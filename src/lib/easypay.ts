import { createHash, randomBytes } from "crypto";
import {
  calculateBasePaymentBalanceCents,
  calculateTieredPaymentBalanceCents,
  parsePaymentAmountTiers,
  type PaymentAmountTier
} from "@/lib/payment-amount-tiers";
import { maskSecret } from "@/lib/smtp";

export const EASYPAY_NOTIFY_PATH = "/api/v1/payment/webhook/easypay";
export const EASYPAY_RETURN_PATH = "/payment/result";
export const EASYPAY_METHODS = ["alipay", "wxpay"] as const;
export const EASYPAY_DISPLAY_MODES = ["qrcode", "popup"] as const;

export type EasyPayMethod = (typeof EASYPAY_METHODS)[number];
export type EasyPayDisplayMode = (typeof EASYPAY_DISPLAY_MODES)[number];
export type EasyPayAmountTier = PaymentAmountTier;

export type EasyPaySettings = {
  easyPayEnabled: boolean;
  easyPayAllowRefund: boolean;
  easyPayDisplayMode: EasyPayDisplayMode;
  easyPayMethods: EasyPayMethod[];
  easyPayBalanceCentsPerYuan: number;
  easyPayAmountTiers: EasyPayAmountTier[];
  easyPayPid: string;
  easyPayKey: string | null;
  easyPayApiBaseUrl: string;
  easyPayAlipayChannelId: string;
  easyPayWxpayChannelId: string;
};

export type EasyPayOrderLookup = {
  amountCents: number | null;
  paid: boolean;
  paidAt: Date | null;
  providerTradeNo: string | null;
  raw: Record<string, unknown>;
  status: string;
};

export type EasyPaySettingsSource = {
  easyPayEnabled?: boolean;
  easyPayAllowRefund?: boolean;
  easyPayDisplayMode?: string | null;
  easyPayMethodsJson?: string | null;
  easyPayBalanceCentsPerYuan?: number | null;
  easyPayAmountTiersJson?: string | null;
  easyPayPid?: string | null;
  easyPayKey?: string | null;
  easyPayApiBaseUrl?: string | null;
  easyPayAlipayChannelId?: string | null;
  easyPayWxpayChannelId?: string | null;
};

type EasyPayOrderLike = {
  amountCents: number;
  method: string;
  outTradeNo: string;
  subject: string;
};

export const DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN = 100;

function md5(value: string) {
  return createHash("md5").update(value, "utf8").digest("hex");
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEasyPayMethod(value: string): value is EasyPayMethod {
  return EASYPAY_METHODS.includes(value as EasyPayMethod);
}

export function normalizeEasyPayMethod(value: string | undefined) {
  const method = value?.trim().toLowerCase() || "";

  if (!isEasyPayMethod(method)) {
    throw new Error("请选择有效的支付方式。");
  }

  return method;
}

export function parseEasyPayMethods(value: string | null | undefined): EasyPayMethod[] {
  try {
    const parsed = JSON.parse(value || "[]");

    if (!Array.isArray(parsed)) {
      return [...EASYPAY_METHODS];
    }

    const methods = parsed
      .map((item) => String(item).trim().toLowerCase())
      .filter(isEasyPayMethod)
      .filter((item, index, list) => list.indexOf(item) === index);

    return methods.length > 0 ? methods : [...EASYPAY_METHODS];
  } catch {
    return [...EASYPAY_METHODS];
  }
}

export function normalizeEasyPayDisplayMode(value: string | null | undefined): EasyPayDisplayMode {
  return value === "popup" ? "popup" : "qrcode";
}

export function normalizeEasyPayBaseUrl(value: string | null | undefined) {
  const raw = value?.trim() || "";

  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("invalid protocol");
    }

    return raw.replace(/\/+$/, "");
  } catch {
    throw new Error("请输入有效的易支付 API 基础地址，例如 https://pay.example.com");
  }
}

