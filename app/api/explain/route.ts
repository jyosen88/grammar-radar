import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { normalizeKnowledgePointKey } from "@/lib/knowledge-points";

const SYSTEM_PROMPT = `你是一名经验丰富的中学英语老师。学生正在学习一道英语题，现在想深入了解这道题涉及的核心知识点。请你输出一份结构完整的"微讲义"，像一页微型教材一样，让学生读完就能彻底掌握这个知识点。不允许说"请参考资料"之类的话。

讲义必须用 Markdown 格式输出，并且严格按以下五个部分组织，每部分用二级标题开头，标题文字一字不差：

## 一、核心规则
把这个知识点的规则讲清楚、讲完整。规则有多条时用有序列表分条列出，语言适合初中生理解，必要时给出公式化总结（如"either A or B 作主语，谓语随 B"）。规则内的关键术语用**加粗**标出。
【完整性强制要求】如果该知识点存在"对立的两类用法"（如哪些词加 the / 哪些词不加 the、哪些动词接 to do / 哪些接 doing、可数 / 不可数等），必须把**两类各自的具体词例**都完整分类列出（每类至少 3-5 个常见例子，中英文对照），不能只讲抽象规则。例如知识点是"独一无二的事物前加 the"，就必须同时列出：✅ 要加 the 的词（the sun、the moon、the earth、the sky、the world…）和 ❌ 不加 the 的词（行星名 Mars/Venus、人名、国名 China/Japan…）。

## 二、正误例句对照
给出 3-4 组贴近中学生生活的例句对照，每组格式为：
- ✅ 正确句（关键部分用**加粗**标出）
- ❌ 错误句（后面用中文一句话说明错因）

## 三、易错点与坑
列出中国学生在这个知识点上最容易踩的 2-3 个坑，每条说明：坑是什么、为什么容易错、怎么避免。

## 四、对比表格
用 Markdown 表格对比最易混淆的用法。表格至少包含"用法/结构 | 含义 | 例句"三列（根据知识点可增删列名），行数 3-6 行。

## 五、记忆口诀
给出一句朗朗上口的中文口诀或顺口溜，帮助学生快速记住核心规则；口诀后用一句话解释口诀含义。

要求：
- 五个部分一个都不能少，顺序固定，除此之外不要输出任何其他文字
- 全部讲解用中文，例句保持英文
- 内容要具体、能直接当教材用，禁止空泛的套话，禁止只讲规则不给具体词例清单
- 【围绕规则而非单词】讲义必须围绕"这条语法规则"展开，绝不能围绕原题里的某一个单词展开；例句与词例必须覆盖该规则下的多个同类词（如规则是"泛指抽象概念前零冠词"，例子要覆盖 nature、man、society、space 等多个词，每个例句换不同的词），禁止整篇反复只讲原题中的那一个词
- 【不超纲】整篇讲义只讲标签中的这一条规则，禁止顺带展开标签以外的其他规则（如标签是"泛指抽象概念不加冠词"，就不要再讲"独一无二的事物加 the"）；如确有必要提示一条关联规则，只能在"五、记忆口诀"末尾用一句话带过并以【延伸】开头
- 对比表格必须是合法的 Markdown 表格语法（含 | --- | 分隔行）`;

/** 规范化缓存键：去掉"（待补充）"标记、去首尾空白、压缩空格。
 *  待补充标签回落到其基础标签，复用基础标签的讲义缓存，避免重复生成。 */
const normalizeKey = normalizeKnowledgePointKey;

/** 读缓存：同一知识点已生成过讲义则直接返回；任何失败都静默降级（当作未命中） */
async function readCachedLesson(key: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabase()
      .from("grammar_lessons")
      .select("content")
      .eq("knowledge_point", key)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.content) return null;
    return String(data.content);
  } catch {
    return null;
  }
}

/** 写缓存：失败静默（表可能还没建），不影响讲义返回 */
async function saveLesson(key: string, content: string) {
  try {
    await getSupabase()
      .from("grammar_lessons")
      .upsert(
        { knowledge_point: key, content },
        { onConflict: "knowledge_point", ignoreDuplicates: true }
      );
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

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
  try {
    const body = await req.json();
    knowledgePoint =
      typeof body?.knowledge_point === "string" ? body.knowledge_point : "";
    original = typeof body?.original === "string" ? body.original : "";
    corrected = typeof body?.corrected === "string" ? body.corrected : "";
    reason = typeof body?.reason === "string" ? body.reason : "";
    context = typeof body?.context === "string" ? body.context : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!knowledgePoint.trim() && !reason.trim() && !context.trim()) {
    return NextResponse.json({ error: "缺少知识点信息" }, { status: 400 });
  }

  // 1) 先查缓存：同一知识点直接读库，不重复调 AI
  const cacheKey = normalizeKey(
    knowledgePoint || reason.slice(0, 120) || context.slice(0, 120)
  );
  const cached = await readCachedLesson(cacheKey);
  if (cached) {
    return NextResponse.json({
      knowledge_point: cacheKey,
      markdown: cached,
      cached: true,
    });
  }

  // 2) 缓存未命中，调 DeepSeek 生成微讲义
  // 待补充标签按基础标签生成讲义（与缓存键一致）
  const kpBase = normalizeKey(knowledgePoint);
  let userContent: string;
  if (context.trim()) {
    // 无错误句子 / 选择题：结合完整题目上下文讲解核心考点
    userContent = `【题目上下文】${context.slice(0, 800)}
【本题核心知识点】${kpBase || "请根据上下文自行提炼"}

请结合这道题讲一份关于核心知识点的微讲义，例句可以涉及类似场景，但不要照抄题目原句。`;
  } else {
    // 传统错误讲解：结合具体错误片段
    userContent = `【要讲解的细化知识点】${kpBase}
【学生刚才做错的片段】${original.slice(0, 300)}
【正确写法】${corrected.slice(0, 300)}
【该错误的原因与修改建议】${reason.slice(0, 500)}

请结合学生这个具体错误来讲一份微讲义（例句可以涉及类似场景，但不要照抄错误句）。`;
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
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
    let markdown: string = (data?.choices?.[0]?.message?.content ?? "").trim();
    // 去掉 AI 偶尔包裹的 ```markdown 代码围栏
    markdown = markdown
      .replace(/^```(?:markdown)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    if (!markdown) {
      return NextResponse.json(
        { error: "AI 没有生成有效的讲义内容，请重试" },
        { status: 502 }
      );
    }

    // 3) 写入缓存（失败静默）
    await saveLesson(cacheKey, markdown);

    return NextResponse.json({
      knowledge_point: cacheKey,
      markdown,
      cached: false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成讲义失败，请重试" },
      { status: 500 }
    );
  }
}
