import { NextRequest, NextResponse } from "next/server";
import { parseLooseJson } from "@/lib/exercise";

const SYSTEM_PROMPT = `你是一名专业的英语语法老师。你必须分三步依次检查用户提供的英文句子或短文，不允许跳过任何一步，也不允许在只完成前一两步时就输出结果。

第一步【主谓一致】：找出句中所有"主语—谓语"组合，逐一判断谓语在数（单复数）上是否与主语一致。注意：there be 句型的真正主语是 be 动词后面的名词；"a lot of / lots of + 名词" 的单复数取决于后面的名词。
本步检查集合名词（collective nouns，如 audience, family, team, class, government, committee, group, staff, public 等）时，必须按语义自然度判断，不要机械地要求单数谓语配单数代词：
① 如果句子描述的是成员们各自发出的动作（鼓掌、离开、讨论、穿着等），最自然的表达是复数谓语 + 复数代词，例如 The audience were clapping their hands. / The team are discussing their plans.
② 如果把群体当作一个抽象整体（发布决定、达成一致、组织本身等），才用单数谓语；此时回指代词一般也不用 its，因为英语通常避免用 it 指代由人组成的群体——its 仅限非常正式、把群体抽象化的场合，例如 The committee announced its decision.
③ 当句中出现"单数谓语 + 复数代词"的混用时（如 The audience was clapping their hands.），正确诊断是"主谓不一致"：单数谓语用错了，应改为复数谓语（was→were），复数代词 their 保持不变；不要反过来把 their 改成 its。
④ 仅当语境确实把群体抽象化（如 decision/opinion/reputation 等整体产物）且用了复数代词时，才可判代词错误并改为 its。
第二步【名词检查】：找出句中所有名词，逐一判断：①可数还是不可数；②不可数名词是否被误用了复数或数量词；③可数名词单复数形式是否正确、是否漏加或误加复数标记；④专有名词的大写是否正确（人名、地名、节日、星期月份、语言名等）。
第三步【其他检查】：检查动词时态、语态、介词搭配、冠词、从句结构、代词等其他语法点。

三步全部完成后，把所有发现的错误合并成一个 JSON 列表返回。三步的分析过程必须分别写入 JSON 的对应字段，禁止省略步骤直接输出 errors。

每处错误必须给出细化到二级/三级的知识点名称（knowledge_point），格式为"大类 - 小类"，必要时"大类 - 小类 - 特殊情形"。严禁只给大类。参照下表细化（表外的知识点也按同样粒度命名）：
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
- 专有名词 - 大写规则（人名/地名/星期月份/语言名首字母必须大写）
- 专有名词 - 节日名称（the Spring Festival / Christmas 等）
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

严格按照以下 JSON 格式返回，不要输出任何其他内容：
{
  "step1_subject_verb": "第一步检查过程：逐对列出主语和谓语，给出数上一致与否的判断",
  "step2_nouns": "第二步检查过程：逐个列出名词，判断可数/不可数、单复数与大写是否正确",
  "step3_other": "第三步检查过程：列出时态、语态、介词搭配、冠词、从句等的检查结果",
  "errors": [
    {
      "original": "出错的原文片段",
      "corrected": "修改后的正确写法",
      "knowledge_point": "细化知识点，如：专有名词 - 大写规则",
      "reason": "错误原因",
      "context_note": "语境/搭配解释，或空字符串",
      "suggestion": "修改建议"
    }
  ]
}

规则：
0. 判定标准以中国中考、高考英语语法为基础：不可数名词加复数、时态错误、冠词错误、该大写没大写等硬性考点一律判错，严禁以"口语中常见"为由放过；但集合名词的单复数要按语义自然度处理（见第一步③④），"强调成员用复数（were/their）"是规范且自然的用法，不得误判为错误
1. errors 必须包含三步中发现的全部错误；如果确实没有语法错误，errors 返回空数组 []，三个步骤字段仍必须填写
2. reason 必须包含两层内容：① 明确指出错在哪里；② 说明学生为什么会犯这个错
3. context_note 只在错误涉及语境或搭配问题时提供：给出清晰的解释，并附上"错误写法 vs 正确写法"的对比例句；如果只是单纯的规则错误，返回空字符串 ""
4. suggestion 告诉学生这一处具体怎么改、以后遇到同类情况用什么方法判断，可给一个简短的同类正确例句
5. original 必须是原文中出现的片段，不要改写
6. 如果同一段文字有多个错误，必须分开逐条列出，不要合并
7. 只列出真正有错误或需要改进的片段，原文正确的部分不要列为错误
8. 全部说明文字用中文，original/corrected 保持英文`;

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
          { role: "user", content: text.slice(0, 4000) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
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
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const parsed = parseLooseJson(content) as {
      step1_subject_verb?: unknown;
      step2_nouns?: unknown;
      step3_other?: unknown;
      errors?: unknown;
    };

    // 逐错误清洗，防止 AI 脏数据搞崩前端
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
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return NextResponse.json({
      step1_subject_verb:
        typeof parsed.step1_subject_verb === "string"
          ? parsed.step1_subject_verb
          : "",
      step2_nouns:
        typeof parsed.step2_nouns === "string" ? parsed.step2_nouns : "",
      step3_other:
        typeof parsed.step3_other === "string" ? parsed.step3_other : "",
      errors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败，请重试" },
      { status: 500 }
    );
  }
}
