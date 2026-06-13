import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import type { AttachmentKind, AttachmentView } from "@/types/gateway";

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 8;
export const MAX_EXTRACTED_TEXT_CHARS = 80_000;
const MAX_ARCHIVE_LISTED_ENTRIES = 200;
const MAX_ARCHIVE_EXTRACTED_ENTRIES = 30;
const MAX_ARCHIVE_ENTRY_BYTES = 8 * 1024 * 1024;

type AttachmentLike = {
  id: string;
  project?: {
    name: string;
  } | null;
  projectId?: string | null;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extractedText: string | null;
  storagePath: string;
  temporary?: boolean | null;
  createdAt: Date;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".c": "text/x-c",
  ".conf": "text/plain",
  ".cpp": "text/x-c++",
  ".cs": "text/x-csharp",
  ".csv": "text/csv",
  ".css": "text/css",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".go": "text/x-go",
  ".gif": "image/gif",
  ".h": "text/x-c",
  ".html": "text/html",
  ".java": "text/x-java",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/jsx",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".py": "text/x-python",
  ".rs": "text/x-rust",
  ".rtf": "application/rtf",
  ".sql": "application/x-sql",
  ".ts": "text/x-typescript",
  ".tsx": "text/tsx",
  ".tsv": "text/tsv",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "text/xml",
  ".yaml": "text/x-yaml",
  ".yml": "text/x-yaml",
  ".zip": "application/zip"
};
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");

const KIND_BY_MIME: Array<{ pattern: RegExp; kind: AttachmentKind }> = [
  { pattern: /^image\//, kind: "IMAGE" },
  { pattern: /^text\//, kind: "TEXT" },
  { pattern: /^application\/(?:json|javascript|typescript|x-sql)$/, kind: "TEXT" },
  { pattern: /^application\/pdf$/, kind: "DOCUMENT" },
  { pattern: /^application\/msword$/, kind: "DOCUMENT" },
  { pattern: /^application\/rtf$/, kind: "DOCUMENT" },
  { pattern: /^application\/vnd\.oasis\.opendocument\.text$/, kind: "DOCUMENT" },
  {
    pattern: /^application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document$/,
    kind: "DOCUMENT"
  },
  { pattern: /^application\/vnd\.ms-powerpoint$/, kind: "DOCUMENT" },
  {
    pattern: /^application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation$/,
    kind: "DOCUMENT"
  },
  { pattern: /^application\/vnd\.ms-excel$/, kind: "SPREADSHEET" },
  {
    pattern: /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet$/,
    kind: "SPREADSHEET"
  },
  {
    pattern: /^application\/(?:zip|x-zip-compressed)$/,
    kind: "ARCHIVE"
  }
];
const ARCHIVE_TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".log",
  ".md",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml"
]);
let pdfWorkerConfigured = false;

function extensionFromName(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

export function normalizeAttachmentMime(fileName: string, mimeType: string) {
  const fromExtension = MIME_BY_EXTENSION[extensionFromName(fileName)];
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim();

  if (!normalized || normalized === "application/octet-stream") {
    return fromExtension || "application/octet-stream";
  }

  return normalized;
}

export function attachmentKindFromMime(mimeType: string): AttachmentKind | null {
  return KIND_BY_MIME.find((item) => item.pattern.test(mimeType))?.kind ?? null;
}

function startsWithBytes(buffer: Buffer, bytes: number[]) {
  return bytes.every((byte, index) => buffer[index] === byte);
}

function hasSupportedImageSignature(mimeType: string, buffer: Buffer) {
  const header = buffer.subarray(0, 12);

  if (mimeType === "image/gif") {
    const gifHeader = header.subarray(0, 6).toString("ascii");

    return gifHeader === "GIF87a" || gifHeader === "GIF89a";
  }

  if (mimeType === "image/png") {
    return startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }

  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return startsWithBytes(header, [0xff, 0xd8, 0xff]);
  }

  if (mimeType === "image/webp") {
    return header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WEBP";
  }

  return false;
}

function isLikelyTextBuffer(buffer: Buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 8192));

  if (sample.includes(0)) {
    return false;
  }

  const text = sample.toString("utf8");
  const replacementCount = text.match(/\uFFFD/g)?.length ?? 0;

  if (replacementCount > Math.max(2, text.length * 0.01)) {
    return false;
  }

  let controlCount = 0;
  let readableCount = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);

    if (code === 9 || code === 10 || code === 13) {
      continue;
    }

    if (code < 32) {
      controlCount += 1;
    } else {
      readableCount += 1;
    }
  }

  return readableCount > 0 && controlCount / Math.max(1, readableCount + controlCount) < 0.02;
}

