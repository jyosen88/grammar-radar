"use client";

import { useRef, useState } from "react";
import { getSupabase, type GrammarCard } from "@/lib/supabase";
import { parseRulesTable, type TableData } from "@/lib/rules-table";

/** AI 分析返回的单个语法错误 */
interface AnalysisError {
  original: string;
  corrected: string;
  reason?: string; // 错误原因（含学生犯错的心理）
  explanation?: string; // 兼容旧字段
  context_note?: string; // 语境/搭配解释，可为空
  keywords: string[];
}

/** 已上传的错题图片（Supabase Storage 公共 URL） */
interface SelectedImage {
  url: string;
  name: string;
}

/** rules_table 渲染成 HTML 表格 */
function RulesTable({ data }: { data: TableData }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-100 text-left text-slate-600">
            {data.headers.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.rows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top text-slate-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 多行文本按行渲染，error=红 good=绿 note=灰 */
function Lines({
  text,
  tone,
}: {
  text: string;
  tone: "error" | "good" | "note";
}) {
  const items = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const toneCls =
    tone === "error"
      ? "border-red-300 bg-red-50 text-red-800"
      : tone === "good"
        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <ul className="space-y-1.5">
      {items.map((line, i) => (
        <li
          key={i}
          className={`whitespace-pre-line rounded-md border-l-4 px-3 py-1.5 text-sm ${toneCls}`}
        >
          {line}
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Card({ card }: { card: GrammarCard }) {
  const rules = parseRulesTable(card.rules_table);
  return (
    <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* card_code + category */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-indigo-600 px-2 py-0.5 font-mono text-xs font-semibold text-white">
          {card.card_code}
        </span>
        {card.category && (
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
            {card.category}
          </span>
        )}
      </div>

      <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>

      {/* rules_table 渲染成表格 */}
      {rules && (
        <Section title="规则表格">
          {typeof rules === "string" ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm whitespace-pre-line text-slate-700">
              {rules}
            </p>
          ) : (
            <RulesTable data={rules} />
          )}
        </Section>
      )}

      {card.typical_errors && (
        <Section title="典型错误">
          <Lines text={card.typical_errors} tone="error" />
        </Section>
      )}

      {card.correct_examples && (
        <Section title="正确示例">
          <Lines text={card.correct_examples} tone="good" />
        </Section>
      )}

      {card.notes && (
        <Section title="笔记">
          <Lines text={card.notes} tone="note" />
        </Section>
      )}
    </article>
  );
}

export default function Home() {
  // 输入与分析状态
  const [analysisText, setAnalysisText] = useState("");
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState(""); // 上传中 / 识别图片中 / AI 分析中
  const [analysisErrors, setAnalysisErrors] = useState<AnalysisError[] | null>(
    null
  );
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [cardMatches, setCardMatches] = useState<GrammarCard[]>([]);

  // 错题图片上传
  const ERROR_BUCKET = "error-bank";
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetResults() {
    setAnalysisError(null);
    setAnalysisErrors(null);
    setCardMatches([]);
  }

  /** 调用 DeepSeek 分析 + 匹配知识点卡片（要求调用方已进入 busy 状态） */
  async function runAnalysis(text: string) {
    setBusyHint("AI 正在分析语法…");
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "分析失败，请重试");

    const errors: AnalysisError[] = Array.isArray(data?.errors) ? data.errors : [];
    setAnalysisErrors(errors);

    // 用 AI 给出的关键词在数据库层面搜索（SQL 评分函数，只返回相关度最高的 3 条），
    // 不再全量拉取 grammar_cards 到浏览器过滤，避免卡片增多后卡死
    const keywords = [...new Set(errors.flatMap((e) => e.keywords ?? []))].filter(
      Boolean
    );
    if (keywords.length) {
      const { data: matched, error: rpcErr } = await getSupabase().rpc(
        "search_grammar_cards",
        { p_keywords: keywords, p_limit: 3 }
      );
      if (rpcErr) throw rpcErr;
      setCardMatches((matched as GrammarCard[] | null) ?? []);
    }
  }

  /** 文本框直接分析 */
  async function handleAnalyze() {
    const text = analysisText.trim();
    if (busy || !text) return;
    setBusy(true);
    resetResults();
    try {
      await runAnalysis(text);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "分析失败，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  /** 选图后全自动：上传 error-bank → 千问视觉 OCR → DeepSeek 分析 */
  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 清空以便可重复选择同一文件
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setAnalysisError("仅支持 JPEG / PNG / WebP 格式的图片");
      return;
    }

    setBusy(true);
    resetResults();
    setSelectedImage(null);
    try {
      // 1. 上传到 Supabase Storage 的 error-bank
      setBusyHint("正在上传错题图片…");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // 时间戳 + 随机数，避免重名
      const path = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.${ext}`;
      const { error: upErr } = await getSupabase().storage
        .from(ERROR_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: urlData } = getSupabase().storage
        .from(ERROR_BUCKET)
        .getPublicUrl(path);
      const imageUrl = urlData.publicUrl;
      setSelectedImage({ url: imageUrl, name: file.name });

      // 2. 调用 /api/vision（qwen-vl-flash）提取图片中的文字
      setBusyHint("正在识别图片中的文字…");
      const ocrRes = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const ocrData = await ocrRes.json();
      if (!ocrRes.ok) {
        throw new Error(ocrData?.error ?? "图片识别失败，请重试");
      }
      const text = String(ocrData.text ?? "").trim();
      // 识别出的文字回填文本框，用户可以核对、修改后重新点分析
      setAnalysisText(text);
      if (!text) {
        throw new Error("没有从图片中识别到英文文字，请换一张更清晰的图片");
      }

      // 3. 走和文本输入完全一样的 DeepSeek 分析流程
      await runAnalysis(text);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "处理失败，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  const canAnalyze = !busy && !!analysisText.trim();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Grammar Radar{" "}
              <span className="text-indigo-600">· 智能语法分析</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              粘贴英文句子，或上传错题图片，AI 自动找出语法错误并匹配知识点卡片
            </p>
          </div>

          {/* 文字输入 */}
          <textarea
            value={analysisText}
            onChange={(e) => setAnalysisText(e.target.value)}
            rows={4}
            placeholder="粘贴一句或一段英文（比如写错的句子或作文）；也可以直接上传错题图片自动识别…"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />

          {/* 已上传图片预览 */}
          {selectedImage && (
            <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedImage.url}
                alt="已上传的错题图片"
                className="h-16 w-16 shrink-0 rounded-lg border border-indigo-200 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-indigo-800">
                  {selectedImage.name}
                </p>
                <p className="mt-0.5 text-xs text-indigo-500">
                  已存入错题银行 error-bank
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                disabled={busy}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
              >
                ✕ 移除
              </button>
            </div>
          )}

          {/* 上传图片 + 智能语法分析 并排 */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              📷 上传图片
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  {busyHint || "处理中…"}
                </>
              ) : (
                <>✨ 智能语法分析</>
              )}
            </button>
            <span className="text-xs text-slate-400">
              上传图片后自动完成：存入错题银行 → 千问识别文字 → DeepSeek 语法分析
            </span>
          </div>

          {busy && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              {busyHint || "处理中…"}通常需要几秒钟，请稍候
            </div>
          )}

          {analysisError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              出错：{analysisError}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
        {analysisErrors && !busy && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {analysisErrors.length === 0 ? (
              <p className="py-2 text-center text-sm text-emerald-700">
                ✅ 未发现明显语法错误
              </p>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-slate-900">
                  AI 分析结果（{analysisErrors.length} 处错误）
                </h3>
                <ul className="space-y-3">
                  {analysisErrors.map((err, i) => (
                    <li
                      key={i}
                      className="space-y-1.5 border-l-4 border-amber-300 pl-3"
                    >
                      <p className="text-sm">
                        <span className="text-red-600 line-through">
                          {err.original}
                        </span>
                        <span className="mx-1.5 text-slate-400">→</span>
                        <span className="font-medium text-emerald-700">
                          {err.corrected}
                        </span>
                      </p>
                      {(() => {
                        const reason = err.reason || err.explanation || "";
                        const contextNote = (err.context_note ?? "").trim();
                        return (
                          <>
                            {reason && (
                              <div className="rounded-md bg-slate-50 px-3 py-2">
                                <p className="text-xs font-semibold text-slate-400">
                                  错误原因
                                </p>
                                <p className="mt-1 text-sm whitespace-pre-line text-slate-700">
                                  {reason}
                                </p>
                              </div>
                            )}
                            {contextNote && (
                              <div className="rounded-md bg-amber-50 px-3 py-2">
                                <p className="text-xs font-semibold text-amber-500">
                                  语境 / 搭配解释
                                </p>
                                <p className="mt-1 text-sm whitespace-pre-line text-amber-900">
                                  {contextNote}
                                </p>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {err.keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {err.keywords.map((k, j) => (
                            <span
                              key={j}
                              className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {cardMatches.length > 0 ? (
                  <div className="space-y-4 border-t border-slate-100 pt-4">
                    <h4 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                      为你找到 {cardMatches.length} 个相关知识点
                    </h4>
                    {cardMatches.map((card, i) => (
                      <Card
                        key={card.id ?? `${card.card_code}-${i}`}
                        card={card}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="border-t border-slate-100 pt-4 text-xs text-slate-400">
                    卡片库中没有匹配到相关知识点
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {!analysisErrors && !analysisError && !busy && (
          <div className="py-16 text-center text-slate-400">
            <p className="text-4xl">✍️</p>
            <p className="mt-3 text-sm">
              粘贴英文句子或上传错题图片，开始智能语法分析
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