export function normalizeEasyPayBalanceCentsPerYuan(value: unknown) {
  const rate = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(rate)) {
    return DEFAULT_EASYPAY_BALANCE_CENTS_PER_YUAN;
  }

  return Math.min(1000000, Math.max(1, Math.round(rate)));
}

export function calculateEasyPayBalanceCents(paymentAmountCents: number, balanceCentsPerYuan: number) {
  return calculateBasePaymentBalanceCents(paymentAmountCents, balanceCentsPerYuan);
}

export function parseEasyPayAmountTiers(
  value: string | null | undefined,
  balanceCentsPerYuan: number
) {
  return parsePaymentAmountTiers(value, balanceCentsPerYuan);
}

export function calculateEasyPayTieredBalanceCents(
  paymentAmountCents: number,
  balanceCentsPerYuan: number,
  tiers: EasyPayAmountTier[]
) {
  return calculateTieredPaymentBalanceCents(paymentAmountCents, balanceCentsPerYuan, tiers);
}

export function normalizeEasyPaySettings(input: EasyPaySettingsSource): EasyPaySettings {
  const easyPayEnabled = Boolean(input.easyPayEnabled);
  const easyPayPid = input.easyPayPid?.trim() || "";
  const easyPayKey = input.easyPayKey?.trim() || null;
  const easyPayApiBaseUrl = normalizeEasyPayBaseUrl(input.easyPayApiBaseUrl);
  const easyPayMethods = parseEasyPayMethods(input.easyPayMethodsJson);
  const easyPayBalanceCentsPerYuan = normalizeEasyPayBalanceCentsPerYuan(
    input.easyPayBalanceCentsPerYuan
  );
  const easyPayAmountTiers = parseEasyPayAmountTiers(
    input.easyPayAmountTiersJson,
    easyPayBalanceCentsPerYuan
  );

  if (easyPayEnabled) {
    if (!easyPayPid) {
      throw new Error("启用易支付前请填写 PID。");
    }

    if (!easyPayKey) {
      throw new Error("启用易支付前请填写 PKey。");
    }

    if (!easyPayApiBaseUrl) {
      throw new Error("启用易支付前请填写 API 基础地址。");
    }
  }

  return {
    easyPayEnabled,
    easyPayAllowRefund: Boolean(input.easyPayAllowRefund),
    easyPayDisplayMode: normalizeEasyPayDisplayMode(input.easyPayDisplayMode),
    easyPayMethods,
    easyPayBalanceCentsPerYuan,
    easyPayAmountTiers,
    easyPayPid,
    easyPayKey,
    easyPayApiBaseUrl,
    easyPayAlipayChannelId: input.easyPayAlipayChannelId?.trim() || "",
    easyPayWxpayChannelId: input.easyPayWxpayChannelId?.trim() || ""
  };
}

export function serializeEasyPaySettings(settings: EasyPaySettingsSource) {
  const normalized = normalizeEasyPaySettings(settings);

  return {
    ...normalized,
    easyPayHasKey: Boolean(normalized.easyPayKey),
    easyPayKeyPreview: maskSecret(normalized.easyPayKey),
    easyPayKey: undefined
  };
}

export function formatEasyPayMoney(amountCents: number) {
  return (Math.max(1, Math.round(amountCents)) / 100).toFixed(2);
}

export function parseEasyPayMoneyCents(value: unknown) {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").trim());

  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : null;
}

export function easyPayAmountMatches(value: unknown, expectedAmountCents: number) {
  return parseEasyPayMoneyCents(value) === Math.max(0, Math.round(expectedAmountCents));
}

export function isEasyPayPaidStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();

  return ["1", "PAID", "SUCCESS", "TRADE_SUCCESS", "TRADE_FINISHED"].includes(normalized);
}

function parseEasyPayDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.trim().replace(" ", "T");
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function createEasyPayOutTradeNo() {
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .slice(0, 14);
  const suffix = randomBytes(5).toString("hex");

  return `EP${stamp}${suffix}`;
}

