import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  buildEasyPaySubmitUrl,
  buildPublicPaymentBaseUrl,
  calculateEasyPayTieredBalanceCents,
  createEasyPayOutTradeNo,
  normalizeEasyPayMethod,
  normalizeEasyPaySettings
} from "@/lib/easypay";
import type { EasyPayMethod } from "@/lib/easypay";
import {
  CODING_PLAN_PRODUCT_TYPE,
  codingPlanSnapshot,
  normalizeCodingPlanConfig,
  parseCodingPlans
} from "@/lib/coding-plan";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName, normalizeSiteUrl } from "@/lib/site-settings";

export const runtime = "nodejs";

type CreatePaymentBody = {
  amountCents?: number;
  method?: string;
  productType?: string;
  codingPlanId?: string;
};

function normalizeAmountCents(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(amount)) {
    throw new Error("请输入有效的充值金额。");
  }

  const cents = Math.round(amount);

  if (cents < 100) {
    throw new Error("单次充值至少 1.00。");
  }

  if (cents > 100000) {
    throw new Error("单次充值不能超过 1000.00。");
  }

  return cents;
}

export async function POST(request: NextRequest) {
  const currentUser = await getUserFromRequest(request);
  const authError = requireActiveUser(currentUser);

  if (!currentUser) {
    return jsonError("请先登录。", 401);
  }

  if (authError) {
    return authError;
  }

  let body: CreatePaymentBody;

  try {
    body = await readJson<CreatePaymentBody>(request);
  } catch (readError) {
    return jsonError(readError instanceof Error ? readError.message : "创建支付订单失败。", 400);
  }

  let method: EasyPayMethod;

  try {
    method = normalizeEasyPayMethod(body.method);
  } catch (validationError) {
    return jsonError(
      validationError instanceof Error ? validationError.message : "支付参数无效。",
      400
    );
  }

  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });
  const easyPaySettings = normalizeEasyPaySettings(settings ?? {});

  if (!easyPaySettings.easyPayEnabled) {
    return jsonError("在线充值暂未开放。", 403);
  }

  if (!easyPaySettings.easyPayMethods.includes(method)) {
    return jsonError("当前支付方式未启用。", 400);
  }

  if (body.productType && body.productType !== "ai_points" && body.productType !== "coding_plan") {
    return jsonError("支付商品无效。", 400);
  }

  const productType = body.productType === "coding_plan" ? CODING_PLAN_PRODUCT_TYPE : "AI_POINTS";
  const legacyCodingPlan = normalizeCodingPlanConfig({
    description: settings?.codingPlanDescription,
    enabled: settings?.codingPlanEnabled,
    monthlyCostLimitCents: settings?.codingPlanMonthlyCostLimitCents,
    name: settings?.codingPlanName,
    personalApiEnabled: settings?.codingPlanPersonalApiEnabled,
    priceCents: settings?.codingPlanPriceCents
  });
  const codingPlans = parseCodingPlans(settings?.codingPlansJson, [legacyCodingPlan]);
  const codingPlan = codingPlans.find((plan) => plan.id === body.codingPlanId) ?? null;
  let amountCents: number;

  try {
    amountCents =
      productType === CODING_PLAN_PRODUCT_TYPE
        ? codingPlan?.priceCents ?? 0
        : normalizeAmountCents(body.amountCents);
  } catch (validationError) {
    return jsonError(
      validationError instanceof Error ? validationError.message : "支付参数无效。",
      400
    );
  }

  if (productType === CODING_PLAN_PRODUCT_TYPE && (!codingPlan || !codingPlan.enabled)) {
    return jsonError("所选 Coding Plan 不存在或暂未开放购买。", 403);
  }

  const selectedCodingPlan = codingPlan ?? legacyCodingPlan;

  const siteName = normalizeSiteName(settings?.siteName);
  const siteUrl = normalizeSiteUrl(settings?.siteUrl);
  const outTradeNo = createEasyPayOutTradeNo();
  const balanceCents =
    productType === CODING_PLAN_PRODUCT_TYPE
      ? 0
      : calculateEasyPayTieredBalanceCents(
          amountCents,
          easyPaySettings.easyPayBalanceCentsPerYuan,
          easyPaySettings.easyPayAmountTiers
        );
  const subject =
    productType === CODING_PLAN_PRODUCT_TYPE
      ? `${siteName} ${selectedCodingPlan.name} 月度订阅`
      : `${siteName} AI 点数充值`;
  const order = await prisma.paymentOrder.create({
    data: {
      userId: currentUser.id,
      method,
      outTradeNo,
      subject,
      amountCents,
      balanceCents,
      metadataJson: JSON.stringify(
        productType === CODING_PLAN_PRODUCT_TYPE
          ? {
              codingPlan: codingPlanSnapshot(selectedCodingPlan),
              displayMode: easyPaySettings.easyPayDisplayMode,
              productType
            }
          : {
              balanceCentsPerYuan: easyPaySettings.easyPayBalanceCentsPerYuan,
              amountTiers: easyPaySettings.easyPayAmountTiers,
              displayMode: easyPaySettings.easyPayDisplayMode,
              productType
            }
      )
    }
  });
  const paymentUrl = buildEasyPaySubmitUrl({
    order,
    paymentBaseUrl: buildPublicPaymentBaseUrl(siteUrl, request.nextUrl.origin),
    settings: easyPaySettings,
    siteName
  });

  return NextResponse.json({
    order: {
      amountCents: order.amountCents,
      balanceCents: order.balanceCents,
      method: order.method,
      outTradeNo: order.outTradeNo,
      productType,
      status: order.status
    },
    paymentUrl
  });
}
