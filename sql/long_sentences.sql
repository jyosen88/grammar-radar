-- 长难句题库：供"从题库选题"功能随机抽取
-- 在 Supabase SQL Editor 中执行本脚本

create table if not exists public.long_sentences (
  id bigint generated always as identity primary key,
  sentence text not null,
  source text,
  difficulty text check (difficulty in ('简单', '中等', '困难')) default '中等',
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 查询加速
create index if not exists long_sentences_created_at_idx
  on public.long_sentences (created_at desc);

alter table public.long_sentences enable row level security;

-- 所有已登录用户均可读题库（题库是公共资源）
create policy "long_sentences_select_authenticated"
  on public.long_sentences for select
  using (auth.role() = 'authenticated');

-- 只有 service_role 可以写（前端暂无后台管理界面，数据由管理员手动导入）
-- 默认 deny insert，无需显式 policy
