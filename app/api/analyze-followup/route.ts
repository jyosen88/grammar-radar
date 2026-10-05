import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `你是一名耐心、专业的中学英语老师。学生刚用"单题语法分析"检查了一个英文句子（或一段话），并收到了逐处错误的分析结果，现在针对这个句子向你追问。

回答要求：
1. 像老师当面讲解一样：先直接回答学生的问题，再讲清背后的语法规则
2. 多用"对比例句"帮助理解：错误说法 vs 正确说法、相近表达之间的细微差别、口语 vs 书面语等
3. 例子要简单、贴近中学生生活；必要时可以举一反三给 2-3 个例句
4. 只讨论与这个句子及相关英语学习的问题；如果学生问与英语学习无关的内容，礼貌地把话题引回语法学习
5. 用中文讲解，英文例句保留英文；可以使用少量 Markdown（加粗、列表），不要输出大标题`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let text = "";
  let analysis = "";
  let question = "";
  let history: unknown = [];
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
    analysis = typeof body?.analysis === "string" ? body.analysis : "";
    question = typeof body?.question === "string" ? body.question : "";
    history = Array.isArray(body?.history) ? body.history : [];
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!text.trim() || !question.trim()) {
    return NextResponse.json(
      { error: "缺少原文或追问内容" },
      { status: 400 }
    );
  }

  // 组装历史对话（只保留 role/content，限制轮数防止超长）
  const messages: { role: string; content: string }[] = [];
  const past = Array.isArray(history) ? history : [];
  for (const m of past.slice(-10) as unknown[]) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim()
    ) {
      messages.push({ role, content: content.slice(0, 2000) });
    }
  }

  const context = `【学生输入的英文原文】\n${text.slice(0, 3000)}\n\n【AI 已给出的分析结果】\n${analysis.slice(0, 3000) || "（无）"}\n\n【学生的追问】\n${question.slice(0, 1000)}`;

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
          ...messages,
          { role: "user", content: context },
        ],
        temperature: 0.4,
        max_tokens: 1500,
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
    const answer: string = data?.choices?.[0]?.message?.content ?? "";
    if (!answer.trim()) {
      return NextResponse.json({ error: "AI 没有返回回答，请重试" }, { status: 502 });
    }
    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "追问失败，请重试" },
      { status: 500 }
    );
  }
}
