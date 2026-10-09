"use client";

import { useEffect, useRef, useState } from "react";
import { Network, Send, RotateCcw, ChevronRight, Check, X, Lightbulb, BookOpen, Target, TreePine } from "lucide-react";
import { getSupabase, getStoredSession } from "@/lib/supabase";
import { SiteNav } from "@/components/SiteNav";
import type { User } from "@supabase/supabase-js";

interface SentenceQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  hint: string;
  knowledge_point: string;
}
interface SentenceStep {
  step: number;
  stage: string;
  questions: SentenceQuestion[];
}
interface SentenceExercise {
  type: "choice";
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}
interface SentenceResult {
  steps: SentenceStep[];
  structure_tree: string;
  summary: string;
  exercises: SentenceExercise[];
}

type QStatus = "pending" | "correct" | "wrong1" | "wrong2" | "revealed";
interface QState {
  picked: string | null;
  attempts: number;
  status: QStatus;
}

/** 把所有 step 的 questions 平铺成一条流水线，并保留每个题所在的 step 下标 */
function flatten(result: SentenceResult): { stepIdx: number; qIdx: number }[] {
  const list: { stepIdx: number; qIdx: number }[] = [];
  result.steps.forEach((_, sIdx) => {
    _.questions.forEach((__, qIdx) => list.push({ stepIdx: sIdx, qIdx }));
  });
  return list;
}

