/**
 * 单题语法分析的"搜索二次确认"。
 *
 * 流程：前端先从题干提取关键词 → 请求本站 /api/search（服务端持 Key 代理调用
 * 博查 Web Search API，Key 不会暴露给浏览器）拿网页标题+摘要+链接 →
 * 作为参考资料随题目一起发给 /api/analyze，由 DeepSeek 对照后给出一致性结论。
 *
 * 降级保证：本模块任何一环失败（网络错误 / 超时 / Key 未配置 / 博查报错）
 * 都返回空数组、绝不抛错，调用方据此降级为纯 AI 分析
 * （AI 返回 reference_check.status = "none"，前端显示"未找到外部参考"）。
 */

/** 一条外部参考资料（网页标题 + 摘要） */
export interface ReferenceItem {
  title: string;
  snippet: string;
  url?: string;
}

/** 常见英语虚词/功能词，提取关键词时过滤 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "when",
  "while", "with", "without", "for", "from", "into", "onto", "that", "this",
  "these", "those", "there", "here", "what", "which", "who", "whom", "whose",
  "where", "why", "how", "does", "doesn", "did", "didn", "done", "doing",
  "have", "has", "had", "having", "not", "no", "yes", "are", "was", "were",
  "been", "being", "will", "would", "shall", "should", "can", "could", "may",
  "might", "must", "than", "they", "them", "their", "his", "her", "hers",
  "its", "our", "ours", "your", "yours", "you", "she", "him", "his", "about",
  "best", "answer", "choose", "fill", "blank", "correct", "sentence",
]);

/**
 * 从用户输入中提取题干关键词（启发式占位版本，不触网）：
 * 1. 去掉 A/B/C/D 选项行和"选择最佳答案"之类的答题指令；
 * 2. 去掉空格占位符（____ / ___ / ( )）；
 * 3. 取长度 >= 4 的英文实义词，去重，最多 8 个。
 * 后续如需更精准的关键词，可替换为 AI 提取，调用方无需改动。
 */
export function extractKeywords(text: string): string[] {
  const stem = text
    .split(/\r?\n/)
    // 去掉选项行：行首是 A. / B) / C．等
    .filter((line) => !/^\s*[A-Za-z][\.\)．、]\s*\S+/.test(line.trim()))
    .join(" ")
    .replace(/_{2,}/g, " ")
    .replace(/[（(]\s*[）)]/g, " ");

  const words = stem.match(/[A-Za-z][A-Za-z'-]{3,}/g) ?? [];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOP_WORDS.has(lower) || seen.has(lower)) continue;
    seen.add(lower);
    keywords.push(w);
    if (keywords.length >= 8) break;
  }
  return keywords;
}

/** 前端等待搜索结果的最长时间（服务端本身 10s 超时，这里再留一点余量） */
const SEARCH_TIMEOUT_MS = 12000;

/**
 * 搜索外部参考资料：请求本站服务端代理 /api/search（内部调用博查 Web Search API）。
 *
 * 约定：
 * - 入参为 extractKeywords 产出的关键词；
 * - 返回最多 5 条 { title, snippet, url }，snippet 为网页摘要/正文纯文本；
 * - 任何失败（网络错误 / 超时 / Key 未配置 / 博查欠费报错）都【不要 reject】，
 *   返回空数组即可，由调用方降级为纯 AI 分析并标注"未找到外部参考"。
 */
export async function searchReferences(
  keywords: string[]
): Promise<ReferenceItem[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return [];
    const data = (await res.json()) as { references?: unknown };
    if (!Array.isArray(data.references)) return [];
    return data.references
      .map((r) => {
        const item =
          r && typeof r === "object" ? (r as Record<string, unknown>) : null;
        if (!item) return null;
        const title = typeof item.title === "string" ? item.title : "";
        const snippet = typeof item.snippet === "string" ? item.snippet : "";
        const url = typeof item.url === "string" ? item.url : undefined;
        if (!title && !snippet) return null;
        const ref: ReferenceItem = { title, snippet };
        if (url) ref.url = url;
        return ref;
      })
      .filter((r): r is ReferenceItem => r !== null)
      .slice(0, 5);
  } catch {
    // 超时 / 网络错误 / JSON 解析失败：静默降级
    return [];
  }
}
