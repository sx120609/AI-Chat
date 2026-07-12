import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileCenter } from "@/components/profile-center";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth";
import { getEnabledApiModels } from "@/lib/models";
import { getPublicPaymentSettings } from "@/lib/payment-settings";
import { getUsageSummary } from "@/lib/quota";
import { getSiteSettings } from "@/lib/site-settings";
import { getAiRuntimeSettings } from "@/lib/upstream";

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: `个人中心 - ${siteSettings.siteName}`
  };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();

  if (!user || !user.active || (user.role !== "ADMIN" && !user.emailVerified)) {
    redirect("/login");
  }

  const [siteSettings, usage, aiSettings, paymentSettings] = await Promise.all([
    getSiteSettings(),
    getUsageSummary(user.id),
    getAiRuntimeSettings(),
    getPublicPaymentSettings()
  ]);
  const apiModels = getEnabledApiModels(aiSettings.chatModels).map((model) => ({
    ...model,
    id: model.upstreamId || model.id
  }));

  return (
    <ProfileCenter
      initialUser={serializeCurrentUser(user)}
      initialUsage={usage}
      initialPaymentSettings={paymentSettings}
      apiModels={apiModels}
      apiImageModelId={aiSettings.imageModelId}
      siteSettings={siteSettings}
    />
  );
}
