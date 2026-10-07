"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

/**
 * 客户端登录守卫：会话保存在 localStorage（supabase-js persistSession），
 * 服务端 middleware 读不到，因此在客户端校验。
 * - 未登录访问受保护页面 → 跳转 /login?redirect=<原路径>
 * - 在受保护页面退出登录 → 同样自动跳走
 * - 会话状态确认前不渲染 children，避免闪现受保护内容
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sb = getSupabase();

    const goLogin = () => {
      // search 直接从浏览器地址读取，避免 useSearchParams 的 Suspense 限制
      const search = window.location.search;
      const dest = encodeURIComponent(pathname + search);
      router.replace(`/login?redirect=${dest}`);
    };

    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAllowed(true);
      } else {
        goLogin();
      }
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      if (session) {
        setAllowed(true);
      } else if (event === "SIGNED_OUT") {
        setAllowed(false);
        goLogin();
      }
    });

    return () => subscription.unsubscribe();
    // router 实例稳定；pathname 变化时重新校验当前页
  }, [pathname, router]);

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
