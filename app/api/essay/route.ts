import { NextRequest, NextResponse } from "next/server";
import { normalizeExercises, parseLooseJson, type Exercise } from "@/lib/exercise";
import { KNOWLEDGE_POINT_SECTION } from "@/lib/knowledge-points";

/** 各写作类型的评分维度与难度基准 */
function buildScopeGuide(scope: string): string {
  const isChuzhong = scope === "初中";
  const isGaozhong = scope === "高中";
  const isKetPet = scope === "KET" || scope === "PET";
  const isIelts = scope === "雅思";

  // 未选择范围时默认按初中标准
  const label = scope || "初中";

  let dims: string[];
  if (isIelts) dims = ["任务回应", "连贯与衔接", "词汇资源", "语法多样性与准确性"];
  else if (isKetPet) dims = ["内容", "沟通达成", "组织结构", "语言"];
  else dims = ["内容", "语言", "结构"];

  let difficulty: string;
  if (isGaozhong) {
    difficulty = `按高考英语作文标准评判，重点检查：
- 内容：是否覆盖所有要点，是否有偏题或遗漏
- 语言：词汇和语法是否准确，是否使用了较多语法结构和词汇
- 结构：是否有效使用语句间连接成分，全文是否结构紧凑
- 升档因素：能熟练灵活运用3500词相关词组短语，用词精准贴合语境；准确、自然地使用超纲词汇或复杂句式（如定语从句叠加非谓语、倒装、强调句、with 复合结构）且无语法错误，一律视为亮点并表扬
- 降档因素：刻意堆砌超纲词导致语句晦涩、字数不达标或大幅超出、内容偏题逻辑断裂；只有用词错误、搭配不当或生硬炫技时才指出，严禁因"超纲"压分`;
  } else if (isChuzhong) {
    difficulty = `以${label}课标词汇和句式为基准线而非封顶线：学生准确、自然地使用超出课标的词汇、短语或复杂句式时，一律视为亮点并表扬，严禁因"超纲"压分或要求替换；只有用词错误、搭配不当或生硬炫技时才指出`;
  } else {
    difficulty = `以 ${label} 考试要求为基准线，准确使用更高级别的词汇和句式视为亮点${
      isKetPet ? "，鼓励适当使用略高一级考试的词汇" : ""
    }`;
  }

  return `【写作类型】${label}
- 难度定位：${difficulty}
- 评分维度：${dims.join("、")}（scores 数组必须严格按这些维度给出，名称一字不差）
${isGaozhong ? "- 高中作文特别要求：按内容、语言、结构三个维度分块评价，每个维度的 comment 必须包含具体分析和改进建议" : ""}
- 参考范文：严格按该范围的词汇和句式难度要求，重新写一篇高质量范文；词数参照题目要求，没有词数要求时按 ${label} 的典型长度`;
}