export function buildPublicPaymentBaseUrl(siteUrl: string, requestOrigin: string) {
  const base = siteUrl?.trim() || requestOrigin;

  return base.replace(/\/+$/, "");
}

export function buildEasyPaySign(params: Record<string, string | number>, key: string) {
  const query = Object.entries(params)
    .filter(([name, value]) => name !== "sign" && name !== "sign_type" && value !== "")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");

  return md5(`${query}${key}`);
}

export function verifyEasyPaySign(params: Record<string, string>, key: string) {
  const sign = params.sign?.trim().toLowerCase();

  if (!sign) {
    return false;
  }

  return buildEasyPaySign(params, key).toLowerCase() === sign;
}

function channelIdForMethod(settings: EasyPaySettings, method: string) {
  return method === "alipay" ? settings.easyPayAlipayChannelId : settings.easyPayWxpayChannelId;
}

export function buildEasyPaySubmitUrl({
  order,
  paymentBaseUrl,
  settings,
  siteName
}: {
  order: EasyPayOrderLike;
  paymentBaseUrl: string;
  settings: EasyPaySettings;
  siteName: string;
}) {
  if (!settings.easyPayKey) {
    throw new Error("易支付 PKey 未配置。");
  }

  const method = normalizeEasyPayMethod(order.method);
  const callbackBase = paymentBaseUrl.replace(/\/+$/, "");
  const params: Record<string, string> = {
    pid: settings.easyPayPid,
    type: method,
    out_trade_no: order.outTradeNo,
    notify_url: `${callbackBase}${EASYPAY_NOTIFY_PATH}`,
    return_url: `${callbackBase}${EASYPAY_RETURN_PATH}`,
    name: order.subject,
    money: formatEasyPayMoney(order.amountCents),
    param: order.outTradeNo,
    sitename: siteName
  };
  const channelId = channelIdForMethod(settings, method);

  if (channelId) {
    params.cid = channelId;
  }

  params.sign = buildEasyPaySign(params, settings.easyPayKey);
  params.sign_type = "MD5";

  const apiBaseUrl = settings.easyPayApiBaseUrl.replace(/\/+$/, "");
  const url = new URL(`${apiBaseUrl}/submit.php`);

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  return url.toString();
}

export async function queryEasyPayOrder(
  settings: EasyPaySettings,
  outTradeNo: string
): Promise<EasyPayOrderLookup> {
  if (!settings.easyPayKey) {
    throw new Error("易支付 PKey 未配置。");
  }

  if (!settings.easyPayApiBaseUrl) {
    throw new Error("易支付 API 基础地址未配置。");
  }

  const apiBaseUrl = settings.easyPayApiBaseUrl.replace(/\/+$/, "");
  const url = new URL(`${apiBaseUrl}/api.php`);

  url.searchParams.set("act", "order");
  url.searchParams.set("pid", settings.easyPayPid);
  url.searchParams.set("key", settings.easyPayKey);
  url.searchParams.set("out_trade_no", outTradeNo);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    const text = await response.text();
    const payload = JSON.parse(text) as unknown;
    const json = jsonObject(payload);

    if (!response.ok || !json) {
      throw new Error(text.slice(0, 500) || `HTTP ${response.status}`);
    }

    const code = String(json.code ?? "").trim();

    if (code && code !== "1" && !isEasyPayPaidStatus(json.status ?? json.trade_status)) {
      throw new Error(String(json.msg ?? json.message ?? "易支付查单失败。"));
    }

    const status = String(json.trade_status ?? json.status ?? "").trim();

    return {
      amountCents: parseEasyPayMoneyCents(json.money ?? json.amount),
      paid: isEasyPayPaidStatus(status),
      paidAt: parseEasyPayDate(json.endtime ?? json.pay_time ?? json.paid_at),
      providerTradeNo:
        typeof json.trade_no === "string" && json.trade_no.trim()
          ? json.trade_no.trim()
          : null,
      raw: json,
      status
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("易支付查单超时。");
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}
