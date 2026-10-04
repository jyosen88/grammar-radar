import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// 懒初始化：避免在构建期（环境变量可能未注入）创建客户端导致构建失败
export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Supabase 环境变量未配置，请检查 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    client = createClient(url, key);
  }
  return client;
}

export interface GrammarCard {
  id?: number;
  card_code: string;
  title: string;
  category: string | null;
  // rules_table 在数据库里是 jsonb（对象数组），原样保留交给渲染层解析
  rules_table: unknown;
  typical_errors: string | null;
  correct_examples: string | null;
  notes: string | null;
}
