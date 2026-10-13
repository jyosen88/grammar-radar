/** user_records.analysis_result 的共享解析工具：记录列表页 / 知识点归因页共用 */

export interface AnalysisErrorLike {
  original?: string;
  corrected?: string;
  knowledge_point?: string;
}

/** analysis_result 可能被存成字符串（列类型 text 而非 jsonb），统一解析 */
export function safeParseAnalysisResult(ar: unknown): Record<string, unknown> {
  if (typeof ar === "string") {
    try {
      return JSON.parse(ar) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return (ar as Record<string, unknown>) ?? {};
}

/** 提取一条记录涉及的所有知识点（去重）：优先 knowledge_points 字段，兜底从 analysis_result 里提取 */
export function extractRecordKps(
  rawAr: unknown,
  kps: string[] | null | undefined
): string[] {
  if (kps && kps.length > 0) return [...new Set(kps)];
  const ar = safeParseAnalysisResult(rawAr);
  const list: string[] = [];
  const quiz = ar.quiz as Record<string, unknown> | undefined;
  if (quiz && typeof quiz.knowledge_point === "string" && quiz.knowledge_point) {
    list.push(quiz.knowledge_point);
  }
  const errLists: unknown[] = [];
  if (Array.isArray(ar.errors)) errLists.push(...ar.errors);
  const result = ar.result as Record<string, unknown> | undefined;
  if (result && Array.isArray(result.errors)) errLists.push(...result.errors);
  for (const e of errLists) {
    const kp = (e as AnalysisErrorLike)?.knowledge_point;
    if (kp) list.push(kp);
  }
  return [...new Set(list)];
}

/** 某个知识点下的具体错误条目 */
export interface KpErrorItem {
  /** error=错误写法→改后；quiz=选择题正确答案；question=长难句步骤题+答案 */
  kind: "error" | "quiz" | "question";
  /** 错误原文 / 题目（quiz 类型为空，题干即记录的 input_text） */
  wrong: string;
  /** 改后写法 / 正确答案 */
  right: string;
}

/** 提取一条记录中指定知识点的具体错误（原文→改后 / 题目→答案） */
export function getKpErrorItems(rawAr: unknown, kp: string): KpErrorItem[] {
  const ar = safeParseAnalysisResult(rawAr);
  const items: KpErrorItem[] = [];

  const pickError = (e: unknown) => {
    const err = e as AnalysisErrorLike;
    if (err?.knowledge_point === kp && err.original && err.corrected) {
      items.push({ kind: "error", wrong: err.original, right: err.corrected });
    }
  };
  if (Array.isArray(ar.errors)) ar.errors.forEach(pickError);
  const result = ar.result as Record<string, unknown> | undefined;
  if (result && Array.isArray(result.errors)) {
    (result.errors as unknown[]).forEach(pickError);
  }

  // 选择题解析记录：题干即 input_text，这里补充正确答案
  const quiz = ar.quiz as Record<string, unknown> | undefined;
  if (quiz && quiz.knowledge_point === kp) {
    const letter = typeof quiz.answer_letter === "string" ? quiz.answer_letter : "";
    const ansText = typeof quiz.answer_text === "string" ? quiz.answer_text : "";
    items.push({ kind: "quiz", wrong: "", right: ansText ? `${letter}. ${ansText}` : letter });
  }

  // 长难句记录：分步题目中该知识点的题目 + 正确答案
  if (Array.isArray(ar.steps)) {
    for (const s of ar.steps as Record<string, unknown>[]) {
      if (!Array.isArray(s?.questions)) continue;
      for (const q of s.questions as Record<string, unknown>[]) {
        if (q?.knowledge_point === kp && typeof q.question === "string") {
          items.push({
            kind: "question",
            wrong: q.question,
            right: typeof q.correct_answer === "string" ? q.correct_answer : "",
          });
        }
      }
    }
  }
  return items;
}