function detectBufferAttachmentType(mimeType: string, buffer: Buffer | undefined) {
  if (!buffer) {
    return null;
  }

  if (mimeType.startsWith("image/")) {
    if (hasSupportedImageSignature(mimeType, buffer)) {
      return null;
    }

    return isLikelyTextBuffer(buffer)
      ? { kind: "TEXT" as const, mimeType: "text/plain" }
      : { kind: "FILE" as const, mimeType: "application/octet-stream" };
  }

  if (mimeType === "application/octet-stream" && isLikelyTextBuffer(buffer)) {
    return { kind: "TEXT" as const, mimeType: "text/plain" };
  }

  return null;
}

export function validateAttachment(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  buffer?: Buffer
) {
  if (sizeBytes <= 0) {
    throw new Error("文件为空。");
  }

  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error("单个附件不能超过 50 MB。");
  }

  const normalizedMime = normalizeAttachmentMime(fileName, mimeType);
  const detectedType = detectBufferAttachmentType(normalizedMime, buffer);

  if (detectedType) {
    return detectedType;
  }

  const kind = attachmentKindFromMime(normalizedMime) ?? "FILE";

  return { kind, mimeType: normalizedMime };
}

function truncateExtractedText(text: string) {
  const normalized = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();

  if (normalized.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n\n[附件内容过长，已截断]`;
}

function printableFallback(buffer: Buffer) {
  return truncateExtractedText(
    buffer
      .toString("latin1")
      .replace(/[^\t\n\r -~\u00a0-\uffff]+/g, " ")
      .replace(/[ \t]{2,}/g, " ")
  );
}

function configurePdfWorker() {
  if (pdfWorkerConfigured) {
    return;
  }

  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdf-parse",
    "dist",
    "pdf-parse",
    "esm",
    "pdf.worker.mjs"
  );

  PDFParse.setWorker(pathToFileURL(workerPath).href);
  pdfWorkerConfigured = true;
}

function cellValueToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== "object") {
    return String(value);
  }

  const record = value as {
    formula?: unknown;
    result?: unknown;
    richText?: Array<{ text?: unknown }>;
    text?: unknown;
  };

  if (record.text !== undefined) {
    return String(record.text);
  }

  if (record.result !== undefined) {
    return cellValueToText(record.result);
  }

  if (Array.isArray(record.richText)) {
    return record.richText.map((item) => String(item.text ?? "")).join("");
  }

  if (record.formula !== undefined) {
    return String(record.formula);
  }

  return String(value);
}

async function spreadsheetToText(buffer: Buffer, mimeType: string) {
  if (mimeType === "application/vnd.ms-excel") {
    return printableFallback(buffer);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets: string[] = [];

  workbook.eachSheet((sheet) => {
    const rows: string[] = [];

    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map(cellValueToText).join(","));
    });

    sheets.push(`# ${sheet.name}\n${rows.join("\n")}`);
  });

  return truncateExtractedText(sheets.join("\n\n"));
}

