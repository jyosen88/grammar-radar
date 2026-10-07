-- 微讲义缓存表：同一知识点的"更多知识点讲解"只生成一次，之后直接读库
-- 请在 Supabase Dashboard → SQL Editor 中手动执行本文件

create table if not exists public.grammar_lessons (
  id bigint generated always as identity primary key,
  knowledge_point text not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- 同一知识点只存一份讲义（upsert onConflict 依赖此唯一约束）
create unique index if not exists grammar_lessons_kp_uidx
  on public.grammar_lessons (knowledge_point);

alter table public.grammar_lessons enable row level security;

-- 讲义内容公开可读（不含用户数据）
create policy "grammar_lessons_public_read"
  on public.grammar_lessons for select using (true);

-- 服务端以匿名 key 写入缓存，允许 anon 插入
create policy "grammar_lessons_anon_insert"
  on public.grammar_lessons for insert with check (true);
