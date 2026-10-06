"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

interface AuthAreaProps {
  onAuthChange?: (user: User | null) => void;
}

/** 顶部导航右侧：登录/注册弹窗 + 用户邮箱 + 退出 */
export function AuthArea({ onAuthChange }: AuthAreaProps) {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 初始化时读取当前登录状态，并监听变化
  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      onAuthChange?.(u);
    });
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      onAuthChange?.(u);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      } else {
        setOpen(false);
        setEmail("");
        setPassword("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }, [email, password, mode]);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      await getSupabase().auth.signOut();
    } catch {
      // 忽略退出错误
    } finally {
      setBusy(false);
    }
  }, []);

  if (user) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="hidden max-w-[140px] truncate text-slate-500 sm:inline">
          {user.email}
        </span>
        <button
          type="button"
          onClick={handleLogout}
          disabled={busy}
          className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
        >
          退出
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 transition hover:bg-indigo-100"
      >
        登录 / 注册
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                {mode === "login" ? "邮箱登录" : "邮箱注册"}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

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
                {busy
                  ? "处理中…"
                  : mode === "login"
                    ? "登录"
                    : "注册"}
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
          </div>
        </div>
      )}
    </>
  );
}
