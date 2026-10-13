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
 * 去掉 AI 偶尔加在选项/答案开头的 "A. ""B、" 字母前缀（前端会自行渲染字母标签）。
 * 只剥离"单个字母 + 分隔符"的形式，不影响 "a"（不定冠词）、"/"（零冠词）等正常选项。
 */
function stripLetterPrefix(s: string): string {
  const stripped = s.replace(/^\(?[A-Da-d][.、,)）：:]\s*/, "").trim();
  return stripped || s;
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
      const answerRaw = typeof ex.answer === "string" ? ex.answer.trim() : "";
      if (!question || !answerRaw) return null;
      const isFill = ex.type === "fill";
      const options = Array.isArray(ex.options)
        ? ex.options
            .filter((o): o is string => typeof o === "string" && !!o.trim())
            .map((o) => stripLetterPrefix(o.trim()))
        : [];
      const answer = stripLetterPrefix(answerRaw);
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

/**
 * 修复 AI 输出 JSON 中字符串内部未转义的控制字符
 * （模型偶尔在字符串里直接输出换行/制表符，JSON.parse 会报
 * "Bad control character in string literal in JSON"）
 * 只处理字符串字面量内部的控制字符，字符串外的换行缩进是合法空白，保持原样
 */
function sanitizeControlChars(json: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    // 字符串内部：转义序列原样保留（\" \\ \n 等）
    if (ch === "\\") {
      out += ch + (json[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code === 10) out += "\\n";
    else if (code === 13) out += "\\r";
    else if (code === 9) out += "\\t";
    else if (code < 32) out += "\\u" + code.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out;
}

/** 尝试从 AI 文本中提取 JSON（兼容模型偶尔在 JSON 外加说明文字） */
export function parseLooseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    // 先尝试修复字符串内部的控制字符再解析
    try {
      return JSON.parse(sanitizeControlChars(content));
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI 返回内容无法解析为 JSON");
      return JSON.parse(sanitizeControlChars(m[0]));
    }
  }
}
