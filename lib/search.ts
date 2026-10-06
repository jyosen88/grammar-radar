/**
 * 单题语法分析的"搜索二次确认"。
 *
 * 流程：前端把原始题干发给 /api/search（服务端先用 DeepSeek 提取干净关键词，
 * 再代理调用博查 Web Search API，Key 不会暴露给浏览器）拿网页标题+摘要+链接 →
 * 作为参考资料随题目一起发给 /api/analyze，由 DeepSeek 对照后给出一致性结论。
 *
 * 降级保证：本模块任何一环失败（网络错误 / 超时 / Key 未配置 / 博查报错）
 * 都返回空数组、绝不抛错，调用方据此降级为纯 AI 分析
 * （AI 返回 reference_check.status = "none"，前端提示核对课本或询问老师）。
 */

/** 一条外部参考资料（网页标题 + 摘要） */
export interface ReferenceItem {
  title: string;
  snippet: string;
  url?: string;
}

/** 前端等待搜索结果的最长时间（DeepSeek 提取 + 博查搜索串行，留足余量） */
const SEARCH_TIMEOUT_MS = 20000;

/**
 * 搜索外部参考资料：请求本站服务端代理 /api/search。
 * 服务端先用 DeepSeek 从原始题干提取核心考点词、关键搭配和特征词，
 * 再用这些关键词组合调用博查 Web Search API。
 *
 * 约定：
 * - 入参为原始题干 text（可包含拼写错误、空格占位符、选项行）；
 * - 返回最多 5 条 { title, snippet, url }，snippet 为网页摘要/正文纯文本；
 * - 任何失败（网络错误 / 超时 / Key 未配置 / 博查欠费报错）都【不要 reject】，
 *   返回空数组即可，由调用方降级为纯 AI 分析并标注"未找到外部参考"。
 */
export async function searchReferences(
  text: string
): Promise<ReferenceItem[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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
