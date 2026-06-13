import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { nextRunAfter, taskToView } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    : "once";
}

function normalizeNextRunAt(value: unknown) {
  if (value === null || value === "") {
    return null;
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

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const tasks = await prisma.userTask.findMany({
    where: { userId: currentUser.id },
    include: {
      project: {
        select: { name: true }
      }
    },
    orderBy: [{ enabled: "desc" }, { nextRunAt: "asc" }, { createdAt: "desc" }]
  });

  return NextResponse.json({ tasks: tasks.map(taskToView) });
}

export async function POST(request: NextRequest) {
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
    return jsonError(readError instanceof Error ? readError.message : "创建任务失败。", 400);
  }

  const title = body.title?.trim().slice(0, 80);
  const prompt = body.prompt?.trim().slice(0, 4000);
  const nextRunAt = normalizeNextRunAt(body.nextRunAt);
  const schedule = normalizeSchedule(body.schedule);
  const projectId =
    typeof body.projectId === "string" && body.projectId.trim() ? body.projectId.trim() : null;

  if (!title || !prompt) {
    return jsonError("任务标题和提示词不能为空。", 400);
  }

  if (nextRunAt === undefined) {
    return jsonError("下次运行时间无效。", 400);
  }

  if (projectId) {
    const project = await prisma.userProject.findFirst({
      where: { id: projectId, userId: currentUser.id },
      select: { id: true }
    });

    if (!project) {
      return jsonError("项目不存在。", 404);
    }
  }

  const task = await prisma.userTask.create({
    data: {
      userId: currentUser.id,
      projectId,
      title,
      prompt,
      schedule,
      timezone: body.timezone?.trim().slice(0, 80) || "Asia/Hong_Kong",
      enabled: body.enabled !== false,
      nextRunAt: nextRunAt ?? (body.enabled === false ? null : defaultNextRunAt(schedule))
    },
    include: {
      project: {
        select: { name: true }
      }
    }
  });

  return NextResponse.json({ task: taskToView(task) }, { status: 201 });
}
