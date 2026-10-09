import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "服务端未配置 Supabase 环境变量" },
      { status: 500 }
    );
  }
  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 先查 count，再随机 offset 取一条
  const { count, error: countErr } = await sb
    .from("long_sentences")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    return NextResponse.json(
      { error: `数据库查询失败：${countErr.message}` },
      { status: 502 }
    );
  }
  if (!count || count === 0) {
    return NextResponse.json({ sentence: null });
  }

  const offset = Math.floor(Math.random() * count);
  const { data, error } = await sb
    .from("long_sentences")
    .select("id, sentence, source, difficulty, tags")
    .range(offset, offset);

  if (error) {
    return NextResponse.json(
      { error: `数据库查询失败：${error.message}` },
      { status: 502 }
    );
  }
  const item = data?.[0];
  if (!item) {
    return NextResponse.json({ sentence: null });
  }

  return NextResponse.json({
    sentence: (item.sentence as string) ?? "",
    source: (item.source as string) ?? null,
    difficulty: (item.difficulty as string) ?? null,
    tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
  });
}
