"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, type GrammarCard } from "@/lib/supabase";
import { Card } from "@/components/GrammarCardView";
import { SiteNav } from "@/components/SiteNav";

/** quiz_questions 表的一行 */
interface QuizQuestion {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  category: string | null;
}

/** /api/quiz-analyze 返回的题目解析（已做字段清洗） */
interface QuizAnalysis {
  topic: string; // 本题核心考点
  explanation: string; // 题目解析：为什么正确答案正确
  wrongReason: string; // 错因分析：学生选的选项为什么错
  knowledgePoints: string[]; // 知识点术语
}

/** 一次做题记录（含作答状态），历史里每道题都有 */
interface QuizEntry {
  q: QuizQuestion;
  picked: string | null; // 用户选的字母；null = 未作答
  correctLetter: string | null;
  cards: GrammarCard[] | null; // 答错时的知识点卡片；null = 加载中
  analysis: QuizAnalysis | null; // AI 题目解析；null = AI 不可用
  cardsSource: "ai" | "keyword" | null; // 卡片来源：AI 精确匹配 / 关键词降级
}

interface QuizState {
  entries: QuizEntry[];
  cursor: number; // 当前显示的条目下标
}

/** 一条反馈记录（暂存 localStorage，后端就绪后再迁移） */
interface FeedbackRecord {
  id: string;
  questionId: string; // quiz_questions 的 uuid
  questionNo: number; // 界面上的题号（从 1 开始）
  questionText: string;
  type: string;
  description: string;
  screenshot: string | null; // 压缩后的 dataURL
  createdAt: string;
}

const FEEDBACK_TYPES = ["题目错误", "答案错误", "知识点卡片错误", "解析错误", "其他"];
const FEEDBACK_KEY = "quiz_feedback";

/** 截图压缩成最长边 800px 的 JPEG dataURL，避免撑爆 localStorage */
async function fileToCompressedDataUrl(file: File, max = 800): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("读取文件失败"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("图片解析失败"));
    i.src = dataUrl;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** 追加保存反馈；容量不足等异常只降级到 console，不阻塞用户 */
function saveFeedback(rec: FeedbackRecord): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? "[]");
    list.push(rec);
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn("[quiz] 反馈写入 localStorage 失败（可能超出容量）", e);
    return false;
  }
}

const LETTERS = ["A", "B", "C", "D"] as const;

/** Fisher-Yates 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 清洗 /api/quiz-analyze 响应：字段归一化；四个内容字段全空视为解析失败 */
function normalizeQuizAnalysis(data: unknown): QuizAnalysis | null {
  const o = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const knowledgePoints = Array.isArray(o.knowledge_points)
    ? o.knowledge_points
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const a: QuizAnalysis = {
    topic: str(o.topic),
    explanation: str(o.explanation),
    wrongReason: str(o.wrong_reason),
    knowledgePoints,
  };
  return a.topic || a.explanation || a.wrongReason ? a : null;
}

