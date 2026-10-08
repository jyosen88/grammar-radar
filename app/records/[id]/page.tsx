"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase, getStoredSession } from "@/lib/supabase";
import { SiteNav } from "@/components/SiteNav";
import { AuthGuard } from "@/components/AuthGuard";
import type { User } from "@supabase/supabase-js";

/* ── 类型 ── */
interface AnalysisError {
  original: string;
  corrected: string;
  knowledge_point?: string;
  reason?: string;
  context_note?: string;
  suggestion?: string;
}
interface QuizSolution {
  answer_letter: string;
  answer_text: string;
  knowledge_point?: string;
  explanation?: string;
  options?: { letter: string; text: string; is_correct?: boolean; analysis?: string }[];
}
interface EssayResult {
  on_topic?: { is_on_topic?: boolean; comment?: string };
  overall_summary?: string;
  scores?: { name: string; level: string; comment: string }[];
  highlights?: { text: string; kind: string; level: string; note: string }[];
  improvements?: { issue: string; suggestion: string }[];
  model_essay?: string;
  errors?: AnalysisError[];
}
interface UserRecord {
  id: number;
  user_id: string;
  image_url: string | null;
  input_text: string;
  analysis_result: {
    type?: string;
    errors?: AnalysisError[];
    quiz?: QuizSolution;
    reference_check?: { status?: string; comment?: string };
    result?: EssayResult;
  };
  knowledge_points: string[];
  created_at: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LEVEL_BADGE: Record<string, string> = {
  超出预期: "bg-amber-100 text-amber-700",
  优秀: "bg-emerald-100 text-emerald-700",
  良好: "bg-sky-100 text-sky-700",
  一般: "bg-slate-100 text-slate-600",
  待提高: "bg-red-100 text-red-700",
};

export default function RecordDetailPage({ params }: { params: { id: string } }) {
  const [user, setUser] = useState<User | null>(null);
  const [record, setRecord] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();

    const fetchRecord = async (uid: string) => {
      setLoading(true);
      setError("");
      setNotFound(false);
      const { data, error: qErr } = await sb
        .from("user_records")
        .select("*")
        .eq("id", params.id)
        .eq("user_id", uid) // RLS 已保护，双保险
        .maybeSingle();
      if (qErr) {
        setError(qErr.message);
      } else if (!data) {
        setNotFound(true);
      } else {
        setRecord(data as UserRecord);
      }
      setLoading(false);
    };

    const applyUser = (u: User | null) => {
      setUser(u);
      if (!u) {
        setRecord(null);
        setLoading(false);
        loadedForRef.current = null;
        return;
      }
      if (loadedForRef.current !== u.id) {
        loadedForRef.current = u.id;
        fetchRecord(u.id);
      }
    };

    const cached = getStoredSession();
    if (cached?.user?.id) {
      applyUser({ id: cached.user.id, email: cached.user.email ?? null } as User);
    } else {
      setLoading(false);
    }

    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) applyUser(session.user);
    });
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, session) => {
      applyUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  // ── 提取分析数据 ──
  const ar = record?.analysis_result;
  const type = ar?.type ?? "analyze";
  const isEssay = type === "essay";
  const isQuiz = type === "analyze-quiz";
  const errors: AnalysisError[] = isEssay
    ? ar?.result?.errors ?? []
    : ar?.errors ?? [];
  const quiz: QuizSolution | null = isQuiz ? ar?.quiz ?? null : null;
  const essay: EssayResult | null = isEssay ? ar?.result ?? null : null;
  const refCheck = !isEssay ? ar?.reference_check ?? null : null;

  return (
    <AuthGuard>
      <div className="min-h-screen bg-[#f8f5fe]">
        <SiteNav />
        <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
          <div className="flex items-center gap-3">
            <Link
              href="/records"
              className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-50"
            >
              ← 返回列表
            </Link>
            <h1 className="text-xl font-bold text-slate-900">记录详情</h1>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">加载中…</p>
          ) : !user ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-slate-600">请先登录后查看记录。</p>
            </div>
          ) : notFound ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-slate-500">
                记录不存在或已删除。
              </p>
              <Link
                href="/records"
                className="mt-3 inline-block text-sm font-medium text-indigo-600 hover:underline"
              >
                ← 返回记录列表
              </Link>
            </div>
          ) : error ? (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
              ⚠️ {error}
            </p>
          ) : record ? (
            <div className="space-y-5">
              {/* 基本信息 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      isEssay
                        ? "bg-violet-100 text-violet-700"
                        : isQuiz
                          ? "bg-sky-100 text-sky-700"
                          : "bg-indigo-100 text-indigo-700"
                    }`}
                  >
                    {isEssay ? "作文分析" : isQuiz ? "选择题解析" : "单题分析"}
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatTime(record.created_at)}
                  </span>
                </div>

                {/* 知识点标签 */}
                {record.knowledge_points.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[...new Set(record.knowledge_points)].map((kp) => (
                      <span
                        key={kp}
                        className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700"
                      >
                        📌 {kp}
                      </span>
                    ))}
                  </div>
                )}

                {/* 图片 */}
                {record.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={record.image_url}
                    alt="上传的图片"
                    className="mt-3 max-h-64 rounded-lg border border-slate-200 object-contain"
                  />
                )}

                {/* 原文 */}
                <div className="mt-4">
                  <p className="mb-1 text-xs font-semibold text-slate-400">原文</p>
                  <p className="whitespace-pre-line rounded-lg bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
                    {record.input_text}
                  </p>
                </div>
              </div>

              {/* 外部参考对照 */}
              {refCheck && (
                <div
                  className={`rounded-2xl border p-4 text-sm ${
                    refCheck.status === "difference"
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : refCheck.status === "consistent"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-500"
                  }`}
                >
                  {refCheck.status === "difference"
                    ? `⚠️ AI 分析与外部参考存在差异${refCheck.comment ? `：${refCheck.comment}` : ""}`
                    : refCheck.status === "consistent"
                      ? "✅ 已与外部参考对照，结论一致"
                      : "🔍 纯 AI 分析（无外部参考）"}
                </div>
              )}

              {/* 作文分析结果 */}
              {isEssay && essay && (
                <>
                  {/* 扣题判断 + 总评 */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 className="text-sm font-semibold text-slate-900">📋 作文总评</h2>
                    {essay.on_topic && (
                      <p className="mt-2 text-sm text-slate-600">
                        {essay.on_topic.is_on_topic ? "✅ 切题" : "⚠️ 偏题"}
                        {essay.on_topic.comment ? `：${essay.on_topic.comment}` : ""}
                      </p>
                    )}
                    {essay.overall_summary && (
                      <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700">
                        {essay.overall_summary}
                      </p>
                    )}
                  </div>

                  {/* 评分维度 */}
                  {essay.scores && essay.scores.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <h2 className="text-sm font-semibold text-slate-900">📊 评分维度</h2>
                      <div className="mt-3 space-y-2">
                        {essay.scores.map((s, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                                LEVEL_BADGE[s.level] ?? "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {s.level}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-slate-800">{s.name}</p>
                              <p className="text-xs text-slate-500">{s.comment}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 亮点摘录 */}
                  {essay.highlights && essay.highlights.length > 0 && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
                      <h2 className="text-sm font-semibold text-amber-800">🌟 亮点摘录</h2>
                      <div className="mt-3 space-y-2">
                        {essay.highlights.map((h, i) => (
                          <div key={i} className="rounded-lg bg-white/60 px-3 py-2">
                            <p className="text-sm font-medium text-slate-800">"{h.text}"</p>
                            <p className="mt-0.5 text-xs text-amber-700">
                              {h.kind} · {h.level}
                              {h.note ? ` · ${h.note}` : ""}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 选择题解析 */}
              {isQuiz && quiz && (
                <div className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
                  <div className="rounded-xl bg-emerald-50 px-4 py-3">
                    <p className="text-sm font-semibold text-emerald-700">
                      ✅ 正确答案：{quiz.answer_letter}
                      {quiz.answer_text ? `. ${quiz.answer_text}` : ""}
                    </p>
                  </div>
                  {quiz.knowledge_point && (
                    <p className="mt-3 text-xs text-violet-600">
                      📌 考点：{quiz.knowledge_point}
                    </p>
                  )}
                  {quiz.explanation && (
                    <div className="mt-3 rounded-md bg-slate-50 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-400">解析</p>
                      <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                        {quiz.explanation}
                      </p>
                    </div>
                  )}
                  {quiz.options && quiz.options.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {quiz.options.map((o) => (
                        <li
                          key={o.letter}
                          className={`rounded-lg px-3 py-2 text-sm ${
                            o.is_correct
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-slate-50 text-slate-600"
                          }`}
                        >
                          <span className="font-semibold">
                            {o.is_correct ? "✓" : "✗"} {o.letter}. {o.text}
                          </span>
                          {o.analysis && (
                            <span className="mt-0.5 block whitespace-pre-line text-xs text-slate-500">
                              {o.analysis}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* 语法错误与修改建议 */}
              {!isQuiz && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">
                    语法错误与修改建议（{errors.length} 处）
                  </h2>
                  {errors.length === 0 ? (
                    <p className="mt-3 py-4 text-center text-sm text-emerald-700">
                      ✅ 未发现明显语法错误
                    </p>
                  ) : (
                    <div className="mt-3 space-y-4">
                      {errors.map((e, i) => (
                        <div key={i} className="rounded-xl border border-slate-100 p-4">
                          {/* 原文 → 改后 */}
                          <p className="text-sm">
                            <span className="text-red-600 line-through">{e.original}</span>
                            <span className="mx-1.5 text-slate-400">→</span>
                            <span className="font-medium text-emerald-700">{e.corrected}</span>
                          </p>
                          {/* 知识点标签 */}
                          {e.knowledge_point && (
                            <span className="mt-2 inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                              📌 {e.knowledge_point}
                            </span>
                          )}
                          {/* 错误原因 */}
                          {e.reason && (
                            <div className="mt-3 rounded-md bg-slate-50 px-3 py-2">
                              <p className="text-xs font-semibold text-slate-400">错误原因</p>
                              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{e.reason}</p>
                            </div>
                          )}
                          {/* 语境解释 */}
                          {e.context_note && (
                            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2">
                              <p className="text-xs font-semibold text-amber-500">语境 / 搭配解释</p>
                              <p className="mt-1 whitespace-pre-line text-sm text-amber-900">{e.context_note}</p>
                            </div>
                          )}
                          {/* 修改建议 */}
                          {e.suggestion && (
                            <div className="mt-2 rounded-md bg-emerald-50 px-3 py-2">
                              <p className="text-xs font-semibold text-emerald-600">修改建议</p>
                              <p className="mt-1 whitespace-pre-line text-sm text-emerald-900">{e.suggestion}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 明显需要改善的地方 */}
              {isEssay && essay?.improvements && essay.improvements.length > 0 && (
                <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-sky-800">🔧 明显需要改善的地方</h2>
                  <div className="mt-3 space-y-2">
                    {essay.improvements.map((it, i) => (
                      <div key={i} className="rounded-lg bg-white/60 px-3 py-2">
                        <p className="text-sm text-slate-700">
                          <span className="font-medium text-slate-900">哪里改：</span>{" "}
                          {it.issue}
                        </p>
                        <p className="mt-0.5 text-sm text-emerald-700">
                          <span className="font-medium">✅ 改成：</span> {it.suggestion}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 参考范文 */}
              {isEssay && essay?.model_essay && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">📝 参考范文</h2>
                  <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
                    {essay.model_essay}
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </main>
      </div>
    </AuthGuard>
  );
}
