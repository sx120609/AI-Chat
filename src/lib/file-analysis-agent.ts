import {
  attachmentAbsolutePath,
  attachmentDataUrl,
  readAttachmentBuffer
} from "@/lib/attachments";
import {
  runPythonInSandbox,
  type CodeInterpreterRuntimeSettings,
  type SandboxInputFile
} from "@/lib/code-interpreter";
import { LIGHTWEIGHT_TASK_MODEL_ID } from "@/lib/models";
import {
  createResponseText,
  uploadResponseFile,
  type AiRuntimeSettings,
  type UpstreamMessage
} from "@/lib/upstream";

type AttachmentForAnalysis = {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  extractedText: string | null;
};

type PlannerResponse = {
  code?: unknown;
  packages?: unknown;
  plan?: unknown;
};

const MAX_TOOL_REPORT_CHARS = 16_000;
const MAX_PLANNER_RESPONSE_CHARS = 24_000;
const MAX_SPARK_DIRECT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PREVIEW_TEXT_CHARS = 12_000;
const CODE_ANALYSIS_PROMPT_PATTERN =
  /(代码解释器|运行代码|python|脚本|沙盒|计算|统计|数据分析|数据处理|表格分析|求和|平均|均值|中位数|排序|筛选|分组|图表|画图|可视化|回归|预测|excel|csv|zip|压缩包|解压|文件列表|目录|ocr)/i;

function shouldAnalyzeWithCode(attachments: AttachmentForAnalysis[], prompt: string) {
  if (!attachments.some((attachment) => attachment.kind !== "IMAGE")) {
    return false;
  }

  if (attachments.some((attachment) => attachment.kind === "SPREADSHEET" || attachment.kind === "ARCHIVE")) {
    return true;
  }

  return CODE_ANALYSIS_PROMPT_PATTERN.test(prompt);
}

function jsonFromPlannerResponse(text: string): PlannerResponse | null {
  const trimmed = text.trim().slice(0, MAX_PLANNER_RESPONSE_CHARS);
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate) as PlannerResponse;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(candidate.slice(start, end + 1)) as PlannerResponse;
    } catch {
      return null;
    }
  }
}

function textFileName(index: number, attachment: AttachmentForAnalysis) {
  return `extracted-${index + 1}-${attachment.originalName}.txt`;
}

function buildSandboxFiles(attachments: AttachmentForAnalysis[]): SandboxInputFile[] {
  return attachments.flatMap((attachment, index) => {
    const files: SandboxInputFile[] = [
      {
        name: `${index + 1}-${attachment.originalName}`,
        sourcePath: attachmentAbsolutePath(attachment)
      }
    ];

    if (attachment.extractedText?.trim()) {
      files.push({
        content: attachment.extractedText,
        name: textFileName(index, attachment)
      });
    }

    return files;
  });
}

function buildPlannerMessages(options: {
  attachments: AttachmentForAnalysis[];
  allowPackageInstall: boolean;
  prompt: string;
}): UpstreamMessage[] {
  const files = options.attachments
    .map((attachment, index) => {
      const extracted = attachment.extractedText?.trim()
        ? `同时提供 ${textFileName(index, attachment)}，里面是后端已提取文本。`
        : "没有可用的已提取文本。";

      return `${index + 1}. ${attachment.originalName} (${attachment.mimeType}, ${attachment.sizeBytes} bytes). ${extracted}`;
    })
    .join("\n");

  return [
    {
      role: "system",
      content:
        "你是文件分析代码规划器。你不会回答用户问题，只生成可在受限 Python 沙箱中运行的代码。只返回 JSON，不要 Markdown，不要解释隐藏推理。JSON 结构必须是 {\"plan\":\"一句话计划\",\"packages\":[\"可选包名\"],\"code\":\"Python 代码\"}。代码只能读取 /workspace/inputs，输出写入 /workspace/outputs，可打印简短分析结果。不要访问环境变量、密钥、网络、本机路径或 /workspace 以外路径。遇到 ZIP 压缩包时，优先使用 Python 标准库 zipfile 在沙箱内列目录、读取文本或解压到 /workspace/outputs。"
    },
    {
      role: "user",
      content: `用户请求：${options.prompt}\n\n可用文件：\n${files}\n\n${
        options.allowPackageInstall
          ? "如确有必要，可在 packages 中声明 PyPI 包名；优先使用标准库和已提取文本。"
          : "管理员未允许安装额外包，请只使用 Python 标准库和已提取文本。"
      }`
    }
  ];
}

