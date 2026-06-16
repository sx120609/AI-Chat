import { Loader2, Mail } from "lucide-react";
import type { AiSettingsView } from "@/types/gateway";
import type { SettingsForm } from "./types";

type MailTabProps = {
  settings: AiSettingsView | null;
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
  testingSmtp: boolean;
  onTestSmtp: () => void;
  testEmail: string;
  setTestEmail: (email: string) => void;
};

export function MailTab({
  settings,
  settingsForm,
  setSettingsForm,
  testingSmtp,
  onTestSmtp,
  testEmail,
  setTestEmail
}: MailTabProps) {
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="ios-list lg:col-span-6">
      <div className="ios-cell flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs font-semibold ios-muted">
          SMTP 密码：{settings?.smtpHasPassword ? settings.smtpPasswordPreview : "未设置"}
        </span>
        <button
          className="ios-button-secondary app-action-button flex h-8 items-center gap-2 px-3 text-xs disabled:opacity-50"
          disabled={testingSmtp}
          onClick={onTestSmtp}
          type="button"
        >
          {testingSmtp ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
          发送测试邮件
        </button>
      </div>
      <div className="grid gap-3 p-3 lg:grid-cols-6">
        <label className="admin-check-row">
          <input
            checked={settingsForm.smtpEnabled}
            className="size-4 accent-[color:var(--claude-accent)]"
            onChange={(event) => handleUpdate({ smtpEnabled: event.target.checked })}
            type="checkbox"
          />
          启用邮件服务
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-xs font-medium ios-muted">SMTP 主机</span>
          <input
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ smtpHost: event.target.value })}
            placeholder="smtp.example.com"
            value={settingsForm.smtpHost}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium ios-muted">端口</span>
          <input
            className="ios-input w-full"
            max={65535}
            min={1}
            onChange={(event) => handleUpdate({ smtpPort: Number(event.target.value) })}
            type="number"
            value={settingsForm.smtpPort}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">账号</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            name="admin-smtp-username"
            onChange={(event) => handleUpdate({ smtpUsername: event.target.value })}
            value={settingsForm.smtpUsername}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">密码</span>
          <input
            autoComplete="new-password"
            className="ios-input w-full"
            name="admin-smtp-password"
            onChange={(event) =>
              handleUpdate({
                smtpPassword: event.target.value,
                clearSmtpPassword: false
              })
            }
            placeholder={settings?.smtpHasPassword ? "输入新密码后替换" : "SMTP 密码"}
            type="password"
            value={settingsForm.smtpPassword}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">发件邮箱</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            name="admin-smtp-from-email"
            onChange={(event) => handleUpdate({ smtpFromEmail: event.target.value })}
            placeholder="noreply@example.com"
            type="email"
            value={settingsForm.smtpFromEmail}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">发件名称</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            name="admin-smtp-from-name"
            onChange={(event) => handleUpdate({ smtpFromName: event.target.value })}
            placeholder={settingsForm.siteName}
            value={settingsForm.smtpFromName}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">测试收件邮箱</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            name="admin-smtp-test-email"
            onChange={(event) => setTestEmail(event.target.value)}
            type="email"
            value={testEmail}
          />
        </label>
        <label className="admin-check-row">
          <input
            checked={settingsForm.smtpSecure}
            className="size-4 accent-[color:var(--claude-accent)]"
            onChange={(event) => handleUpdate({ smtpSecure: event.target.checked })}
            type="checkbox"
          />
          SSL/TLS
        </label>
        <label className="admin-check-row">
          <input
            checked={settingsForm.smtpStartTls}
            className="size-4 accent-[color:var(--claude-accent)]"
            onChange={(event) => handleUpdate({ smtpStartTls: event.target.checked })}
            type="checkbox"
          />
          STARTTLS
        </label>
        <label className="admin-check-row">
          <input
            checked={settingsForm.clearSmtpPassword}
            className="size-4 accent-red-500"
            onChange={(event) =>
              handleUpdate({
                clearSmtpPassword: event.target.checked,
                smtpPassword: event.target.checked ? "" : settingsForm.smtpPassword
              })
            }
            type="checkbox"
          />
          清空 SMTP 密码
        </label>
      </div>
    </div>
  );
}
