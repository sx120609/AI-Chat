import { estimateChatCostForModel, getChatModel } from "@/lib/models";
import { formatRecentChatHistoryForPrompt } from "@/lib/chat-history";
import { formatMemoriesForPrompt, listUserMemories } from "@/lib/memories";
import { maybeNotifyLowBalance, notifyTaskFinished } from "@/lib/notifications";
import { formatPersonalizationForPrompt, parsePersonalizationSettings } from "@/lib/personalization";
import { prisma } from "@/lib/prisma";
import { assertQuotaAvailable, QuotaError } from "@/lib/quota";
import { resolveSystemPrompt } from "@/lib/system-prompt";
import { compactTitle, estimateTokens } from "@/lib/tokens";
import { createResponseText, getAiRuntimeSettings, type UpstreamMessage } from "@/lib/upstream";

type TaskLike = {
  createdAt: Date;
  enabled: boolean;
  id: string;
  lastRunAt: Date | null;
  lastStatus: string;
  nextRunAt: Date | null;
  project?: { name: string } | null;
  projectId?: string | null;
  prompt: string;
  schedule: string;
  timezone: string;
  title: string;
  updatedAt: Date;
};

export type RunTaskResult = {
  conversationId?: string;
  error?: string;
  skipped?: boolean;
  taskId: string;
};

export function taskToView(task: TaskLike) {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    projectId: task.projectId ?? null,
    projectName: task.project?.name ?? null,
    schedule: task.schedule,
    timezone: task.timezone,
    enabled: task.enabled,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    lastStatus: task.lastStatus,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString()
  };
}

