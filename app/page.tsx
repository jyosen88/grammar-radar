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
    <main
      className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-12"
      style={{
        // 底层：左上紫 → 中上蓝紫 → 右上浅蓝；顶层：纵向从透明渐隐到纯白，
        // 复刻设计图顶部多彩、底部净白的柔和背景
        background:
          "linear-gradient(180deg, rgba(255,255,255,0) 8%, rgba(255,255,255,0.35) 38%, rgba(255,255,255,0.8) 58%, #ffffff 74%), linear-gradient(105deg, #D5BAFD 0%, #C0CCFE 50%, #B2DAFE 100%)",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        {/* 品牌区：Logo + 主副标题（Logo 图片位于 public/logo.png，直接展示原图） */}
        <div className="flex w-full flex-col items-center gap-4">
          {/* Logo 宽度为容器 1/3；背后四层光效：紫色环境光 → 近白亮芯 → 柔焦/清晰双光圈 */}
          <div className="relative flex w-full items-center justify-center">
            {/* 1. 紫色环境光：大面积淡紫散开，与页面背景衔接 */}
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 aspect-square w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl"
              style={{
                background:
                  "radial-gradient(circle, rgba(196,181,253,0.55) 0%, rgba(196,181,253,0.18) 55%, rgba(196,181,253,0) 75%)",
              }}
            />
            {/* 2. 近白亮芯：比背景更浅的一团白光，托住 Logo */}
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 aspect-square w-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-xl"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.98) 0%, rgba(245,240,255,0.75) 45%, rgba(233,223,255,0) 72%)",
              }}
            />
            {/* 3. 柔焦光圈：发光白环的模糊层，直径约为 Logo 的 1.45 倍 */}
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 aspect-square w-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 blur-[3px]"
            />
            {/* 4. 清晰光圈：半透明白环 + 内外发光 */}
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 aspect-square w-[48%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70"
              style={{
                boxShadow:
                  "0 0 18px rgba(255,255,255,0.9), inset 0 0 12px rgba(255,255,255,0.55)",
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
