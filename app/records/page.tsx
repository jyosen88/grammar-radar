"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { SiteNav } from "@/components/SiteNav";
import type { User } from "@supabase/supabase-js";

/** user_records 表的一行 */
interface UserRecord {
  id: number;
  user_id: string;
  image_url: string | null;
  input_text: string;
  analysis_result: {
    type?: string;
    errors?: {
      original: string;
      corrected: string;
      knowledge_point?: string;
      reason?: string;
      suggestion?: string;
    }[];
    result?: {
      on_topic?: { is_on_topic?: boolean; comment?: string };
      scores?: { name: string; level: string; comment: string }[];
      model_essay?: string;
      errors?: {
        original: string;
        corrected: string;
        knowledge_point?: string;
      }[];
    };
  };
  knowledge_points: string[];
  created_at: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RecordsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) loadRecords(u.id);
      else setLoading(false);
    });
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) loadRecords(u.id);
      else {
        setRecords([]);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
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
    <div className="min-h-screen bg-slate-50">
      <SiteNav />
      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">我的记录</h1>
          <p className="mt-1 text-sm text-slate-500">
            你的历史分析记录：输入内容、图片、分析结果和知识点汇总
          </p>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-slate-400">加载中…</p>
        ) : !user ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-600">
              请先点击右上角「登录 / 注册」，登录后即可查看你的历史分析记录。
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
          <ul className="space-y-4">
            {records.map((r) => {
              const isEssay = r.analysis_result?.type === "essay";
              const errors =
                r.analysis_result?.errors ??
                r.analysis_result?.result?.errors ??
                [];
              const isOpen = expanded[r.id] ?? false;
              return (
                <li
                  key={r.id}
                  className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            isEssay
                              ? "bg-violet-100 text-violet-700"
                              : "bg-indigo-100 text-indigo-700"
                          }`}
                        >
                          {isEssay ? "作文分析" : "单题分析"}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatTime(r.created_at)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-3 text-sm whitespace-pre-line text-slate-700">
                        {r.input_text}
                      </p>
                    </div>
                    {r.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.image_url}
                        alt="上传的图片"
                        className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 object-cover"
                      />
                    )}
                  </div>

                  {r.knowledge_points.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {[...new Set(r.knowledge_points)].map((kp) => (
                        <span
                          key={kp}
                          className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700"
                        >
                          📌 {kp}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <p className="text-xs text-slate-400">
                      共 {errors.length} 处错误
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((m) => ({ ...m, [r.id]: !isOpen }))
                      }
                      className="text-xs font-medium text-indigo-600 hover:underline"
                    >
                      {isOpen ? "收起 ▲" : "查看分析详情 ▼"}
                    </button>
                  </div>

                  {isOpen && (
                    <ul className="space-y-2 border-t border-slate-100 pt-3">
                      {errors.length === 0 ? (
                        <li className="text-sm text-emerald-700">
                          ✅ 未发现明显语法错误
                        </li>
                      ) : (
                        errors.map((e, i) => (
                          <li
                            key={i}
                            className="rounded-lg bg-slate-50 px-3 py-2 text-sm"
                          >
                            <span className="text-red-600 line-through">
                              {e.original}
                            </span>
                            <span className="mx-1.5 text-slate-400">→</span>
                            <span className="font-medium text-emerald-700">
                              {e.corrected}
                            </span>
                            {e.knowledge_point && (
                              <span className="ml-2 text-xs text-violet-600">
                                {e.knowledge_point}
                              </span>
                            )}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
