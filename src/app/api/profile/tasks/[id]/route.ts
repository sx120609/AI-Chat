import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { nextRunAfter, taskToView } from "@/lib/tasks";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type TaskBody = {
  enabled?: boolean;
  nextRunAt?: string | null;
  prompt?: string;
  projectId?: string | null;
  schedule?: string;
  timezone?: string;
  title?: string;
};

function normalizeSchedule(value: unknown) {
  return typeof value === "string" && /^(once|daily|weekly|monthly)$/.test(value)
    ? value
    : undefined;
}

function normalizeNextRunAt(value: unknown) {
  if (value === null || value === "") {
    return null;
  }

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function defaultNextRunAt(schedule: string) {
  if (schedule === "once") {
    return new Date(Date.now() + 60 * 60 * 1000);
  }

  return nextRunAfter(schedule, new Date());
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: TaskBody;

  try {
    body = await readJson<TaskBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新任务失败。", 400);
  }

  const { id } = await context.params;
  const existing = await prisma.userTask.findFirst({
    where: { id, userId: currentUser.id }
  });

  if (!existing) {
    return jsonError("任务不存在。", 404);
  }

  const nextRunAt = normalizeNextRunAt(body.nextRunAt);
  const schedule = normalizeSchedule(body.schedule);
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : undefined;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : undefined;

  if ("schedule" in body && !schedule) {
    return jsonError("运行频率无效。", 400);
  }

  if ("nextRunAt" in body && nextRunAt === undefined) {
    return jsonError("下次运行时间无效。", 400);
  }

  if (typeof body.title === "string" && !title) {
    return jsonError("任务标题不能为空。", 400);
  }

  if (typeof body.prompt === "string" && !prompt) {
    return jsonError("任务提示词不能为空。", 400);
  }

  const data: {
    enabled?: boolean;
    nextRunAt?: Date | null;
    projectId?: string | null;
    prompt?: string;
    schedule?: string;
    timezone?: string;
    title?: string;
  } = {
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(prompt !== undefined ? { prompt } : {}),
    ...(schedule ? { schedule } : {}),
    ...(typeof body.timezone === "string" ? { timezone: body.timezone.trim().slice(0, 80) } : {}),
    ...(nextRunAt !== undefined ? { nextRunAt } : {})
  };
  const nextSchedule = schedule ?? existing.schedule;

  if (body.enabled === false && nextRunAt === undefined) {
    data.nextRunAt = null;
  }

  if (
    nextRunAt === undefined &&
    !existing.nextRunAt &&
    (body.enabled === true || (body.enabled === undefined && schedule && existing.enabled))
  ) {
    data.nextRunAt = defaultNextRunAt(nextSchedule);
  }

  if ("projectId" in body) {
    const projectId =
      typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;

    if (projectId) {
      const project = await prisma.userProject.findFirst({
        where: { id: projectId, userId: currentUser.id },
        select: { id: true }
      });

      if (!project) {
        return jsonError("项目不存在。", 404);
      }
    }

    data.projectId = projectId;
  }

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新的内容。", 400);
  }

  const task = await prisma.userTask.update({
    where: { id },
    data,
    include: {
      project: {
        select: { name: true }
      }
    }
  });

  return NextResponse.json({ task: taskToView(task) });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const { id } = await context.params;
  const deleted = await prisma.userTask.deleteMany({
    where: {
      id,
      userId: currentUser.id
    }
  });

  if (deleted.count === 0) {
    return jsonError("任务不存在。", 404);
  }

  return NextResponse.json({ id });
}
