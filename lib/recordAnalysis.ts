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

/** 长难句分步题的答题状态（qStates 的值） */
interface SentenceQState {
  status?: string;
  attempts?: number;
}

/** 从 analysis_result 里取 qStates（缺失或为空时返回 null） */
function sentenceQStates(ar: Record<string, unknown>): Record<string, SentenceQState> | null {
  const qs = ar.qStates;
  if (qs && typeof qs === "object" && Object.keys(qs as object).length > 0) {
    return qs as Record<string, SentenceQState>;
  }
  return null;
}

/** 判断长难句分步题是否真正答错（错过至少一次：错 1 次后答对，或错两次揭示答案；首次答对不算错题） */
function isSentenceQWrong(st: SentenceQState | undefined): boolean {
  if (!st || typeof st.status !== "string") return false;
  if (st.status === "revealed") return true;
  if (st.status === "wrong1" || st.status === "wrong2") return true;
  // 首次就答对 attempts=1；错 1 次后答对 attempts=2
  if (st.status === "correct") return (typeof st.attempts === "number" ? st.attempts : 1) >= 2;
  return false;
}

/** 提取一条记录涉及的所有知识点（去重）：优先 knowledge_points 字段，兜底从 analysis_result 里提取 */
export function extractRecordKps(
  rawAr: unknown,
  kps: string[] | null | undefined
): string[] {
  const ar = safeParseAnalysisResult(rawAr);
  // 长难句记录：只统计真正答错的题目所涉及的知识点（首次答对的不算错题）；
  // qStates 缺失的旧记录没有答题状态，走下方通用兜底
  if (ar.type === "sentence" && Array.isArray(ar.steps)) {
    const qStates = sentenceQStates(ar);
    if (qStates) {
      const list: string[] = [];
      (ar.steps as Record<string, unknown>[]).forEach((s, sIdx) => {
        if (!Array.isArray(s?.questions)) return;
        (s.questions as Record<string, unknown>[]).forEach((q, qIdx) => {
          const kp = q?.knowledge_point;
          if (typeof kp !== "string" || !kp) return;
          if (!isSentenceQWrong(qStates[`${sIdx}-${qIdx}`])) return;
          list.push(kp);
        });
      });
      return [...new Set(list)];
    }
  }
  if (kps && kps.length > 0) return [...new Set(kps)];
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

  // 长难句记录：只列出真正答错的分步题（首次答对的不算错题）
  if (Array.isArray(ar.steps)) {
    const qStates = sentenceQStates(ar);
    (ar.steps as Record<string, unknown>[]).forEach((s, sIdx) => {
      if (!Array.isArray(s?.questions)) return;
      (s.questions as Record<string, unknown>[]).forEach((q, qIdx) => {
        if (q?.knowledge_point !== kp || typeof q.question !== "string") return;
        if (qStates && !isSentenceQWrong(qStates[`${sIdx}-${qIdx}`])) return;
        items.push({
          kind: "question",
          wrong: q.question,
          right: typeof q.correct_answer === "string" ? q.correct_answer : "",
        });
      });
    });
  }
  return items;
}
