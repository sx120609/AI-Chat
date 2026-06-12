import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import { DocumentTitle } from "@/components/document-title";
import { SiteLogo } from "@/components/site-logo";
import { getSiteSettings } from "@/lib/site-settings";
import { verifyEmailToken } from "@/lib/email-verification";

type VerifyEmailPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const siteSettings = await getSiteSettings();

  return {
    title: siteSettings.siteName
  };
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const siteSettings = await getSiteSettings();
  const { token } = await searchParams;
  const result = token
    ? await verifyEmailToken(token)
    : { ok: false, message: "验证链接缺少 token。" };

  return (
    <main className="ios-page app-shell app-route-enter grid place-items-center px-5 py-10">
      <DocumentTitle title={siteSettings.siteName} />
      <div className="ios-panel app-card-enter motion-lift w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2">
          <SiteLogo className="size-8 shrink-0" />
          <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--claude-accent)]">
            {siteSettings.siteName}
          </p>
        </div>
        <div className="mb-5 flex items-start gap-3">
          <div
            className={`grid size-10 shrink-0 place-items-center rounded-lg ${
              result.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {result.ok ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-stone-950">
              {result.ok ? "邮箱已验证" : "验证失败"}
            </h1>
            <p className="mt-1 text-sm leading-6 ios-muted">{result.message}</p>
          </div>
        </div>
        <a
          className="ios-button-primary app-action-button flex h-11 w-full items-center justify-center px-4"
          href="/login"
        >
          返回登录
        </a>
      </div>
    </main>
  );
}
