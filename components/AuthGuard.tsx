"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getSupabase, getStoredSession } from "@/lib/supabase";

/**
 * 客户端登录守卫：会话保存在 localStorage（supabase-js persistSession），
 * 服务端 middleware 读不到，因此在客户端校验。
 * - 未登录访问受保护页面 → 统一跳转 /login（登录成功后进入首页）
 * - 在受保护页面退出登录 → 同样自动跳走
 * - 会话状态确认前不渲染 children，避免闪现受保护内容
 *
 * 弱网处理：先用 localStorage 缓存会话做零网络判定——无缓存会话立即跳登录，
 * 有缓存会话先放行；getSession() 的 token 网络刷新只在后台对账，
 * 避免手机弱网下长时间停在“正在检查登录状态”。
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    let settled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    // 第一步：零网络的本地判定（同步完成）
    const stored = getStoredSession();
    if (!stored?.access_token) {
      // 本地没有任何会话：必定未登录，直接跳，绝不等待网络
      router.replace("/login");
      return;
    }
    // 本地有缓存会话（即使 access_token 已过期，也可能靠 refresh_token 续期）：
    // 先放行页面，后台静默对账
    setAllowed(true);

    const finishNoSession = () => {
      if (settled) return;
      settled = true;
      setAllowed(false);
      router.replace("/login");
    };

    // 第二步：后台网络对账，刷新结果明确为无会话才踢回登录；
    // 3 秒仍无结果（弱网）不打扰用户，保留本地会话继续用
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
      // 超时兜底：停止等待，页面保持当前状态
      settled = true;
    }, 3000);

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if (session) {
        setAllowed(true);
      } else if (event === "SIGNED_OUT") {
        setAllowed(false);
        router.replace("/login");
      }
    });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      subscription.unsubscribe();
    };
    // router 实例稳定
  }, [router]);

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
