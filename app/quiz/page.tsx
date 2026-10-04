"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase, type GrammarCard } from "@/lib/supabase";
import { Card } from "@/components/GrammarCardView";

/** quiz_questions 表的一行 */
interface QuizQuestion {
  id: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  category: string | null;
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

  const deckRef = useRef<QuizQuestion[]>([]); // 洗好的题堆
  const [current, setCurrent] = useState<QuizQuestion | null>(null);
  const [count, setCount] = useState(0); // 当前题在本次会话中的序号（从 1 开始）

  const [answered, setAnswered] = useState(false);
  const [picked, setPicked] = useState<string | null>(null); // 用户选的选项字母
  const [correctLetter, setCorrectLetter] = useState<string | null>(null);
  const [relatedCards, setRelatedCards] = useState<GrammarCard[]>([]);
  const [cardLoading, setCardLoading] = useState(false);

  // 进度统计
  const [answeredCount, setAnsweredCount] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  /** 从题堆里抽下一题；抽完自动重新洗牌 */
  const drawNext = useCallback(() => {
    if (deckRef.current.length === 0) return;
    const [q, ...rest] = deckRef.current;
    deckRef.current = rest;
    setCurrent(q);
    setCount((c) => c + 1);
    setAnswered(false);
    setPicked(null);
    setCorrectLetter(null);
    setRelatedCards([]);
  }, []);

  /** 首次进入：拉全部题目（50 道很小），洗牌后开始 */
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
        deckRef.current = shuffle(rows);
        drawNext();
      } catch (e) {
        if (alive) {
          setLoadError(e instanceof Error ? e.message : "题目加载失败");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [drawNext]);

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

  /** 答错时：用题目的 category 和题干里的中文关键词搜知识点卡片 */
  async function searchCards(q: QuizQuestion) {
    const keywords = [
      ...(q.category ? [q.category.trim()] : []),
      ...(q.question_text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []),
    ]
      .slice(0, 4)
      .filter(Boolean);
    if (keywords.length === 0) return;
    setCardLoading(true);
    try {
      const { data, error } = await getSupabase().rpc("search_grammar_cards", {
        p_keywords: keywords,
        p_limit: 3,
      });
      if (error) throw error;
      setRelatedCards((data as GrammarCard[] | null) ?? []);
    } catch {
      // 搜索失败不阻塞答题流程，卡片区留空即可
      setRelatedCards([]);
    } finally {
      setCardLoading(false);
    }
  }

  /** 点击选项 */
  function handlePick(letter: string, q: QuizQuestion) {
    if (answered || loading) return;
    const correct = letterOf(q);
    setAnswered(true);
    setPicked(letter);
    setCorrectLetter(correct);
    setAnsweredCount((n) => n + 1);
    if (correct && letter === correct) {
      setCorrectCount((n) => n + 1);
      // 答对：延迟 1 秒自动下一题
      setTimeout(() => drawNext(), 1000);
    } else {
      // 答错：搜知识点卡片展示
      void searchCards(q);
    }
  }

  const options = current
    ? LETTERS.map((l, i) => {
        const text = [current.option_a, current.option_b, current.option_c, current.option_d][i];
        return { letter: l, text };
      }).filter((o) => (o.text ?? "").trim() !== "")
    : [];

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <main className="mx-auto max-w-2xl space-y-5">
        {/* 顶部：返回首页 */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
          >
            ← 返回首页
          </Link>
          <h1 className="text-lg font-bold text-slate-900">名词选择题</h1>
          <span className="w-20" />
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
                第 {count} 题
              </span>
              {current.category && (
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                  {current.category}
                </span>
              )}
            </div>

            <p className="text-base font-medium text-slate-900">
              {current.question_text}
            </p>

            <div className="space-y-2">
              {options.map(({ letter, text }) => {
                const isCorrect = answered && letter === correctLetter;
                const isWrongPick = answered && letter === picked && letter !== correctLetter;
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
                    onClick={() => handlePick(letter, current)}
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
            {answered && picked === correctLetter && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                ✅ 答对了！马上进入下一题…
              </div>
            )}

            {/* 答错提示 */}
            {answered && picked !== correctLetter && (
              <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-semibold text-red-800">
                  ❌ 答错了，正确答案是{" "}
                  <span className="font-bold">
                    {correctLetter ?? "—"}
                    {correctLetter &&
                      `（${options.find((o) => o.letter === correctLetter)?.text ?? ""}）`}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={drawNext}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  下一题 →
                </button>
              </div>
            )}

            {/* 答错后的知识点卡片 */}
            {answered && picked !== correctLetter && (
              <div className="space-y-3 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  相关知识点卡片
                </h3>
                {cardLoading ? (
                  <p className="text-sm text-slate-400">正在搜索知识点…</p>
                ) : relatedCards.length > 0 ? (
                  relatedCards.map((card, i) => (
                    <Card key={card.id ?? `${card.card_code}-${i}`} card={card} />
                  ))
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
                    没有找到相关知识点卡片
                  </p>
                )}
              </div>
            )}
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
