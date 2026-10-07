import Link from "next/link";
import { Network, ArrowLeft } from "lucide-react";
import { SiteNav } from "@/components/SiteNav";
import { AuthGuard } from "@/components/AuthGuard";

export const metadata = {
  title: "Grammar Radar · 长难句分析",
};

/** 长难句分析：功能开发中占位页 */
export default function SentencePage() {
  return (
    <AuthGuard>
      <div className="min-h-screen">
        <SiteNav />
        <main className="flex min-h-[calc(100vh-3rem)] items-center justify-center bg-gradient-to-b from-violet-100 via-blue-50 to-white px-4 py-12">
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100">
              <Network className="h-11 w-11 text-indigo-600" />
            </span>
            <h1 className="mt-5 text-xl font-bold text-blue-950">
              长难句分析
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              句子成分拆解、主干提取、从句层级可视化功能正在开发中，敬请期待。
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 active:scale-95"
            >
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Link>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
