import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileCenter } from "@/components/profile-center";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth";
import { getUsageSummary } from "@/lib/quota";
import { getSiteSettings } from "@/lib/site-settings";

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: `个人中心 - ${siteSettings.siteName}`
  };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();

  if (!user || !user.active || !user.emailVerified) {
    redirect("/login");
  }

  const [siteSettings, usage] = await Promise.all([
    getSiteSettings(),
    getUsageSummary(user.id)
  ]);

  return (
    <ProfileCenter
      initialUser={serializeCurrentUser(user)}
      initialUsage={usage}
      siteSettings={siteSettings}
    />
  );
}
