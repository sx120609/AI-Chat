import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { getCurrentUser, serializeCurrentUser } from "@/lib/auth";
import { getSiteSettings } from "@/lib/site-settings";

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: siteSettings.siteName
  };
}

export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!user || !user.active || !user.emailVerified) {
    redirect("/login");
  }

  if (user.role !== "ADMIN") {
    redirect("/chat");
  }

  return <AdminDashboard currentUser={serializeCurrentUser(user)} />;
}
