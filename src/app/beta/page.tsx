import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { BetaChatShell } from "@/components/beta-chat-shell";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth";
import { getEnabledChatModels } from "@/lib/models";
import { getPublicPaymentSettings } from "@/lib/payment-settings";
import { getUsageSummary } from "@/lib/quota";
import { getSiteSettings } from "@/lib/site-settings";
import { getAiRuntimeSettings } from "@/lib/upstream";

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: `${siteSettings.siteName} · Beta`,
    description: "A focused AI workspace for writing, analysis, research and creation."
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1714",
  colorScheme: "light"
};

export default async function BetaPage() {
  const user = await getCurrentUser();

  if (!user || !user.active || !user.emailVerified) {
    redirect("/login?next=%2Fbeta");
  }

  const usage = await getUsageSummary(user.id);
  const aiSettings = await getAiRuntimeSettings();
  const paymentSettings = await getPublicPaymentSettings();
  const siteSettings = await getSiteSettings();

  return (
    <BetaChatShell
      initialDefaultReasoningEffort={aiSettings.defaultReasoningEffort}
      initialModels={getEnabledChatModels(aiSettings.chatModels)}
      initialPaymentSettings={paymentSettings}
      initialSiteSettings={siteSettings}
      initialUsage={usage}
      initialUser={serializeCurrentUser(user)}
      initialWebSearchEnabled={aiSettings.webSearchEnabled}
    />
  );
}
