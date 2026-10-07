import Link from "next/link";
import { FilePenLine, SearchCheck, Network } from "lucide-react";

/** 首页三个功能入口（稍后可整体替换为 public/ 下的本地图标图片） */
const ENTRIES = [
  { href: "/essay", label: "作文分析", Icon: FilePenLine },
  { href: "/single", label: "单题语法分析", Icon: SearchCheck },
  { href: "/sentence", label: "长难句分析", Icon: Network },
] as const;

export default function HomePage() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center bg-gradient-to-b from-violet-100 via-blue-50 to-white px-4 py-12">
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        {/* 品牌区：Logo + 主副标题（Logo 为占位 SVG，稍后替换成 public/ 里的真实图片） */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-white shadow-[0_8px_40px_rgba(99,102,241,0.35)] ring-1 ring-white sm:h-32 sm:w-32">
            <svg
              viewBox="0 0 64 64"
              fill="none"
              className="h-20 w-20 sm:h-24 sm:w-24"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="logoGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#1e3a8a" />
                  <stop offset="55%" stopColor="#4f46e5" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
              {/* G 形圆弧 + 雷达扫描线与信号点 */}
              <circle
                cx="32"
                cy="32"
                r="22"
                stroke="url(#logoGrad)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray="102 139"
                transform="rotate(128 32 32)"
              />
              <circle cx="32" cy="32" r="6" fill="url(#logoGrad)" />
              <line
                x1="32"
                y1="32"
                x2="47"
                y2="17"
                stroke="url(#logoGrad)"
                strokeWidth="6"
                strokeLinecap="round"
              />
              <circle cx="48" cy="16" r="3.6" fill="#7c3aed" />
            </svg>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-blue-950">
            Grammar-Radar
          </h1>
          <p className="text-lg text-slate-500">语法雷达</p>
        </div>

        {/* 功能入口：三卡片横排，360px 窄屏也不换行 */}
        <div className="mt-20 grid w-full grid-cols-3 gap-2 sm:mt-24 sm:gap-3">
          {ENTRIES.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex min-w-0 flex-col items-center gap-3 rounded-2xl bg-white p-3 shadow-sm transition-transform duration-150 active:scale-95 sm:p-4"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 sm:h-16 sm:w-16">
                <Icon className="h-8 w-8 text-indigo-600 sm:h-10 sm:w-10" />
              </span>
              <span className="whitespace-nowrap text-center text-xs font-medium text-slate-700 sm:text-sm">
                {label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
