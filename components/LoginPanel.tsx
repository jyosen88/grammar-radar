"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStoredSession } from "@/lib/supabase";
import { AuthForm } from "./AuthForm";

/** /login 页面主体：登录/注册成功后统一进入首页 */
export function LoginPanel() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // 同步读取本地缓存会话（零网络）：已登录直接进首页；
    // 不使用 getSession()，避免手机弱网刷新 token 时登录页一直“加载中”
    if (getStoredSession()?.access_token) router.replace("/");
    else setChecked(true);
  }, [router]);

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
          <AuthForm onSuccess={() => router.replace("/")} />
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