export function SentenceTool() {
  const [user, setUser] = useState<User | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<SentenceResult | null>(null);
  const [originalSentence, setOriginalSentence] = useState("");

  // 当前展示的 step 下标（0-based）
  const [curStep, setCurStep] = useState(0);
  // 每道题的状态，key = `${sIdx}-${qIdx}`
  const [qStates, setQStates] = useState<Record<string, QState>>({});
  // 是否已进入总结页
  const [showSummary, setShowSummary] = useState(false);
  // 举一反三练习状态
  const [exPicked, setExPicked] = useState<string[]>([]);
  const [exChecked, setExChecked] = useState<boolean[]>([]);
  // 记录是否已保存
  const [savedRecord, setSavedRecord] = useState(false);

  const topRef = useRef<HTMLDivElement>(null);
  const stepTopRef = useRef<HTMLDivElement>(null);

  // 登录态同步
  useEffect(() => {
    const sb = getSupabase();
    const cached = getStoredSession()?.user;
    if (cached?.id) {
      setUser({ id: cached.id, email: cached.email ?? null } as User);
    }
    sb.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // 切换 step / 切换到总结页时，把 step 顶部滚回视口
  useEffect(() => {
    if (result) {
      requestAnimationFrame(() =>
        stepTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    }
  }, [curStep, showSummary, result]);

  function resetAll() {
    setResult(null);
    setQStates({});
    setCurStep(0);
    setShowSummary(false);
    setExPicked([]);
    setExChecked([]);
    setSavedRecord(false);
    setError(null);
  }

  async function handleAnalyze(overrideText?: string) {
    const targetText = (overrideText ?? text).trim();
    if (!targetText) {
      setError("请输入要分析的英文长难句");
      return;
    }
    // 如果是外部传入的文本（来自题库），同步更新输入框
    if (overrideText !== undefined) setText(targetText);
    setBusy(true);
    setBusyHint("AI 正在拆解长难句…");
    setError(null);
    resetResultState();
    try {
      const res = await fetch("/api/sentence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: targetText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "分析失败，请重试");
        return;
      }
      const r = data as SentenceResult;
      if (!r.steps || r.steps.length === 0) {
        setError("AI 未能拆解出有效步骤，请换一句更长的英文长难句再试");
        return;
      }
      setResult(r);
      setOriginalSentence(targetText);
      setCurStep(0);
      setShowSummary(false);
      requestAnimationFrame(() =>
        topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  /** 从题库随机抽一句，自动填入并立即分析 */
  async function handlePickFromBank() {
    // 先清空旧结果，给即时视觉反馈（避免总结页/答题页"假死"）
    resetAll();
    setBusy(true);
    setBusyHint("正在从题库抽取长难句…");
    setError(null);
    try {
      const res = await fetch("/api/sentence-bank");
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "题库服务暂时不可用，请稍后再试");
        return;
      }
      const sentence = data?.sentence as string | null;
      if (!sentence) {
        setError("题库暂未导入，请先上传长难句");
        return;
      }
      // 拿到句子后立即分析（同步 setText + 传参给 handleAnalyze 避免异步 state 问题）
      await handleAnalyze(sentence);
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  function resetResultState() {
    setResult(null);
    setQStates({});
    setShowSummary(false);
    setExPicked([]);
    setExChecked([]);
    setSavedRecord(false);
  }

  function keyOf(sIdx: number, qIdx: number) {
    return `${sIdx}-${qIdx}`;
  }

  function pickOption(sIdx: number, qIdx: number, opt: string) {
    const k = keyOf(sIdx, qIdx);
    const cur = qStates[k] ?? { picked: null, attempts: 0, status: "pending" as QStatus };
    if (cur.status === "correct" || cur.status === "revealed") return;
    const step = result!.steps[sIdx];
    const q = step.questions[qIdx];
    const isCorrect = opt === q.correct_answer;
    const nextAttempts = cur.attempts + 1;
    let nextStatus: QStatus;
    if (isCorrect) {
      nextStatus = "correct";
    } else if (nextAttempts >= 2) {
      nextStatus = "revealed";
    } else {
      nextStatus = "wrong1";
    }
    setQStates((prev) => ({
      ...prev,
      [k]: { picked: opt, attempts: nextAttempts, status: nextStatus },
    }));
  }

  function stepCompleted(sIdx: number): boolean {
    const step = result!.steps[sIdx];
    return step.questions.every((_, qIdx) => {
      const st = qStates[keyOf(sIdx, qIdx)]?.status;
      return st === "correct" || st === "revealed";
    });
  }

  function allStepsCompleted(): boolean {
    return result!.steps.every((_, sIdx) => stepCompleted(sIdx));
  }

  function goNextStep() {
    if (curStep < result!.steps.length - 1) {
      setCurStep(curStep + 1);
    } else {
      // 全部完成，进入总结页
      setShowSummary(true);
    }
  }

  // 完成全部步骤后保存一次记录
  useEffect(() => {
    if (!result || !showSummary || savedRecord) return;
    void saveRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSummary, result]);

  async function saveRecord() {
    const {
      data: { user: currentUser },
    } = await getSupabase().auth.getUser();
    if (!currentUser) {
      setError("记录未保存：请先登录后再进行分析");
      return;
    }
    // 收集所有知识点（去重）
    const kps: string[] = [];
    result!.steps.forEach((s) => {
      s.questions.forEach((q) => {
        if (q.knowledge_point && !kps.includes(q.knowledge_point)) {
          kps.push(q.knowledge_point);
        }
      });
    });
    // 答题统计
    const flat = flatten(result!);
    const correctCount = flat.filter(({ stepIdx, qIdx }) => {
      const st = qStates[keyOf(stepIdx, qIdx)]?.status;
      return st === "correct";
    }).length;
    const revealedCount = flat.filter(({ stepIdx, qIdx }) => {
      const st = qStates[keyOf(stepIdx, qIdx)]?.status;
      return st === "revealed";
    }).length;

    const analysisResult = {
      type: "sentence",
      original: originalSentence,
      steps: result!.steps,
      structure_tree: result!.structure_tree,
      summary: result!.summary,
      exercises: result!.exercises,
      stats: {
        total: flat.length,
        correct_first_or_second_try: correctCount,
        revealed_after_two_wrong: revealedCount,
      },
      qStates,
    };

    const { error: insErr } = await getSupabase()
      .from("user_records")
      .insert({
        user_id: currentUser.id,
        input_text: originalSentence.slice(0, 4000),
        analysis_result: JSON.parse(JSON.stringify(analysisResult)),
        knowledge_points: kps,
      });
    if (insErr) {
      setError(`记录保存失败：${insErr.message}（分析结果不受影响）`);
    } else {
      setSavedRecord(true);
    }
  }

  // 举一反三练习：点击选项
  function pickExercise(exIdx: number, opt: string) {
    if (exChecked[exIdx]) return;
    setExPicked((prev) => {
      const next = [...prev];
      next[exIdx] = opt;
      return next;
    });
  }
  function checkExercise(exIdx: number) {
    if (!exPicked[exIdx]) return;
    setExChecked((prev) => {
      const next = [...prev];
      next[exIdx] = true;
      return next;
    });
  }

  // ============ 渲染 ============
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#efe6fe] via-[#f5f0fe] to-[#f8f5fe]">
      <SiteNav />
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <div ref={topRef} />
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100">
            <Network className="h-6 w-6 text-indigo-600" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-blue-950">长难句分析</h1>
            <p className="text-xs text-slate-500">
              把长难句拆成 4-5 个引导步骤，分步答题理清句子结构
            </p>
          </div>
        </div>

        {/* 输入区 */}
        {!result && (
          <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
            {/* 两个入口按钮 */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={handlePickFromBank}
                className="group inline-flex flex-col items-start gap-1 rounded-xl border border-violet-200 bg-[#fdfbff] p-3 text-left transition hover:border-violet-400 hover:bg-violet-50 disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-800">
                  <span className="text-base">📚</span> 从题库选题
                </span>
                <span className="text-xs text-slate-500">随机抽一句，立即开始分析</span>
              </button>
              <div className="inline-flex flex-col items-start gap-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                  <span className="text-base">✍️</span> 手动输入
                </span>
                <span className="text-xs text-slate-500">粘贴或输入长难句，点击下方按钮</span>
              </div>
            </div>

            <label className="mt-4 block text-sm font-semibold text-slate-800">
              输入或粘贴一个英文长难句
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="例如：The research that was conducted by a team that included scientists from three different countries revealed a surprising finding about climate change."
              rows={5}
              className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {user ? (
                  <>已登录，分析完成后会自动保存到「我的记录」</>
                ) : (
                  <>未登录可继续分析，但不会保存记录</>
                )}
              </p>
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={() => handleAnalyze()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:from-indigo-700 hover:to-violet-700 active:scale-95 disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    {busyHint || "分析中…"}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    开始拆解
                  </>
                )}
              </button>
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                ⚠️ {error}
              </p>
            )}
          </div>
        )}

        {/* 结果区：分步答题 */}
        {result && !showSummary && (
          <div ref={stepTopRef} className="space-y-4">
            {/* 进度条 */}
            <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>
                  第 <span className="font-semibold text-violet-700">{curStep + 1}</span> / {result.steps.length} 步
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("确定要重新分析另一句吗？当前进度不会保存。")) {
                      setText("");
                      resetAll();
                    }
                  }}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-700"
                >
                  <RotateCcw className="h-3 w-3" /> 换一句
                </button>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                  style={{
                    width: `${((curStep + (stepCompleted(curStep) ? 1 : 0)) / result.steps.length) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {result.steps.map((s, i) => {
                  const done = stepCompleted(i);
                  const isCur = i === curStep;
                  return (
                    <span
                      key={i}
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        isCur
                          ? "bg-violet-600 text-white"
                          : done
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {done && !isCur ? "✅ " : ""}{s.stage}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* 原句 */}
            <div className="rounded-2xl border border-slate-200 bg-[#fdfbff] p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">📌 原句</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-800">
                {originalSentence}
              </p>
            </div>

            {/* 当前 step 的题目 */}
            {result.steps
              .filter((_, i) => i === curStep)
              .map((step, sIdx) => (
                <div key={sIdx} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-xs font-bold text-white">
                      {step.step}
                    </span>
                    <h2 className="text-base font-semibold text-slate-900">{step.stage}</h2>
                  </div>
                  {step.questions.map((q, qIdx) => {
                    const k = keyOf(curStep, qIdx);
                    const st = qStates[k] ?? { picked: null, attempts: 0, status: "pending" as QStatus };
                    return (
                      <SentenceQuestionCard
                        key={qIdx}
                        qIdx={qIdx}
                        q={q}
                        state={st}
                        onPick={(opt) => pickOption(curStep, qIdx, opt)}
                      />
                    );
                  })}
                </div>
              ))}

            {/* 下一步按钮 */}
            {stepCompleted(curStep) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={goNextStep}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-indigo-700 hover:to-violet-700 active:scale-95"
                >
                  {curStep < result.steps.length - 1 ? (
                    <>下一步 <ChevronRight className="h-4 w-4" /></>
                  ) : (
                    <>查看完整解析 <TreePine className="h-4 w-4" /></>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 总结页 */}
        {result && showSummary && (
          <SentenceSummary
            result={result}
            originalSentence={originalSentence}
            qStates={qStates}
            exPicked={exPicked}
            exChecked={exChecked}
            onPickExercise={pickExercise}
            onCheckExercise={checkExercise}
            onPickBank={handlePickFromBank}
            onRestart={() => {
              setText("");
              resetAll();
            }}
            saved={savedRecord}
            saveError={error}
          />
        )}

        {busy && !result && (
          <div className="rounded-2xl border border-violet-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
            <p className="mt-3 text-sm text-slate-500">{busyHint || "AI 分析中…"}</p>
          </div>
        )}
      </main>
    </div>
  );
}

// ============ 单题卡片 ============
function SentenceQuestionCard({
  qIdx,
  q,
  state,
  onPick,
}: {
  qIdx: number;
  q: SentenceQuestion;
  state: QState;
  onPick: (opt: string) => void;
}) {
  const locked = state.status === "correct" || state.status === "revealed";
  return (
    <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-800">
        <span className="mr-1 text-violet-600">Q{qIdx + 1}.</span>
        {q.question}
      </p>
      <div className="mt-3 space-y-1.5">
        {q.options.map((opt) => {
          const isAnswer = opt === q.correct_answer;
          const isPicked = state.picked === opt;
          let cls =
            "border-slate-200 bg-white text-slate-700 hover:border-violet-400 hover:bg-violet-50";
          if (locked) {
            if (isAnswer)
              cls = "border-emerald-500 bg-emerald-50 text-emerald-800";
            else if (isPicked)
              cls = "border-red-400 bg-red-50 text-red-700";
            else cls = "border-slate-200 bg-white text-slate-400";
          } else if (isPicked && state.status === "wrong1") {
            cls = "border-red-400 bg-red-50 text-red-700";
          }
          return (
            <button
              key={opt}
              type="button"
              disabled={locked}
              onClick={() => onPick(opt)}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-default ${cls}`}
            >
              <span className="flex-1">{opt}</span>
              {locked && isAnswer && <Check className="h-4 w-4" />}
              {locked && !isAnswer && isPicked && <X className="h-4 w-4" />}
            </button>
          );
        })}
      </div>

      {/* 反馈 */}
      {state.status === "correct" && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          ✅ 答对了！{q.knowledge_point && (
            <span className="ml-1 text-emerald-600">· 知识点：{q.knowledge_point}</span>
          )}
        </div>
      )}
      {state.status === "wrong1" && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Lightbulb className="mr-1 inline h-3.5 w-3.5" />
          还不太对，再试一次。提示：{q.hint || "再仔细看看句子结构。"}
        </div>
      )}
      {state.status === "revealed" && (
        <div className="mt-3 space-y-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          <p>
            ❌ 正确答案：<span className="font-semibold">{q.correct_answer}</span>
            {q.knowledge_point && (
              <span className="ml-1 text-red-600">· 知识点：{q.knowledge_point}</span>
            )}
          </p>
          <p className="text-slate-700">💡 {q.hint || "再仔细看看句子结构。"}</p>
        </div>
      )}
    </div>
  );
}

