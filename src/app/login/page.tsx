import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";
import { SiteLogo } from "@/components/site-logo";
import { getSiteSettings } from "@/lib/site-settings";

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/chat");
  }

  const siteSettings = await getSiteSettings();

  return (
    <main className="ios-page app-shell grid place-items-center px-5 py-10">
      <div className="ios-panel w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <SiteLogo className="size-8 shrink-0" />
            <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--claude-accent)]">
              {siteSettings.siteName}
            </p>
          </div>
          {siteSettings.siteUrl ? (
            <p className="mt-1 truncate text-xs ios-muted">{siteSettings.siteUrl}</p>
          ) : null}
          <h1 className="mt-2 text-2xl font-semibold text-stone-950">登录</h1>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
