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
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-2 py-2.5 md:flex-row md:items-center md:gap-1 md:px-4">
        {/* 手机端：四个功能按钮在登录注册下方一行等宽并列；桌面端：展开为单行 */}
        <div className="order-2 grid w-full grid-cols-4 gap-0.5 md:order-none md:w-auto md:contents md:gap-1">
          {ITEMS.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center justify-center whitespace-normal text-center text-[13px] font-medium leading-tight rounded-2xl border px-1 py-2.5 transition md:whitespace-nowrap md:px-3.5 md:py-1.5 md:text-sm ${
                  active
                    ? "border-transparent bg-gradient-to-r from-[#1a2388] to-[#9c5cf0] text-white shadow-[0_8px_20px_-10px_rgba(93,62,220,0.6)]"
                    : "border-transparent bg-[#f0f2fb] text-slate-600 hover:bg-[#e6e9f8] hover:text-slate-800"
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