// ============ 总结页 ============
function SentenceSummary({
  result,
  originalSentence,
  qStates,
  exPicked,
  exChecked,
  onPickExercise,
  onCheckExercise,
  onPickBank,
  onRestart,
  saved,
  saveError,
}: {
  result: SentenceResult;
  originalSentence: string;
  qStates: Record<string, QState>;
  exPicked: string[];
  exChecked: boolean[];
  onPickExercise: (exIdx: number, opt: string) => void;
  onCheckExercise: (exIdx: number) => void;
  onPickBank: () => void;
  onRestart: () => void;
  saved: boolean;
  saveError: string | null;
}) {
  // 统计
  let correct = 0;
  let revealed = 0;
  let total = 0;
  result.steps.forEach((s, sIdx) => {
    s.questions.forEach((_, qIdx) => {
      total++;
      const st = qStates[`${sIdx}-${qIdx}`]?.status;
      if (st === "correct") correct++;
      else if (st === "revealed") revealed++;
    });
  });

  return (
    <div className="space-y-5">
      {/* 顶部答题统计 */}
      <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
            <Check className="h-5 w-5 text-emerald-600" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-slate-900">完成全部 {result.steps.length} 个步骤</h2>
            <p className="text-xs text-slate-500">
              共 {total} 道题，答对 <span className="font-semibold text-emerald-600">{correct}</span> 道，
              错两次后揭示 <span className="font-semibold text-red-600">{revealed}</span> 道
            </p>
          </div>
        </div>
        {saved && (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
            ✅ 已保存到「我的记录」，可在知识点错误排行中查看
          </p>
        )}
        {saveError && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
            ⚠️ {saveError}
          </p>
        )}
      </div>

      {/* 原句 */}
      <div className="rounded-2xl border border-slate-200 bg-[#fdfbff] p-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500">📌 原句</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-800">{originalSentence}</p>
      </div>

      {/* 句子结构图 */}
      {result.structure_tree && (
        <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <TreePine className="h-5 w-5 text-violet-600" />
            <h3 className="text-base font-semibold text-slate-900">句子结构图</h3>
          </div>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-[#f8f5fe] p-4 text-xs leading-relaxed text-slate-800">
            {result.structure_tree}
          </pre>
        </div>
      )}

      {/* 一句总结 */}
      {result.summary && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-indigo-900">一句总结</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-indigo-800">{result.summary}</p>
        </div>
      )}

      {/* 举一反三练习 */}
      {result.exercises.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-violet-600" />
            <h3 className="text-base font-semibold text-slate-900">举一反三练习</h3>
            <span className="text-xs text-slate-500">（共 {result.exercises.length} 道）</span>
          </div>
          <div className="mt-4 space-y-4">
            {result.exercises.map((ex, i) => (
              <ExerciseCard
                key={i}
                idx={i}
                ex={ex}
                picked={exPicked[i] ?? null}
                checked={exChecked[i] ?? false}
                onPick={(opt) => onPickExercise(i, opt)}
                onCheck={() => onCheckExercise(i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 操作 */}
      <div className="flex justify-center gap-3">
        <button
          type="button"
          onClick={onPickBank}
          className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 bg-white px-5 py-2.5 text-sm font-medium text-violet-700 shadow-sm transition hover:bg-violet-50 active:scale-95"
        >
          <span className="text-base">📚</span> 换一句（题库）
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-indigo-700 hover:to-violet-700 active:scale-95"
        >
          <RotateCcw className="h-4 w-4" /> 手动输入新句子
        </button>
      </div>
    </div>
  );
}

// ============ 举一反三单题卡片 ============
function ExerciseCard({
  idx,
  ex,
  picked,
  checked,
  onPick,
  onCheck,
}: {
  idx: number;
  ex: SentenceExercise;
  picked: string | null;
  checked: boolean;
  onPick: (opt: string) => void;
  onCheck: () => void;
}) {
  return (
    <div className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
      <p className="text-sm font-medium text-slate-800">
        <span className="mr-1 text-violet-600">{idx + 1}.</span>
        {ex.question}
      </p>
      <div className="mt-2.5 space-y-1.5">
        {ex.options.map((opt) => {
          const isAnswer = opt === ex.answer;
          const isPicked = picked === opt;
          let cls =
            "border-slate-200 bg-white text-slate-700 hover:border-violet-400 hover:bg-violet-50";
          if (checked) {
            if (isAnswer)
              cls = "border-emerald-500 bg-emerald-50 text-emerald-800";
            else if (isPicked)
              cls = "border-red-400 bg-red-50 text-red-700";
            else cls = "border-slate-200 bg-white text-slate-400";
          }
          return (
            <button
              key={opt}
              type="button"
              disabled={checked}
              onClick={() => onPick(opt)}
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-default ${cls}`}
            >
              <span className="flex-1">{opt}</span>
              {checked && isAnswer && <Check className="h-4 w-4" />}
              {checked && !isAnswer && isPicked && <X className="h-4 w-4" />}
            </button>
          );
        })}
      </div>
      {!checked && picked && (
        <button
          type="button"
          onClick={onCheck}
          className="mt-2.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
        >
          提交
        </button>
      )}
      {checked && (
        <div
          className={`mt-2.5 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            picked === ex.answer
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {picked === ex.answer ? "✅ 答对了！" : `❌ 正确答案是「${ex.answer}」。`}
          {ex.explanation && (
            <span className="mt-0.5 block text-slate-700">💡 {ex.explanation}</span>
          )}
        </div>
      )}
    </div>
  );
}