function formatArchiveBytes(bytes: number | undefined) {
  if (bytes === undefined) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function zipEntrySize(entry: JSZip.JSZipObject) {
  const internalEntry = entry as JSZip.JSZipObject & {
    _data?: {
      uncompressedSize?: number;
    };
  };

  return internalEntry._data?.uncompressedSize;
}

function shouldSkipArchiveEntry(entry: JSZip.JSZipObject) {
  const name = entry.name.replaceAll("\\", "/");

  return (
    entry.dir ||
    name.startsWith("__MACOSX/") ||
    name.endsWith("/.DS_Store") ||
    name.includes("/.DS_Store/")
  );
}

function canExtractArchiveEntry(entryName: string) {
  const mimeType = normalizeAttachmentMime(entryName, "");
  const kind = attachmentKindFromMime(mimeType);

  return (
    kind === "TEXT" ||
    kind === "DOCUMENT" ||
    kind === "SPREADSHEET" ||
    ARCHIVE_TEXT_EXTENSIONS.has(extensionFromName(entryName))
  );
}

async function extractArchiveEntryText(entry: JSZip.JSZipObject) {
  const entryName = entry.name.replaceAll("\\", "/");
  const mimeType = normalizeAttachmentMime(entryName, "");
  const kind = attachmentKindFromMime(mimeType);

  if (!canExtractArchiveEntry(entryName) || kind === "ARCHIVE" || kind === "IMAGE") {
    return null;
  }

  const size = zipEntrySize(entry);

  if (size !== undefined && size > MAX_ARCHIVE_ENTRY_BYTES) {
    return `[${entryName} 过大，已跳过自动提取：${formatArchiveBytes(size)}]`;
  }

  const buffer = await entry.async("nodebuffer");

  if (buffer.byteLength > MAX_ARCHIVE_ENTRY_BYTES) {
    return `[${entryName} 过大，已跳过自动提取：${formatArchiveBytes(buffer.byteLength)}]`;
  }

  if (kind === "DOCUMENT" || kind === "SPREADSHEET") {
    return extractAttachmentText({
      buffer,
      kind,
      mimeType,
      originalName: entryName
    });
  }

  return truncateExtractedText(buffer.toString("utf8").replace(/^\uFEFF/, ""));
}

async function archiveToText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter((entry) => !shouldSkipArchiveEntry(entry))
    .sort((a, b) => a.name.localeCompare(b.name));
  const listedEntries = entries.slice(0, MAX_ARCHIVE_LISTED_ENTRIES);
  const fileList = listedEntries.map((entry) => {
    const size = formatArchiveBytes(zipEntrySize(entry));

    return `- ${entry.name}${size ? ` (${size})` : ""}`;
  });
  const extractedBlocks: string[] = [];
  const skippedNotes: string[] = [];

  for (const entry of entries) {
    if (extractedBlocks.length >= MAX_ARCHIVE_EXTRACTED_ENTRIES) {
      break;
    }

    if (!canExtractArchiveEntry(entry.name)) {
      continue;
    }

    try {
      const text = await extractArchiveEntryText(entry);

      if (!text?.trim()) {
        continue;
      }

      extractedBlocks.push(`## ${entry.name}\n${text.trim()}`);
    } catch (error) {
      skippedNotes.push(
        `- ${entry.name}: ${error instanceof Error ? error.message : "提取失败"}`
      );
    }
  }

  const sections = [
    `ZIP 压缩包内容摘要：共 ${entries.length} 个文件。`,
    [
      "文件列表：",
      fileList.join("\n"),
      entries.length > listedEntries.length
        ? `... 还有 ${entries.length - listedEntries.length} 个文件未展示`
        : ""
    ]
      .filter(Boolean)
      .join("\n"),
    extractedBlocks.length
      ? [
          `已自动提取 ${extractedBlocks.length} 个可读文件的内容：`,
          extractedBlocks.join("\n\n")
        ].join("\n")
      : "未自动提取到可读文本。若启用了代码解释器，模型仍可在 Docker 沙箱中使用 Python 标准库 zipfile 解包分析。",
    skippedNotes.length ? `跳过的条目：\n${skippedNotes.slice(0, 20).join("\n")}` : ""
  ].filter(Boolean);

  return truncateExtractedText(sections.join("\n\n"));
}

