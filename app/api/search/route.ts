import { NextRequest, NextResponse } from "next/server";
import { parseLooseJson } from "@/lib/exercise";

/**
 * 搜索代理路由：前端 lib/search.ts → 本路由（服务端）→ 博查 Web Search API。
 * Key 只存在于服务端环境变量 BOCHA_API_KEY，绝不下发浏览器。
 *
 * 流程：收到原始题干 text → 优先用 DeepSeek 提取干净的关键词（去掉拼写错误、
 * 标点、多余空格，提炼核心考点词/关键搭配/特征词）→ 用关键词组合调博查 →
 * 提取标题/摘要/链接。DeepSeek 失败或超时则降级为启发式关键词提取，保证可用。
 *
 * 契约：无论 Key 缺失、博查报错还是超时，本路由始终返回 200 + { references: [] }，
 * 由 /api/analyze 侧自动降级为纯 AI 分析，绝不阻断主流程。
 *
 * 博查官方文档：https://open.bochaai.com/
 *   POST https://api.bochaai.com/v1/web-search
 *   Headers: Authorization: Bearer <KEY>, Content-Type: application/json
 *   Body: { query, freshness, summary, count }
 *   结果: data.webPages.value[] —— name / url / snippet / summary / siteName
 */

const BOCHA_ENDPOINT = "https://api.bochaai.com/v1/web-search";
const BOCHA_TIMEOUT_MS = 10000;
const DEEPSEEK_TIMEOUT_MS = 8000;
const REQUEST_COUNT = 8; // 多取几条，清洗/截断后给 analyze 最多 5 条
const MAX_REFERENCES = 5;
const MAX_TEXT_LEN = 2000;

/** 常见英语虚词/功能词，启发式提取时过滤 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "when",
  "while", "with", "without", "for", "from", "into", "onto", "that", "this",
  "these", "those", "there", "here", "what", "which", "who", "whom", "whose",
  "where", "why", "how", "does", "doesn", "did", "didn", "done", "doing",
  "have", "has", "had", "having", "not", "no", "yes", "are", "was", "were",
  "been", "being", "will", "would", "shall", "should", "can", "could", "may",
  "might", "must", "than", "they", "them", "their", "his", "her", "hers",
  "its", "our", "ours", "your", "yours", "you", "she", "him", "about",
  "best", "answer", "choose", "fill", "blank", "correct", "sentence",
]);

/**
 * 启发式关键词提取（DeepSeek 不可用的兜底，不触网）：
 * 去掉 A/B/C/D 选项行和空格占位符，取长度 >= 4 的实义词，最多 8 个。
 */
