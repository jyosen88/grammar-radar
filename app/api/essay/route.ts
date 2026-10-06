import { NextRequest, NextResponse } from "next/server";
import { normalizeExercises, parseLooseJson } from "@/lib/exercise";

/** 各写作范围的批改约束：词汇难度 / 句式难度 / 评分维度 */
function buildScopeGuide(scope: string): string {
  const UNIT = ["七上", "七下", "八上", "八下", "九上", "九下"];
  const isUnit = UNIT.includes(scope);
  const isZhongkao = scope === "中考";
  const isGaokao = scope === "高考";
  const isKetPet = scope === "KET" || scope === "PET";
  const isFceCae = scope === "FCE" || scope === "CAE";
  const isIelts = scope === "雅思";
  const isToefl = scope === "托福";

  // 未选择范围时默认按中考标准
  const label = scope || "中考";

  let vocab: string;
  if (isUnit || isZhongkao || isGaokao) {
    vocab = "以课标词汇为主，可以适当使用少量高级词汇，超出课标太多的用词要提示替换";
  } else {
    vocab = `按 ${label} 考试的词汇范围评判${
      isKetPet ? "，允许并鼓励适当使用略高一级考试的词汇" : ""
    }`;
  }

  let sentence: string;
  if (isUnit || isZhongkao || isKetPet) {
    sentence =
      "句式以简单句和基础复合句为主，鼓励在恰当位置使用 1-2 个定语从句、状语从句或倒装句作为亮点，但不能堆砌复杂句式；亮点句要自然融入，不能为了用而用；段落清晰，连接词使用得当";
    if (isUnit) {
      sentence += `；本次为单元作文（${label}），还需紧扣该单元的核心词汇、句型和话题来评价`;
    }
  } else {
    sentence =
      "鼓励使用复杂从句、非谓语动词、倒装、虚拟语气等多种句式，句式多样性是加分项；段落清晰，连接词使用得当";
  }

  let dims: string[];
  if (isIelts) dims = ["任务回应", "连贯与衔接", "词汇资源", "语法多样性与准确性"];
  else if (isToefl) dims = ["语言运用"];
  else if (isFceCae || isKetPet)
    dims = ["内容", "沟通达成", "组织结构", "语言"];
  else dims = ["内容", "语言", "结构"];

  return `【写作范围】${label}
- 词汇难度要求：${vocab}
- 句式难度要求：${sentence}
- 评分维度：${dims.join("、")}（scores 数组必须严格按这些维度给出，名称一字不差）
- 高级表达推荐：在该范围的词汇范围内，把学生作文中平淡或不够地道的表达换成更地道、更精准的表达（不要超过该范围的水平）
- 参考范文：严格按该范围的词汇和句式难度要求，重新写一篇高质量范文；词数参照题目要求，没有词数要求时按 ${label} 的典型长度`;
}

