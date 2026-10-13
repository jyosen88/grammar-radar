"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase, getStoredSession } from "@/lib/supabase";
import { SiteNav } from "@/components/SiteNav";
import { AuthGuard } from "@/components/AuthGuard";
import {
  extractRecordKps,
  getKpErrorItems,
  safeParseAnalysisResult,
} from "@/lib/recordAnalysis";
import type { User } from "@supabase/supabase-js";

interface UserRecord {
  id: number;
  user_id: string;
  image_url: string | null;
  input_text: string;
  analysis_result: unknown;
  knowledge_points: string[];
  created_at: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 记录类型 → 徽章文案与配色 */
const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  essay: { label: "作文分析", cls: "bg-violet-100 text-violet-700" },
  "analyze-quiz": { label: "选择题解析", cls: "bg-sky-100 text-sky-700" },
  sentence: { label: "长难句分析", cls: "bg-fuchsia-100 text-fuchsia-700" },
  analyze: { label: "单题分析", cls: "bg-indigo-100 text-indigo-700" },
};

function typeOf(rawAr: unknown): string {
  return (safeParseAnalysisResult(rawAr).type as string) ?? "analyze";
}

function ByKpContent() {
  const sp = useSearchParams();
  const kp = sp.get("kp") ?? "";
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

  const matched = records.filter((r) =>
    extractRecordKps(r.analysis_result, r.knowledge_points).includes(kp)
  );

  return (
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
          <h1 className="text-xl font-bold text-slate-900">知识点错误归因</h1>
        </div>

        <div className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold text-slate-400">知识点</p>
          <p className="mt-1 text-lg font-bold text-violet-700">📌 {kp || "未指定"}</p>
          {!loading && !error && (
            <p className="mt-1 text-xs text-slate-500">
              共 {matched.length} 条记录涉及该知识点，点击卡片查看完整分析详情
            </p>
          )}
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-slate-400">加载中…</p>
        ) : !user ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-600">请先登录后查看记录。</p>
          </div>
        ) : error ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</p>
        ) : matched.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-slate-500">没有找到涉及该知识点的记录。</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {matched.map((r) => {
              const t = typeOf(r.analysis_result);
              const badge = TYPE_BADGE[t] ?? TYPE_BADGE.analyze;
              const items = getKpErrorItems(r.analysis_result, kp);
              return (
                <li key={r.id}>
                  <Link
                    href={`/records/${r.id}`}
                    className="block space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-300 hover:shadow-md"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs text-slate-400">{formatTime(r.created_at)}</span>
                    </div>

                    <p className="line-clamp-2 text-sm whitespace-pre-line text-slate-600">
                      {r.input_text}
                    </p>

                    {items.length > 0 && (
                      <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-400">
                          该知识点下的具体错误（{items.length} 处）
                        </p>
                        {items.map((it, i) =>
                          it.kind === "error" ? (
                            <p key={i} className="text-sm">
                              <span className="text-red-600 line-through">{it.wrong}</span>
                              <span className="mx-1.5 text-slate-400">→</span>
                              <span className="font-medium text-emerald-700">{it.right}</span>
                            </p>
                          ) : it.kind === "quiz" ? (
                            <p key={i} className="text-sm font-medium text-emerald-700">
                              ✅ 正确答案：{it.right}
                            </p>
                          ) : (
                            <div key={i} className="text-xs">
                              <p className="text-slate-800">{it.wrong}</p>
                              <p className="mt-0.5 text-emerald-700">✅ {it.right}</p>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

export default function RecordsByKpPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#f8f5fe]">
            <SiteNav />
            <main className="mx-auto max-w-3xl px-4 py-8">
              <p className="py-10 text-center text-sm text-slate-400">加载中…</p>
            </main>
          </div>
        }
      >
        <ByKpContent />
      </Suspense>
    </AuthGuard>
  );
}
