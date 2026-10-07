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

/** supabase-js 持久化会话所用的 localStorage 键名（需与 createClient 配置一致） */
export const AUTH_STORAGE_KEY = "grammar-radar-auth";

/** 本地缓存会话的最小结构 */
export interface StoredSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  user?: { id?: string; email?: string };
}

/**
 * 只从 localStorage 同步读取缓存会话，绝不发起网络请求。
 * 手机弱网下 getSession() 可能因刷新 token 请求挂起，路由守卫用它做即时判定。
 * 兼容两种存储结构：
 * - auth-js v2.117+：直接存 session 对象（顶层即 access_token 等）
 * - 旧版 gotrue-js：{ currentSession: session, expiresAt, ... } 包装
 */
export function getStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as
      | StoredSession
      | { currentSession?: StoredSession }
      | null;
    if (!data || typeof data !== "object") return null;
    if ("access_token" in data) return data as StoredSession;
    return (data as { currentSession?: StoredSession }).currentSession ?? null;
  } catch {
    return null;
  }
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