const SYSTEM_PROMPT = `你是一名专业的中学英语作文批改老师。用户会给你两样东西：①作文的题目要求（可能包含题目、词数要求、内容要点等）；②学生写的作文。用户还会指定"写作类型"，你的评判标准和范文难度必须围绕该范围执行，但评分上限完全开放——该范围的标准是"基准线"而不是"封顶线"。

你必须依次完成以下分析，不允许跳过：

1.【扣题判断】：对照题目要求，判断作文是否切题。检查：主题是否一致、题目列出的内容要点是否都有覆盖、词数是否明显不达标（如果题目给了词数要求）。
2.【一句话总评】：用一句话概括这篇作文的整体水平，要让学生一眼知道自己处在什么位置。要求：①结合写作类型，允许且鼓励指出"超出预期"，如"语言水平远超初中要求，词汇和句式接近高中优秀水平"；②有依据（点明主要优点和最主要短板），不要空泛夸；③只有一句话。
3.【逐处语法错误】：找出作文中所有语法错误。判定标准以中国初中、高中英语语法为基础，硬性考点一律判错，严禁以"口语中常见"为由放过。
   【铁律·逐句检查】无论用户选择什么写作范围/学段，你都必须逐句检查基础语法错误，至少覆盖以下类别：动词时态、主谓一致、名词单复数、拼写大小写、冠词用法、介词搭配、形容词副词比较级。只要作文里存在这些错误，就必须全部找出来并逐一列入 errors，严禁以"低年级不要求"或"口语中可接受"为由忽略任何一处。errors 不能为空数组，除非作文确实零语法错误。
4.【按评分维度打分】：按写作类型指定的评分维度逐项给出等级评价和一句结合作文具体内容的理由。等级共五档：
   - 超出预期：作文在这一维度明显超出该学段/该考试的平均要求。例如初中作文中准确、自然地使用高中甚至雅思水平的词汇（如 nevertheless、be accustomed to、sacrifice...for...）、复杂句式（如定语从句叠加非谓语、倒装、强调句、with 复合结构），且没有语法错误、不是生硬炫技。
   - 优秀：扎实达到该范围的上限要求，表达准确、丰富、自然，仅有极小瑕疵。
   - 良好：稳稳达到该范围的基本要求，整体正确，丰富度或准确性有少量提升空间。
   - 一般：基本达到要求但存在明显短板，需指出具体问题。
   - 待提高：未达到该范围的基本要求，错误较多或影响理解。
   严禁机械套用"良好"档：凡词汇、句式明显超出该学段平均水平的，必须给"优秀"或"超出预期"；拿不准是优秀还是超出预期时，给超出预期。
5.【亮点摘录】：把作文中写得好的词汇、短语和句子单独摘录出来，给学生正向反馈：
   - 每条必须引用作文原文（text），不得改写或编造；
   - 亮点词汇/短语与亮点句式都可以收录，用 kind 标明"亮点词汇"或"亮点句式"；
   - 对每条标注其实际水平（level），如"初中内的精彩运用""已达到高中水平""已达到雅思 6.5+ 水平"；
   - note 用一句中文说明好在哪里；
   - 至少挑 2 条、最多 8 条；作文确实没有亮点时返回空数组 []。
6.【明显需要改善的地方】：列出 3-5 条具体、可操作的改进建议，不分类、不写空话：
   - issue 指出"哪里需要改"：必须具体到作文中的某个原句、某个位置或某个衔接处（可以直接引用原文片段）；
   - suggestion 说明"改成什么/怎么改"：给出可直接使用的英文改法或具体做法（例如把某个平淡表达替换成什么、在第几句之间加哪个英文过渡词）；
   - 语法硬伤已经在 errors 中逐条批改，这里侧重"不扣分但可以写得更好"的提升点（词汇升级、句式变化、衔接过渡、内容展开等）；
   - 如果作文已非常出色、确实凑不满 3 条，有几条写几条，禁止为凑数编造。
7.【参考范文】：按写作类型的要求重写一篇高质量范文。

每处错误必须做到四件事：
① 给出知识点名称（knowledge_point），必须严格遵守文末【标准知识点标签清单】一节的选择规则，从清单中逐字选取，禁止发明新标签。

② 三段讲解，各司其职、内容不重复：
- reason（错误原因）：明确指出错在哪里，说明学生为什么容易犯这个错；
- context_note（语境/搭配解释）：只在涉及语境或固定搭配时填写，讲清用法并给"错误写法 vs 正确写法"的对比例句；单纯规则错误返回空字符串 ""；
- suggestion（修改建议）：这一处具体怎么改、以后遇到同类情况用什么方法判断，可给一个简短的同类正确例句。

③ 现场出 2 道针对性练习题（exercises）：与该错误考同一个细化知识点，但换场景换句式、不照抄原句；初中难度；单项选择题（选项 2-4 个）或填空题（空格用 ____）；每题给正确答案和一句中文解析；不要在题干或解析中暴露学生的错误句子。

严格按照以下 JSON 格式返回，不要输出任何其他内容。注意：errors 必须放在最前面输出，确保即使输出被截断也能保留所有语法错误：
{
  "errors": [
    {
      "original": "出错的原文片段",
      "corrected": "修改后的正确写法",
      "knowledge_point": "主谓一致 - 就近一致",
      "reason": "错误原因",
      "context_note": "语境/搭配解释，或空字符串",
      "suggestion": "修改建议",
      "exercises": [
        {
          "type": "choice 或 fill",
          "question": "英文题目（填空题用 ____ 表示空格）",
          "options": ["选项1", "选项2", "选项3", "选项4"],
          "answer": "选择题给与 options 中完全一致的选项文本；填空题给要填入的英文",
          "explanation": "一句中文简短解析"
        }
      ]
    }
  ],
  "on_topic": {
    "is_on_topic": true 或 false,
    "comment": "扣题情况说明"
  },
  "overall_summary": "一句话总评，概括整体水平",
  "scores": [
    { "name": "评分维度名（与写作类型指定的维度一致）", "level": "超出预期/优秀/良好/一般/待提高", "comment": "一句结合作文具体内容的理由" }
  ],
  "highlights": [
    { "text": "作文原文中的亮点词汇/短语/句子", "kind": "亮点词汇 或 亮点句式", "level": "初中内的精彩运用 / 已达到高中水平 / 已达到雅思水平 等", "note": "一句中文说明好在哪里" }
  ],
  "improvements": [
    { "issue": "哪里需要改：引用原文片段或指出具体位置", "suggestion": "改成什么/怎么改：给可直接使用的英文或具体做法" }
  ],
  "model_essay": "参考范文（纯英文，按写作类型的词汇和句式难度写）"
}

规则：
1. errors 必须包含全部语法错误；确实没有语法错误时返回空数组 []
2. original、highlights[].text、improvements[].issue 中引用的部分必须是作文原文中出现的片段，不要改写
3. 同一个片段有多个错误时分开逐条列出
4. 每处错误的 exercises 固定给 2 道题
5. scores 数组的维度和顺序必须与"写作类型"指定的评分维度完全一致，level 只能是：超出预期、优秀、良好、一般、待提高
6. 凡准确使用明显超学段的词汇或句式，相关 score 必须给"优秀"或"超出预期"，不得因"超纲"压分
7. highlights 每条必须真实出自作文原文，并标注具体水平；没有亮点时返回 []
8. improvements 给 3-5 条，必须具体可操作（指出位置 + 给出改法），禁止"注意衔接""多使用高级句型"这类空话；如缺过渡词，必须指出具体在哪两句/两段之间加哪个英文过渡词
9. model_essay 必须符合写作类型的词汇/句式难度，不要为了炫技超纲
10. 全部说明文字用中文，original/corrected/text/题目/选项/答案/suggestion 中的英文/model_essay 保持英文

${KNOWLEDGE_POINT_SECTION}`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let topic = "";
  let essay = "";
  let scope = "";
  try {
    const body = await req.json();
    topic = typeof body?.topic === "string" ? body.topic : "";
    essay = typeof body?.essay === "string" ? body.essay : "";
    scope = typeof body?.scope === "string" ? body.scope.trim() : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!topic.trim()) {
    return NextResponse.json({ error: "请先输入作文的题目要求" }, { status: 400 });
  }
  if (!essay.trim()) {
    return NextResponse.json({ error: "请输入要分析的作文" }, { status: 400 });
  }

  try {
    const userContent = `${buildScopeGuide(scope)}\n\n【题目要求】\n${topic.slice(0, 1000)}\n\n【学生作文】\n${essay.slice(0, 4000)}`;

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
        temperature: 0,
        max_tokens: 16000, // 每处错误自带 2 道题，外加亮点/改进建议/整篇范文，长作文需要足够空间避免截断
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
    const finishReason = data?.choices?.[0]?.finish_reason;

    // 容错解析：JSON 可能因 max_tokens 截断而不完整。errors 已放在 JSON 最前，
    // 因此即使整体解析失败，也尽量单独提取 errors 数组，避免前端显示 0 处错误。
    let parsed: {
      on_topic?: unknown;
      overall_summary?: unknown;
      scores?: unknown;
      highlights?: unknown;
      improvements?: unknown;
      model_essay?: unknown;
      errors?: unknown;
    } = {};
    try {
      parsed = parseLooseJson(content) as typeof parsed;
    } catch {
      // 整体 JSON 解析失败，尝试只提取 errors 数组（放在最前面，截断时仍可能完整）
      try {
        const m = content.match(/"errors"\s*:\s*(\[[\s\S]*?\n\s*\])/);
        if (m) parsed.errors = JSON.parse(m[1]);
      } catch {
        parsed.errors = [];
      }
      // 截断导致后续字段缺失，errors 优先保留即可
    }
    // 如果是 length（max_tokens 截断）且 errors 仍为空，记录一下便于排查
    if (finishReason === "length" && (!Array.isArray(parsed.errors) || parsed.errors.length === 0)) {
      console.warn("[essay] AI 输出被 max_tokens 截断且 errors 为空");
    }

    const LEVELS = ["超出预期", "优秀", "良好", "一般", "待提高"];
    const cleanLevel = (v: unknown) =>
      typeof v === "string" && LEVELS.includes(v.trim()) ? v.trim() : "良好";

    // 评分维度清洗
    const scores = (
      Array.isArray(parsed?.scores)
        ? (parsed.scores as Record<string, unknown>[])
        : []
    )
      .map((s) => ({
        name: typeof s?.name === "string" ? s.name.trim() : "",
        level: cleanLevel(s?.level),
        comment: typeof s?.comment === "string" ? s.comment.trim() : "",
      }))
      .filter((s) => s.name);

    // 亮点摘录清洗
    const highlights = (Array.isArray(parsed?.highlights)
      ? (parsed.highlights as Record<string, unknown>[])
      : []
    )
      .map((h) => {
        const text = typeof h?.text === "string" ? h.text.trim() : "";
        if (!text) return null;
        return {
          text,
          kind:
            typeof h?.kind === "string" && h.kind.includes("句式")
              ? "亮点句式"
              : "亮点词汇",
          level: typeof h?.level === "string" ? h.level.trim() : "",
          note: typeof h?.note === "string" ? h.note.trim() : "",
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .slice(0, 8);

    // 明显需要改善的地方清洗
    const improvements = (Array.isArray(parsed?.improvements)
      ? (parsed.improvements as Record<string, unknown>[])
      : []
    )
      .map((it) => ({
        issue: typeof it?.issue === "string" ? it.issue.trim() : "",
        suggestion:
          typeof it?.suggestion === "string" ? it.suggestion.trim() : "",
      }))
      .filter((it) => it.issue && it.suggestion)
      .slice(0, 5);

    // 逐错误清洗：讲解字段 + 练习题都做兜底，防止 AI 脏数据搞崩前端
    const rawErrors = Array.isArray(parsed?.errors)
      ? (parsed.errors as Record<string, unknown>[])
      : [];
    const errors = rawErrors
      .map((raw) => {
        const original =
          typeof raw.original === "string" ? raw.original.trim() : "";
        const corrected =
          typeof raw.corrected === "string" ? raw.corrected.trim() : "";
        if (!original || !corrected) return null;
        return {
          original,
          corrected,
          knowledge_point:
            typeof raw.knowledge_point === "string"
              ? raw.knowledge_point.trim()
              : "",
          reason: typeof raw.reason === "string" ? raw.reason.trim() : "",
          context_note:
            typeof raw.context_note === "string"
              ? raw.context_note.trim()
              : "",
          suggestion:
            typeof raw.suggestion === "string" ? raw.suggestion.trim() : "",
          exercises: normalizeExercises(raw.exercises, 2) as Exercise[],
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    const rawOnTopic = (parsed?.on_topic ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      on_topic: {
        is_on_topic: rawOnTopic.is_on_topic !== false,
        comment:
          typeof rawOnTopic.comment === "string" ? rawOnTopic.comment : "",
      },
      overall_summary:
        typeof parsed?.overall_summary === "string"
          ? parsed.overall_summary.trim()
          : "",
      scores,
      highlights,
      improvements,
      model_essay:
        typeof parsed?.model_essay === "string"
          ? parsed.model_essay.trim()
          : "",
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败，请重试" },
      { status: 500 }
    );
  }
}
