import type { Metadata } from "next";
import { LockKeyhole } from "lucide-react";
import { DocumentTitle } from "@/components/document-title";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { SiteLogo } from "@/components/site-logo";
import { getSiteSettings } from "@/lib/site-settings";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: `重置密码 - ${siteSettings.siteName}`
  };
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const siteSettings = await getSiteSettings();
  const { token = "" } = await searchParams;

  return (
    <main className="ios-page app-shell app-route-enter grid place-items-center px-5 py-10">
      <DocumentTitle title={`重置密码 - ${siteSettings.siteName}`} />
      <div className="ios-panel app-card-enter motion-lift w-full max-w-sm p-6">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <SiteLogo className="size-8 shrink-0" />
            <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--claude-accent)]">
              {siteSettings.siteName}
            </p>
          </div>
          <div className="mt-4 flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[color:var(--app-accent-soft)] text-[color:var(--claude-accent)]">
              <LockKeyhole className="size-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-stone-950">重置密码</h1>
              <p className="mt-1 text-sm leading-6 ios-muted">
                设置一个新密码。完成后旧登录设备会自动退出。
              </p>
            </div>
          </div>
        </div>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            重置链接缺少 token，请重新发送密码重置邮件。
          </div>
        )}
      </div>
    </main>
  );
}
