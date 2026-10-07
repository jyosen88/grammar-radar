import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grammar Radar · 英语语法卡片搜索",
  description: "搜索英语语法知识点卡片",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="bg-[#f8f5fe] text-slate-900 antialiased">{children}</body>
    </html>
  );
}