export default function QuizPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const [quiz, setQuiz] = useState<QuizState>({ entries: [], cursor: -1 });
  const quizRef = useRef(quiz);
  quizRef.current = quiz;

  // 反馈/纠错弹窗状态
  const [fbOpen, setFbOpen] = useState(false);
  const [fbType, setFbType] = useState(FEEDBACK_TYPES[0]);
  const [fbDesc, setFbDesc] = useState("");
  const [fbShot, setFbShot] = useState<{ name: string; dataUrl: string } | null>(
    null
  );
  const [fbError, setFbError] = useState<string | null>(null);
  const [fbToast, setFbToast] = useState(false);
  const fbToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allRef = useRef<QuizQuestion[]>([]); // 全部题目（重洗牌用）
  const deckRef = useRef<QuizQuestion[]>([]); // 待抽题堆
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 从题堆抽一题；抽完自动重新洗牌，保证永远有下一题 */
  const takeQuestion = useCallback((): QuizQuestion | null => {
    if (allRef.current.length === 0) return null;
    if (deckRef.current.length === 0) {
      deckRef.current = shuffle(allRef.current);
    }
    const [q, ...rest] = deckRef.current;
    deckRef.current = rest;
    return q;
  }, []);

  /** 首次进入：拉全部题目，洗牌后出第一题 */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await getSupabase()
          .from("quiz_questions")
          .select("*");
        if (!alive) return;
        if (error) throw new Error(error.message);
        const rows = (data as QuizQuestion[] | null) ?? [];
        if (rows.length === 0) {
          setEmpty(true);
          return;
        }
        allRef.current = rows;
        deckRef.current = shuffle(rows);
        const q = takeQuestion();
        if (q)
          setQuiz({
            entries: [
              { q, picked: null, correctLetter: null, cards: null, analysis: null, cardsSource: null },
            ],
            cursor: 0,
          });
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "题目加载失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [takeQuestion]);

  /** 把 correct_answer 归一化成 A/B/C/D 字母（兼容存字母或存完整选项两种情况） */
  function letterOf(q: QuizQuestion): string | null {
    const ans = (q.correct_answer ?? "").trim();
    if (!ans) return null;
    const m = ans.match(/^[A-Da-d]$/);
    if (m) return m[0].toUpperCase();
    const opts = [q.option_a, q.option_b, q.option_c, q.option_d];
    const idx = opts.findIndex((o) => (o ?? "").trim() === ans);
    return idx >= 0 ? LETTERS[idx] : null;
  }

  /** 手动切换题目：清除可能触发的自动跳转定时器 */
  function goTo(idx: number) {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setQuiz((prev) => ({
      ...prev,
      cursor: Math.max(0, Math.min(idx, prev.entries.length - 1)),
    }));
  }

  /** 下一题：历史里有就前进，到末尾就抽新题 */
  function moveNext() {
    const { entries, cursor } = quizRef.current;
    if (cursor < entries.length - 1) {
      goTo(cursor + 1);
      return;
    }
    const q = takeQuestion();
    if (!q) return;
    const entry: QuizEntry = {
      q,
      picked: null,
      correctLetter: null,
      cards: null,
      analysis: null,
      cardsSource: null,
    };
    setQuiz({ entries: [...entries, entry], cursor: entries.length });
  }

  /** 答错时的智能分析流程：
   *  ① 把题干/选项/正确答案/错误答案发给 /api/quiz-analyze，DeepSeek 先做
   *     题目解析（考点+解析+错因+知识点），并返回 1-3 个 card_code；
   *  ② 前端按编号 .in() 精确查库展示卡片；
   *  ③ AI 不可用或没匹配到卡片时，降级为 search_grammar_cards RPC 关键词搜卡 */
  async function loadCards(q: QuizQuestion, pickedLetter: string, idx: number) {
    const opts = [q.option_a, q.option_b, q.option_c, q.option_d];
    const idxOf = (l: string) => "ABCD".indexOf(l);
    const correctLetter = letterOf(q);
    const correctText = correctLetter
      ? opts[idxOf(correctLetter)]
      : q.correct_answer;
    const wrongText = opts[idxOf(pickedLetter)];

    let cards: GrammarCard[] = [];
    let analysis: QuizAnalysis | null = null;
    let aiKeywords: string[] = [];
    let source: "ai" | "keyword" = "ai";

    // ① 首选：DeepSeek 题目解析 → matched_card_codes → 精确查库
    try {
      const res = await fetch("/api/quiz-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_text: q.question_text,
          category: q.category,
          options: LETTERS.map((l, i) => ({ letter: l, text: opts[i] ?? "" })),
          correct_letter: correctLetter,
          correct_text: correctText ?? "",
          wrong_letter: pickedLetter,
          wrong_text: wrongText ?? "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        analysis = normalizeQuizAnalysis(data);
        aiKeywords = analysis?.knowledgePoints ?? [];
        const codes: string[] = Array.isArray(data?.matched_card_codes)
          ? data.matched_card_codes.filter((c: unknown) => typeof c === "string")
          : [];
        if (codes.length > 0) {
          const { data: rows, error } = await getSupabase()
            .from("grammar_cards")
            .select("*")
            .in("card_code", codes);
          if (!error && rows) {
            const byCode = new Map(
              (rows as GrammarCard[]).map((c) => [c.card_code, c])
            );
            cards = codes
              .map((c) => byCode.get(c))
              .filter((c): c is GrammarCard => !!c);
          }
        }
      } else {
        console.warn("[quiz] /api/quiz-analyze 返回错误：", data?.error ?? res.status);
      }
    } catch (e) {
      console.warn("[quiz] AI 题目解析失败，降级为关键词搜卡", e);
    }

    // ② 降级：AI 不可用 / 无编号 / 查库无结果 → 用关键词走数据库 RPC
    if (cards.length === 0) {
      source = "keyword";
      const keywords = Array.from(
        new Set(
          [
            ...aiKeywords, // AI 给出了知识点但没匹配到卡片时，复用知识点关键词
            ...(q.category ? [q.category.trim()] : []),
            ...(q.question_text.match(/[一-龥]{2,}/g) ?? []),
          ].filter(Boolean)
        )
      ).slice(0, 6);
      if (keywords.length > 0) {
        try {
          const { data: rows, error } = await getSupabase().rpc(
            "search_grammar_cards",
            { p_keywords: keywords, p_limit: 3 }
          );
          if (!error) cards = (rows as GrammarCard[] | null) ?? [];
        } catch (e) {
          console.warn("[quiz] 关键词降级搜卡失败", e);
        }
      }
    }

    setQuiz((prev) => {
      if (!prev.entries[idx]) return prev; // 条目已被清理
      const entries = [...prev.entries];
      entries[idx] = {
        ...entries[idx],
        cards,
        analysis,
        cardsSource: cards.length > 0 ? source : null,
      };
      return { ...prev, entries };
    });
  }

  /** 点击选项（已作答的题目锁定，不可重答） */
  function handlePick(letter: string) {
    const { entries, cursor } = quizRef.current;
    const entry = entries[cursor];
    if (!entry || entry.picked !== null || loading) return;
    const correct = letterOf(entry.q);
    const entries2 = [...entries];
    entries2[cursor] = { ...entry, picked: letter, correctLetter: correct };
    setQuiz({ entries: entries2, cursor });
    if (correct && letter === correct) {
      // 答对：延迟 1 秒自动进入下一题
      timerRef.current = setTimeout(() => moveNext(), 1000);
    } else {
      // 答错：AI 匹配知识点卡片
      void loadCards(entry.q, letter, cursor);
    }
  }

  /** 打开反馈弹窗（重置表单） */
  function openFeedback() {
    setFbType(FEEDBACK_TYPES[0]);
    setFbDesc("");
    setFbShot(null);
    setFbError(null);
    setFbOpen(true);
  }

  /** 选择截图：压缩后暂存预览 */
  async function handleShotChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选择同一文件
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFbError("截图只支持图片文件");
      return;
    }
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      setFbShot({ name: file.name, dataUrl });
      setFbError(null);
    } catch (err) {
      setFbError(err instanceof Error ? err.message : "截图处理失败");
    }
  }

  /** 提交反馈：前端校验必填项 → localStorage + console.log */
  function submitFeedback() {
    const { entries, cursor } = quizRef.current;
    const entry = entries[cursor];
    if (!entry) return;
    if (!fbDesc.trim()) {
      setFbError("请填写具体描述");
      return;
    }
    const rec: FeedbackRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      questionId: entry.q.id,
      questionNo: cursor + 1,
      questionText: entry.q.question_text,
      type: fbType,
      description: fbDesc.trim(),
      screenshot: fbShot?.dataUrl ?? null,
      createdAt: new Date().toISOString(),
    };
    console.log("[quiz] 收到反馈/纠错：", rec);
    saveFeedback(rec);
    setFbOpen(false);
    setFbToast(true);
    if (fbToastTimer.current) clearTimeout(fbToastTimer.current);
    fbToastTimer.current = setTimeout(() => setFbToast(false), 2500);
  }

  const { entries, cursor } = quiz;
  const current = cursor >= 0 ? entries[cursor] : null;
  const answeredCount = entries.filter((e) => e.picked !== null).length;
  const correctCount = entries.filter(
    (e) => e.picked !== null && e.picked === e.correctLetter
  ).length;

  const options = current
    ? LETTERS.map((l, i) => {
        const text = [
          current.q.option_a,
          current.q.option_b,
          current.q.option_c,
          current.q.option_d,
        ][i];
        return { letter: l, text };
      }).filter((o) => (o.text ?? "").trim() !== "")
    : [];

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <main className="mx-auto max-w-2xl space-y-5">
        {/* 顶部：导航 + 标题 */}
        <div className="space-y-3">
          <SiteNav />
          <h1 className="text-center text-lg font-bold text-slate-900">
            名词选择题
          </h1>
        </div>

        {/* 加载 / 错误 / 空状态 */}
        {loading && (
          <div className="rounded-2xl bg-white p-10 text-center text-slate-500 shadow-sm">
            题目加载中…
          </div>
        )}
        {!loading && loadError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            题目加载失败：{loadError}
          </div>
        )}
        {!loading && empty && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <p className="font-semibold">题库为空（读到了 0 道题）</p>
            <p className="mt-2">
              如果 quiz_questions 表里已经有 50 道题，多半是 RLS 没有放开匿名读取权限。请到
              Supabase SQL Editor 执行：
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-amber-100 p-3 text-xs">
              {`create policy "anon_read_quiz_questions"
on public.quiz_questions for select
to anon
using (true);`}
            </pre>
          </div>
        )}

        {/* 答题卡片 */}
        {!loading && !loadError && !empty && current && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white">
                第 {cursor + 1} 题
              </span>
              {current.q.category && (
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                  {current.q.category}
                </span>
              )}
            </div>

            <p className="text-base font-medium text-slate-900">
              {current.q.question_text}
            </p>

            <div className="space-y-2">
              {options.map(({ letter, text }) => {
                const answered = current.picked !== null;
                const isCorrect = answered && letter === current.correctLetter;
                const isWrongPick =
                  answered && letter === current.picked && letter !== current.correctLetter;
                let cls =
                  "border-slate-200 bg-white text-slate-700 hover:border-indigo-400 hover:bg-indigo-50";
                if (answered) {
                  if (isCorrect) cls = "border-emerald-500 bg-emerald-50 text-emerald-800";
                  else if (isWrongPick) cls = "border-red-400 bg-red-50 text-red-700";
                  else cls = "border-slate-200 bg-white text-slate-400";
                }
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={answered}
                    onClick={() => handlePick(letter)}
                    className={`flex w-full items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left text-sm transition disabled:cursor-default ${cls}`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold opacity-70">
                      {letter}
                    </span>
                    <span className="flex-1">{text}</span>
                    {isCorrect && <span>✅</span>}
                    {isWrongPick && <span>❌</span>}
                  </button>
                );
              })}
            </div>

            {/* 答对提示 */}
            {current.picked !== null && current.picked === current.correctLetter && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                ✅ 答对了！马上进入下一题…
              </div>
            )}

            {/* 答错提示 */}
            {current.picked !== null && current.picked !== current.correctLetter && (
              <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-semibold text-red-800">
                  ❌ 答错了，正确答案是{" "}
                  <span className="font-bold">
                    {current.correctLetter ?? "—"}
                    {current.correctLetter &&
                      `（${options.find((o) => o.letter === current.correctLetter)?.text ?? ""}）`}
                  </span>
                </p>

                {/* DeepSeek 智能题目解析：考点 → 题目解析 → 错因分析 → 知识点 */}
                {current.analysis && (
                  <div className="space-y-2 rounded-lg bg-white/70 px-3 py-2.5 text-xs text-red-900">
                    {current.analysis.topic && (
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="shrink-0 font-semibold text-red-800">考点</span>
                        <span className="rounded-full bg-red-600 px-2 py-0.5 font-medium text-white">
                          {current.analysis.topic}
                        </span>
                      </p>
                    )}
                    {current.analysis.explanation && (
                      <div>
                        <p className="font-semibold text-red-800">📝 题目解析</p>
                        <p className="mt-0.5 leading-relaxed text-slate-700">
                          {current.analysis.explanation}
                        </p>
                      </div>
                    )}
                    {current.analysis.wrongReason && (
                      <div>
                        <p className="font-semibold text-red-800">❌ 错因分析</p>
                        <p className="mt-0.5 leading-relaxed text-slate-700">
                          {current.analysis.wrongReason}
                        </p>
                      </div>
                    )}
                    {current.analysis.knowledgePoints.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span className="font-semibold text-red-800">知识点</span>
                        {current.analysis.knowledgePoints.map((kw) => (
                          <span
                            key={kw}
                            className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={moveNext}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  下一题 →
                </button>
              </div>
            )}

            {/* 答错后的知识点卡片 */}
            {current.picked !== null && current.picked !== current.correctLetter && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  相关知识点卡片
                  {current.cardsSource === "keyword" && (
                    <span className="ml-2 font-normal normal-case text-slate-400">
                      {current.analysis
                        ? "（AI 未匹配到对应卡片，以下按知识点关键词推荐）"
                        : "（AI 分析暂不可用，已按关键词匹配）"}
                    </span>
                  )}
                </h3>
                {current.cards === null ? (
                  <p className="text-sm text-slate-400">
                    AI 正在分析题目、匹配知识点卡片…
                  </p>
                ) : current.cards.length > 0 ? (
                  current.cards.map((card, i) => (
                    <Card key={card.id ?? `${card.card_code}-${i}`} card={card} />
                  ))
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
                    没有找到相关知识点卡片
                  </p>
                )}
              </div>
            )}

            {/* 上一题 / 下一题 / 反馈 */}
            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => goTo(cursor - 1)}
                disabled={cursor <= 0}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← 上一题
              </button>
              <span className="text-xs text-slate-400">
                {cursor + 1} / {entries.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openFeedback}
                  className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-amber-400 hover:text-amber-700"
                >
                  反馈/纠错
                </button>
                <button
                  type="button"
                  onClick={moveNext}
                  className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
                >
                  下一题 →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 底部进度 */}
        {!loading && !loadError && !empty && (
          <p className="text-center text-sm text-slate-500">
            当前进度：已答 <span className="font-semibold text-slate-900">{answeredCount}</span>{" "}
            题，正确 <span className="font-semibold text-emerald-600">{correctCount}</span> 题
          </p>
        )}
      </main>

      {/* 反馈/纠错 Modal */}
      {fbOpen && current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setFbOpen(false)}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">反馈/纠错</h3>
              <button
                type="button"
                onClick={() => setFbOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* 题目 ID（自动带出，只读） */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">题目</label>
              <input
                type="text"
                readOnly
                value={`第 ${cursor + 1} 题 · ID ${current.q.id}`}
                className="w-full cursor-default rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
              />
            </div>

            {/* 问题类型 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">问题类型</label>
              <select
                value={fbType}
                onChange={(e) => setFbType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              >
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* 具体描述（必填） */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">
                具体描述 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={fbDesc}
                onChange={(e) => {
                  setFbDesc(e.target.value);
                  if (fbError) setFbError(null);
                }}
                rows={4}
                placeholder="请描述问题，例如：这道题的正确答案应该是…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              />
            </div>

            {/* 截图上传（可选） */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">截图上传（可选）</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleShotChange}
                className="w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
              />
              {fbShot && (
                <div className="flex items-center gap-2.5 rounded-lg border border-indigo-200 bg-indigo-50 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={fbShot.dataUrl}
                    alt="截图预览"
                    className="h-12 w-12 shrink-0 rounded-md border border-indigo-200 object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-indigo-800">
                    {fbShot.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFbShot(null)}
                    className="shrink-0 text-xs text-slate-400 hover:text-red-600"
                  >
                    移除
                  </button>
                </div>
              )}
            </div>

            {/* 校验错误提示 */}
            {fbError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {fbError}
              </p>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setFbOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitFeedback}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
              >
                提交
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提交成功提示 */}
      {fbToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-medium text-emerald-800 shadow-lg">
          ✅ 反馈已提交，感谢反馈
        </div>
      )}
    </div>
  );
}
