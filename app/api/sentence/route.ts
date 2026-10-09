import { NextRequest, NextResponse } from "next/server";
import { parseLooseJson } from "@/lib/exercise";
import { KNOWLEDGE_POINT_SECTION } from "@/lib/knowledge-points";

const SYSTEM_PROMPT = `你是一名中学英语语法老师，擅长把英语长难句拆解成"分步引导"练习题，引导学生一步一步理解句子结构。

任务：收到一个英语长难句后，把它拆成 4-5 个步骤的引导题，让学生通过答题理解句子主干、从句、修饰关系和句意。每个步骤包含一道或多道四选一选择题。

拆解原则（必须遵守）：
1. 步骤数量在 4-5 之间；如果句子较短或结构简单，可以只出 4 步；结构复杂的（嵌套从句、多个修饰成分）可以出 5 步；同一 step 下可以并列多道题（例如"主句主语 + 主句宾语"两道），都放在该 step 的 questions 数组里
2. 步骤顺序必须按"由表及里、先主干后细节"的认知顺序：
   - Step 1：找主句谓语动词（让学生先把主干谓语挑出来）
   - Step 2：找主句主语和宾语（主干核心名词）
   - Step 3：识别从句和修饰成分（判断从句类型）
   - Step 4：理清修饰关系（从句修饰哪个先行词）
   - Step 5：理解句意（整句主干意思）
   简单句可以省略不需要的步骤，但顺序不能乱
3. 每道题 4 个选项，只有一个正确答案，干扰项必须来自原句中真实存在的词或结构（不能凭空造词），让学生在真实句子里做选择
4. hint 是答错时的提示，要"指方向但不给答案"——例如提示"主句谓语不在从句里"，而不是直接说"答案是 revealed"
5. knowledge_point 必须严格遵守文末【标准知识点标签清单】的选择规则，从清单中逐字选取；优先选"句法 -"开头的标签（主语部分/谓语部分/宾语部分/定语部分/状语部分），从句类问题选"从句 -"开头的标签；若清单无完全匹配的可加"（待补充）"后缀
6. correct_answer 必须是 options 中的某一项的完整文本（不是字母），保证前端能直接对照
7. structure_tree 是 ASCII 树状结构图，用 └── ├── │  等字符画出主句、从句、修饰成分之间的层级关系；每行末尾用括号注明成分类型（修饰 The research 等）；中文标注，英文原句片段保留英文
8. summary 是一句中文翻译/总结，简洁讲清主干意思
9. exercises 是 3 道举一反三变式练习题，基于本句最核心的知识点（通常是嵌套定语从句、从句修饰关系等"句法 -"或"从句 -"知识点）。要求：
   - 每题都考与原句同一个核心知识点，但用全新的英文句子（与原句完全不同的词汇和场景）
   - 题型为四选一单项选择题，句中用 ____ 表示空格
   - 每题的 4 个选项中只有一个正确答案，answer 必须与 options 中某一项完全一致
   - 解析 explanation 是一句中文，讲清考点并指向正确答案
   - 3 道题的句子结构要有变化（不能都用同一种句式），但都要考同一个知识点
   - 不能复用原句的名词、动词、形容词（除非该词本身就是知识点考查的核心对象）
   - 专有名词红线：行星名（Mercury/Venus/Mars/Jupiter/Saturn 等）和人名前不加 the；本身需带 the 的（the United States、the Yangtze River、the Pacific、the Alps、the North Star 等）不在此列
   - 每题出题前先确定唯一正确答案，出题后把正确答案和每个错误选项分别代入验证：正确项必须通顺，错误项必须确实错误；答案方向必须与 explanation 一致

${KNOWLEDGE_POINT_SECTION}

============================================================
【输出格式】严格按照以下 JSON 返回，不要输出任何其他内容。中文说明用中文，英文原句片段保留英文。

{
  "steps": [
    {
      "step": 1,
      "stage": "找主句谓语动词",
      "questions": [
        {
          "question": "这句话主句的谓语动词是哪个？",
          "options": ["A. was conducted", "B. included", "C. revealed", "D. 没有"],
          "correct_answer": "C. revealed",
          "hint": "主句的谓语动词不在 that 引导的从句里。was conducted 和 included 都在 that 引导的从句里，只有 revealed 是主句的谓语。",
          "knowledge_point": "句法 - 谓语部分（47种类型）"
        }
      ]
    },
    {
      "step": 2,
      "stage": "找主句主语和宾语",
      "questions": [
        {
          "question": "主句的主语是什么？",
          "options": ["A. The research", "B. a team", "C. scientists", "D. a surprising finding"],
          "correct_answer": "A. The research",
          "hint": "主语是谓语动词 revealed 的发出者，The research 是整个句子的核心名词。",
          "knowledge_point": "句法 - 主语部分（12种类型）"
        },
        {
          "question": "主句的宾语是什么？",
          "options": ["A. a team", "B. a surprising finding", "C. climate change", "D. three different countries"],
          "correct_answer": "B. a surprising finding",
          "hint": "宾语是谓语动词 revealed 的接受者。",
          "knowledge_point": "句法 - 宾语部分"
        }
      ]
    }
  ],
  "structure_tree": "主句：The research revealed a surprising finding.\n  ├── 定语从句1：that was conducted by a team（修饰 The research）\n  │     └── 定语从句2：that included scientists from three different countries（修饰 a team）\n  └── 介词短语：about climate change（修饰 a finding）",
  "summary": "这项由一支包含来自三个不同国家的科学家的团队所进行的研究，揭示了一个关于气候变化的惊人发现。",
  "exercises": [
    {
      "type": "choice",
      "question": "The book that was written by an author who lived in the 19th century became a bestseller. 句中 who lived in the 19th century 修饰的是哪个词？",
      "options": ["A. The book", "B. an author", "C. a bestseller", "D. the 19th century"],
      "answer": "B. an author",
      "explanation": "who lived in the 19th century 是定语从句，紧跟在 an author 后面修饰它。"
    }
  ]
}

【铁律】
- steps 至少 4 步，最多 5 步；每步至少 1 道题，最多 3 道题
- 每道题的 options 必须 4 个，correct_answer 必须是 options 中某一项的完整文本（包含字母前缀）
- correct_answer 不能只写字母，必须写完整文本如 "C. revealed"，方便前端对照
- exercises 必须 3 道，全部是四选一单项选择题；answer 必须与 options 中某一项完全一致
- structure_tree 必须用 ASCII 树状字符（├── └── │），保留英文原句片段，中文标注成分类型
- 知识点必须从清单中逐字选取，禁止自造`;