export function nextRunAfter(schedule: string, from: Date) {
  if (schedule === "daily") {
    return new Date(from.getTime() + 24 * 60 * 60 * 1000);
  }

  if (schedule === "weekly") {
    return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  if (schedule === "monthly") {
    const next = new Date(from);

    next.setMonth(next.getMonth() + 1);
    return next;
  }

  return null;
}

export async function runUserTask({
  claimDue = false,
  signal,
  taskId,
  userId
}: {
  claimDue?: boolean;
  signal?: AbortSignal;
  taskId: string;
  userId: string;
}): Promise<RunTaskResult> {
  const now = new Date();

  if (claimDue) {
    const claimed = await prisma.userTask.updateMany({
      where: {
        id: taskId,
        userId,
        enabled: true,
        nextRunAt: { lte: now }
      },
      data: {
        lastStatus: "running"
      }
    });

    if (claimed.count === 0) {
      return { skipped: true, taskId };
    }
  }

  const task = await prisma.userTask.findFirst({
    where: { id: taskId, userId },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          instructions: true,
          defaultModel: true,
          memoryScope: true
        }
      },
      user: {
        select: {
          id: true,
          active: true,
          aiStylePrompt: true
        }
      }
    }
  });

  if (!task || !task.user.active) {
    return { error: "任务不存在或用户已停用。", taskId };
  }

  if (!claimDue) {
    await prisma.userTask.update({
      where: { id: task.id },
      data: { lastStatus: "running" }
    });
  }

  const settings = await getAiRuntimeSettings();
  const model = getChatModel(task.project?.defaultModel || undefined, settings.chatModels);
  const taskPrompt = `请执行这个定时任务：${task.title}\n\n${task.prompt}`;
  const baseSystemPrompt = resolveSystemPrompt({
    mode: settings.systemPromptMode,
    customSystemPrompt: settings.customSystemPrompt,
    modelSystemPrompt:
      settings.modelSystemPrompts[model.id] || settings.modelSystemPrompts[model.upstreamId],
    modelLabel: model.label
  });
  const personalizationSettings = parsePersonalizationSettings(task.user.aiStylePrompt);
  const personalizationPrompt = formatPersonalizationForPrompt(task.user.aiStylePrompt);
  const projectMemoryScope = task.project?.memoryScope ?? "account";
  const projectAllowsMemory = projectMemoryScope !== "off";
  const memoryProjectId = projectMemoryScope === "project" ? task.projectId : null;
  const savedMemoryPrompt =
    personalizationSettings.savedMemoryEnabled && projectAllowsMemory
      ? formatMemoriesForPrompt(await listUserMemories(userId, { projectId: memoryProjectId }), {
          profileNickname: personalizationSettings.about.nickname
        })
      : "";
  const chatHistoryPrompt =
    personalizationSettings.chatHistoryMemoryEnabled && projectAllowsMemory
      ? await formatRecentChatHistoryForPrompt({
          projectId: projectMemoryScope === "project" ? task.projectId : null,
          userId
        })
      : "";
  const projectPrompt = task.project
    ? [
        `当前项目：${task.project.name}`,
        task.project.instructions ? `项目专属指令：${task.project.instructions}` : "",
        projectMemoryScope === "project"
          ? "当前项目只引用项目范围内的记忆。"
          : projectMemoryScope === "off"
            ? "当前项目不引用长期记忆。"
            : ""
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const systemPrompt = [
    baseSystemPrompt,
    projectPrompt ? `项目上下文：\n${projectPrompt}` : "",
    personalizationPrompt ? `用户偏好的回答风格：\n${personalizationPrompt}` : "",
    savedMemoryPrompt,
    chatHistoryPrompt
  ]
    .filter(Boolean)
    .join("\n\n");
  const messages: UpstreamMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: taskPrompt }
  ];
  const promptTokens = estimateTokens(`${systemPrompt}\n${taskPrompt}`);
  const estimatedCostCents = estimateChatCostForModel(model, promptTokens, 800);

  try {
    await assertQuotaAvailable(userId, estimatedCostCents);
    const answer = await createResponseText(model.id, messages, settings, { signal });
    const completionTokens = Math.max(1, estimateTokens(answer));
    const totalTokens = promptTokens + completionTokens;
    const cost = estimateChatCostForModel(model, promptTokens, completionTokens);
    const conversation = await prisma.conversation.create({
      data: {
        userId,
        projectId: task.projectId,
        title: compactTitle(task.title),
        model: model.id,
        mode: "CHAT",
        messages: {
          create: [
            {
              role: "USER",
              content: taskPrompt,
              model: model.id,
              mode: "CHAT"
            },
            {
              role: "ASSISTANT",
              content: answer || "任务已执行，但模型没有返回可见内容。",
              model: model.id,
              mode: "CHAT",
              promptTokens,
              completionTokens,
              totalTokens,
              estimatedCostCents: cost,
              usageSource: "estimated"
            }
          ]
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });
    const assistantMessage = conversation.messages[0];

    await prisma.usageRecord.create({
      data: {
        userId,
        conversationId: conversation.id,
        messageId: assistantMessage?.id,
        model: model.id,
        mode: "CHAT",
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostCents: cost,
        usageSource: "estimated"
      }
    });
    await maybeNotifyLowBalance(userId).catch(() => undefined);

    const finishedAt = new Date();
    const nextRunAt = nextRunAfter(task.schedule, finishedAt);

    await prisma.userTask.update({
      where: { id: task.id },
      data: {
        enabled: task.schedule === "once" ? false : task.enabled,
        lastRunAt: finishedAt,
        lastStatus: "done",
        nextRunAt
      }
    });
    await notifyTaskFinished({
      conversationId: conversation.id,
      taskId: task.id,
      taskTitle: task.title,
      userId
    }).catch(() => undefined);

    return {
      conversationId: conversation.id,
      taskId: task.id
    };
  } catch (error) {
    const message = error instanceof QuotaError ? error.message : error instanceof Error ? error.message : "运行任务失败。";

    await prisma.userTask.update({
      where: { id: task.id },
      data: {
        lastRunAt: new Date(),
        lastStatus: `error: ${message}`.slice(0, 200)
      }
    });
    await notifyTaskFinished({
      error: message,
      taskId: task.id,
      taskTitle: task.title,
      userId
    }).catch(() => undefined);

    return {
      error: message,
      taskId: task.id
    };
  }
}

export async function runDueTasks({
  limit = 10,
  signal,
  userId
}: {
  limit?: number;
  signal?: AbortSignal;
  userId?: string;
}) {
  const now = new Date();
  const tasks = await prisma.userTask.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      ...(userId ? { userId } : {})
    },
    orderBy: [{ nextRunAt: "asc" }, { createdAt: "asc" }],
    take: Math.max(1, Math.min(limit, 50)),
    select: {
      id: true,
      userId: true
    }
  });
  const results: RunTaskResult[] = [];

  for (const task of tasks) {
    if (signal?.aborted) {
      break;
    }

    results.push(
      await runUserTask({
        claimDue: true,
        signal,
        taskId: task.id,
        userId: task.userId
      })
    );
  }

  return {
    checkedAt: now.toISOString(),
    due: tasks.length,
    results,
    ran: results.filter((result) => result.conversationId).length,
    skipped: results.filter((result) => result.skipped).length,
    failed: results.filter((result) => result.error).length
  };
}
