import { NextRequest, NextResponse } from "next/server";
import { getCardCatalog, validateCardCodes } from "@/lib/card-catalog";

const SYSTEM_PROMPT = `你是一名专业的中学英语作文批改老师。用户会给你两样东西：①作文的题目要求（可能包含题目、词数要求、内容要点等）；②学生写的作文。

你必须依次完成以下四项分析，不允许跳过：

1.【扣题判断】：对照题目要求，判断作文是否切题。检查：主题是否一致、题目列出的内容要点是否都有覆盖、词数是否明显不达标（如果题目给了词数要求）。
2.【结构评价】：判断作文结构是否合理：开头/主体/结尾是否完整、段落划分是否清晰、句子之间是否有基本衔接（first/also/finally 等）。
3.【语言准确性】：总体评价用词、时态、句式的准确性和丰富度。
4.【逐处语法错误】：找出作文中所有语法错误，逐条列出并给出修改建议。检查范围：主谓一致、名词可数/不可数与单复数、动词时态语态、介词搭配、冠词、从句结构、代词、拼写等。判定标准以中国中考、高考英语语法为基础，硬性考点一律判错，严禁以"口语中常见"为由放过。

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "on_topic": {
    "is_on_topic": true 或 false,
    "comment": "扣题情况说明：切题就简述作文如何覆盖了题目要点；偏题就明确指出哪里偏离了题目要求"
  },
  "structure": "结构评价：1-3 句话，指出结构上的优点和不足",
  "language": "语言评价：1-3 句话，指出用词/时态/句式上的整体表现",
  "errors": [
    {
      "original": "出错的原文片段",
      "corrected": "修改后的正确写法",
      "reason": "错误原因及修改建议",
      "keywords": ["对应的语法知识点关键词"]
    }
  ]
}

规则：
1. errors 必须包含全部语法错误；如果确实没有语法错误，errors 返回空数组 []
2. original 必须是作文原文中出现的片段，不要改写
3. 同一个片段有多个错误时分开逐条列出
4. keywords 使用简短的中文语法术语（例如：主谓一致、可数名词复数、时态、冠词），每个错误 1-3 个
5. 全部说明文字用中文，original/corrected 保持英文`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let topic: string;
  let essay: string;
  try {
    const body = await req.json();
    topic = typeof body?.topic === "string" ? body.topic : "";
    essay = typeof body?.essay === "string" ? body.essay : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!topic.trim()) {
    return NextResponse.json({ error: "请先输入作文的题目要求" }, { status: 400 });
  }
  if (!essay.trim()) {
    return NextResponse.json({ error: "请输入要分析的作文" }, { status: 400 });
  }

  try {
    const catalog = await getCardCatalog();
    const promptWithCatalog = `${SYSTEM_PROMPT}

【知识点卡片目录】
以下是知识库中所有可用的知识点卡片（编号 + 标题）：
${catalog.promptList}

分析完错误后，你必须从上面的目录中挑选与本次发现的错误最匹配的 1-3 个卡片编号，放入 JSON 的 matched_card_codes 字段（如 ["N-006","M-002"]）。只允许选择目录中真实存在的编号，禁止编造；确实没有匹配的知识点时才返回空数组。

选卡规则：
① 每个错误的 keywords 与所选卡片标题必须属于同一语法类别，禁止跨类选卡；
② 强制类别映射——当错误涉及以下类别时，matched_card_codes 中必须包含对应前缀的卡片：
   - 冠词错误 → 必须选 A-xxx 冠词卡片；
   - 代词错误 → 必须选 P-xxx 代词卡片；
   - 名词错误 → 必须选 N-xxx 名词卡片；
   - 主谓一致错误 → 必须选 M-xxx 主谓一致卡片。
③ 若作文同时存在多个类别的错误，必须每个类别都选出对应卡片，不能只选一类。最终返回的 JSON 结构：
{
  "on_topic": { "is_on_topic": true, "comment": "..." },
  "structure": "...",
  "language": "...",
  "errors": [...],
  "matched_card_codes": ["..."]
}`;

    const userContent = `【题目要求】\n${topic.slice(0, 1000)}\n\n【学生作文】\n${essay.slice(0, 4000)}`;

    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: promptWithCatalog },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 4000,
        stream: false,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `DeepSeek API 出错（${res.status}）：${detail.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    let parsed: {
      on_topic?: unknown;
      structure?: unknown;
      language?: unknown;
      errors?: unknown;
      matched_card_codes?: unknown;
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回内容无法解析为 JSON");
      parsed = JSON.parse(m[0]);
    }

    const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
    const matchedCardCodes = validateCardCodes(
      parsed?.matched_card_codes,
      catalog.codes
    );

    // 逐字段清洗，防止 AI 脏数据
    const rawOnTopic = (parsed?.on_topic ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      on_topic: {
        is_on_topic: rawOnTopic.is_on_topic !== false,
        comment:
          typeof rawOnTopic.comment === "string" ? rawOnTopic.comment : "",
      },
      structure: typeof parsed?.structure === "string" ? parsed.structure : "",
      language: typeof parsed?.language === "string" ? parsed.language : "",
      errors,
      matched_card_codes: matchedCardCodes,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败，请重试" },
      { status: 500 }
    );
  }
}
