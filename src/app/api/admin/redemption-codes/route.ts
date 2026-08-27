import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  AI_POINTS_PRODUCT_TYPE,
  CODING_PLAN_PRODUCT_TYPE,
  codingPlanSnapshot,
  normalizeCodingPlanConfig,
  parseCodingPlans
} from "@/lib/coding-plan";
import { coerceInt, jsonError, readJson, requireAdmin } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  encryptRedemptionCode,
  generateRedemptionCode,
  hashRedemptionCode,
  redemptionCodePreview,
  serializeRedemptionCode
} from "@/lib/redemption-codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateRedemptionCodesBody = {
  aiPointsBalanceCents?: number;
  codingPlanDurationUnit?: string;
  codingPlanDurationValue?: number;
  codingPlanId?: string;
  expiresAt?: string | null;
  label?: string;
  maxRedemptions?: number;
  prefix?: string;
  quantity?: number;
  rewardType?: string;
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numberValue));
}

function parseFutureDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = new Date(String(value));

  if (!Number.isFinite(date.getTime()) || date <= new Date()) {
    throw new Error("兑换码过期时间必须晚于当前时间。");
  }

  return date;
}

function serializeAdminCode(code: Parameters<typeof serializeRedemptionCode>[0] & {
  redemptions: Array<{
    redeemedAt: Date;
    user: { email: string; name: string };
  }>;
}) {
  return {
    ...serializeRedemptionCode(code),
    recentRedemptions: code.redemptions.map((redemption) => ({
      redeemedAt: redemption.redeemedAt.toISOString(),
      userEmail: redemption.user.email,
      userName: redemption.user.name
    }))
  };
}

export async function GET(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const authError = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  const limit = Math.min(200, coerceInt(request.nextUrl.searchParams.get("limit"), 100, 1));
  const codes = await prisma.redemptionCode.findMany({
    include: {
      redemptions: {
        include: {
          user: {
            select: { email: true, name: true }
          }
        },
        orderBy: { redeemedAt: "desc" },
        take: 5
      }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  return NextResponse.json({
    codes: codes.map(serializeAdminCode)
  });
}

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const authError = requireAdmin(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  let body: CreateRedemptionCodesBody;

  try {
    body = await readJson<CreateRedemptionCodesBody>(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "创建兑换码失败。", 400);
  }

  const rewardType = body.rewardType === CODING_PLAN_PRODUCT_TYPE
    ? CODING_PLAN_PRODUCT_TYPE
    : body.rewardType === AI_POINTS_PRODUCT_TYPE
      ? AI_POINTS_PRODUCT_TYPE
      : null;

  if (!rewardType) {
    return jsonError("请选择兑换权益类型。", 400);
  }

  const quantity = boundedInteger(body.quantity, 1, 1, 100);
  const maxRedemptions = boundedInteger(body.maxRedemptions, 1, 1, 10000);
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  let expiresAt: Date | null;

  try {
    expiresAt = parseFutureDate(body.expiresAt);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "过期时间无效。", 400);
  }

  let aiPointsBalanceCents = 0;
  let codingPlanSnapshotJson = "{}";

  if (rewardType === AI_POINTS_PRODUCT_TYPE) {
    aiPointsBalanceCents = boundedInteger(body.aiPointsBalanceCents, 0, 1, 100_000_000);

    if (aiPointsBalanceCents <= 0) {
      return jsonError("AI 点数必须大于 0。", 400);
    }
  } else {
    const settings = await prisma.aiSettings.findUnique({ where: { id: "default" } });
    const legacyPlan = normalizeCodingPlanConfig({
      description: settings?.codingPlanDescription,
      enabled: settings?.codingPlanEnabled,
      monthlyCostLimitCents: settings?.codingPlanMonthlyCostLimitCents,
      name: settings?.codingPlanName,
      personalApiEnabled: settings?.codingPlanPersonalApiEnabled,
      priceCents: settings?.codingPlanPriceCents
    });
    const plan = parseCodingPlans(settings?.codingPlansJson, [legacyPlan]).find(
      (item) => item.id === body.codingPlanId
    );

    if (!plan) {
      return jsonError("所选 Coding Plan 不存在，请先保存套餐配置。", 400);
    }

    const durationUnit = body.codingPlanDurationUnit === "DAYS" ? "DAYS" : "MONTHS";
    const fallbackDuration = durationUnit === "DAYS" ? plan.durationMonths * 30 : plan.durationMonths;
    const durationValue = Number(body.codingPlanDurationValue ?? fallbackDuration);
    const maxDuration = durationUnit === "DAYS" ? 3650 : 120;

    if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > maxDuration) {
      return jsonError(
        durationUnit === "DAYS"
          ? "兑换套餐有效期必须是 1-3650 个整天。"
          : "兑换套餐有效期必须是 1-120 个整月。",
        400
      );
    }

    codingPlanSnapshotJson = JSON.stringify({
      ...codingPlanSnapshot(plan),
      redemptionDurationUnit: durationUnit,
      redemptionDurationValue: durationValue
    });
  }

  const codes = await prisma.$transaction(async (tx) => {
    const created = [];

    for (let index = 0; index < quantity; index += 1) {
      const rawCode = generateRedemptionCode(body.prefix);
      const code = await tx.redemptionCode.create({
        data: {
          codeHash: hashRedemptionCode(rawCode),
          codeEncrypted: encryptRedemptionCode(rawCode),
          codePreview: redemptionCodePreview(rawCode),
          label,
          rewardType,
          aiPointsBalanceCents,
          codingPlanSnapshotJson,
          maxRedemptions,
          expiresAt,
          createdById: currentUser.id
        }
      });

      created.push({ ...code, rawCode });
    }

    return created;
  });

  return NextResponse.json(
    {
      codes: codes.map(({ rawCode, ...code }) => ({
        ...serializeRedemptionCode(code),
        code: rawCode,
        recentRedemptions: []
      }))
    },
    { status: 201 }
  );
}
