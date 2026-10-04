import { NextRequest, NextResponse } from "next/server";

// 注意：本接口刻意不使用 response_format: json_object。
// 用户可能粘贴整篇作文或仅一句话，要求模型返回"润色后全文 + 逐句说明"的纯文本，
// 用两个固定中文标记分段，服务端再解析成结构化 JSON 交给前端分区域展示。
const POLISH_PROMPT = `你是一名资深的英语写作老师。请润色学生提交的英文内容：可能是整篇作文，也可能只有一句话，两种情况都按同一格式处理。

润色要求：
1. 保留学生原本想表达的意思、观点和语气，不随意增删内容；只修正语法、用词、搭配、时态、冠词、连贯衔接和标点，让表达更地道、准确、自然。
2. 不要把简单句过度复杂化，润色后的文本应适合中国中学生的英语水平。
3. 逐句修改说明只列出真正有改动的句子；每条都要写清"原句 / 修改 / 说明"，说明用简短中文讲清为什么这样改（语法规则、固定搭配或更地道的表达）。
4. 如果原文本身没有错误，润色后文本照抄原文，并在说明区写"原文表达正确，无需修改"。

请严格按下面的纯文本格式输出，不要使用 JSON，不要输出任何格式之外的解释：
【润色后作文】
（这里放润色后的完整英文内容，保留原有的段落换行）
【逐句修改说明】
1.
原句：...
修改：...
说明：...
2.
原句：...
修改：...
说明：...`;

interface PolishNote {
  original: string;
  revised: string;
  note: string;
}

/** 按 原句/修改/说明 标签解析一条修改记录；标签缺失时返回 null */
function parseNoteItem(block: string): PolishNote | null {
  const pick = (label: string) => {
    const m = block.match(
      new RegExp(`${label}[：:]\\s*([^\\n]*(?:\\n(?!\\s*(?:原句|修改|说明)[：:]).+)*)`)
    );
    return m ? m[1].trim() : "";
  };
  const original = pick("原句");
  const revised = pick("修改");
  const note = pick("说明");
  if (!original && !revised && !note) return null;
  return { original, revised, note };
}

/** 把模型的纯文本回复拆成"润色后作文 + 逐句说明" */
function parsePolishContent(content: string): {
  essay: string;
  notes: PolishNote[];
  notesRaw: string;
} {
  // 兼容模型在标记里多加空格/个别近义字的情况
  const essayHeader = /【[^】]*润色后[^】]*】/;
  const notesHeader = /【[^】]*(?:逐句|修改说明)[^】]*】/;

  let essay = "";
  let notesText = "";

  const h1 = content.match(essayHeader);
  const h2 = content.match(notesHeader);
  if (h1 && h2 && h1.index! < h2.index!) {
    essay = content.slice(h1.index! + h1[0].length, h2.index).trim();
    notesText = content.slice(h2.index! + h2[0].length).trim();
  } else {
    // 兜底：找不到标记时，把全部内容当作润色结果，不阻塞展示
    essay = content.trim();
  }

  // 按 "1." "2、" 等序号切块
  const blocks = notesText
    .split(/\n\s*(?=\d+\s*[.、)])/)
    .map((b) => b.replace(/^\s*\d+\s*[.、)]\s*/, "").trim())
    .filter(Boolean);

  const notes: PolishNote[] = [];
  for (const b of blocks) {
    const note = parseNoteItem(b);
    if (note) notes.push(note);
  }

  return { essay, notes, notesRaw: notesText };
}

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
    return NextResponse.json({ error: "请输入要润色的英文内容" }, { status: 400 });
  }

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
          { role: "system", content: POLISH_PROMPT },
          {
            role: "user",
            content: `请润色下面的英文内容：\n\n${text.slice(0, 4000)}`,
          },
        ],
        // 刻意不使用 JSON 模式
        temperature: 0.3,
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
    if (!content.trim()) {
      throw new Error("AI 未返回内容");
    }

    const { essay, notes, notesRaw } = parsePolishContent(content);
    return NextResponse.json({ essay, notes, notes_raw: notesRaw });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "润色失败，请重试" },
      { status: 500 }
    );
  }
}
