"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getSupabase, getStoredSession } from "@/lib/supabase";

/**
 * 客户端登录守卫：
 * - 同步读 localStorage 判断登录态（零网络，SSR 阶段用 typeof window 拦截）
 * - 有缓存会话直接放行；无缓存会话渲染登录入口
 * - 后台 getSession() 仅做对账，弱网不踢出
 *
 * 关键点：登录判定不靠 useEffect 异步 setState，而是
 * 用 useState(getStoredSession()?.access_token) 做同步初始化，
 * 避免 hydration 后先渲染 spinner 再闪 children 的时序差，
 * 彻底解决 iPad Safari 上"检查登录状态"卡死的问题。
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  // 同步初始化：SSR 时 window 不存在 → localStorage 读不到 → 初始 false；
  // 客户端首次渲染 → localStorage 有值则初始 true → 直接渲染 children，
  // 完全不出现 spinner 闪一下再消失的窗口期。
  const [allowed, setAllowed] = useState<boolean>(
    typeof window !== "undefined" && !!getStoredSession()?.access_token
  );
  const [noSession, setNoSession] = useState<boolean>(
    typeof window !== "undefined" && !getStoredSession()?.access_token
  );

  useEffect(() => {
    const sb = getSupabase();
    let settled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    // 如果 useState 初始值判定有 session，这里做后台对账
    if (allowed) {
      const finishNoSession = () => {
        if (settled) return;
        settled = true;
        setAllowed(false);
        setNoSession(true);
      };

      sb.auth
        .getSession()
        .then(({ data: { session } }) => {
          if (!session) finishNoSession();
          else settled = true;
        })
        .catch(() => {
          // 网络错误不踢出
          settled = true;
        });

      refreshTimer = setTimeout(() => {
        settled = true;
      }, 3000);
    }

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if (session) {
        setAllowed(true);
        setNoSession(false);
      } else if (event === "SIGNED_OUT") {
        setAllowed(false);
        setNoSession(true);
      }
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (noSession && !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <svg
            className="h-10 w-10 text-slate-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <p className="text-sm text-slate-500">请先登录后使用</p>
          <Link
            href="/login"
            className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700"
          >
            前往登录
          </Link>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <svg className="h-8 w-8 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <p className="text-sm">正在检查登录状态…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
