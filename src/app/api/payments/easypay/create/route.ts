import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import {
  buildEasyPaySubmitUrl,
  buildPublicPaymentBaseUrl,
  calculateEasyPayBalanceCents,
  createEasyPayOutTradeNo,
  normalizeEasyPayMethod,
  normalizeEasyPaySettings
} from "@/lib/easypay";
import type { EasyPayMethod } from "@/lib/easypay";
import { jsonError, readJson, requireActiveUser } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { normalizeSiteName, normalizeSiteUrl } from "@/lib/site-settings";

export const runtime = "nodejs";

type CreatePaymentBody = {
  amountCents?: number;
  method?: string;
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

  let amountCents: number;
  let method: EasyPayMethod;

  try {
    amountCents = normalizeAmountCents(body.amountCents);
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

  const siteName = normalizeSiteName(settings?.siteName);
  const siteUrl = normalizeSiteUrl(settings?.siteUrl);
  const outTradeNo = createEasyPayOutTradeNo();
  const balanceCents = calculateEasyPayBalanceCents(
    amountCents,
    easyPaySettings.easyPayBalanceCentsPerYuan
  );
  const subject = `${siteName} AI 点数充值`;
  const order = await prisma.paymentOrder.create({
    data: {
      userId: currentUser.id,
      method,
      outTradeNo,
      subject,
      amountCents,
      balanceCents,
      metadataJson: JSON.stringify({
        balanceCentsPerYuan: easyPaySettings.easyPayBalanceCentsPerYuan,
        displayMode: easyPaySettings.easyPayDisplayMode
      })
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
      status: order.status
    },
    paymentUrl
  });
}
