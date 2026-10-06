-- 学习记录表：每次分析完成后自动保存
-- 在 Supabase SQL Editor 中执行本脚本

create table if not exists public.user_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  image_url text,
  input_text text not null,
  analysis_result jsonb not null,
  knowledge_points text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 查询加速：按用户 + 时间倒序
create index if not exists user_records_user_id_created_at_idx
  on public.user_records (user_id, created_at desc);

alter table public.user_records enable row level security;

-- 用户只能读自己的记录
create policy "user_records_select_own"
  on public.user_records for select
  using (auth.uid() = user_id);

-- 用户只能写入自己的记录
create policy "user_records_insert_own"
  on public.user_records for insert
  with check (auth.uid() = user_id);

-- 用户只能删自己的记录（前端暂未用到，先开放）
create policy "user_records_delete_own"
  on public.user_records for delete
  using (auth.uid() = user_id);
