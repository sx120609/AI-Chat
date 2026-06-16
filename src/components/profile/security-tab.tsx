import { FormEvent } from "react";
import { Lock, Loader2, Check } from "lucide-react";

type SecurityTabProps = {
  currentPassword: string;
  setCurrentPassword: (password: string) => void;
  newPassword: string;
  setNewPassword: (password: string) => void;
  savingPassword: boolean;
  onSavePassword: (event: FormEvent<HTMLFormElement>) => void;
};

export function SecurityTab({
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  savingPassword,
  onSavePassword
}: SecurityTabProps) {
  return (
    <form className="ios-panel motion-lift p-4" onSubmit={onSavePassword}>
      <div className="mb-4 flex items-center gap-2">
        <Lock className="size-4 text-[color:var(--claude-accent)]" />
        <h2 className="text-base font-semibold">修改密码</h2>
      </div>
      <div className="grid gap-3">
        <input
          className="ios-input"
          onChange={(event) => setCurrentPassword(event.target.value)}
          placeholder="当前密码"
          type="password"
          value={currentPassword}
        />
        <input
          className="ios-input"
          minLength={8}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="新密码"
          type="password"
          value={newPassword}
        />
        <button
          className="ios-button-primary app-action-button flex h-10 items-center justify-center gap-2 px-4 disabled:opacity-60"
          disabled={savingPassword}
          type="submit"
        >
          {savingPassword ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          更新密码
        </button>
      </div>
    </form>
  );
}