function nonImageAttachments(attachments: AttachmentForAnalysis[]) {
  return attachments.filter((attachment) => attachment.kind !== "IMAGE");
}

function attachmentMetadataLine(
  attachment: AttachmentForAnalysis,
  index: number,
  includeExtractedText: boolean
) {
  const extracted = includeExtractedText && attachment.extractedText?.trim()
    ? `\n已提取文本备份：\n${attachment.extractedText.trim().slice(0, MAX_PREVIEW_TEXT_CHARS)}`
    : "";

  return [
    `## 附件 ${index + 1}`,
    `文件名：${attachment.originalName}`,
    `后端初步类型：${attachment.kind}`,
    `MIME：${attachment.mimeType}`,
    `大小：${attachment.sizeBytes} bytes`,
    extracted || "未附带本地提取文本；请优先读取原始文件。"
  ].join("\n");
}

function buildFilePreAnalysisPrompt(options: {
  attachments: AttachmentForAnalysis[];
  prompt: string;
  rawFilesIncluded: boolean;
}) {
  const files = options.attachments
    .map((attachment, index) =>
      attachmentMetadataLine(attachment, index, !options.rawFilesIncluded)
    )
    .join("\n\n");

  return [
    `用户请求：${options.prompt}`,
    `原始文件随本次预分析请求发送：${options.rawFilesIncluded ? "是" : "否"}`,
    "请作为轻量附件预处理器帮助主模型判断如何处理这些附件。不要回答用户最终问题，只输出给主模型使用的中文预分析报告。",
    "报告需要包含：每个附件的真实格式判断、能读到的关键内容、建议主模型如何分析、是否需要计算/解析/运行代码、任何不确定性或读取失败原因。不要编造没读到的数据。",
    "附件元信息和已提取文本备份：",
    files || "无非图片附件。"
  ].join("\n\n---\n\n");
}

async function buildFilePreAnalysisMessages(options: {
  attachments: AttachmentForAnalysis[];
  includeRawFiles: boolean;
  prompt: string;
  settings: AiRuntimeSettings;
  signal?: AbortSignal;
}): Promise<UpstreamMessage[]> {
  const prompt = buildFilePreAnalysisPrompt({
    attachments: options.attachments,
    prompt: options.prompt,
    rawFilesIncluded: options.includeRawFiles
  });

  return [
    {
      role: "system",
      content:
        "你是 GPT-5.3-Codex-Spark，负责低成本附件预分析。你只做文件类型判断、内容提取摘要和处理建议，不直接完成用户最终任务。输出必须简洁、中文、可供后续主模型引用。"
    },
    {
      role: "user",
      content: options.includeRawFiles
        ? [
            ...(await Promise.all(
              options.attachments.map(async (attachment) => ({
                type: "file" as const,
                file: await preAnalysisFilePart(attachment, options.settings, options.signal)
              }))
            )),
            { type: "text" as const, text: prompt }
          ]
        : prompt
    }
  ];
}

async function preAnalysisFilePart(
  attachment: AttachmentForAnalysis,
  settings: AiRuntimeSettings,
  signal?: AbortSignal
) {
  try {
    const fileId = await uploadResponseFile(
      {
        buffer: await readAttachmentBuffer(attachment),
        filename: attachment.originalName,
        mimeType: attachment.mimeType
      },
      settings,
      { signal }
    );

    return {
      filename: attachment.originalName,
      file_id: fileId
    };
  } catch (error) {
    console.warn(
      `[file-analysis] Failed to upload ${attachment.originalName} to upstream /files for pre-analysis, falling back to file_data:`,
      error instanceof Error ? error.message : error
    );
  }

  return {
    filename: attachment.originalName,
    file_data: await attachmentDataUrl(attachment)
  };
}

