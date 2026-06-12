import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedConversationView } from "@/components/shared-conversation-view";
import { getSharedConversation } from "@/lib/conversation-share";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    token: string;
  }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const [conversation, siteSettings] = await Promise.all([
    getSharedConversation(token),
    getSiteSettings()
  ]);

  return {
    title: conversation ? `${conversation.title} · ${siteSettings.siteName}` : siteSettings.siteName,
    description: conversation ? `来自 ${siteSettings.siteName} 的分享聊天` : undefined
  };
}

export default async function SharedConversationPage({ params }: PageProps) {
  const { token } = await params;
  const [conversation, siteSettings] = await Promise.all([
    getSharedConversation(token),
    getSiteSettings()
  ]);

  if (!conversation) {
    notFound();
  }

  return <SharedConversationView conversation={conversation} siteName={siteSettings.siteName} />;
}
