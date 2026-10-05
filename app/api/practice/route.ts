import { NextRequest, NextResponse } from "next/server";
import { normalizeExercises, parseLooseJson, type Exercise } from "@/lib/exercise";

const SYSTEM_PROMPT = `你是一名中学英语老师。学生在作文里犯了一个具体的语法错误，请围绕这个错误对应的"细化知识点"，为学生生成 1-3 道变式练习题，帮助他通过练习掌握。

出题要求：
1. 题目必须严格考同一个细化知识点（例如知识点是"主谓一致 - 就近一致"，就不要出成普通主谓一致或时态题），但句子、场景要换，不能照抄学生原句
2. 难度以中国中考英语为标准，句子贴近中学生生活
3. 题型用单项选择题（选项 2-4 个）或填空题，每道题只考这一个知识点
4. 每题必须给出正确答案和一句简短解析（讲清为什么，中文）
5. 不要在题干或解析中暴露学生的错误句子，让学生独立做
6. 如果提供了"已经出过的题目"，新题目绝对不能与它们重复，场景和句式都要换新的

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "knowledge_point": "细化知识点名称（与传入的一致或更精确）",
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

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let knowledgePoint = "";
  let original = "";
  let corrected = "";
  let reason = "";
  let exclude: unknown = [];
  try {
    const body = await req.json();
    knowledgePoint =
      typeof body?.knowledge_point === "string" ? body.knowledge_point : "";
    original = typeof body?.original === "string" ? body.original : "";
    corrected = typeof body?.corrected === "string" ? body.corrected : "";
    reason = typeof body?.reason === "string" ? body.reason : "";
    exclude = Array.isArray(body?.exclude) ? body.exclude : [];
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!knowledgePoint.trim() && !reason.trim()) {
    return NextResponse.json(
      { error: "缺少知识点信息" },
      { status: 400 }
    );
  }

  const excludeList = (Array.isArray(exclude) ? exclude : [])
    .filter((q): q is string => typeof q === "string" && !!q.trim())
    .map((q) => q.trim())
    .slice(0, 30);

  const userContent = `【细化知识点】${knowledgePoint.slice(0, 200) || reason.slice(0, 200)}
【学生作文里的错误片段】${original.slice(0, 300)}
【正确写法】${corrected.slice(0, 300)}
【错误原因与修改建议】${reason.slice(0, 600)}
${
  excludeList.length
    ? `【已经出过的题目（禁止重复，请换新场景新句式）】\n${excludeList
        .map((q, i) => `${i + 1}. ${q.slice(0, 300)}`)
        .join("\n")}\n`
    : ""
}
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
    const parsed = parseLooseJson(content) as {
      knowledge_point?: unknown;
      exercises?: unknown;
    };

    const exercises: Exercise[] = normalizeExercises(parsed?.exercises, 3);
    if (exercises.length === 0) {
      return NextResponse.json(
        { error: "AI 没有生成有效的练习题，请重试" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      knowledge_point:
        typeof parsed?.knowledge_point === "string" &&
        parsed.knowledge_point.trim()
          ? parsed.knowledge_point.trim()
          : knowledgePoint,
      exercises,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成练习题失败，请重试" },
      { status: 500 }
    );
  }
}
