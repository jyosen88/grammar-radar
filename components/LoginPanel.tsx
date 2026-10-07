"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { AuthForm } from "./AuthForm";

/** 只允许站内相对路径，防开放重定向与 /login 自循环 */
function safeRedirect(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/"))
    return "/";
  return raw;
}

/** /login 页面主体：登录/注册成功后跳回原本想访问的页面 */
export function LoginPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checked, setChecked] = useState(false);
  const redirectTo = safeRedirect(searchParams.get("redirect"));

  useEffect(() => {
    // 已登录用户打开 /login：直接送到目标页，无需再登录
    getSupabase()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace(redirectTo);
        else setChecked(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!checked) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-slate-400">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-violet-100 via-blue-50 to-white px-4 py-12">
      <div className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-sm">
        <h1 className="text-center text-2xl font-bold tracking-tight text-indigo-700">
          Grammar Radar
        </h1>
        <p className="mt-1.5 text-center text-sm text-slate-500">
          登录后继续使用各项语法分析功能
        </p>

        <div className="mt-6">
          <AuthForm onSuccess={() => router.replace(redirectTo)} />
        </div>

        <div className="mt-5 text-center">
          <Link
            href="/"
            className="text-xs text-slate-400 transition hover:text-slate-600"
          >
            ← 返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
