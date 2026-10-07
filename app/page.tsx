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
        {/* 品牌区：Logo + 主副标题（public/logo.png 由 logo.jpg 分层重建：
            G 原色在顶层、白色发光环外扩到 1.38 倍、外圈淡紫光透明渐隐） */}
        <div className="flex w-full flex-col items-center gap-4">
          {/* 图内 G 标志约占 61.7%，图片取容器 54% 使 G 本体约为 1/3 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Grammar Radar 语法雷达"
            className="aspect-square w-[54%] object-contain"
          />

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
