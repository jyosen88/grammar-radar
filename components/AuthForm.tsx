"use client";

import { useCallback, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

interface AuthFormProps {
  /** 初始模式：登录 / 注册 */
  initialMode?: "login" | "register";
  /** 登录或注册成功且拿到会话后回调（如关闭弹窗、跳回原页面） */
  onSuccess?: (user: User) => void;
}

/** 邮箱 + 密码的登录/注册表单，供顶部弹窗与 /login 页面共用 */
export function AuthForm({ initialMode = "login", onSuccess }: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleAuth = useCallback(async () => {
    if (!email.trim() || !password) {
      setError("请输入邮箱和密码");
      return;
    }
    setBusy(true);
    setError("");
    const sb = getSupabase();
    try {
      let result;
      if (mode === "login") {
        result = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
      } else {
        result = await sb.auth.signUp({
          email: email.trim(),
          password,
        });
      }
      if (result.error) {
        setError(result.error.message);
      } else if (mode === "register" && !result.data.session) {
        // 注册成功但 Supabase 开启了邮箱验证：没有 session，需要先去邮箱点链接
        setError("注册成功！请先到邮箱点击验证链接，然后再登录。");
      } else if (result.data.user) {
        onSuccess?.(result.data.user);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }, [email, password, mode, onSuccess]);

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          邮箱
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          密码
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 6 位"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAuth();
          }}
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          ⚠️ {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleAuth}
        disabled={busy}
        className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "处理中…" : mode === "login" ? "登录" : "注册"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError("");
        }}
        className="w-full text-center text-xs text-indigo-600 hover:underline"
      >
        {mode === "login"
          ? "没有账号？去注册 →"
          : "已有账号？去登录 →"}
      </button>
    </div>
  );
}
