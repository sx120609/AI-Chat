import { NextRequest, NextResponse } from "next/server";
import {
  easyPayAmountMatches,
  isEasyPayPaidStatus,
  normalizeEasyPaySettings,
  verifyEasyPaySign
} from "@/lib/easypay";
import { settlePaidPaymentOrder } from "@/lib/payment-orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function textResponse(message: string, status = 200) {
  return new NextResponse(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

async function readEasyPayPayload(request: NextRequest) {
  const payload: Record<string, string> = {};

  request.nextUrl.searchParams.forEach((value, key) => {
    payload[key] = value;
  });

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();

    for (const [key, value] of formData.entries()) {
      payload[key] = typeof value === "string" ? value : value.name;
    }
  }

  return payload;
}

async function handleEasyPayNotify(request: NextRequest) {
  const payload = await readEasyPayPayload(request);
  const settings = await prisma.aiSettings.findUnique({
    where: { id: "default" }
  });
  const easyPaySettings = normalizeEasyPaySettings(settings ?? {});

  if (!easyPaySettings.easyPayEnabled || !easyPaySettings.easyPayKey) {
    return textResponse("payment disabled", 400);
  }

  if (!verifyEasyPaySign(payload, easyPaySettings.easyPayKey)) {
    return textResponse("invalid sign", 400);
  }

  if (payload.pid !== easyPaySettings.easyPayPid) {
    return textResponse("invalid pid", 400);
  }

  if (!isEasyPayPaidStatus(payload.trade_status ?? payload.status)) {
    return textResponse("ignored");
  }

  const outTradeNo = payload.out_trade_no || payload.param;

  if (!outTradeNo) {
    return textResponse("missing out_trade_no", 400);
  }

  const order = await prisma.paymentOrder.findUnique({
    where: { outTradeNo }
  });

  if (!order) {
    return textResponse("order not found", 404);
  }

  if (!easyPayAmountMatches(payload.money, order.amountCents)) {
    return textResponse("amount mismatch", 400);
  }

  if (order.status === "PAID") {
    return textResponse("success");
  }

  await settlePaidPaymentOrder(order, {
    providerTradeNo: payload.trade_no || null
  });

  return textResponse("success");
}

export async function GET(request: NextRequest) {
  return handleEasyPayNotify(request);
}

export async function POST(request: NextRequest) {
  return handleEasyPayNotify(request);
}
