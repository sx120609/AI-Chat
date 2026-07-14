import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, serializeCurrentUser } from "@/lib/auth";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type ProfileBody = {
  aiStylePrompt?: string;
  name?: string;
};

function normalizeAiStylePrompt(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 8000) : "";
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

  return NextResponse.json({ user: serializeCurrentUser(currentUser) });
}

export async function PATCH(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const error = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  let body: ProfileBody;

  try {
    body = await readJson<ProfileBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "保存个人资料失败。", 400);
  }

  const name = body.name?.trim();

  if (!name) {
    return jsonError("昵称不能为空。", 400);
  }

  const user = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      name,
      aiStylePrompt: normalizeAiStylePrompt(body.aiStylePrompt)
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      userGroup: true,
      active: true,
      emailVerified: true,
      aiStylePrompt: true,
      aiPointsBalanceCents: true,
      codingPlanDailyCostLimitCents: true,
      codingPlanExpiresAt: true,
      codingPlanId: true,
      codingPlanMonthlyCostLimitCents: true,
      codingPlanName: true,
      codingPlanPersonalApiEnabled: true,
      codingPlanWeeklyCostLimitCents: true,
      monthlyCostLimitCents: true,
      quotaNextResetAt: true,
      quotaResetAt: true
    }
  });

  return NextResponse.json({ user: serializeCurrentUser(user) });
}
