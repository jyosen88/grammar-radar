-- error-bank 桶的上传策略：登录用户传到自己文件夹，匿名用户传到 anonymous/
-- 在 Supabase SQL Editor 中执行本脚本

-- 已登录用户：只能上传到「自己 user_id 命名的文件夹」下
create policy "error_bank_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'error-bank'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 匿名用户：只能上传到 anonymous/ 文件夹下
create policy "error_bank_insert_anonymous_folder"
  on storage.objects for insert
  to anon
  with check (
    bucket_id = 'error-bank'
    and (storage.foldername(name))[1] = 'anonymous'
  );

-- 读取保持公开（bucket 本身是 Public 即可，下面这条是兜底）
create policy "error_bank_read_public"
  on storage.objects for select
  using (bucket_id = 'error-bank');
