"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthArea } from "./AuthArea";

const ITEMS = [
  { href: "/essay", label: "作文分析" },
  { href: "/single", label: "单题语法分析" },
  { href: "/sentence", label: "长难句分析" },
  { href: "/records", label: "我的记录" },
];

/** 全站顶部导航栏，当前页高亮 */
export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-2.5 md:flex-row md:items-center md:gap-1">
        {/* 手机端：四个功能按钮在登录注册下方一行等宽并列；桌面端：展开为单行 */}
        <div className="order-2 grid w-full grid-cols-4 gap-1 md:order-none md:w-auto md:contents">
          {ITEMS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`whitespace-nowrap rounded-lg border px-1.5 py-1.5 text-center text-xs font-medium transition md:px-3.5 md:text-sm ${
                  active
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                    : "border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-slate-200 hover:text-slate-900"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
        {/* 手机端：登录注册位于第一行右上角；桌面端：仍贴整行最右侧 */}
        <div className="order-1 self-end md:order-none md:ml-auto md:self-auto">
          <AuthArea />
        </div>
      </div>
    </nav>
  );
}
