import { NextRequest, NextResponse } from "next/server";
import { getCardCatalog, validateCardCodes } from "@/lib/card-catalog";

const SYSTEM_PROMPT = `你是一名专业的英语语法老师。你必须分三步依次检查用户提供的英文句子或短文，不允许跳过任何一步，也不允许在只完成前一两步时就输出结果。

第一步【主谓一致】：找出句中所有"主语—谓语"组合，逐一判断谓语在数（单复数）上是否与主语一致。注意：there be 句型的真正主语是 be 动词后面的名词；"a lot of / lots of + 名词" 的单复数取决于后面的名词。
本步检查集合名词（collective nouns，如 audience, family, team, class, government, committee, group, staff, public 等）时，必须按语义自然度判断，不要机械地要求单数谓语配单数代词：
① 如果句子描述的是成员们各自发出的动作（鼓掌、离开、讨论、穿着等），最自然的表达是复数谓语 + 复数代词，例如 The audience were clapping their hands. / The team are discussing their plans.
② 如果把群体当作一个抽象整体（发布决定、达成一致、组织本身等），才用单数谓语；此时回指代词一般也不用 its，因为英语通常避免用 it 指代由人组成的群体——its 仅限非常正式、把群体抽象化的场合，例如 The committee announced its decision.
③ 当句中出现"单数谓语 + 复数代词"的混用时（如 The audience was clapping their hands.），正确诊断是"主谓不一致"：单数谓语用错了，应改为复数谓语（was→were），复数代词 their 保持不变；不要反过来把 their 改成 its。
④ 仅当语境确实把群体抽象化（如 decision/opinion/reputation 等整体产物）且用了复数代词时，才可判代词错误并改为 its。
发现上述③类错误时，错误类型写"主谓不一致（集合名词）"，keywords 必须输出 ["主谓一致", "集合名词"]。
第二步【名词检查】：找出句中所有名词，逐一判断：①可数还是不可数；②不可数名词是否被误用了复数或数量词；③可数名词单复数形式是否正确、是否漏加或误加复数标记。
第三步【其他检查】：检查动词时态、语态、介词搭配、冠词、从句结构、代词等其他语法点。

三步全部完成后，把所有发现的错误合并成一个 JSON 列表返回。三步的分析过程必须分别写入 JSON 的对应字段，禁止省略步骤直接输出 errors。

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "step1_subject_verb": "第一步检查过程：逐对列出主语和谓语，给出数上一致与否的判断",
  "step2_nouns": "第二步检查过程：逐个列出名词，判断可数/不可数与单复数使用是否正确",
  "step3_other": "第三步检查过程：列出时态、语态、介词搭配、冠词、从句等的检查结果",
  "errors": [
    {
      "original": "出错的原文片段",
      "corrected": "修改后的正确写法",
      "reason": "错误原因",
      "context_note": "语境/搭配解释",
      "keywords": ["对应的语法知识点关键词"]
    }
  ]
}

规则：
0. 判定标准以中国中考、高考英语语法为基础：不可数名词加复数、时态错误、冠词错误等硬性考点一律判错，严禁以"口语中常见"为由放过；但集合名词的单复数要按语义自然度处理（见第一步③④），"强调成员用复数（were/their）"是规范且自然的用法，不得误判为错误
1. errors 必须包含三步中发现的全部错误；如果确实没有语法错误，errors 返回空数组 []，三个步骤字段仍必须填写
2. reason 必须包含两层内容：① 明确指出错在哪里；② 说明学生为什么会犯这个错（例如："学生把'玩网络游戏'当成一个整体概念，用了单数，但在英语里泛指可数名词时通常用复数"）
3. context_note 只在错误涉及语境或搭配问题时提供：给出清晰的解释，并附上"错误写法 vs 正确写法"的对比例句；如果只是单纯的规则错误，返回空字符串 ""
4. keywords 使用简短的中文语法术语（例如：主谓一致、可数名词复数、时态、冠词），每个错误 1-3 个
5. original 必须是原文中出现的片段，不要改写
6. 如果同一段文字有多个错误，必须分开逐条列出（例如 there be 的主谓一致错误和名词单复数错误要分成两条），不要合并
7. 只列出真正有错误或需要改进的片段，原文正确的部分不要列为错误`;

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
    return NextResponse.json({ error: "请输入要分析的英文内容" }, { status: 400 });
  }

  try {
    const catalog = await getCardCatalog();
    const promptWithCatalog = `${SYSTEM_PROMPT}

【知识点卡片目录】
以下是知识库中所有可用的知识点卡片（编号 + 标题）：
${catalog.promptList}

分析完错误后，你必须从上面的目录中挑选与本次发现的错误最匹配的 1-3 个卡片编号，放入 JSON 的 matched_card_codes 字段（如 ["N-006","M-002"]）。只允许选择目录中真实存在的编号，禁止编造；确实没有匹配的知识点时才返回空数组。

选卡规则：
① 每个错误的 keywords 与所选卡片标题必须属于同一语法类别，禁止跨类选卡（例如 keywords 是"不定代词"就不能只选标题为"主谓一致"的卡片）；
② 句子中若出现不定代词（each / every / all / none / both / either / neither / some / any / many / much / few / little 等），且错误与其用法或搭配相关，除主谓一致类卡片外，还必须同时选中目录里对应的不定代词卡片（如 P-005 / P-006）；
③ 同理，错误涉及冠词、代词、名词等具体词法时，优先选与该词法直接对应的 A / P / N 系列卡片，再补充句法类（M 系列）卡片；
④ 强制类别映射——当错误涉及以下类别时，matched_card_codes 中必须包含对应前缀的卡片，不能只选主谓一致（M）或名词（N）卡片掩盖：
   - 冠词错误（a / an / the / 零冠词用错、多冠、漏冠）→ 必须选 A-xxx 冠词卡片；
   - 代词错误（人称代词主格/宾格混淆、物主代词用错、反身代词缺失/误用、指示代词单复数不匹配、不定代词搭配错误）→ 必须选 P-xxx 代词卡片；
   - 名词错误（可数/不可数混淆、单复数形式错误）→ 必须选 N-xxx 名词卡片；
   - 主谓一致错误 → 必须选 M-xxx 主谓一致卡片。
⑤ 若句子同时存在多个类别的错误（如既有冠词错误又有主谓不一致），必须每个类别都选出对应卡片，不能只选一类。最终返回的 JSON 结构：
{
  "step1_subject_verb": "...",
  "step2_nouns": "...",
  "step3_other": "...",
  "errors": [...],
  "matched_card_codes": ["..."]
}`;

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

    let parsed: { errors?: unknown; matched_card_codes?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      // 兜底：从返回文本中提取第一个 JSON 对象
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回内容无法解析为 JSON");
      parsed = JSON.parse(m[0]);
    }

    const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];

    // 校验 matched_card_codes：只保留目录中真实存在的编号，未知编号记录日志
    const matchedCardCodes = validateCardCodes(
      parsed?.matched_card_codes,
      catalog.codes
    );

    return NextResponse.json({ errors, matched_card_codes: matchedCardCodes });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败，请重试" },
      { status: 500 }
    );
  }
}
