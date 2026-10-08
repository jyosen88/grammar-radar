"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase, getStoredSession } from "@/lib/supabase";
import { SiteNav } from "@/components/SiteNav";
import { AuthGuard } from "@/components/AuthGuard";
import type { User } from "@supabase/supabase-js";

/** user_records 表的一行（列表页只需摘要字段） */
interface UserRecord {
  id: number;
  user_id: string;
  image_url: string | null;
  input_text: string;
  analysis_result: {
    type?: string;
    errors?: unknown[];
    quiz?: { answer_letter?: string; knowledge_point?: string };
    result?: { errors?: unknown[] };
  };
  knowledge_points: string[];
  created_at: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 从 analysis_result 里提取错误数量，兼容 analyze / essay 两种存储结构 */
function getErrorCount(ar: UserRecord["analysis_result"]): number {
  if (Array.isArray(ar?.errors)) return ar.errors.length;
  if (Array.isArray(ar?.result?.errors)) return ar.result.errors.length;
  return 0;
}

/** 提取前几个知识点标签用于列表摘要展示 */
function getKnowledgeTags(ar: UserRecord["analysis_result"], kps: string[]): string[] {
  // 优先用 knowledge_points 字段
  if (kps.length > 0) return [...new Set(kps)].slice(0, 3);
  // 兜底：从 analysis_result 里找
  const tags: string[] = [];
  if (ar?.quiz?.knowledge_point) tags.push(ar.quiz.knowledge_point);
  if (Array.isArray(ar?.errors)) {
    for (const e of ar.errors) {
      const kp = (e as { knowledge_point?: string })?.knowledge_point;
      if (kp && tags.length < 3) tags.push(kp);
    }
  }
  if (Array.isArray(ar?.result?.errors)) {
    for (const e of ar.result.errors) {
      const kp = (e as { knowledge_point?: string })?.knowledge_point;
      if (kp && tags.length < 3) tags.push(kp);
    }
  }
  return [...new Set(tags)].slice(0, 3);
}

export default function RecordsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [error, setError] = useState("");
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();

    const applyUser = (u: User | null) => {
      setUser(u);
      if (!u) {
        setRecords([]);
        setLoading(false);
        loadedForRef.current = null;
        return;
      }
      if (loadedForRef.current !== u.id) {
        loadedForRef.current = u.id;
        loadRecords(u.id);
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
  }, []);

  async function loadRecords(userId: string) {
    setLoading(true);
    setError("");
    const { data, error: qErr } = await getSupabase()
      .from("user_records")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (qErr) setError(qErr.message);
    else setRecords((data ?? []) as UserRecord[]);
    setLoading(false);
  }

  return (
    <AuthGuard>
      <div className="min-h-screen bg-[#f8f5fe]">
        <SiteNav />
        <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">我的记录</h1>
            <p className="mt-1 text-sm text-slate-500">
              点击任意记录查看完整的分析详情
            </p>
          </div>

          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">加载中…</p>
          ) : !user ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-slate-600">
                请先登录后查看记录。
              </p>
            </div>
          ) : error ? (
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
              ⚠️ {error}
            </p>
          ) : records.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-slate-500">
                还没有记录。回到首页做一次分析，结果会自动保存到这里。
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {records.map((r) => {
                const type = r.analysis_result?.type ?? "analyze";
                const isEssay = type === "essay";
                const isQuiz = type === "analyze-quiz";
                const errCount = getErrorCount(r.analysis_result);
                const tags = getKnowledgeTags(r.analysis_result, r.knowledge_points);
                return (
                  <li key={r.id}>
                    <Link
                      href={`/records/${r.id}`}
                      className="block space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-300 hover:shadow-md"
                    >
                      {/* 第一行：类型徽章 + 时间 */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
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
                          {formatTime(r.created_at)}
                        </span>
                        {/* 错误数量 */}
                        {!isQuiz && (
                          <span
                            className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                              errCount === 0
                                ? "bg-emerald-50 text-emerald-600"
                                : "bg-red-50 text-red-600"
                            }`}
                          >
                            {errCount} 处错误
                          </span>
                        )}
                        {isQuiz && (
                          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                            选择题
                          </span>
                        )}
                      </div>

                      {/* 第二行：内容摘要 */}
                      <p className="line-clamp-2 text-sm whitespace-pre-line text-slate-600">
                        {r.input_text}
                      </p>

                      {/* 第三行：知识点标签 */}
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {tags.map((kp) => (
                            <span
                              key={kp}
                              className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-700"
                            >
                              📌 {kp}
                            </span>
                          ))}
                          {/* 缩略图 */}
                          {r.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.image_url}
                              alt="图片"
                              className="ml-auto h-8 w-8 rounded border border-slate-200 object-cover"
                            />
                          )}
                        </div>
                      )}

                      {/* 如果没有知识点但有图片，单独显示缩略图 */}
                      {tags.length === 0 && r.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.image_url}
                          alt="图片"
                          className="h-8 w-8 rounded border border-slate-200 object-cover"
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}
