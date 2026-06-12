import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest, serializeCurrentUser } from "@/lib/auth";
import { getUsageSummary } from "@/lib/quota";
import { jsonError, requireActiveUser } from "@/lib/http";
import { getEnabledChatModels } from "@/lib/models";
import { getPublicPaymentSettings } from "@/lib/payment-settings";
import { getSiteSettings } from "@/lib/site-settings";
import { getAiRuntimeSettings } from "@/lib/upstream";

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest(request);
  const error = requireActiveUser(user);

  if (!user) {
    return jsonError("请先登录。", 401);
  }

  if (error) {
    return error;
  }

  const usage = await getUsageSummary(user.id);
  const aiSettings = await getAiRuntimeSettings();
  const paymentSettings = await getPublicPaymentSettings();
  const siteSettings = await getSiteSettings();

  return NextResponse.json({
    user: serializeCurrentUser(user),
    siteSettings,
    usage,
    chatModels: getEnabledChatModels(aiSettings.chatModels),
    defaultReasoningEffort: aiSettings.defaultReasoningEffort,
    longContextThresholdTokens: aiSettings.longContextThresholdTokens,
    paymentSettings,
    webSearchEnabled: aiSettings.webSearchEnabled,
    webSearchProvider: aiSettings.webSearchProvider
  });
}
