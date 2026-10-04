import { NextRequest, NextResponse } from "next/server";
import { getCardCatalog, validateCardCodes } from "@/lib/card-catalog";

const QUIZ_ANALYZE_PROMPT = `你是一名经验丰富的中国中学英语语法老师。学生刚答错了一道英语语法选择题，你要先把题目讲清楚（题目解析），再针对学生选错的选项说明错在哪里（错因分析），最后从知识库挑选知识点卡片。

请完成以下内容：
1. topic：用一个中文短语概括本题核心考点（如"可数名词单复数""主谓一致（集合名词）""固定搭配"）。
2. explanation：题目解析，2-4 句中文。先说明题干语境或句子结构、空格处需要什么成分/形式，再讲正确选项为什么正确，必要时给出关键例句或用法对比。
3. wrong_reason：错因分析，1-3 句中文。针对学生选的错误选项，说明它为什么错、暴露了什么知识误区（例如混淆了可数与不可数名词、忽略了主谓一致）。
4. knowledge_points：1-3 个简短中文语法术语（如 ["可数名词复数","量词搭配"]）。
5. matched_card_codes：从给定的【知识点卡片目录】中挑选与本题考点最匹配的 1-3 个卡片编号；目录中确实没有对应卡片时才返回空数组 []，严禁编造目录之外的编号。

要求：
- 全部用中文解析（英文例句除外），语言简洁准确，以中国中考、高考英语语法标准为准。
- 解析要面向答错的学生，讲清"为什么"，不要只翻译选项。
- 集合名词（audience/family/team 等）按语义自然度讲解：强调成员动作用复数谓语+复数代词，强调整体才用单数谓语。

严格按以下 JSON 格式返回，不要输出任何其他内容：
{
  "topic": "本题核心考点中文短语",
  "explanation": "题目解析（2-4 句中文）",
  "wrong_reason": "错因分析（1-3 句中文）",
  "knowledge_points": ["知识点术语1", "知识点术语2"],
  "matched_card_codes": ["卡片编号"]
}`;

interface QuizAnalyzeBody {
  question_text?: unknown;
  category?: unknown;
  options?: unknown; // [{ letter, text }]
  correct_letter?: unknown;
  correct_text?: unknown;
  wrong_letter?: unknown;
  wrong_text?: unknown;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let body: QuizAnalyzeBody;
  try {
    body = (await req.json()) as QuizAnalyzeBody;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const question = typeof body.question_text === "string" ? body.question_text.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "缺少题干 question_text" }, { status: 400 });
  }
  const correctLetter =
    typeof body.correct_letter === "string" ? body.correct_letter.trim() : "";
  const correctText =
    typeof body.correct_text === "string" ? body.correct_text.trim() : "";
  const wrongLetter =
    typeof body.wrong_letter === "string" ? body.wrong_letter.trim() : "";
  const wrongText =
    typeof body.wrong_text === "string" ? body.wrong_text.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";

  // 组装结构化题目文本（options 仅作上下文，逐行列出）
  const optionLines = Array.isArray(body.options)
    ? body.options
        .map((o) => {
          const item = o as Record<string, unknown>;
          const l = typeof item?.letter === "string" ? item.letter.trim() : "";
          const t = typeof item?.text === "string" ? item.text.trim() : "";
          return l && t ? `${l}. ${t}` : "";
        })
        .filter(Boolean)
        .join("\n")
    : "";

  const userText = [
    category ? `题目分类：${category}` : "",
    `题干：${question}`,
    optionLines ? `选项：\n${optionLines}` : "",
    `正确答案：${[correctLetter, correctText].filter(Boolean).join(" ")}`,
    `学生选择的错误答案：${[wrongLetter, wrongText].filter(Boolean).join(" ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const catalog = await getCardCatalog();
    const promptWithCatalog = `${QUIZ_ANALYZE_PROMPT}

【知识点卡片目录】
${catalog.promptList}`;

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
          { role: "user", content: userText.slice(0, 4000) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 2000,
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

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回内容无法解析为 JSON");
      parsed = JSON.parse(m[0]) as Record<string, unknown>;
    }

    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const knowledgePoints = Array.isArray(parsed.knowledge_points)
      ? parsed.knowledge_points
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return NextResponse.json({
      topic: str(parsed.topic),
      explanation: str(parsed.explanation),
      wrong_reason: str(parsed.wrong_reason),
      knowledge_points: knowledgePoints,
      matched_card_codes: validateCardCodes(parsed.matched_card_codes, catalog.codes),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "题目解析失败，请重试" },
      { status: 500 }
    );
  }
}
