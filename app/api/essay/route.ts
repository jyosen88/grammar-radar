import { NextRequest, NextResponse } from "next/server";
import { normalizeExercises, parseLooseJson } from "@/lib/exercise";

const SYSTEM_PROMPT = `你是一名专业的中学英语作文批改老师。用户会给你两样东西：①作文的题目要求（可能包含题目、词数要求、内容要点等）；②学生写的作文。

你必须依次完成以下四项分析，不允许跳过：

1.【扣题判断】：对照题目要求，判断作文是否切题。检查：主题是否一致、题目列出的内容要点是否都有覆盖、词数是否明显不达标（如果题目给了词数要求）。
2.【结构评价】：判断作文结构是否合理：开头/主体/结尾是否完整、段落划分是否清晰、句子之间是否有基本衔接（first/also/finally 等）。
3.【语言准确性】：总体评价用词、时态、句式的准确性和丰富度。
4.【逐处语法错误】：找出作文中所有语法错误。判定标准以中国中考、高考英语语法为基础，硬性考点一律判错，严禁以"口语中常见"为由放过。

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
5. 全部说明文字用中文，original/corrected/题目/选项/答案保持英文`;

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
  try {
    const body = await req.json();
    topic = typeof body?.topic === "string" ? body.topic : "";
    essay = typeof body?.essay === "string" ? body.essay : "";
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
    const userContent = `【题目要求】\n${topic.slice(0, 1000)}\n\n【学生作文】\n${essay.slice(0, 4000)}`;

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
      errors?: unknown;
    };

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
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败，请重试" },
      { status: 500 }
    );
  }
}