function truncateReport(value: string) {
  if (value.length <= MAX_TOOL_REPORT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_TOOL_REPORT_CHARS)}\n\n[工具结果过长，已截断]`;
}

async function maybeRunSparkFilePreAnalysis(options: {
  attachments: AttachmentForAnalysis[];
  prompt: string;
  settings: AiRuntimeSettings;
  signal?: AbortSignal;
}) {
  const attachments = nonImageAttachments(options.attachments);

  if (options.settings.mockResponses || attachments.length === 0) {
    return "";
  }

  const totalBytes = attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0);
  const includeRawFiles = totalBytes <= MAX_SPARK_DIRECT_FILE_BYTES;

  try {
    const analysisText = await createResponseText(
      LIGHTWEIGHT_TASK_MODEL_ID,
      await buildFilePreAnalysisMessages({
        attachments,
        includeRawFiles,
        prompt: options.prompt,
        settings: options.settings,
        signal: options.signal
      }),
      options.settings,
      {
        allowDisabledModel: true,
        signal: options.signal
      }
    );
    const trimmed = analysisText.trim();

    return trimmed
      ? truncateReport(`附件预分析结果（${LIGHTWEIGHT_TASK_MODEL_ID}）：\n\n${trimmed}`)
      : "";
  } catch (error) {
    console.warn(
      "[file-analysis] Spark file pre-analysis failed:",
      error instanceof Error ? error.message : error
    );
    return "";
  }
}

export async function maybeRunFileAnalysisAgent(options: {
  attachments: AttachmentForAnalysis[];
  prompt: string;
  signal?: AbortSignal;
  settings: CodeInterpreterRuntimeSettings & AiRuntimeSettings;
}) {
  const { attachments, settings } = options;
  const reports: string[] = [];
  const preAnalysisReport = await maybeRunSparkFilePreAnalysis({
    attachments,
    prompt: options.prompt,
    settings,
    signal: options.signal
  });

  if (preAnalysisReport) {
    reports.push(preAnalysisReport);
  }

  if (!settings.codeInterpreterEnabled || settings.mockResponses || !shouldAnalyzeWithCode(attachments, options.prompt)) {
    return truncateReport(reports.join("\n\n---\n\n"));
  }

  try {
    const plannerText = await createResponseText(
      LIGHTWEIGHT_TASK_MODEL_ID,
      buildPlannerMessages({
        allowPackageInstall: settings.codeInterpreterAllowPackageInstall,
        attachments,
        prompt: options.prompt
      }),
      settings,
      {
        allowDisabledModel: true,
        signal: options.signal
      }
    );
    const plan = jsonFromPlannerResponse(plannerText);
    const code = typeof plan?.code === "string" ? plan.code.trim() : "";
    const packages = Array.isArray(plan?.packages)
      ? plan.packages.filter((item): item is string => typeof item === "string")
      : [];

    if (!code) {
      return truncateReport(reports.join("\n\n---\n\n"));
    }

    const result = await runPythonInSandbox({
      code,
      files: buildSandboxFiles(attachments),
      packages,
      settings
    });

    reports.push(
      [
        "文件分析工具结果：",
        `计划：${typeof plan?.plan === "string" ? plan.plan : "自动分析上传附件"}`,
        `退出码：${result.exitCode}${result.timedOut ? "（超时）" : ""}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        result.outputFiles.length
          ? `输出文件：${result.outputFiles
              .map((file) => `${file.name} (${file.sizeBytes} bytes)`)
              .join(", ")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n\n")
    );

    return truncateReport(reports.join("\n\n---\n\n"));
  } catch (error) {
    reports.push(
      `文件分析工具未执行成功：${error instanceof Error ? error.message : String(error)}`
    );
    return truncateReport(reports.join("\n\n---\n\n"));
  }
}
