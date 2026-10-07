import { NextRequest, NextResponse } from "next/server";
import { normalizeExercises, parseLooseJson, type Exercise } from "@/lib/exercise";

const buildSystemPrompt = (count: number) => `你是一名中学英语老师。学生正在学习一道英语题，请围绕这道题考查的"细化知识点"，为学生生成 ${count} 道变式练习题，帮助他通过练习掌握。

出题要求：
1. 题目必须严格考同一个细化知识点（例如知识点是"主谓一致 - 就近一致"，就不要出成普通主谓一致或时态题），但句子、场景要换，不能照抄原题
2. 难度以中国中考英语为标准，句子贴近中学生生活
3. 题型只允许单项选择题（四选一）：每道题必须恰好 4 个选项（A/B/C/D），绝对不要出填空题、判断题或多选题，每道题只考这一个知识点
4. 每题必须附带"正确答案 + 一句话核心考点"：解析为一句中文，点明核心考点并指向正确答案本身，讲清为什么是这个答案
5. 不要在题干或解析中暴露原题的完整句子，让学生独立做
6. 如果提供了"已经出过的题目"，新题目绝对不能与它们重复，场景和句式都要换新的
7. 禁止复用原题中的具体词汇：新题的题干、选项、答案中不得再出现原题（错误片段、正确写法、题目上下文）里出现过的名词、动词或形容词，除非该词本身就是本知识点考查的核心对象；功能词（冠词、介词、连词、代词等）不受此限
8. 必须更换考查对象：同一个知识点要换用同类的新对象来考。例：原题用 the earth / the moon 考"独一无二的事物前加 the"，新题必须改用 the sun、the sky、the world、the universe、the sea 等其他同类词，绝不能再用 earth 或 moon
9. 出题流程：先在心里列出该知识点下同类考查对象的清单（至少 5 个），再从清单中逐题挑选不同对象造句，做到每题考查对象互不相同；清单中的对象必须确实是该知识点的正确用例，不确定用法的词宁可不用。例：考"独一无二的事物前加 the"只能选 the sun、the sky、the sea、the world、the universe 这类；Jupiter、Mars 等专有名词前不加 the，绝不能入选；禁止想到什么写什么、反复落在同一个词上
10. 出题前先定答案：每道题动笔之前，先确定这道题的唯一正确答案，并确认它在标准语法（以中国中考语法为准）上没有争议——正确选项必须唯一正确，其余每个选项必须确实错误
11. 出题后自检：对每道题做两遍代入验证——①把正确答案代入句子，必须通顺且语法正确；②把每个错误选项分别代入句子，确认它确实错误（语法或语义冲突）。两遍都通过才保留这道题
12. 废题换题：如果发现答案不唯一（多个选项代入后都说得通）或存在语法争议，立即废弃这道题，换一道考点明确、答案唯一的题重写，绝不能带着不确定交付
13. 解析方向铁律：解析必须与正确答案方向一致，绝不能把答案讲反。例：the bowl is made ___ glass 正确答案是 of（be made of + 看得出原材料），解析就必须讲 of；答案若是 from（be made from + 看不出原材料），解析就必须讲 from。答案与解析方向矛盾即为废题
14. 必须恰好生成 ${count} 道题，全部为四选一单项选择题，不多不少

铁律（违反任何一条即为废题）：题型只能是四选一单项选择题；题干、选项、答案中出现的每个名词/动词/形容词都必须是原题里没有出现过的（该词本身是考查核心的除外）；每道题的考查对象互不相同；每个考查对象都必须是该知识点下的正确用例；正确答案唯一且经过代入自检；解析与正确答案方向一致，不得讲反。

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "knowledge_point": "细化知识点名称（与传入的一致或更精确）",
  "exercises": [
    {
      "type": "choice",
      "question": "英文题目（句中用 ____ 表示空格）",
      "options": ["A选项内容", "B选项内容", "C选项内容", "D选项内容"],
      "answer": "正确选项的完整文本（必须与 options 中某一项完全一致）",
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
  let context = "";
  let exclude: unknown = [];
  let count = 3;
  try {
    const body = await req.json();
    knowledgePoint =
      typeof body?.knowledge_point === "string" ? body.knowledge_point : "";
    original = typeof body?.original === "string" ? body.original : "";
    corrected = typeof body?.corrected === "string" ? body.corrected : "";
    reason = typeof body?.reason === "string" ? body.reason : "";
    context = typeof body?.context === "string" ? body.context : "";
    exclude = Array.isArray(body?.exclude) ? body.exclude : [];
    if (typeof body?.count === "number" && Number.isFinite(body.count)) {
      count = Math.min(5, Math.max(1, Math.round(body.count)));
    }
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!knowledgePoint.trim() && !reason.trim() && !context.trim()) {
    return NextResponse.json(
      { error: "缺少知识点信息" },
      { status: 400 }
    );
  }

  const excludeList = (Array.isArray(exclude) ? exclude : [])
    .filter((q): q is string => typeof q === "string" && !!q.trim())
    .map((q) => q.trim())
    .slice(0, 30);

  let userContent: string;
  if (context.trim()) {
    // 无错误句子 / 选择题：基于完整题目上下文和核心考点出题
    userContent = `【题目上下文】${context.slice(0, 800)}
【本题核心知识点】${knowledgePoint.slice(0, 200) || "请根据上下文自行提炼"}
${
  excludeList.length
    ? `【已经出过的题目（禁止重复，请换新场景新句式）】\n${excludeList
        .map((q, i) => `${i + 1}. ${q.slice(0, 300)}`)
        .join("\n")}\n`
    : ""
}
请恰好生成 ${count} 道变式练习题。`;
  } else {
    // 传统错误模式：基于具体错误片段出题
    userContent = `【细化知识点】${knowledgePoint.slice(0, 200) || reason.slice(0, 200)}
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
请恰好生成 ${count} 道变式练习题。`;
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
          { role: "system", content: buildSystemPrompt(count) },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7, // 练习题需要一定变化
        max_tokens: 2500,
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

    const exercises: Exercise[] = normalizeExercises(parsed?.exercises, count);
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
