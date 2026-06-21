"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, Loader2, LogIn, Mail, UserPlus } from "lucide-react";
import { VERIFICATION_EMAIL_HINT } from "@/lib/email-copy";
import type { PublicAuthSettingsView } from "@/types/gateway";

type LoginFormProps = {
  authSettings: PublicAuthSettingsView;
};

type AuthMode = "forgot" | "login" | "register";

export function LoginForm({ authSettings }: LoginFormProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setErrorCode("");
    setNotice("");

    const response = await fetch(
      mode === "forgot"
        ? "/api/auth/password-reset/request"
        : mode === "login"
          ? "/api/auth/login"
          : "/api/auth/register",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, password })
      }
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { code?: string; error?: string }
        | null;
      setError(payload?.error || (mode === "forgot" ? "发送重置邮件失败。" : "登录失败。"));
      setErrorCode(payload?.code || "");
      setLoading(false);
      return;
    }

    if (mode === "forgot") {
      const payload = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;

      setNotice(payload?.message || "如果这个邮箱存在可用账号，系统会发送一封重置密码邮件。");
      setLoading(false);
      return;
    }

    if (mode === "register") {
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; needsVerification?: boolean }
        | null;

      if (payload?.needsVerification) {
        setMode("login");
        setPassword("");
        setNotice(payload.message || `注册成功，请查收验证邮件后登录。${VERIFICATION_EMAIL_HINT}`);
        setLoading(false);
        return;
      }
    }

    window.location.href = "/chat";
  }

  async function resendVerification() {
    setResending(true);
    setError("");
    setNotice("");

    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error || "发送验证邮件失败。");
    } else {
      setNotice(payload?.message || `验证邮件已发送，请查收。${VERIFICATION_EMAIL_HINT}`);
      setErrorCode("");
    }

    setResending(false);
  }

  const isForgot = mode === "forgot";
  const isRegister = mode === "register";

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {!isForgot && authSettings.registrationEnabled ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-white/60 p-1">
          <button
            className={`app-action-button h-9 rounded-md text-sm font-semibold ${
              mode === "login" ? "bg-white text-stone-950 shadow-sm" : "text-stone-500"
            }`}
            onClick={() => {
              setMode("login");
              setError("");
              setNotice("");
            }}
            type="button"
          >
            登录
          </button>
          <button
            className={`app-action-button h-9 rounded-md text-sm font-semibold ${
              mode === "register" ? "bg-white text-stone-950 shadow-sm" : "text-stone-500"
            }`}
            onClick={() => {
              setMode("register");
              setError("");
              setNotice("");
            }}
            type="button"
          >
            注册
          </button>
        </div>
      ) : null}
      {isForgot ? (
        <div className="rounded-lg border border-[color:var(--ios-separator)] bg-white/55 px-3 py-2 text-sm leading-6 text-stone-700">
          输入账号邮箱。链接有效期 30 分钟，重置后旧登录设备会自动退出。
        </div>
      ) : null}
      {isRegister ? (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">昵称</span>
          <input
            autoComplete="name"
            className="ios-input h-11 w-full"
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">邮箱</span>
        <input
          className="ios-input h-11 w-full"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      {!isForgot ? (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">密码</span>
          <input
            className="ios-input h-11 w-full"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
      ) : null}
      {!isForgot ? (
        <button
          className="app-action-button -mt-2 inline-flex h-8 items-center rounded-lg px-1 text-sm font-semibold text-[color:var(--claude-accent)]"
          onClick={() => {
            setMode("forgot");
            setError("");
            setErrorCode("");
            setNotice("");
            setPassword("");
          }}
          type="button"
        >
          忘记密码？
        </button>
      ) : null}
      {error ? (
        <div className="app-inline-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="app-inline-alert rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </div>
      ) : null}
      {errorCode === "EMAIL_UNVERIFIED" ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{VERIFICATION_EMAIL_HINT}</p>
          <button
            className="ios-button-secondary app-action-button flex h-10 w-full items-center justify-center gap-2 px-4 text-sm disabled:opacity-60"
            disabled={resending || !email}
            onClick={resendVerification}
            type="button"
          >
            {resending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            重发验证邮件
          </button>
        </div>
      ) : null}
      <button
        className="ios-button-primary app-action-button flex h-11 w-full items-center justify-center gap-2 px-4 disabled:opacity-60"
        disabled={loading}
        type="submit"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isForgot ? (
          <Mail className="size-4" />
        ) : isRegister ? (
          <UserPlus className="size-4" />
        ) : (
          <LogIn className="size-4" />
        )}
        {isForgot ? "发送重置邮件" : isRegister ? "注册" : "登录"}
      </button>
      {isForgot ? (
        <button
          className="ios-button-secondary app-action-button flex h-10 w-full items-center justify-center gap-2 px-4 text-sm"
          onClick={() => {
            setMode("login");
            setError("");
            setErrorCode("");
            setNotice("");
          }}
          type="button"
        >
          <ArrowLeft className="size-4" />
          返回登录
        </button>
      ) : null}
    </form>
  );
}
