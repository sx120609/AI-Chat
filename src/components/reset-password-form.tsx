"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Loader2, LockKeyhole, XCircle } from "lucide-react";

type ResetPasswordFormProps = {
  token: string;
};

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");

    if (password !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/password-reset/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, token })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error || "重置密码失败。");
    } else {
      setPassword("");
      setConfirmPassword("");
      setNotice(payload?.message || "密码已重置，请使用新密码登录。");
    }

    setLoading(false);
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">新密码</span>
        <input
          autoComplete="new-password"
          className="ios-input h-11 w-full"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">确认新密码</span>
        <input
          autoComplete="new-password"
          className="ios-input h-11 w-full"
          minLength={8}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          type="password"
          value={confirmPassword}
        />
      </label>
      {error ? (
        <div className="app-inline-alert flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <XCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="app-inline-alert flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}
      <button
        className="ios-button-primary app-action-button flex h-11 w-full items-center justify-center gap-2 px-4 disabled:opacity-60"
        disabled={loading || !token}
        type="submit"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
        重置密码
      </button>
      {notice ? (
        <a
          className="ios-button-secondary app-action-button flex h-10 w-full items-center justify-center px-4 text-sm"
          href="/login"
        >
          返回登录
        </a>
      ) : null}
    </form>
  );
}
