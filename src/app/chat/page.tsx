import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChatShell } from "@/components/chat-shell";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth";
import { getEnabledChatModels } from "@/lib/models";
import { getUsageSummary } from "@/lib/quota";
import { getSiteSettings } from "@/lib/site-settings";
import { getAiRuntimeSettings } from "@/lib/upstream";

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: siteSettings.siteName
  };
}

export default async function ChatPage() {
  const user = await getCurrentUser();

  if (!user || !user.active) {
    redirect("/login");
  }

  const usage = await getUsageSummary(user.id);
  const aiSettings = await getAiRuntimeSettings();
  const siteSettings = await getSiteSettings();

  return (
    <ChatShell
      initialDefaultReasoningEffort={aiSettings.defaultReasoningEffort}
      initialModels={getEnabledChatModels(aiSettings.chatModels)}
      initialSiteSettings={siteSettings}
      initialUsage={usage}
      initialUser={serializeCurrentUser(user)}
      initialWebSearchEnabled={aiSettings.webSearchEnabled}
      initialWebSearchProvider={aiSettings.webSearchProvider}
    />
  );
}