export interface SentenceQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  hint: string;
  knowledge_point: string;
}
export interface SentenceStep {
  step: number;
  stage: string;
  questions: SentenceQuestion[];
}
export interface SentenceExercise {
  type: "choice";
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 DEEPSEEK_API_KEY 环境变量" },
      { status: 500 }
    );
  }

  let text = "";
  try {
    const body = await req.json();
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "请输入要分析的英文长难句" }, { status: 400 });
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
        max_tokens: 8000,
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
      steps?: unknown;
      structure_tree?: unknown;
      summary?: unknown;
      exercises?: unknown;
    };

    // 清洗 steps
    const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    const steps: SentenceStep[] = rawSteps
      .map((s, sIdx) => {
        const step =
          s && typeof s === "object"
            ? (s as Record<string, unknown>)
            : null;
        if (!step) return null;
        const stage =
          typeof step.stage === "string" ? step.stage.trim() : `步骤 ${sIdx + 1}`;
        const rawQs = Array.isArray(step.questions) ? step.questions : [];
        const questions: SentenceQuestion[] = rawQs
          .map((q) => {
            const item =
              q && typeof q === "object"
                ? (q as Record<string, unknown>)
                : null;
            if (!item) return null;
            const question =
              typeof item.question === "string" ? item.question.trim() : "";
            const options = Array.isArray(item.options)
              ? item.options
                  .filter((o): o is string => typeof o === "string" && !!o.trim())
                  .map((o) => o.trim())
              : [];
            const correctAnswer =
              typeof item.correct_answer === "string"
                ? item.correct_answer.trim()
                : "";
            const hint = typeof item.hint === "string" ? item.hint.trim() : "";
            const knowledgePoint =
              typeof item.knowledge_point === "string"
                ? item.knowledge_point.trim()
                : "";
            if (!question || options.length < 2 || !correctAnswer) return null;
            // 校验 correct_answer 必须在 options 中
            if (!options.includes(correctAnswer)) return null;
            return {
              question,
              options,
              correct_answer: correctAnswer,
              hint,
              knowledge_point: knowledgePoint,
            };
          })
          .filter((q): q is SentenceQuestion => q !== null);
        if (questions.length === 0) return null;
        return {
          step: typeof step.step === "number" ? step.step : sIdx + 1,
          stage,
          questions,
        };
      })
      .filter((s): s is SentenceStep => s !== null);

    const structureTree =
      typeof parsed?.structure_tree === "string"
        ? parsed.structure_tree.trim()
        : "";
    const summary =
      typeof parsed?.summary === "string" ? parsed.summary.trim() : "";

    // 清洗 exercises（举一反三变式练习）
    const rawExs = Array.isArray(parsed?.exercises) ? parsed.exercises : [];
    const exercises = rawExs
      .map((ex) => {
        const item =
          ex && typeof ex === "object"
            ? (ex as Record<string, unknown>)
            : null;
        if (!item) return null;
        const question =
          typeof item.question === "string" ? item.question.trim() : "";
        const options = Array.isArray(item.options)
          ? item.options
              .filter((o): o is string => typeof o === "string" && !!o.trim())
              .map((o) => o.trim())
          : [];
        const answer =
          typeof item.answer === "string" ? item.answer.trim() : "";
        const explanation =
          typeof item.explanation === "string" ? item.explanation.trim() : "";
        if (!question || options.length < 2 || !answer) return null;
        if (!options.includes(answer)) return null;
        return {
          type: "choice" as const,
          question,
          options,
          answer,
          explanation,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .slice(0, 3);

    if (steps.length === 0) {
      return NextResponse.json(
        { error: "AI 未能拆解出有效步骤，请换一句更长的英文长难句再试" },
        { status: 422 }
      );
    }

    return NextResponse.json({
      steps,
      structure_tree: structureTree,
      summary,
      exercises,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "分析失败，请重试" },
      { status: 500 }
    );
  }
}
