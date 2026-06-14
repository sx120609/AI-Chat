import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPublicAuthSettings } from "@/lib/auth-settings";
import { DocumentTitle } from "@/components/document-title";
import { LoginForm } from "@/components/login-form";
import { SiteLogo } from "@/components/site-logo";
import { getSiteSettings } from "@/lib/site-settings";

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: siteSettings.siteName
  };
}

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/chat");
  }

  const siteSettings = await getSiteSettings();
  const authSettings = await getPublicAuthSettings();

  return (
    <main className="ios-page app-shell app-route-enter grid place-items-center px-5 py-10 relative">
      <DocumentTitle title={siteSettings.siteName} />
      <div className="ios-panel app-card-enter motion-lift w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <SiteLogo className="size-8 shrink-0" />
            <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--claude-accent)]">
              {siteSettings.siteName}
            </p>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-stone-950">
            {authSettings.registrationEnabled ? "登录或注册" : "登录"}
          </h1>
        </div>
        <LoginForm authSettings={authSettings} />
      </div>
    </main>
  );
}
