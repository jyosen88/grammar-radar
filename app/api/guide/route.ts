import { NextRequest, NextResponse } from "next/server";
import { getCardCatalog, validateCardCodes } from "@/lib/card-catalog";

const GUIDE_PROMPT = `你是一名擅长启发式教学的英语语法老师。学生会给你一道语法题（可能是填空、选择或改错题），你的任务是把这道题拆解成 3-4 个循序渐进的引导步骤，让学生通过一步步思考自己得出答案，而不是直接看到答案。

拆解要求：
1. 一共 3 到 4 步：先引导识别句子结构/考点类型，再分析关键成分，最后做出选择。
2. 每一步都是一道单选题，有 3-4 个选项，且只有一个正确选项。
3. 难度从浅到深：第一步通常是"这个句子考查什么语法现象/空格处需要什么成分"，最后一步才是"应该选哪个词"。
4. question 用中文提问，可以引用英文原句或其中的片段。
5. hint 是学生答错时看的简短提示（一句话），不要直接把答案说出来。
6. knowledge_point 是该步骤对应的中文知识点名称（如"定语从句关系代词"）。
7. card_codes 必须从给定的【知识点卡片目录】中挑选与该步骤最匹配的 1-2 个卡片编号；目录里没有对应卡片时返回空数组 []，严禁编造编号。

严格按以下 JSON 格式返回，不要输出任何其他内容：
{
  "steps": [
    {
      "step": 1,
      "question": "这一步的引导问题",
      "options": ["选项A", "选项B", "选项C"],
      "correct_answer": "选项B",
      "hint": "答错时的简短提示",
      "knowledge_point": "知识点中文名称",
      "card_codes": ["卡片编号"]
    }
  ],
  "summary_topic": "整道题考查的核心语法点（中文短语，如：定语从句关系代词）"
}`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let text: string;
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "请输入要拆解的语法题" }, { status: 400 });
  }

  try {
    const catalog = await getCardCatalog();
    const promptWithCatalog = `${GUIDE_PROMPT}

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
          { role: "user", content: text.slice(0, 4000) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 3000,
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

    let parsed: { steps?: unknown; summary_topic?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回内容无法解析为 JSON");
      parsed = JSON.parse(m[0]);
    }

    const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    // 逐字段清洗 + 校验卡片编号
    const steps = rawSteps
      .map((s, i) => {
        const step = s as Record<string, unknown>;
        const options = Array.isArray(step.options)
          ? step.options.filter((o): o is string => typeof o === "string")
          : [];
        const correctAnswer =
          typeof step.correct_answer === "string" ? step.correct_answer : "";
        return {
          step: typeof step.step === "number" ? step.step : i + 1,
          question: typeof step.question === "string" ? step.question : "",
          options,
          correct_answer: correctAnswer,
          hint: typeof step.hint === "string" ? step.hint : "",
          knowledge_point:
            typeof step.knowledge_point === "string"
              ? step.knowledge_point
              : "",
          card_codes: validateCardCodes(step.card_codes, catalog.codes),
        };
      })
      .filter((s) => s.question && s.options.length >= 2 && s.correct_answer);

    return NextResponse.json({
      steps,
      summary_topic:
        typeof parsed?.summary_topic === "string" ? parsed.summary_topic : "",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成引导题失败，请重试" },
      { status: 500 }
    );
  }
}
