"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
import { AuthForm } from "./AuthForm";

interface AuthAreaProps {
  onAuthChange?: (user: User | null) => void;
}

/** 顶部导航右侧：登录/注册弹窗 + 用户邮箱 + 退出 */
export function AuthArea({ onAuthChange }: AuthAreaProps) {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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
        onClick={() => setOpen(true)}
        className="rounded-2xl border border-[#e7defb] bg-[#f5f1fe] px-2.5 py-1 text-xs font-medium text-[#7c55d8] transition hover:bg-[#ece4fd]"
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
              <h3 className="text-lg font-semibold text-slate-900">账号登录</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <AuthForm onSuccess={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
