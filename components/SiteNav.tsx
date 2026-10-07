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
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-1 px-4 py-2.5">
        {ITEMS.map(({ href, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-lg border px-3.5 py-1.5 text-sm font-medium transition ${
                active
                  ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                  : "border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-slate-200 hover:text-slate-900"
              }`}
            >
              {label}
            </Link>
          );
        })}
        <div className="ml-auto">
          <AuthArea />
        </div>
      </div>
    </nav>
  );
}
