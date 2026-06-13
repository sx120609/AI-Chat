import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { getChatModel, isChatModel, type ChatModelConfig } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { getAiRuntimeSettings } from "@/lib/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectBody = {
  defaultModel?: string;
  instructions?: string;
  memoryScope?: string;
  name?: string;
};

function projectToView(project: {
  _count?: {
    attachments?: number;
    conversations?: number;
    memories?: number;
    tasks?: number;
  };
  createdAt: Date;
  defaultModel: string;
  id: string;
  instructions: string;
  memoryScope: string;
  name: string;
  updatedAt: Date;
}) {
  return {
    id: project.id,
    name: project.name,
    instructions: project.instructions,
    memoryScope: project.memoryScope,
    defaultModel: project.defaultModel,
    counts: {
      attachments: project._count?.attachments ?? 0,
      conversations: project._count?.conversations ?? 0,
      memories: project._count?.memories ?? 0,
      tasks: project._count?.tasks ?? 0
    },
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}

function normalizeMemoryScope(value: unknown) {
  return typeof value === "string" && /^(account|project|off)$/.test(value)
    ? value
    : "account";
}

function normalizeDefaultModel(value: unknown, chatModels: ChatModelConfig[]) {
  const modelId = typeof value === "string" ? value.trim().slice(0, 80) : "";

  if (!modelId) {
    return "";
  }

  if (!isChatModel(modelId, chatModels)) {
    return null;
  }

  return getChatModel(modelId, chatModels).id;
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

  const projects = await prisma.userProject.findMany({
    where: { userId: currentUser.id },
    include: {
      _count: {
        select: {
          attachments: true,
          conversations: true,
          memories: true,
          tasks: true
        }
      }
    },
    orderBy: { updatedAt: "desc" }
  });

  return NextResponse.json({ projects: projects.map(projectToView) });
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

  let body: ProjectBody;

  try {
    body = await readJson<ProjectBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "创建项目偏好失败。", 400);
  }

  const name = body.name?.trim().slice(0, 80);

  if (!name) {
    return jsonError("项目名称不能为空。", 400);
  }

  if ("memoryScope" in body && !/^(account|project|off)$/.test(String(body.memoryScope))) {
    return jsonError("记忆范围无效。", 400);
  }

  const aiSettings = await getAiRuntimeSettings();
  const defaultModel = normalizeDefaultModel(body.defaultModel, aiSettings.chatModels);

  if (defaultModel === null) {
    return jsonError("默认模型不可用或未启用。", 400);
  }

  const project = await prisma.userProject.create({
    data: {
      userId: currentUser.id,
      name,
      instructions: body.instructions?.trim().slice(0, 2000) || "",
      memoryScope: normalizeMemoryScope(body.memoryScope),
      defaultModel
    },
    include: {
      _count: {
        select: {
          attachments: true,
          conversations: true,
          memories: true,
          tasks: true
        }
      }
    }
  });

  return NextResponse.json({ project: projectToView(project) }, { status: 201 });
}
