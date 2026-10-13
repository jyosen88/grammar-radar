"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { getSupabase, getStoredSession } from "@/lib/supabase";

/**
 * 客户端登录守卫：会话保存在 localStorage（supabase-js persistSession），
 * 服务端 middleware 读不到，因此在客户端校验。
 * - 未登录访问受保护页面 → 跳转 /login（登录成功后进入首页）
 * - 在受保护页面退出登录 → 同样自动跳走
 * - 会话状态确认前不渲染 children，避免闪现受保护内容
 *
 * 弱网 / Safari 兼容处理：
 * 1. 先用 localStorage 缓存会话做零网络判定——有缓存会话立即放行
 * 2. 无缓存会话：尝试 window.location.replace 跳转，同时渲染可点击的登录按钮兜底
 *    （iPad Safari 上 JS 跳转偶发静默失败，用户可手动点按钮进入登录页）
 * 3. 有缓存会话时后台 getSession() 只做对账，弱网超时不踢出
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  // noSession=true 表示确认未登录，需要显示登录入口（而非无限转圈）
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    let settled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    // 第一步：零网络的本地判定（同步完成）
    const stored = getStoredSession();
    if (!stored?.access_token) {
      // 本地没有任何会话：必定未登录
      // 尝试自动跳转；同时 setNoSession(true) 渲染可点击的登录按钮作为兜底，
      // 防止 window.location.replace 在 Safari 上静默失败时卡死
      setNoSession(true);
      window.location.replace("/login");
      return;
    }
    // 本地有缓存会话：先放行页面，后台静默对账
    setAllowed(true);

    const finishNoSession = () => {
      if (settled) return;
      settled = true;
      setAllowed(false);
      setNoSession(true);
    };

    // 第二步：后台网络对账，刷新结果明确为无会话才踢回登录；
    // 弱网超时不打扰用户，保留本地会话继续用
    sb.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!session) finishNoSession();
        else settled = true;
      })
      .catch(() => {
        // 网络错误不踢出，按本地会话放行
        settled = true;
      });

    refreshTimer = setTimeout(() => {
      settled = true;
    }, 3000);

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
