import { NextRequest, NextResponse } from "next/server";
import { parseLooseJson } from "@/lib/exercise";

const SYSTEM_PROMPT = `你是一名专业的英语语法老师。收到学生的输入后，你必须【先判断输入类型】，再按对应模式输出。输入类型有两种：

一、quiz（未做的选择题）：题干中留有未填写的空格（如 ____、___、( )、（  ）等），并带有 A/B/C/D（或更多）选项，或题目要求"选择最佳答案/choose the best answer"。
二、correction（已完成的句子/短文）：没有空格，是一段写完整的英文，需要查错批改。
注意：如果空格里已经填了具体单词（学生做过了），按 correction 处理。

============================================================
【模式一：quiz 解题模式】
按下面的要求解题：
1. 选出唯一正确答案，给出选项字母和选项全文；
2. knowledge_point：本题考查的细化知识点，必须细化到二级/三级（粒度要求同模式二的知识点表），如"非谓语动词 - 动名词作宾语（enjoy/finish/mind/practice + doing）"。【铁律】knowledge_point 只描述语法规则本身，绝不绑定题目中的具体词汇——括号里只能写规则的适用范围或类别，不能写本题的单词。例：题目考 nature 前不加冠词，knowledge_point 必须写"冠词 - 零冠词（泛指抽象概念不加冠词）"，禁止写"冠词 - 零冠词（nature 表示大自然时不用冠词）"；
3. explanation：题目解析，先讲题干句子是什么意思、空格处需要什么语法成分或搭配，再讲正确选项为什么对；
4. options：逐个选项分析为什么对/为什么错——正确项说明它满足什么语法规则；错误项说明它错在哪、属于什么典型误区，必要时给一个正确用法的小例句。
此模式只输出 quiz 对象，不输出三步检查字段，errors 返回空数组 []。

============================================================
【模式二：correction 批改模式】
你必须分三步依次检查，不允许跳过任何一步，也不允许在只完成前一两步时就输出结果。

第一步【主谓一致】：找出句中所有"主语—谓语"组合，逐一判断谓语在数（单复数）上是否与主语一致。注意：there be 句型的真正主语是 be 动词后面的名词；"a lot of / lots of + 名词" 的单复数取决于后面的名词。
本步检查集合名词（collective nouns，如 audience, family, team, class, government, committee, group, staff, public 等）时，必须按语义自然度判断，不要机械地要求单数谓语配单数代词：
① 如果句子描述的是成员们各自发出的动作（鼓掌、离开、讨论、穿着等），最自然的表达是复数谓语 + 复数代词，例如 The audience were clapping their hands. / The team are discussing their plans.
② 如果把群体当作一个抽象整体（发布决定、达成一致、组织本身等），才用单数谓语；此时回指代词一般也不用 its，因为英语通常避免用 it 指代由人组成的群体——its 仅限非常正式、把群体抽象化的场合，例如 The committee announced its decision.
③ 当句中出现"单数谓语 + 复数代词"的混用时（如 The audience was clapping their hands.），正确诊断是"主谓不一致"：单数谓语用错了，应改为复数谓语（was→were），复数代词 their 保持不变；不要反过来把 their 改成 its。
④ 仅当语境确实把群体抽象化（如 decision/opinion/reputation 等整体产物）且用了复数代词时，才可判代词错误并改为 its。
第二步【名词检查】：找出句中所有名词，逐一判断：①可数还是不可数；②不可数名词是否被误用了复数或数量词；③可数名词单复数形式是否正确、是否漏加或误加复数标记；④专有名词的大写是否正确（人名、地名、节日、星期月份、语言名等）。
第三步【其他检查】：检查动词时态、语态、介词搭配、冠词、从句结构、代词等其他语法点。

三步全部完成后，把所有发现的错误合并成一个 errors 列表。三步的分析过程必须分别写入 JSON 的对应字段，禁止省略步骤直接输出 errors。

每处错误必须给出细化到二级/三级的知识点名称（knowledge_point），格式为"大类 - 小类"，必要时"大类 - 小类 - 特殊情形"。严禁只给大类。【铁律】knowledge_point 只描述语法规则本身，绝不绑定本句中的具体词汇——括号里只能写规则的适用范围或类别，不能写原句里的单词。例：原句错在 nature 前多了 the，knowledge_point 必须写"冠词 - 零冠词（泛指抽象概念不加冠词）"，禁止写"冠词 - 零冠词（nature 表示大自然时不用冠词）"。参照下表细化（表外的知识点也按同样粒度命名）：
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

批改模式的判定标准以中国中考、高考英语语法为基础：不可数名词加复数、时态错误、冠词错误、该大写没大写等硬性考点一律判错，严禁以"口语中常见"为由放过；但集合名词的单复数要按语义自然度处理，"强调成员用复数（were/their）"是规范且自然的用法，不得误判为错误。errors 必须包含全部错误；如果确实没有语法错误，errors 返回空数组 []，三个步骤字段仍必须填写。
reason 必须包含两层：① 明确指出错在哪里；② 说明学生为什么会犯这个错。context_note 只在涉及语境或搭配时提供，并附"错误写法 vs 正确写法"对比例句；单纯规则错误返回空字符串 ""。suggestion 告诉学生具体怎么改、以后同类情况怎么判断。original 必须是原文片段，不要改写；多个错误分开逐条列出，不要合并；原文正确的部分不要列为错误。

============================================================
【外部参考资料对照规则】用户消息末尾可能附有【外部参考资料】（来自网页搜索的标题与摘要，可能存在质量参差或观点过时）：
1. 你必须【先完全独立完成自己的分析/解题】，不要先看参考资料下结论，尤其遇到集合名词单复数等需要按语境判断的题目时，以你自己的语法分析为准；
2. 独立分析完成后，再把你的结论逐条与参考资料对照：
   - 结论方向一致或参考资料只是补充说明 → reference_check.status 填 "consistent"，comment 简述参考资料如何支持你的结论；
   - 参考资料与你的分析存在实质分歧（如参考资料说集合名词必须用单数谓语，而你按语境判断应为复数）→ status 填 "difference"，comment 必须以"【AI 分析与外部参考存在差异】"开头，说明分歧点是什么、你为什么坚持自己的判断；
   - 用户消息标注"（未提供参考资料）"或参考资料与本题无关、没有明确答案 → status 填 "none"，comment 固定填"未找到明确的外部参考，以下为纯 AI 分析，本题建议核对课本或询问老师"。
3. 参考资料仅作对照，不允许因为参考资料的说法而动摇你在 errors / quiz 中给出的独立结论；发现分歧时只在 reference_check 中声明，不要改写自己的分析结果。

============================================================
【统一输出格式】严格按照以下 JSON 返回，不要输出任何其他内容。全部说明文字用中文，英文内容保持英文。

quiz 模式必须按此骨架返回：
{
  "input_type": "quiz",
  "step1_subject_verb": "",
  "step2_nouns": "",
  "step3_other": "",
  "errors": [],
  "reference_check": { "status": "consistent / difference / none", "comment": "对照结论说明" },
  "quiz": {
    "answer_letter": "B",
    "answer_text": "正确选项全文",
    "knowledge_point": "细化到二级/三级的知识点",
    "explanation": "题目解析：句意 + 空格需要什么 + 正确项为何对",
    "options": [
      { "letter": "A", "text": "选项内容", "is_correct": false, "analysis": "为什么错" },
      { "letter": "B", "text": "选项内容", "is_correct": true, "analysis": "为什么对" }
    ]
  }
}

correction 模式必须按此骨架返回（errors 中每个错误一个对象）：
{
  "input_type": "correction",
  "step1_subject_verb": "第一步主谓一致检查过程（无论有无错误都必须写）",
  "step2_nouns": "第二步名词检查过程（无论有无错误都必须写）",
  "step3_other": "第三步其他检查过程（无论有无错误都必须写）",
  "errors": [
    {
      "original": "原文中的错误片段，不要改写",
      "corrected": "修改后的正确片段",
      "knowledge_point": "大类 - 小类（细化到二级/三级）",
      "reason": "①明确指出错在哪里；②说明学生为什么会犯这个错",
      "context_note": "涉及语境或搭配时给错误写法 vs 正确写法规例；单纯规则错误填空字符串",
      "suggestion": "具体怎么改、以后同类情况怎么判断"
    }
  ],
  "reference_check": { "status": "consistent / difference / none", "comment": "对照结论说明" },
  "quiz": null
}

【最重要的铁律】correction 模式下，凡是在 step1_subject_verb / step2_nouns / step3_other 文字分析中指出的错误，必须逐条同步写进 errors 数组，严禁"步骤文字里分析出了错误、errors 却是空数组"。只有全文确实没有任何语法错误时，errors 才允许返回 []，此时三个步骤字段仍要写明检查过程。quiz 模式下 quiz 对象必填，errors 必须为 []。`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let text: string;
  let rawReferences: unknown;
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
    rawReferences = body?.references;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "请输入要分析的英文内容" }, { status: 400 });
  }

  // 清洗前端搜索到的外部参考资料（最多 5 条，防止超长内容冲掉 prompt 预算）
  const references = (Array.isArray(rawReferences) ? rawReferences : [])
    .map((r) => {
      const item = r && typeof r === "object" ? (r as Record<string, unknown>) : null;
      if (!item) return null;
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const snippet =
        typeof item.snippet === "string" ? item.snippet.trim() : "";
      if (!title && !snippet) return null;
      return {
        title: title.slice(0, 200),
        snippet: snippet.slice(0, 500),
      };
    })
    .filter((r): r is { title: string; snippet: string } => r !== null)
    .slice(0, 5);

  // 拼到用户消息末尾，让 AI 先独立分析再对照
  const referenceBlock =
    references.length > 0
      ? "\n\n【外部参考资料】\n" +
        references
          .map(
            (r, i) =>
              `${i + 1}. 标题：${r.title}\n   摘要：${r.snippet}`
          )
          .join("\n")
      : '\n\n【外部参考资料】\n（未提供参考资料）';

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
          {
            role: "user",
            content: text.slice(0, 4000) + referenceBlock,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 6000,
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
      input_type?: unknown;
      step1_subject_verb?: unknown;
      step2_nouns?: unknown;
      step3_other?: unknown;
      errors?: unknown;
      quiz?: unknown;
      reference_check?: unknown;
    };

    const inputType =
      parsed?.input_type === "quiz" ? "quiz" : "correction";

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

    // —— quiz 解题模式结果清洗 ——
    let quiz = null;
    const rawQuiz =
      inputType === "quiz" &&
      parsed.quiz &&
      typeof parsed.quiz === "object"
        ? (parsed.quiz as Record<string, unknown>)
        : null;
    if (rawQuiz) {
      const answerLetter =
        typeof rawQuiz.answer_letter === "string"
          ? rawQuiz.answer_letter.trim().charAt(0).toUpperCase()
          : "";
      const rawOptions = Array.isArray(rawQuiz.options)
        ? (rawQuiz.options as Record<string, unknown>[])
        : [];
      const options = rawOptions
        .map((o) => {
          const letter =
            typeof o.letter === "string"
              ? o.letter.trim().charAt(0).toUpperCase()
              : "";
          const textOpt =
            typeof o.text === "string" ? o.text.trim() : "";
          const analysis =
            typeof o.analysis === "string" ? o.analysis.trim() : "";
          if (!/^[A-Z]$/.test(letter) || !textOpt) return null;
          return {
            letter,
            text: textOpt,
            // 以 answer_letter 为唯一准绳，避免 AI 自相矛盾
            is_correct: letter === answerLetter,
            analysis,
          };
        })
        .filter((o): o is NonNullable<typeof o> => o !== null);

      const hasCorrect = options.some((o) => o.is_correct);
      if (/^[A-Z]$/.test(answerLetter) && options.length >= 2 && hasCorrect) {
        quiz = {
          answer_letter: answerLetter,
          answer_text:
            typeof rawQuiz.answer_text === "string"
              ? rawQuiz.answer_text.trim()
              : options.find((o) => o.is_correct)?.text ?? "",
          knowledge_point:
            typeof rawQuiz.knowledge_point === "string"
              ? rawQuiz.knowledge_point.trim()
              : "",
          explanation:
            typeof rawQuiz.explanation === "string"
              ? rawQuiz.explanation.trim()
              : "",
          options,
        };
      }
    }
    // AI 说 quiz 但数据不完整时，降级为批改模式（errors 通常也为空，前端会显示未发现错误）
    const finalType = inputType === "quiz" && quiz ? "quiz" : "correction";

    // —— 外部参考对照结论清洗 ——
    // 根本没给参考资料时，不允许 AI 编造对照结果，强制 none
    let refStatus: "consistent" | "difference" | "none" = "none";
    let refComment =
      "未找到明确的外部参考，以下为纯 AI 分析，本题建议核对课本或询问老师";
    if (references.length > 0) {
      const rc =
        parsed.reference_check &&
        typeof parsed.reference_check === "object"
          ? (parsed.reference_check as Record<string, unknown>)
          : null;
      const rawStatus = typeof rc?.status === "string" ? rc.status.trim() : "";
      if (rawStatus === "consistent" || rawStatus === "difference") {
        refStatus = rawStatus;
        refComment =
          typeof rc?.comment === "string" && rc.comment.trim()
            ? rc.comment.trim()
            : rawStatus === "consistent"
              ? "AI 分析与外部参考结论一致"
              : "AI 分析与外部参考存在差异，请结合两者自行判断";
      } else if (rawStatus === "none") {
        refStatus = "none";
        refComment =
          typeof rc?.comment === "string" && rc.comment.trim()
            ? rc.comment.trim()
            : "外部参考与本题无关或未给出明确答案，以下为纯 AI 分析，建议核对课本或询问老师";
      } else {
        // AI 漏返字段时的诚实兜底：不编造"一致"
        refComment = "外部参考对照结果缺失，以下分析未参考外部资料";
      }
    }

    return NextResponse.json({
      input_type: finalType,
      step1_subject_verb:
        typeof parsed.step1_subject_verb === "string"
          ? parsed.step1_subject_verb
          : "",
      step2_nouns:
        typeof parsed.step2_nouns === "string" ? parsed.step2_nouns : "",
      step3_other:
        typeof parsed.step3_other === "string" ? parsed.step3_other : "",
      errors: finalType === "quiz" ? [] : errors,
      reference_check: { status: refStatus, comment: refComment.slice(0, 600) },
      quiz,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败，请重试" },
      { status: 500 }
    );
  }
}
