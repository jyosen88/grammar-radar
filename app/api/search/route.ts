import { NextRequest, NextResponse } from "next/server";

/**
 * 搜索代理路由：前端 lib/search.ts → 本路由（服务端）→ 博查 Web Search API。
 * Key 只存在于服务端环境变量 BOCHA_API_KEY，绝不下发浏览器。
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
const REQUEST_COUNT = 8; // 多取几条，清洗/截断后给 analyze 最多 5 条
const MAX_REFERENCES = 5;

export async function POST(req: NextRequest) {
  let keywords: unknown;
  let rawQuery: unknown;
  try {
    const body = await req.json();
    keywords = body?.keywords;
    rawQuery = body?.query;
  } catch {
    return NextResponse.json({ references: [] });
  }

  // 组装查询词：优先用关键词数组，其次接受单个 query 字符串
  const query = (
    Array.isArray(keywords)
      ? keywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim())
          .filter(Boolean)
          .join(" ")
      : typeof rawQuery === "string"
        ? rawQuery.trim()
        : ""
  ).slice(0, 200);

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
        detail = String(
          errBody?.msg ?? errBody?.message ?? errBody?.error ?? ""
        );
      } catch {
        try {
          detail = (await res.text()).slice(0, 200);
        } catch {
          detail = "";
        }
      }
      console.error(
        `[search] 博查 API 返回 ${res.status}：${detail || "(无响应体)"}`
      );
      return NextResponse.json({ references: [] });
    }

    const json = (await res.json()) as {
      data?: {
        webPages?: {
          value?: Record<string, unknown>[];
        };
      };
      // 兼容不带外层信封的响应结构
      webPages?: {
        value?: Record<string, unknown>[];
      };
      // 博查业务层错误信封
      code?: number;
      msg?: string;
    };

    // 部分账号异常时 HTTP 200 但业务 code 非 200
    if (typeof json.code === "number" && json.code !== 200) {
      console.error(`[search] 博查业务错误 code=${json.code} msg=${json.msg ?? ""}`);
      return NextResponse.json({ references: [] });
    }

    const rawItems =
      json.data?.webPages?.value ?? json.webPages?.value ?? [];

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
      .filter(
        (r): r is { title: string; snippet: string; url: string } => r !== null
      )
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