function extractKeywordsHeuristic(text: string): string[] {
  const stem = text
    .split(/\r?\n/)
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
 * 用 DeepSeek 从题干提取搜索关键词：
 * 去掉拼写错误、标点、多余空格，提炼核心考点词、关键搭配和特征词。
 * 返回 null 表示失败，调用方降级为启发式提取。
 */
async function extractKeywordsWithDeepSeek(text: string): Promise<string[] | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: `你是一个英语语法题搜索关键词提取助手。收到一段英语题干（选择题或改错题）后，提取 3-8 个搜索关键词短语，用空格分隔，只输出关键词本身，不要任何解释、标点、编号或 JSON。

要求：
1. 忽略 OCR/拼写错误、换行、多余空格等噪声，按正确单词提取；
2. 必须包含：核心考点词（如 How far / how long）、关键搭配（如 hours' ride / two hours' ride）、题干中的其他特征词；
3. 可以在关键词中补充 1-2 个中文语法术语（如"疑问词辨析""主谓一致"）以提高搜索命中率；
4. 不要包含选项字母（A. B. C. D.）、答题指令（选择最佳答案等）和空格占位符；
5. 每个短语保持简短，整体适合作为搜索引擎查询词。`,
          },
          { role: "user", content: text },
        ],
        temperature: 0,
        max_tokens: 120,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[search] DeepSeek 关键词提取返回 ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    // 允许模型偶尔返回 JSON（防御性解析）
    let raw = content.trim();
    if (raw.startsWith("{") || raw.startsWith("[")) {
      try {
        const parsed = parseLooseJson(raw) as unknown;
        if (Array.isArray(parsed)) {
          raw = parsed.filter((k): k is string => typeof k === "string").join(" ");
        } else if (parsed && typeof parsed === "object" && "keywords" in parsed) {
          const kw = (parsed as { keywords?: unknown }).keywords;
          if (Array.isArray(kw)) {
            raw = kw.filter((k): k is string => typeof k === "string").join(" ");
          } else if (typeof kw === "string") {
            raw = kw;
          }
        }
      } catch {
        // 解析失败则按纯文本处理
      }
    }

    const keywords = raw
      .replace(/[\n\r,;，；、]/g, " ")
      .split(/\s+/)
      .map((s) => s.replace(/["'`]/g, "").trim())
      .filter((s) => s.length >= 2)
      .slice(0, 10);

    if (keywords.length === 0) return null;
    return keywords;
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") {
      console.error(
        `[search] DeepSeek 关键词提取失败：${e instanceof Error ? e.message : String(e)}`
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  let text = "";
  let keywords: string[] | null = null;
  let rawQuery = "";
  try {
    const body = await req.json();
    if (typeof body?.text === "string") text = body.text.trim();
    if (Array.isArray(body?.keywords)) {
      keywords = (body.keywords as unknown[])
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter(Boolean);
    }
    if (typeof body?.query === "string") rawQuery = body.query.trim();
  } catch {
    return NextResponse.json({ references: [] });
  }

  // 组装查询词：优先 DeepSeek 从 text 提取，其次 keywords 数组，最后 query 字符串
  let query = "";
  if (text) {
    const aiKeywords = await extractKeywordsWithDeepSeek(text.slice(0, MAX_TEXT_LEN));
    query = (aiKeywords ?? extractKeywordsHeuristic(text.slice(0, MAX_TEXT_LEN))).join(" ");
  } else if (keywords && keywords.length > 0) {
    query = keywords.join(" ");
  } else if (rawQuery) {
    query = rawQuery;
  }
  query = query.slice(0, 200);

  if (!query) return NextResponse.json({ references: [] });

  const apiKey = process.env.BOCHA_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[search] BOCHA_API_KEY 未配置，跳过外部搜索，降级为纯 AI 分析");
    return NextResponse.json({ references: [] });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BOCHA_TIMEOUT_MS);

  try {
    const res = await fetch(BOCHA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        freshness: "noLimit", // 语法规则是长期知识，不限制时间范围
        summary: true, // 返回正文摘要，给 AI 对照用的信息更充分
        count: REQUEST_COUNT,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 401 Key 无效/无权限；403 欠费/额度耗尽；429 限流——解析响应体给出可定位信息
      let detail = "";
      try {
        const errBody = await res.json();
        detail = String(errBody?.msg ?? errBody?.message ?? errBody?.error ?? "");
      } catch {
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          detail = "";
        }
      }
      console.error(`[search] 博查 API 返回 ${res.status}：${detail || "(无响应体)"}`);
      return NextResponse.json({ references: [] });
    }

    const json = (await res.json()) as {
      data?: { webPages?: { value?: Record<string, unknown>[] } };
      // 兼容不带外层信封的响应结构
      webPages?: { value?: Record<string, unknown>[] };
      // 博查业务层错误信封
      code?: number;
      msg?: string;
    };

    // 部分账号异常时 HTTP 200 但业务 code 非 200
    if (typeof json.code === "number" && json.code !== 200) {
      console.error(`[search] 博查业务错误 code=${json.code} msg=${json.msg ?? ""}`);
      return NextResponse.json({ references: [] });
    }

    const rawItems = json.data?.webPages?.value ?? json.webPages?.value ?? [];

    const references = rawItems
      .map((item) => {
        const title = typeof item.name === "string" ? item.name.trim() : "";
        const url = typeof item.url === "string" ? item.url.trim() : "";
        // summary 是正文长摘要，snippet 是短摘要；优先信息量大的 summary
        const snippet = (
          (typeof item.summary === "string" && item.summary.trim()) ||
          (typeof item.snippet === "string" && item.snippet.trim()) ||
          ""
        ).slice(0, 500);
        if (!title && !snippet) return null;
        return { title: title.slice(0, 200), snippet, url };
      })
      .filter((r): r is { title: string; snippet: string; url: string } => r !== null)
      .slice(0, MAX_REFERENCES);

    return NextResponse.json({ references });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      console.error(`[search] 博查搜索超时（${BOCHA_TIMEOUT_MS}ms），降级为纯 AI 分析`);
    } else {
      console.error(
        `[search] 博查搜索请求失败：${e instanceof Error ? e.message : String(e)}`
      );
    }
    return NextResponse.json({ references: [] });
  } finally {
    clearTimeout(timer);
  }
}
