"use client";

import { FormEvent, useState } from "react";
import { Loader2, LogIn } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || "登录失败。");
      setLoading(false);
      return;
    }

    window.location.href = "/chat";
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
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
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">密码</span>
        <input
          className="ios-input h-11 w-full"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      {error ? (
        <div className="app-inline-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      <button
        className="ios-button-primary app-action-button flex h-11 w-full items-center justify-center gap-2 px-4 disabled:opacity-60"
        disabled={loading}
        type="submit"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
        登录
      </button>
    </form>
  );
}
