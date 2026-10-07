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
        {/* 品牌区：Logo + 主副标题（Logo 图片位于 public/logo.png，直接展示原图） */}
        <div className="flex w-full flex-col items-center gap-4">
          {/* Logo 宽度为容器 1/3，左右边缘正好落在横向 1/3、2/3 位置；背后叠加柔焦紫色光环 */}
          <div className="relative flex w-full items-center justify-center">
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl sm:h-48 sm:w-48"
              style={{
                background:
                  "radial-gradient(circle, rgba(139,92,246,0.3) 0%, transparent 70%)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Grammar Radar 语法雷达"
              className="relative z-10 aspect-square w-1/3 object-contain"
            />
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
