/**
 * 变式练习题的共享类型与 AI 返回数据清洗工具
 * 被 /api/essay（作文分析时现场出题）和 /api/practice（生成更多题）复用
 */

export interface Exercise {
  type: "choice" | "fill";
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

interface RawExercise {
  type?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
}

/**
 * 把 AI 返回的练习题数组逐题清洗：
 * - 题干/答案缺失直接丢弃
 * - 选择题至少 2 个选项且答案必须在选项中，否则降级为填空题
 * - 默认最多保留 max 道
 */
export function normalizeExercises(raw: unknown, max = 3): Exercise[] {
  const rawList = Array.isArray(raw) ? (raw as RawExercise[]) : [];
  return rawList
    .map((ex) => {
      const question =
        typeof ex.question === "string" ? ex.question.trim() : "";
      const answer = typeof ex.answer === "string" ? ex.answer.trim() : "";
      if (!question || !answer) return null;
      const isFill = ex.type === "fill";
      const options = Array.isArray(ex.options)
        ? ex.options
            .filter((o): o is string => typeof o === "string" && !!o.trim())
            .map((o) => o.trim())
        : [];
      const validChoice =
        !isFill && options.length >= 2 && options.includes(answer);
      return {
        type: validChoice ? ("choice" as const) : ("fill" as const),
        question,
        options: validChoice ? options : [],
        answer,
        explanation:
          typeof ex.explanation === "string" ? ex.explanation.trim() : "",
      };
    })
    .filter((e): e is Exercise => e !== null)
    .slice(0, max);
}

/** 尝试从 AI 文本中提取 JSON（兼容模型偶尔在 JSON 外加说明文字） */
export function parseLooseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("AI 返回内容无法解析为 JSON");
    return JSON.parse(m[0]);
  }
}
