"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase, getStoredSession } from "@/lib/supabase";
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

    // 先用本地缓存会话即时渲染邮箱（仅用到 email 字段），不等待弱网请求
    const cached = getStoredSession()?.user;
    if (cached?.id) {
      const snapshot = { id: cached.id, email: cached.email ?? null } as User;
      setUser(snapshot);
      onAuthChange?.(snapshot);
    }

    // 网络结果作为权威状态对账（刷新失败时保留本地快照）
    sb.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      if (u) {
        setUser(u);
        onAuthChange?.(u);
      }
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
          className="rounded-lg border border-[#e7dbfa] bg-[#f4eefc] px-2.5 py-1 font-medium text-[#6d4fc9] transition hover:bg-[#ebdff9] disabled:opacity-60"
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
        className="rounded-2xl border border-[#ddcbfa] bg-[#f6f1ff] px-2.5 py-1 text-xs font-medium text-[#6d3fd4] transition hover:bg-[#eee4fd]"
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
