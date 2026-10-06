/**
 * 单题语法分析的"搜索二次确认"。
 *
 * 流程：前端先从题干提取关键词 → 调用搜索接口拿网页标题+摘要 →
 * 作为参考资料随题目一起发给 /api/analyze，由 DeepSeek 对照后给出一致性结论。
 *
 * 当前为【占位实现】：搜索接口尚未接入，searchReferences 固定返回空数组，
 * 调用方据此降级为纯 AI 分析（AI 返回 reference_check.status = "none"）。
 * 后续接入真实 API（如 Bing Web Search / SerpAPI / 自建检索服务）时，
 * 只需替换 searchReferences 函数体，调用方代码无需改动。
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

/**
 * 搜索外部参考资料（占位实现）。
 *
 * 约定（接入真实 API 时必须遵守）：
 * - 入参为 extractKeywords 产出的关键词；
 * - 返回最多 5 条 { title, snippet, url? }，snippet 为网页摘要纯文本；
 * - 任何失败（网络错误 / 配额不足 / 未配置 Key）都【不要 reject】，
 *   返回空数组即可，由调用方降级为纯 AI 分析并标注"未找到外部参考"。
 */
export async function searchReferences(
  _keywords: string[]
): Promise<ReferenceItem[]> {
  // TODO: 后续在此接入具体搜索 API，例如：
  // const res = await fetch(`https://api.example.com/search?q=${encodeURIComponent(_keywords.join(" "))}`);
  // if (!res.ok) return [];
  // return (await res.json()).results.slice(0, 5).map(...);
  void _keywords;
  return [];
}
