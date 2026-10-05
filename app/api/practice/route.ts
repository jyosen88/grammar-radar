import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `你是一名中学英语老师。学生在作文里犯了一个具体的语法错误，现在不理解这个知识点。请围绕这个知识点，为学生生成 1-3 道变式练习题，帮助他通过练习掌握。

出题要求：
1. 题目必须和学生的具体错误考同一个知识点，但句子、场景要换，不能照抄原句
2. 难度以中国中考英语为标准，句子贴近中学生生活
3. 题型用单项选择题（4 选 1）或填空题，每道题只考这一个知识点
4. 每题必须给出正确答案和一句简短解析（讲清为什么，中文）
5. 不要在题干或解析中暴露学生的错误句子，让学生独立做

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "knowledge_point": "这个知识点的简短中文名",
  "exercises": [
    {
      "type": "choice 或 fill",
      "question": "英文题目（填空题用空格 ____ 表示）",
      "options": ["A选项内容", "B选项内容", "C选项内容", "D选项内容"],
      "answer": "选择题给完整的选项文本（与 options 中某项完全一致）；填空题给要填入的英文答案",
      "explanation": "一句中文简短解析"
    }
  ]
}`;

interface RawExercise {
  type?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let keyword = "";
  let original = "";
  let corrected = "";
  let reason = "";
  try {
    const body = await req.json();
    keyword = typeof body?.keyword === "string" ? body.keyword : "";
    original = typeof body?.original === "string" ? body.original : "";
    corrected = typeof body?.corrected === "string" ? body.corrected : "";
    reason = typeof body?.reason === "string" ? body.reason : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!keyword.trim() && !reason.trim()) {
    return NextResponse.json(
      { error: "缺少知识点信息" },
      { status: 400 }
    );
  }

  const userContent = `【知识点】${keyword.slice(0, 200) || reason.slice(0, 200)}
【学生作文里的错误片段】${original.slice(0, 300)}
【正确写法】${corrected.slice(0, 300)}
【错误原因】${reason.slice(0, 500)}

请生成 1-3 道变式练习题。`;

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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7, // 练习题需要一定变化
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

    let parsed: {
      knowledge_point?: unknown;
      exercises?: unknown;
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回内容无法解析为 JSON");
      parsed = JSON.parse(m[0]);
    }

    // 逐题清洗，防止脏数据
    const rawList = Array.isArray(parsed?.exercises)
      ? (parsed.exercises as RawExercise[])
      : [];
    const exercises = rawList
      .map((ex) => {
        const question =
          typeof ex.question === "string" ? ex.question.trim() : "";
        const answer = typeof ex.answer === "string" ? ex.answer.trim() : "";
        if (!question || !answer) return null;
        const isFill = ex.type === "fill";
        const options = Array.isArray(ex.options)
          ? ex.options
              .filter((o): o is string => typeof o === "string" && !!o.trim())
              .map((o) => o.trim())
          : [];
        // 选择题必须有 4 个选项且答案在选项中，否则降级为填空题
        const validChoice = !isFill && options.length >= 2 && options.includes(answer);
        return {
          type: validChoice ? ("choice" as const) : ("fill" as const),
          question,
          options: validChoice ? options : [],
          answer,
          explanation:
            typeof ex.explanation === "string" ? ex.explanation.trim() : "",
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .slice(0, 3);

    if (exercises.length === 0) {
      return NextResponse.json(
        { error: "AI 没有生成有效的练习题，请重试" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      knowledge_point:
        typeof parsed?.knowledge_point === "string"
          ? parsed.knowledge_point
          : keyword,
      exercises,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成练习题失败，请重试" },
      { status: 500 }
    );
  }
}
