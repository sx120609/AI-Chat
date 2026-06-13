import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { getChatModel, isChatModel, type ChatModelConfig } from "@/lib/models";
import { prisma } from "@/lib/prisma";
import { getAiRuntimeSettings } from "@/lib/upstream";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ProjectBody = {
  defaultModel?: string;
  instructions?: string;
  memoryScope?: string;
  name?: string;
};

function normalizeMemoryScope(value: unknown) {
  return typeof value === "string" && /^(account|project|off)$/.test(value)
    ? value
    : undefined;
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

function projectToView(project: {
  _count?: {
    attachments?: number;
    conversations?: number;
    memories?: number;
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
      memories: project._count?.memories ?? 0
    },
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
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

  let body: ProjectBody;

  try {
    body = await readJson<ProjectBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "更新项目偏好失败。", 400);
  }

  const { id } = await context.params;
  const existing = await prisma.userProject.findFirst({
    where: { id, userId: currentUser.id }
  });

  if (!existing) {
    return jsonError("项目偏好不存在。", 404);
  }

  const memoryScope = normalizeMemoryScope(body.memoryScope);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : undefined;
  const aiSettings = "defaultModel" in body ? await getAiRuntimeSettings() : null;
  const defaultModel =
    "defaultModel" in body ? normalizeDefaultModel(body.defaultModel, aiSettings?.chatModels ?? []) : undefined;

  if (typeof body.name === "string" && !name) {
    return jsonError("项目名称不能为空。", 400);
  }

  if ("memoryScope" in body && !memoryScope) {
    return jsonError("记忆范围无效。", 400);
  }

  if (defaultModel === null) {
    return jsonError("默认模型不可用或未启用。", 400);
  }

  const data = {
    ...(name !== undefined ? { name } : {}),
    ...(typeof body.instructions === "string"
      ? { instructions: body.instructions.trim().slice(0, 2000) }
      : {}),
    ...(memoryScope ? { memoryScope } : {}),
    ...(defaultModel !== undefined ? { defaultModel } : {})
  };

  if (Object.keys(data).length === 0) {
    return jsonError("没有可更新的内容。", 400);
  }

  const project = await prisma.userProject.update({
    where: { id },
    data,
    include: {
      _count: {
        select: {
          attachments: true,
          conversations: true,
          memories: true
        }
      }
    }
  });

  return NextResponse.json({ project: projectToView(project) });
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
  const deleted = await prisma.userProject.deleteMany({
    where: {
      id,
      userId: currentUser.id
    }
  });

  if (deleted.count === 0) {
    return jsonError("项目偏好不存在。", 404);
  }

  return NextResponse.json({ id });
}
