import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DocumentTitle } from "@/components/document-title";
import { RedeemForm } from "@/components/redeem-form";
import { SiteLogo } from "@/components/site-logo";
import { getCurrentUser } from "@/lib/auth";
import { getSiteSettings } from "@/lib/site-settings";

type RedeemPageProps = {
  searchParams: Promise<{ code?: string | string[] }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return { title: `兑换权益 - ${siteSettings.siteName}` };
}

export default async function RedeemPage({ searchParams }: RedeemPageProps) {
  const params = await searchParams;
  const initialCode = typeof params.code === "string" ? params.code.slice(0, 80) : "";
  const user = await getCurrentUser();

  if (!user || !user.active || (user.role !== "ADMIN" && !user.emailVerified)) {
    const nextPath = initialCode ? `/redeem?code=${encodeURIComponent(initialCode)}` : "/redeem";
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const siteSettings = await getSiteSettings();

  return (
    <main className="ios-page app-shell app-route-enter grid place-items-center px-5 py-10">
      <DocumentTitle title={`兑换权益 - ${siteSettings.siteName}`} />
      <div className="ios-panel app-card-enter motion-lift w-full max-w-md p-6">
        <div className="mb-5 flex items-center gap-2 border-b border-[color:var(--ios-separator)] pb-4">
          <SiteLogo className="size-8 shrink-0" />
          <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--claude-accent)]">
            {siteSettings.siteName}
          </p>
        </div>
        <RedeemForm initialCode={initialCode} />
      </div>
    </main>
  );
}