export async function extractAttachmentText(options: {
  buffer: Buffer;
  kind: AttachmentKind;
  mimeType: string;
  originalName: string;
}) {
  const { buffer, kind, mimeType, originalName } = options;

  if (kind === "IMAGE") {
    return null;
  }

  try {
    if (kind === "TEXT") {
      return truncateExtractedText(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    }

    if (mimeType === "application/pdf") {
      configurePdfWorker();
      const parser = new PDFParse({ data: new Uint8Array(buffer) });

      try {
        const parsed = await parser.getText();
        return truncateExtractedText(parsed.text || "");
      } finally {
        await parser.destroy();
      }
    }

    if (mimeType.includes("wordprocessingml")) {
      const parsed = await mammoth.extractRawText({ buffer });
      return truncateExtractedText(parsed.value || "");
    }

    if (mimeType === "application/msword") {
      return printableFallback(buffer);
    }

    if (kind === "SPREADSHEET") {
      return spreadsheetToText(buffer, mimeType);
    }

    if (kind === "ARCHIVE") {
      return archiveToText(buffer);
    }
  } catch (error) {
    console.warn(
      `[attachments] Failed to extract text from ${originalName}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }

  if (extensionFromName(originalName) === ".csv") {
    return truncateExtractedText(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  }

  return null;
}

export async function saveAttachmentBuffer(options: {
  buffer: Buffer;
  originalName: string;
  userId: string;
}) {
  const id = randomUUID();
  const ext = extensionFromName(options.originalName);
  const relativeDirectory = options.userId;
  const relativePath = path.join("uploads", relativeDirectory, `${id}${ext}`);
  const absoluteDirectory = path.join(UPLOADS_ROOT, relativeDirectory);
  const absolutePath = path.join(absoluteDirectory, `${id}${ext}`);

  await mkdir(absoluteDirectory, { recursive: true });
  await writeFile(absolutePath, options.buffer);

  return relativePath;
}

export async function readAttachmentBuffer(attachment: Pick<AttachmentLike, "storagePath">) {
  return readFile(attachmentAbsolutePath(attachment));
}

export function attachmentAbsolutePath(attachment: Pick<AttachmentLike, "storagePath">) {
  const normalized = attachment.storagePath.replaceAll("\\", "/");
  const relativePath = normalized.startsWith("uploads/")
    ? normalized.slice("uploads/".length)
    : normalized;

  return path.join(UPLOADS_ROOT, relativePath);
}

export async function extractStoredAttachmentText(
  attachment: Pick<AttachmentLike, "kind" | "mimeType" | "originalName" | "storagePath">
) {
  if (attachment.kind === "IMAGE") {
    return null;
  }

  const buffer = await readAttachmentBuffer(attachment);

  return extractAttachmentText({
    buffer,
    kind: attachment.kind as AttachmentKind,
    mimeType: attachment.mimeType,
    originalName: attachment.originalName
  });
}

export async function deleteAttachmentFiles(attachments: Array<Pick<AttachmentLike, "storagePath">>) {
  await Promise.all(
    attachments.map((attachment) =>
      readAttachmentBuffer(attachment)
        .then(() => {
          const normalized = attachment.storagePath.replaceAll("\\", "/");
          const relativePath = normalized.startsWith("uploads/")
            ? normalized.slice("uploads/".length)
            : normalized;

          return unlink(path.join(UPLOADS_ROOT, relativePath));
        })
        .catch(() => undefined)
    )
  );
}

export function attachmentDataUrl(attachment: Pick<AttachmentLike, "mimeType" | "storagePath">) {
  return readAttachmentBuffer(attachment).then(
    (buffer) => `data:${attachment.mimeType};base64,${buffer.toString("base64")}`
  );
}

export function attachmentToView(attachment: AttachmentLike): AttachmentView {
  const kind = attachment.kind as AttachmentKind;

  return {
    id: attachment.id,
    projectId: attachment.projectId ?? null,
    projectName: attachment.project?.name ?? null,
    kind,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    extractedText: attachment.extractedText,
    temporary: Boolean(attachment.temporary),
    previewUrl: kind === "IMAGE" ? `/api/attachments/${attachment.id}/content` : undefined,
    createdAt: attachment.createdAt.toISOString()
  };
}

export function attachmentContextBlock(attachments: Array<Pick<AttachmentLike, "kind" | "originalName" | "mimeType" | "extractedText">>) {
  const blocks = attachments.map((attachment) => {
    if (attachment.kind === "IMAGE") {
      return `[图片附件: ${attachment.originalName} (${attachment.mimeType})]`;
    }

    if (attachment.kind === "ARCHIVE") {
      return `[压缩包附件: ${attachment.originalName} (${attachment.mimeType})]\n${
        attachment.extractedText?.trim() || "未能提取压缩包目录或可读文本。"
      }`;
    }

    if (attachment.kind === "FILE") {
      return `[文件附件: ${attachment.originalName} (${attachment.mimeType})]\n${
        attachment.extractedText?.trim() ||
        "已上传原始文件，但当前没有可直接加入聊天上下文的文本内容。"
      }`;
    }

    if (!attachment.extractedText?.trim()) {
      return `[附件: ${attachment.originalName} (${attachment.mimeType})]\n未能提取可用文本。`;
    }

    return `[附件: ${attachment.originalName} (${attachment.mimeType})]\n${attachment.extractedText}`;
  });

  return blocks.length ? blocks.join("\n\n") : "";
}

export function contentWithAttachmentContext(
  content: string,
  attachments: Array<Pick<AttachmentLike, "kind" | "originalName" | "mimeType" | "extractedText">>
) {
  const attachmentContext = attachmentContextBlock(attachments);

  if (!attachmentContext) {
    return content;
  }

  return `${content}\n\n---\n用户上传的附件内容：\n${attachmentContext}`;
}
