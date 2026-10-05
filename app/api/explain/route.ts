import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `你是一名经验丰富的中学英语老师。学生在做题时遇到了一个具体的语法错误，现在想深入学习这个"细化知识点"。请你现场讲解，不允许说"请参考资料"之类的话。

讲解必须包含以下四个部分：
1. rules（核心规则）：把这个知识点的规则讲清楚、讲完整。规则有多条时分条列出（用 1. 2. 3.），语言适合初中生理解，必要时给出公式化总结（如"either A or B 作主语，谓语随 B"）。
2. examples（例句）：给出 2-3 个贴近中学生生活的正确例句，关键部分用【】标出，例如 Either you or I 【am】 wrong.
3. confusions（易混淆点）：对比学生最容易搞混的相近用法（如就近一致 vs 就远一致、a/an 的判断依据是发音不是字母），用"✗ 错误 / ✓ 正确"的形式对比。
4. common_mistakes（常见错误）：列出中国学生在这个知识点上最常犯的 2-3 个错误及提醒。

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "knowledge_point": "细化知识点名称",
  "rules": "核心规则，多条用换行和数字编号",
  "examples": "2-3 个正确例句，每个一行，关键部分用【】标出",
  "confusions": "易混淆点对比，含 ✗/✓ 例句",
  "common_mistakes": "2-3 个常见错误及提醒，每条一行"
}

全部讲解用中文，例句保持英文。内容要具体，禁止空泛的套话。`;

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
  try {
    const body = await req.json();
    knowledgePoint =
      typeof body?.knowledge_point === "string" ? body.knowledge_point : "";
    original = typeof body?.original === "string" ? body.original : "";
    corrected = typeof body?.corrected === "string" ? body.corrected : "";
    reason = typeof body?.reason === "string" ? body.reason : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!knowledgePoint.trim() && !reason.trim()) {
    return NextResponse.json({ error: "缺少知识点信息" }, { status: 400 });
  }

  const userContent = `【要讲解的细化知识点】${knowledgePoint.slice(0, 200)}
【学生刚才做错的片段】${original.slice(0, 300)}
【正确写法】${corrected.slice(0, 300)}
【该错误的原因与修改建议】${reason.slice(0, 500)}

请结合学生这个具体错误来讲解（例句可以涉及类似场景，但不要照抄错误句）。`;

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
        temperature: 0.3,
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
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回内容无法解析为 JSON");
      parsed = JSON.parse(m[0]);
    }

    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    return NextResponse.json({
      knowledge_point: str(parsed.knowledge_point) || knowledgePoint,
      rules: str(parsed.rules),
      examples: str(parsed.examples),
      confusions: str(parsed.confusions),
      common_mistakes: str(parsed.common_mistakes),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成讲解失败，请重试" },
      { status: 500 }
    );
  }
}
