import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** 懒初始化：浏览器端复用单例，服务端每次新建（避免跨请求泄漏） */
function createSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase 环境变量未配置，请检查 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: true,
      storageKey: "grammar-radar-auth",
      autoRefreshToken: true,
    },
  });
}

export function getSupabase(): SupabaseClient {
  if (typeof window === "undefined") {
    return createSupabase(); // 服务端：不缓存，每次新建
  }
  if (!client) {
    client = createSupabase();
  }
  return client;
}

/** 获取当前登录用户，未登录返回 null */
export async function getCurrentUser() {
  const sb = getSupabase();
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error || !user) return null;
  return user;
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
