import { formatCents } from "@/lib/format";
import type { AiSettingsView, EasyPayDisplayMode, EasyPayMethod } from "@/types/gateway";
import type { SettingsForm } from "./types";

type PaymentTabProps = {
  settings: AiSettingsView | null;
  settingsForm: SettingsForm;
  setSettingsForm: (
    updater: (current: SettingsForm) => SettingsForm | Partial<SettingsForm>
  ) => void;
};

export function PaymentTab({
  settings,
  settingsForm,
  setSettingsForm
}: PaymentTabProps) {
  const handleUpdate = (patch: Partial<SettingsForm>) => {
    setSettingsForm((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="ios-list lg:col-span-6">
      <div className="ios-cell px-3 py-2">
        <p className="text-xs font-semibold ios-muted">
          PKey：{settings?.easyPayHasKey ? settings.easyPayKeyPreview : "未设置"}
        </p>
      </div>
      <div className="grid gap-3 p-3 lg:grid-cols-6">
        <label className="admin-check-row">
          <input
            checked={settingsForm.easyPayEnabled}
            className="size-4 accent-[color:var(--claude-accent)]"
            onChange={(event) => handleUpdate({ easyPayEnabled: event.target.checked })}
            type="checkbox"
          />
          启用
        </label>
        <label className="admin-check-row">
          <input
            checked={settingsForm.easyPayAllowRefund}
            className="size-4 accent-[color:var(--claude-accent)]"
            onChange={(event) => handleUpdate({ easyPayAllowRefund: event.target.checked })}
            type="checkbox"
          />
          允许退款
        </label>
        <div className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">支付模式</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["qrcode", "二维码"],
              ["popup", "弹窗"]
            ].map(([value, label]) => (
              <button
                className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                  settingsForm.easyPayDisplayMode === value
                    ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                    : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                }`}
                key={value}
                onClick={() =>
                  handleUpdate({ easyPayDisplayMode: value as EasyPayDisplayMode })
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">支持的支付方式</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["alipay", "支付宝"],
              ["wxpay", "微信支付"]
            ].map(([value, label]) => {
              const method = value as EasyPayMethod;
              const checked = settingsForm.easyPayMethods.includes(method);

              return (
                <button
                  className={`app-action-button h-10 rounded-lg border text-sm font-semibold ${
                    checked
                      ? "border-[color:var(--claude-accent)] bg-white text-stone-950"
                      : "border-[color:var(--ios-separator)] bg-white/60 text-stone-600"
                  }`}
                  key={value}
                  onClick={() =>
                    setSettingsForm((current) => ({
                      ...current,
                      easyPayMethods: checked
                        ? current.easyPayMethods.filter((item) => item !== method)
                        : [...new Set([...current.easyPayMethods, method])]
                    }))
                  }
                  type="button"
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">1 元到账余额 *</span>
          <input
            className="ios-input w-full"
            min={0.01}
            onChange={(event) => {
              const value = Number(event.target.value);

              if (Number.isFinite(value)) {
                handleUpdate({
                  easyPayBalanceCentsPerYuan: Math.max(1, Math.round(value * 100))
                });
              }
            }}
            step={0.01}
            type="number"
            value={settingsForm.easyPayBalanceCentsPerYuan / 100}
          />
          <p className="mt-1 text-xs ios-muted">
            ¥1.00 = {formatCents(settingsForm.easyPayBalanceCentsPerYuan)} 余额
          </p>
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">PID *</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            name="admin-easypay-pid"
            onChange={(event) => handleUpdate({ easyPayPid: event.target.value })}
            value={settingsForm.easyPayPid}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">PKey *</span>
          <input
            autoComplete="new-password"
            className="ios-input w-full"
            name="admin-easypay-pkey"
            onChange={(event) =>
              handleUpdate({
                easyPayKey: event.target.value,
                clearEasyPayKey: false
              })
            }
            placeholder={settings?.easyPayHasKey ? "输入新 PKey 后替换" : "输入 PKey"}
            type="password"
            value={settingsForm.easyPayKey}
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-xs font-medium ios-muted">API 基础地址 *</span>
          <input
            autoComplete="off"
            className="ios-input w-full"
            name="admin-easypay-api-base-url"
            onChange={(event) => handleUpdate({ easyPayApiBaseUrl: event.target.value })}
            placeholder="https://pay.example.com"
            value={settingsForm.easyPayApiBaseUrl}
          />
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-xs font-medium ios-muted">支付宝渠道 ID（可选）</span>
          <input
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ easyPayAlipayChannelId: event.target.value })}
            value={settingsForm.easyPayAlipayChannelId}
          />
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-xs font-medium ios-muted">微信渠道 ID（可选）</span>
          <input
            className="ios-input w-full"
            onChange={(event) => handleUpdate({ easyPayWxpayChannelId: event.target.value })}
            value={settingsForm.easyPayWxpayChannelId}
          />
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-xs font-medium ios-muted">异步通知地址 *</span>
          <div className="flex overflow-hidden rounded-lg border border-[color:var(--app-border)] bg-white/60">
            <span className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-stone-500">
              {settingsForm.siteUrl || "https://your-site.example"}
            </span>
            <span className="shrink-0 border-l border-[color:var(--ios-separator)] px-3 py-2 text-sm font-semibold text-stone-600">
              {settings?.easyPayNotifyPath || "/api/v1/payment/webhook/easypay"}
            </span>
          </div>
        </label>
        <label className="block lg:col-span-3">
          <span className="mb-1 block text-xs font-medium ios-muted">同步跳转地址 *</span>
          <div className="flex overflow-hidden rounded-lg border border-[color:var(--app-border)] bg-white/60">
            <span className="min-w-0 flex-1 truncate px-3 py-2 text-sm text-stone-500">
              {settingsForm.siteUrl || "https://your-site.example"}
            </span>
            <span className="shrink-0 border-l border-[color:var(--ios-separator)] px-3 py-2 text-sm font-semibold text-stone-600">
              {settings?.easyPayReturnPath || "/payment/result"}
            </span>
          </div>
        </label>
        <label className="admin-check-row">
          <input
            checked={settingsForm.clearEasyPayKey}
            className="size-4 accent-red-500"
            onChange={(event) =>
              handleUpdate({
                clearEasyPayKey: event.target.checked,
                easyPayKey: event.target.checked ? "" : settingsForm.easyPayKey
              })
            }
            type="checkbox"
          />
          清空 PKey
        </label>
      </div>
    </div>
  );
}
