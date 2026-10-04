// 服务端专用：从 Supabase 拉取知识点卡片目录（card_code + title），供 AI Prompt 使用
// 仅在 API Route（服务端）中引用，不要在客户端组件中 import

let catalogCache: { codes: string[]; promptList: string; at: number } | null = null;
const CATALOG_TTL_MS = 10 * 60 * 1000;

export async function getCardCatalog(): Promise<{
  codes: string[];
  promptList: string;
}> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase 环境变量未配置");
  const res = await fetch(
    `${url}/rest/v1/grammar_cards?select=card_code,title&order=card_code`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) throw new Error(`获取知识点目录失败（${res.status}）`);
  const rows: { card_code: string; title: string }[] = await res.json();
  const catalog = {
    codes: rows.map((r) => r.card_code),
    promptList: rows.map((r) => `${r.card_code} ${r.title}`).join("\n"),
    at: Date.now(),
  };
  catalogCache = catalog;
  return catalog;
}

// 校验 AI 返回的编号，过滤掉目录中不存在的，并把未知编号写入服务端日志
export function validateCardCodes(
  rawCodes: unknown,
  validCodes: string[]
): string[] {
  const validSet = new Set(validCodes);
  const result: string[] = [];
  const unknown: string[] = [];
  const list = Array.isArray(rawCodes) ? rawCodes : [];
  for (const c of list) {
    if (typeof c !== "string") continue;
    if (validSet.has(c)) result.push(c);
    else unknown.push(c);
  }
  if (unknown.length > 0) {
    console.warn(
      `[card-catalog] AI 返回了知识库中不存在的编号，已忽略: ${unknown.join(", ")}`
    );
  }
  return result;
}
