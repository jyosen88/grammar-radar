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

/** 一次做题记录（含作答状态），历史里每道题都有 */
interface QuizEntry {
  q: QuizQuestion;
  picked: string | null; // 用户选的字母；null = 未作答
  correctLetter: string | null;
  cards: GrammarCard[] | null; // 答错时的知识点卡片；null = 加载中
}

interface QuizState {
  entries: QuizEntry[];
  cursor: number; // 当前显示的条目下标
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

export default function QuizPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  const [quiz, setQuiz] = useState<QuizState>({ entries: [], cursor: -1 });
  const quizRef = useRef(quiz);
  quizRef.current = quiz;

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
        if (q) setQuiz({ entries: [{ q, picked: null, correctLetter: null, cards: null }], cursor: 0 });
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
    const entry: QuizEntry = { q, picked: null, correctLetter: null, cards: null };
    setQuiz({ entries: [...entries, entry], cursor: entries.length });
  }

  /** 答错时：用题目的 category 和题干里的中文关键词搜知识点卡片，回填到对应条目 */
  async function loadCards(q: QuizQuestion, idx: number) {
    const keywords = [
      ...(q.category ? [q.category.trim()] : []),
      ...(q.question_text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []),
    ]
      .slice(0, 4)
      .filter(Boolean);
    let cards: GrammarCard[] = [];
    if (keywords.length > 0) {
      try {
        const { data, error } = await getSupabase().rpc("search_grammar_cards", {
          p_keywords: keywords,
          p_limit: 3,
        });
        if (!error) cards = (data as GrammarCard[] | null) ?? [];
      } catch {
        cards = [];
      }
    }
    setQuiz((prev) => {
      if (!prev.entries[idx]) return prev; // 条目已被清理
      const entries = [...prev.entries];
      entries[idx] = { ...entries[idx], cards };
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
      // 答错：搜知识点卡片展示
      void loadCards(entry.q, cursor);
    }
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
                </h3>
                {current.cards === null ? (
                  <p className="text-sm text-slate-400">正在搜索知识点…</p>
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

            {/* 上一题 / 下一题 */}
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
              <button
                type="button"
                onClick={moveNext}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
              >
                下一题 →
              </button>
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
    </div>
  );
}