const SYSTEM_PROMPT = `你是一名专业的中学英语作文批改老师。用户会给你两样东西：①作文的题目要求（可能包含题目、词数要求、内容要点等）；②学生写的作文。用户还会指定"写作范围"，你的评判标准、范文难度、评分维度都必须严格围绕该范围执行。

你必须依次完成以下分析，不允许跳过：

1.【扣题判断】：对照题目要求，判断作文是否切题。检查：主题是否一致、题目列出的内容要点是否都有覆盖、词数是否明显不达标（如果题目给了词数要求）。
2.【结构评价】：判断作文结构是否合理：开头/主体/结尾是否完整、段落划分是否清晰、句子之间是否有基本衔接（first/also/finally 等）。
3.【语言准确性】：总体评价用词、时态、句式的准确性和丰富度。
4.【逐处语法错误】：找出作文中所有语法错误。判定标准以中国中考、高考英语语法为基础，硬性考点一律判错，严禁以"口语中常见"为由放过。
5.【细化维度评价】：从词汇丰富度、句式多样性、衔接词使用、逻辑连贯性四个维度分别评价。每个维度必须：引用作文中的具体句子作为证据（用引号标出原文片段），指出好在哪里或问题在哪里，并给出可操作的改进建议。评价标准要与写作范围匹配（如中考不要求虚拟语气，就不要因缺少虚拟语气扣分）。
6.【按评分维度打分】：按写作范围指定的评分维度逐项给出等级评价（优秀/良好/一般/待提高）和一句理由，理由要结合作文具体内容。
7.【高级表达推荐】：挑 3-5 处学生写得平淡或不够地道的表达，给出更地道的替换写法。
8.【参考范文】：按写作范围的要求重写一篇高质量范文。

每处错误必须做到四件事：
① 给出细化到二级/三级的知识点名称（knowledge_point），格式为"大类 - 小类"，必要时"大类 - 小类 - 特殊情形"。严禁只给大类。参照下表细化（表外的知识点也按同样粒度命名）：
- 主谓一致 - 语法一致
- 主谓一致 - 意义一致（集合名词 family/audience/team 等按语义决定单复数）
- 主谓一致 - 就近一致（either...or / neither...nor / not only...but also / there be）
- 主谓一致 - 不定代词作主语（each/every/someone/nobody 等）
- 主谓一致 - 分数/百分数作主语
- 主谓一致 - the number of vs a number of
- 主谓一致 - 主语后接 with/together with/as well as
- 非谓语动词 - 动名词作宾语（enjoy/finish/mind/practice + doing）
- 非谓语动词 - 不定式作宾语（want/decide/hope + to do）
- 非谓语动词 - 使役/感官动词（make/let/have/see/hear + do/doing）
- 非谓语动词 - 分词作定语/状语
- 名词 - 可数与不可数
- 名词 - 名词作定语的单复数（man/woman 变复数）
- 名词 - 所有格（'s 与 of）
- 名词 - 恒复数名词（police/cattle/people）
- 冠词 - 不定冠词 a/an
- 冠词 - 定冠词 the（乐器/序数词/特指）
- 冠词 - 零冠词（三餐/球类/学科）
- 代词 - 人称代词主格宾格
- 代词 - 物主代词/反身代词
- 代词 - 指示代词/不定代词
- 时态 - 一般现在时 / 现在进行时 / 一般过去时 / 现在完成时 / 过去进行时 / 过去完成时 / 一般将来时
- 被动语态
- 介词 - 固定搭配（listen to / interested in 等）
- 形容词与副词 - 比较级/最高级、系动词后接形容词
- 从句 - 定语从句（who/which/that/whose/关系副词）
- 从句 - 宾语从句（语序/引导词）
- 从句 - 状语从句（时间/条件/让步）
- 连词与逻辑衔接 / 词性混用 / 拼写

② 三段讲解，各司其职、内容不重复：
- reason（错误原因）：明确指出错在哪里，说明学生为什么容易犯这个错；
- context_note（语境/搭配解释）：只在涉及语境或固定搭配时填写，讲清用法并给"错误写法 vs 正确写法"的对比例句；单纯规则错误返回空字符串 ""；
- suggestion（修改建议）：这一处具体怎么改、以后遇到同类情况用什么方法判断，可给一个简短的同类正确例句。

③ 现场出 2 道针对性练习题（exercises）：与该错误考同一个细化知识点，但换场景换句式、不照抄原句；中考难度；单项选择题（选项 2-4 个）或填空题（空格用 ____）；每题给正确答案和一句中文解析；不要在题干或解析中暴露学生的错误句子。

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "on_topic": {
    "is_on_topic": true 或 false,
    "comment": "扣题情况说明"
  },
  "structure": "结构评价：1-3 句话",
  "language": "语言评价：1-3 句话",
  "dimensions": {
    "vocabulary": { "level": "优秀/良好/一般/待提高", "comment": "词汇丰富度评价：引用具体句子，指出问题或亮点，给改进建议" },
    "sentence_variety": { "level": "...", "comment": "句式多样性评价：引用具体句子，结合写作范围的句式难度要求" },
    "cohesive_devices": { "level": "...", "comment": "衔接词使用评价：引用具体句子" },
    "coherence": { "level": "...", "comment": "逻辑连贯性评价：引用具体句子" }
  },
  "scores": [
    { "name": "评分维度名（与写作范围指定的维度一致）", "level": "优秀/良好/一般/待提高", "comment": "一句结合作文具体内容的理由" }
  ],
  "advanced_expressions": [
    { "original": "学生作文中的原表达", "better": "更地道的替换表达", "note": "一句中文说明为什么更好" }
  ],
  "model_essay": "参考范文（纯英文，按写作范围的词汇和句式难度写）",
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
  ]
}

规则：
1. errors 必须包含全部语法错误；确实没有语法错误时返回空数组 []
2. original 必须是作文原文中出现的片段，不要改写
3. 同一个片段有多个错误时分开逐条列出
4. 每处错误的 exercises 固定给 2 道题
5. scores 数组的维度和顺序必须与"写作范围"指定的评分维度完全一致
6. dimensions 四个键都必须给出，level 只能是：优秀、良好、一般、待提高
7. advanced_expressions 给 3-5 条；original 必须是作文中出现过的表达
8. model_essay 必须符合写作范围的词汇/句式难度，不要为了炫技超纲
9. 全部说明文字用中文，original/corrected/better/题目/选项/答案/model_essay 保持英文`;

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
        max_tokens: 8000, // 每处错误自带 2 道题，需要较大输出空间
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
      on_topic?: unknown;
      structure?: unknown;
      language?: unknown;
      dimensions?: unknown;
      scores?: unknown;
      advanced_expressions?: unknown;
      model_essay?: unknown;
      errors?: unknown;
    };

    const LEVELS = ["优秀", "良好", "一般", "待提高"];
    const cleanLevel = (v: unknown) =>
      typeof v === "string" && LEVELS.includes(v.trim()) ? v.trim() : "一般";

    // 细化维度评价清洗
    const rawDims = (parsed?.dimensions ?? {}) as Record<string, unknown>;
    const cleanDim = (v: unknown) => {
      const d = (v ?? {}) as Record<string, unknown>;
      return {
        level: cleanLevel(d.level),
        comment: typeof d.comment === "string" ? d.comment.trim() : "",
      };
    };
    const dimensions = {
      vocabulary: cleanDim(rawDims.vocabulary),
      sentence_variety: cleanDim(rawDims.sentence_variety),
      cohesive_devices: cleanDim(rawDims.cohesive_devices),
      coherence: cleanDim(rawDims.coherence),
    };

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

    // 高级表达推荐清洗
    const advanced_expressions = (
      Array.isArray(parsed?.advanced_expressions)
        ? (parsed.advanced_expressions as Record<string, unknown>[])
        : []
    )
      .map((a) => ({
        original: typeof a?.original === "string" ? a.original.trim() : "",
        better: typeof a?.better === "string" ? a.better.trim() : "",
        note: typeof a?.note === "string" ? a.note.trim() : "",
      }))
      .filter((a) => a.original && a.better)
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
          exercises: normalizeExercises(raw.exercises, 2),
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
      structure: typeof parsed?.structure === "string" ? parsed.structure : "",
      language: typeof parsed?.language === "string" ? parsed.language : "",
      dimensions,
      scores,
      advanced_expressions,
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
