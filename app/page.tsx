"use client";

import { useRef, useState } from "react";
import { getSupabase, type GrammarCard } from "@/lib/supabase";
import { Card } from "@/components/GrammarCardView";
import { SiteNav } from "@/components/SiteNav";

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

/** 分步引导的单个步骤 */
interface GuideStep {
  step: number;
  question: string;
  options: string[];
  correct_answer: string;
  hint: string;
  knowledge_point: string;
  card_codes: string[];
}

/** 润色结果中的单条逐句修改说明 */
interface PolishNote {
  original: string;
  revised: string;
  note: string;
}

/** /api/polish 返回的润色结果 */
interface PolishResult {
  essay: string; // 润色后的完整作文（保留段落）
  notes: PolishNote[]; // 结构化的逐句说明
  notesRaw: string; // 说明区原文（结构化解析失败时兜底展示）
}

/** /api/essay 返回的作文分析结果 */
interface EssayResult {
  onTopic: boolean;
  onTopicComment: string;
  structure: string;
  language: string;
  errors: AnalysisError[];
}

/** 追问对话消息 */
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** /api/practice 返回的变式练习题 */
interface PracticeExercise {
  type: "choice" | "fill";
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

/** 单处错误的"我不懂"展开面板 */
interface PracticePanel {
  loading: boolean;
  failed: boolean;
  knowledgePoint: string;
  cards: GrammarCard[];
  exercises: PracticeExercise[];
  picked: (string | null)[]; // 选择题每题已选选项
  fillText: string[]; // 填空题每题输入
  checked: boolean[]; // 每题是否已提交答案（提交后显示解析）
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

  // 分步引导答题状态
  const [mode, setMode] = useState<"analyze" | "guide" | "polish" | "essay" | null>(null);
  const [polish, setPolish] = useState<PolishResult | null>(null);
  // 作文分析（两步流程）：①题目要求 ②作文
  const [topicText, setTopicText] = useState("");
  const [essayResult, setEssayResult] = useState<EssayResult | null>(null);
  // 分析时的题目+作文快照，供追问使用（用户之后可能改了输入框）
  const [essaySnapshot, setEssaySnapshot] = useState<{
    topic: string;
    essay: string;
  } | null>(null);
  // 作文追问对话
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  // 每处错误的练习面板，key 为错误在 errors 中的下标
  const [practicePanels, setPracticePanels] = useState<
    Record<number, PracticePanel>
  >({});
  const [guide, setGuide] = useState<{
    steps: GuideStep[];
    topic: string;
    cards: Map<string, GrammarCard>;
  } | null>(null);
  const [gIdx, setGIdx] = useState(0);
  const [gChosen, setGChosen] = useState<(string | null)[]>([]); // 每步最近一次选择
  const [gFirstCorrect, setGFirstCorrect] = useState<boolean[]>([]); // 每步是否一次答对
  const [gShowCard, setGShowCard] = useState<boolean[]>([]); // 每步是否展开知识点卡片
  const [gFinished, setGFinished] = useState(false);

  // 错题图片上传
  const ERROR_BUCKET = "error-bank";
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicFileInputRef = useRef<HTMLInputElement>(null);

  function resetResults() {
    setAnalysisError(null);
    setAnalysisErrors(null);
    setCardMatches([]);
    setMode(null);
    setGuide(null);
    setPolish(null);
    setEssayResult(null);
    setEssaySnapshot(null);
    setChatMessages([]);
    setChatInput("");
    setPracticePanels({});
    setGIdx(0);
    setGChosen([]);
    setGFirstCorrect([]);
    setGShowCard([]);
    setGFinished(false);
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

    // AI 直接返回知识点编号，前端用 .in() 精确取卡，结果稳定可复现
    const codes: string[] = Array.isArray(data?.matched_card_codes)
      ? data.matched_card_codes.filter((c: unknown) => typeof c === "string")
      : [];
    if (codes.length) {
      const { data: matched, error: qErr } = await getSupabase()
        .from("grammar_cards")
        .select("*")
        .in("card_code", codes);
      if (qErr) throw qErr;
      // 按 AI 返回的编号顺序排列
      const byCode = new Map(
        ((matched as GrammarCard[] | null) ?? []).map((c) => [c.card_code, c])
      );
      setCardMatches(
        codes.map((c) => byCode.get(c)).filter((c): c is GrammarCard => !!c)
      );
    }
    setMode("analyze");
  }

  /** 调用 /api/guide 拆题，并预取所有步骤引用的知识点卡片 */
  async function runGuide(text: string) {
    setBusyHint("AI 正在拆成引导步骤…");
    const res = await fetch("/api/guide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "生成引导题失败，请重试");

    const steps: GuideStep[] = Array.isArray(data?.steps) ? data.steps : [];
    if (steps.length === 0) {
      throw new Error("AI 没有拆出引导步骤，请换一道题试试");
    }

    // 一次性预取全部步骤引用的卡片
    const codes = [...new Set(steps.flatMap((s) => s.card_codes))];
    const cards = new Map<string, GrammarCard>();
    if (codes.length) {
      const { data: rows, error: qErr } = await getSupabase()
        .from("grammar_cards")
        .select("*")
        .in("card_code", codes);
      if (qErr) throw qErr;
      for (const c of (rows as GrammarCard[] | null) ?? []) cards.set(c.card_code, c);
    }

    setGuide({ steps, topic: String(data?.summary_topic ?? ""), cards });
    setGIdx(0);
    setGChosen(steps.map(() => null));
    setGFirstCorrect(steps.map(() => false));
    setGShowCard(steps.map(() => false));
    setGFinished(false);
    setMode("guide");
  }

  /** 调用 /api/polish 润色作文（单句话同样适用），结果分区域展示 */
  async function runPolish(text: string) {
    setBusyHint("AI 正在润色英文…");
    const res = await fetch("/api/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "润色失败，请重试");

    const result: PolishResult = {
      essay: typeof data?.essay === "string" ? data.essay : "",
      notes: Array.isArray(data?.notes) ? data.notes : [],
      notesRaw: typeof data?.notes_raw === "string" ? data.notes_raw : "",
    };
    if (!result.essay) throw new Error("AI 未返回润色结果，请重试");
    setPolish(result);
    setMode("polish");
  }

  /** 选择某一步的选项 */
  function chooseOption(opt: string) {
    if (!guide) return;
    const step = guide.steps[gIdx];
    if (gChosen[gIdx] === step.correct_answer) return; // 已答对，锁定
    const nextChosen = [...gChosen];
    nextChosen[gIdx] = opt;
    setGChosen(nextChosen);
    if (opt === step.correct_answer) {
      // 第一次尝试就答对才得分
      if (gChosen[gIdx] === null) {
        const f = [...gFirstCorrect];
        f[gIdx] = true;
        setGFirstCorrect(f);
      }
    } else {
      // 答错：自动弹出知识点卡片
      const s = [...gShowCard];
      s[gIdx] = true;
      setGShowCard(s);
    }
  }

  function gotoNextStep() {
    if (!guide) return;
    if (gIdx + 1 >= guide.steps.length) setGFinished(true);
    else setGIdx(gIdx + 1);
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

  /** 文本框分步引导答题 */
  async function handleGuide() {
    const text = analysisText.trim();
    if (busy || !text) return;
    setBusy(true);
    resetResults();
    try {
      await runGuide(text);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "生成引导题失败，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  /** 调用 /api/essay：题目要求 + 作文一起分析，并匹配知识点卡片 */
  async function runEssay(topic: string, essay: string) {
    setBusyHint("AI 正在批改作文…");
    const res = await fetch("/api/essay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, essay }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "作文分析失败，请重试");

    setEssayResult({
      onTopic: data?.on_topic?.is_on_topic !== false,
      onTopicComment:
        typeof data?.on_topic?.comment === "string"
          ? data.on_topic.comment
          : "",
      structure: typeof data?.structure === "string" ? data.structure : "",
      language: typeof data?.language === "string" ? data.language : "",
      errors: Array.isArray(data?.errors) ? data.errors : [],
    });

    // 与智能语法分析一致：AI 返回编号，前端 .in() 精确取卡
    const codes: string[] = Array.isArray(data?.matched_card_codes)
      ? data.matched_card_codes.filter((c: unknown) => typeof c === "string")
      : [];
    if (codes.length) {
      const { data: matched, error: qErr } = await getSupabase()
        .from("grammar_cards")
        .select("*")
        .in("card_code", codes);
      if (qErr) throw qErr;
      const byCode = new Map(
        ((matched as GrammarCard[] | null) ?? []).map((c) => [c.card_code, c])
      );
      setCardMatches(
        codes.map((c) => byCode.get(c)).filter((c): c is GrammarCard => !!c)
      );
    }
    setMode("essay");
    setEssaySnapshot({ topic, essay });
  }

  /** 把已有作文分析结果拼成纯文本，作为追问时的上下文 */
  function buildAnalysisContext(r: EssayResult): string {
    const lines = [
      `扣题判断：${r.onTopic ? "切题" : "偏题"}。${r.onTopicComment}`,
      r.structure ? `结构评价：${r.structure}` : "",
      r.language ? `语言评价：${r.language}` : "",
      r.errors.length
        ? "语法错误：\n" +
          r.errors
            .map(
              (e, i) =>
                `${i + 1}. ${e.original} → ${e.corrected}（${
                  e.reason ?? ""
                }）`
            )
            .join("\n")
        : "",
    ];
    return lines.filter(Boolean).join("\n\n");
  }

  /** 作文追问 */
  async function handleFollowup() {
    const question = chatInput.trim();
    if (chatBusy || !question || !essayResult || !essaySnapshot) return;
    const history = chatMessages;
    setChatMessages((m) => [...m, { role: "user", content: question }]);
    setChatInput("");
    setChatBusy(true);
    try {
      const res = await fetch("/api/essay-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: essaySnapshot.topic,
          essay: essaySnapshot.essay,
          analysis: buildAnalysisContext(essayResult),
          history,
          question,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "追问失败，请重试");
      setChatMessages((m) => [
        ...m,
        { role: "assistant", content: String(data.answer ?? "") },
      ]);
    } catch (e) {
      // 失败时把用户消息保留，追加错误提示，方便直接重发
      setChatMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `⚠️ ${e instanceof Error ? e.message : "追问失败，请重试"}`,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  /** 点"这个知识点我不懂"：关键词搜卡 + AI 生成变式练习，两路并行 */
  async function handleExplainError(idx: number) {
    if (!essayResult) return;
    const err = essayResult.errors[idx];
    if (!err) return;
    const existing = practicePanels[idx];
    // 已成功加载（有练习题）则展开/收起切换；失败面板点击则重新请求
    if (existing && !existing.loading && existing.exercises.length > 0) {
      setPracticePanels((p) => {
        const next = { ...p };
        delete next[idx];
        return next;
      });
      return;
    }
    const keyword = (err.keywords ?? []).join("、");
    setPracticePanels((p) => ({
      ...p,
      [idx]: {
        loading: true,
        failed: false,
        knowledgePoint: keyword,
        cards: [],
        exercises: [],
        picked: [],
        fillText: [],
        checked: [],
      },
    }));

    // ① 用错误关键词走 RPC 搜卡（与 /quiz 降级同一函数）
    const cardPromise: Promise<GrammarCard[]> = (async () => {
      try {
        const { data, error } = await getSupabase()
          .rpc("search_grammar_cards", {
            p_keywords: (err.keywords ?? []).slice(0, 4),
            p_limit: 2,
          });
        return error ? [] : ((data as GrammarCard[] | null) ?? []);
      } catch {
        return [];
      }
    })();

    // ② AI 生成变式练习题
    const practicePromise = fetch("/api/practice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        original: err.original,
        corrected: err.corrected,
        reason: err.reason ?? err.explanation ?? "",
      }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成练习题失败");
      return {
        knowledgePoint: String(data?.knowledge_point ?? keyword),
        exercises: (Array.isArray(data?.exercises)
          ? data.exercises
          : []) as PracticeExercise[],
      };
    });

    try {
      const [cards, practice] = await Promise.all([cardPromise, practicePromise]);
      setPracticePanels((p) => ({
        ...p,
        [idx]: {
          loading: false,
          failed: false,
          knowledgePoint: practice.knowledgePoint,
          cards,
          exercises: practice.exercises,
          picked: practice.exercises.map(() => null),
          fillText: practice.exercises.map(() => ""),
          checked: practice.exercises.map(() => false),
        },
      }));
    } catch {
      // 卡片可能已拿到，单独保留；练习题失败时给重试提示
      const cards = await cardPromise;
      setPracticePanels((p) => ({
        ...p,
        [idx]: {
          loading: false,
          failed: true,
          knowledgePoint: keyword,
          cards,
          exercises: [],
          picked: [],
          fillText: [],
          checked: [],
        },
      }));
    }
  }

  /** 更新某处错误面板里某道题的作答状态 */
  function updatePanelExercise(
    errIdx: number,
    exIdx: number,
    patch: Partial<{
      picked: string | null;
      fillText: string;
      checked: boolean;
    }>
  ) {
    setPracticePanels((p) => {
      const panel = p[errIdx];
      if (!panel) return p;
      const next: PracticePanel = {
        ...panel,
        picked: [...panel.picked],
        fillText: [...panel.fillText],
        checked: [...panel.checked],
      };
      if (patch.picked !== undefined) next.picked[exIdx] = patch.picked;
      if (patch.fillText !== undefined) next.fillText[exIdx] = patch.fillText;
      if (patch.checked !== undefined) next.checked[exIdx] = patch.checked;
      return { ...p, [errIdx]: next };
    });
  }

  /** 文本框润色作文 */
  async function handlePolish() {
    const text = analysisText.trim();
    if (busy || !text) return;
    setBusy(true);
    resetResults();
    try {
      await runPolish(text);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "润色失败，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  /** 两步作文分析 */
  async function handleEssay() {
    const topic = topicText.trim();
    const essay = analysisText.trim();
    if (busy || !topic || !essay) return;
    setBusy(true);
    resetResults();
    try {
      await runEssay(topic, essay);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "作文分析失败，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  /** 选图：上传 error-bank → 千问视觉 OCR 回填文本；target 决定回填到题目框还是作文框 */
  async function handleImageSelect(
    e: React.ChangeEvent<HTMLInputElement>,
    target: "topic" | "essay"
  ) {
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
      setBusyHint("正在上传图片…");
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
      if (target === "topic") setTopicText(text);
      else setAnalysisText(text);
      if (!text) {
        throw new Error("没有从图片中识别到文字，请换一张更清晰的图片");
      }
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "处理失败，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  const canAnalyze = !busy && !!analysisText.trim();
  const canEssay = !busy && !!analysisText.trim() && !!topicText.trim();

  return (
    <div className="min-h-screen">
      <SiteNav />
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

          {/* 第一步：题目要求（作文分析用，可选） */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">
                ① 题目要求
                <span className="ml-1 text-xs font-normal text-slate-400">
                  （作文分析必填，如：请以 My Favorite Season 为题写一篇 80 词作文）
                </span>
              </label>
              <input
                ref={topicFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => handleImageSelect(e, "topic")}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => topicFileInputRef.current?.click()}
                disabled={busy}
                className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                📷 上传题目图片
              </button>
            </div>
            <textarea
              value={topicText}
              onChange={(e) => setTopicText(e.target.value)}
              rows={2}
              placeholder="粘贴作文题目要求（中文也可以），或点右侧按钮上传题目图片自动识别…"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          {/* 第二步：作文 / 句子输入 */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              ② 我的作文 / 句子
            </label>
            <textarea
              value={analysisText}
              onChange={(e) => setAnalysisText(e.target.value)}
              rows={6}
              placeholder="粘贴你的作文（作文分析、润色用），或一句/一段英文（智能分析、分步引导用）；也可以点下方按钮上传图片自动识别…"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
          </div>

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

          {/* 上传图片 + 各功能按钮 */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleImageSelect(e, "essay")}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              📷 上传作文图片
            </button>
            <button
              type="button"
              onClick={handleEssay}
              disabled={!canEssay}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && mode === "essay" ? (
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
                <>📋 分析作文</>
              )}
            </button>
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && mode === "analyze" ? (
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
            <button
              type="button"
              onClick={handlePolish}
              disabled={!canAnalyze}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && mode === "polish" ? (
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
                <>📝 帮我润色作文</>
              )}
            </button>
            <button
              type="button"
              onClick={handleGuide}
              disabled={!canAnalyze}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && mode === "guide" ? (
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
                <>🎯 分步引导答题</>
              )}
            </button>
            <span className="w-full text-xs text-slate-400 sm:w-auto">
              「分析作文」需要先填①题目要求和②作文；其余按钮只需填②
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
        {/* 作文分析结果：扣题 / 结构 / 语言 / 逐处错误 / 知识点卡片 */}
        {mode === "essay" && essayResult && !busy && (
          <div className="space-y-5">
            {/* 总评：扣题 + 结构 + 语言 */}
            <div className="space-y-3 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                📋 作文总评
              </h3>
              <div
                className={`rounded-xl border px-4 py-3 ${
                  essayResult.onTopic
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    essayResult.onTopic ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {essayResult.onTopic ? "✅ 切题" : "⚠️ 偏题"}
                </p>
                {essayResult.onTopicComment && (
                  <p className="mt-1 text-sm whitespace-pre-line text-slate-700">
                    {essayResult.onTopicComment}
                  </p>
                )}
              </div>
              {essayResult.structure && (
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-400">
                    结构评价
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-line text-slate-700">
                    {essayResult.structure}
                  </p>
                </div>
              )}
              {essayResult.language && (
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs font-semibold text-slate-400">
                    语言评价
                  </p>
                  <p className="mt-1 text-sm whitespace-pre-line text-slate-700">
                    {essayResult.language}
                  </p>
                </div>
              )}
            </div>

            {/* 逐处语法错误 */}
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                语法错误与修改建议（{essayResult.errors.length} 处）
              </h3>
              {essayResult.errors.length === 0 ? (
                <p className="py-2 text-center text-sm text-emerald-700">
                  ✅ 未发现明显语法错误
                </p>
              ) : (
                <ul className="space-y-3">
                  {essayResult.errors.map((err, i) => (
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
                      {(err.reason || err.explanation) && (
                        <div className="rounded-md bg-slate-50 px-3 py-2">
                          <p className="text-xs font-semibold text-slate-400">
                            修改建议
                          </p>
                          <p className="mt-1 text-sm whitespace-pre-line text-slate-700">
                            {err.reason || err.explanation}
                          </p>
                        </div>
                      )}
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
                      <button
                        type="button"
                        onClick={() => handleExplainError(i)}
                        disabled={practicePanels[i]?.loading}
                        className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
                      >
                        {practicePanels[i]?.loading
                          ? "正在准备讲解和练习…"
                          : practicePanels[i]
                            ? "收起知识点讲解"
                            : "💡 这个知识点我不懂"}
                      </button>

                      {/* 知识点卡片 + 变式练习 */}
                      {practicePanels[i] && (
                        <PracticeArea
                          panel={practicePanels[i]}
                          onPick={(exIdx, opt) =>
                            updatePanelExercise(i, exIdx, {
                              picked: opt,
                              checked: true,
                            })
                          }
                          onFill={(exIdx, text) =>
                            updatePanelExercise(i, exIdx, { fillText: text })
                          }
                          onCheckFill={(exIdx) =>
                            updatePanelExercise(i, exIdx, { checked: true })
                          }
                          onRetry={() => handleExplainError(i)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}

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
            </div>

            {/* 追问对话框 */}
            <div className="space-y-3 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                💬 对批改结果有疑问？继续问老师
              </h3>

              {chatMessages.length === 0 && (
                <p className="text-xs text-slate-400">
                  例如：这里为什么要用一般现在时？besides 和 except 有什么区别？
                </p>
              )}

              {chatMessages.length > 0 && (
                <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {chatMessages.map((m, i) => (
                    <li
                      key={i}
                      className={`flex ${
                        m.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-6 ${
                          m.role === "user"
                            ? "bg-violet-600 text-white"
                            : "border border-slate-200 bg-slate-50 text-slate-800"
                        }`}
                      >
                        {m.content}
                      </div>
                    </li>
                  ))}
                  {chatBusy && (
                    <li className="flex justify-start">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-400">
                        老师正在思考…
                      </div>
                    </li>
                  )}
                </ul>
              )}

              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleFollowup();
                    }
                  }}
                  placeholder="输入你的问题，回车发送"
                  className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                />
                <button
                  type="button"
                  onClick={handleFollowup}
                  disabled={chatBusy || !chatInput.trim()}
                  className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* 作文润色结果：上方润色后的作文，下方逐句修改说明 */}
        {mode === "polish" && polish && !busy && (
          <div className="space-y-5">
            {/* 上：润色后的完整作文 */}
            <div className="space-y-3 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                ✨ 润色后的作文
              </h3>
              <p className="whitespace-pre-wrap rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-7 text-slate-800">
                {polish.essay}
              </p>
            </div>

            {/* 下：逐句修改说明 */}
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">
                📝 逐句修改说明
                {polish.notes.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    共 {polish.notes.length} 处修改
                  </span>
                )}
              </h3>
              {polish.notes.length > 0 ? (
                <ul className="space-y-3">
                  {polish.notes.map((n, i) => (
                    <li
                      key={i}
                      className="space-y-1.5 border-l-4 border-emerald-300 pl-3"
                    >
                      {n.original && (
                        <p className="text-sm">
                          <span className="text-xs font-semibold text-slate-400">
                            原句{" "}
                          </span>
                          <span className="text-red-600 line-through">
                            {n.original}
                          </span>
                        </p>
                      )}
                      {n.revised && (
                        <p className="text-sm">
                          <span className="text-xs font-semibold text-slate-400">
                            修改{" "}
                          </span>
                          <span className="font-medium text-emerald-700">
                            {n.revised}
                          </span>
                        </p>
                      )}
                      {n.note && (
                        <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                          {n.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                /* 模型输出格式异常时，用纯文本兜底展示说明区，不丢内容 */
                <p className="whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                  {polish.notesRaw || "原文表达正确，无需修改。"}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 分步引导答题 */}
        {mode === "guide" && guide && !busy && (
          <div className="space-y-4">
            {!gFinished ? (
              (() => {
                const step = guide.steps[gIdx];
                const chosen = gChosen[gIdx] ?? null;
                const solved = chosen === step.correct_answer;
                const stepCards = step.card_codes
                  .map((c) => guide.cards.get(c))
                  .filter((c): c is GrammarCard => !!c);
                return (
                  <div className="space-y-4 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
                    {/* 进度 */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-amber-600">
                        第 {gIdx + 1} / {guide.steps.length} 步
                      </span>
                      <span className="text-sm text-slate-500">
                        得分：{gFirstCorrect.filter(Boolean).length}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      {guide.steps.map((_, i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full ${
                            i < gIdx
                              ? "bg-amber-500"
                              : i === gIdx
                                ? "bg-amber-300"
                                : "bg-slate-200"
                          }`}
                        />
                      ))}
                    </div>

                    {/* 问题 */}
                    <div className="space-y-2">
                      {step.knowledge_point && (
                        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                          {step.knowledge_point}
                        </span>
                      )}
                      <p className="text-base font-medium text-slate-900">
                        {step.question}
                      </p>
                    </div>

                    {/* 选项 */}
                    <div className="space-y-2">
                      {step.options.map((opt, i) => {
                        const isCorrect = opt === step.correct_answer;
                        const isPicked = chosen === opt;
                        let cls =
                          "border-slate-200 bg-white text-slate-700 hover:border-amber-400 hover:bg-amber-50";
                        if (solved) {
                          if (isCorrect)
                            cls = "border-emerald-500 bg-emerald-50 text-emerald-800";
                          else if (isPicked)
                            cls = "border-red-400 bg-red-50 text-red-700";
                          else cls = "border-slate-200 bg-white text-slate-400";
                        } else if (isPicked) {
                          cls = "border-red-400 bg-red-50 text-red-700";
                        }
                        return (
                          <button
                            key={i}
                            type="button"
                            disabled={solved}
                            onClick={() => chooseOption(opt)}
                            className={`flex w-full items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left text-sm transition disabled:cursor-default ${cls}`}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold opacity-70">
                              {String.fromCharCode(65 + i)}
                            </span>
                            <span className="flex-1">{opt}</span>
                            {solved && isCorrect && <span>✅</span>}
                            {!solved && isPicked && <span>❌</span>}
                          </button>
                        );
                      })}
                    </div>

                    {/* 反馈区 */}
                    {chosen && !solved && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        <p className="font-semibold">❌ 再想一想</p>
                        {step.hint && <p className="mt-1">💡 {step.hint}</p>}
                      </div>
                    )}
                    {solved && (
                      <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <p className="text-sm font-semibold text-emerald-800">
                          {gFirstCorrect[gIdx]
                            ? "✅ 答对了！+1 分"
                            : "✅ 答对了！"}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const s = [...gShowCard];
                              s[gIdx] = !s[gIdx];
                              setGShowCard(s);
                            }}
                            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            {gShowCard[gIdx] ? "收起知识点卡片" : "查看知识点卡片"}
                          </button>
                          <button
                            type="button"
                            onClick={gotoNextStep}
                            className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
                          >
                            {gIdx + 1 >= guide.steps.length
                              ? "查看总结 →"
                              : "下一步 →"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 知识点卡片（答错自动弹出，答对可手动展开） */}
                    {gShowCard[gIdx] && (
                      <div className="space-y-3">
                        {stepCards.length > 0 ? (
                          stepCards.map((card, i) => (
                            <Card
                              key={card.id ?? `${card.card_code}-${i}`}
                              card={card}
                            />
                          ))
                        ) : (
                          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
                            这一步暂时没有对应的知识点卡片
                          </p>
                        )}
                        {!solved && (
                          <p className="text-center text-xs text-slate-500">
                            看完知识点后，重新选择上方答案继续
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              /* 总结 */
              <div className="space-y-4 rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-sm">
                <p className="text-4xl">🎉</p>
                <h3 className="text-lg font-bold text-slate-900">
                  {gFirstCorrect.every(Boolean)
                    ? "全部一次答对，太棒了！"
                    : "全部完成，为你坚持思考点赞！"}
                </h3>
                <p className="text-sm text-slate-600">
                  这道题考的是
                  <span className="mx-1 font-semibold text-amber-600">
                    {guide.topic || "综合语法"}
                  </span>
                  ，你答对了{" "}
                  <span className="font-semibold text-emerald-600">
                    {gFirstCorrect.filter(Boolean).length}
                  </span>{" "}
                  / {guide.steps.length} 步。
                  {gFirstCorrect.every(Boolean)
                    ? "这个知识点你掌握得很好！"
                    : "答错的步骤已经展示了知识点卡片，建议再复习一遍。"}
                </p>
                <button
                  type="button"
                  onClick={resetResults}
                  className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-600"
                >
                  再来一题
                </button>
              </div>
            )}
          </div>
        )}

        {mode === null && !analysisError && !busy && (
          <div className="py-16 text-center text-slate-400">
            <p className="text-4xl">✍️</p>
            <p className="mt-3 text-sm">
              粘贴英文句子或上传错题图片，选择智能分析、润色作文或分步引导答题
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

/** 作文批改中"这个知识点我不懂"展开的讲解 + 练习区 */
function PracticeArea(props: {
  panel: PracticePanel;
  onPick: (exIdx: number, opt: string) => void;
  onFill: (exIdx: number, text: string) => void;
  onCheckFill: (exIdx: number) => void;
  onRetry: () => void;
}) {
  const { panel, onPick, onFill, onCheckFill, onRetry } = props;

  if (panel.loading) {
    return (
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-600">
        正在匹配知识点卡片、生成针对性练习…
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      {/* 关键词匹配到的知识点卡片 */}
      {panel.cards.length > 0 ? (
        panel.cards.map((card, i) => (
          <Card key={card.id ?? `${card.card_code}-${i}`} card={card} />
        ))
      ) : (
        !panel.failed && (
          <p className="text-xs text-slate-400">
            卡片库中暂时没有直接对应的知识点卡片，先做下面的练习吧
          </p>
        )
      )}

      {panel.failed ? (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <span className="text-xs text-red-700">
            针对性练习生成失败（不影响上面的知识点卡片）
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            重试
          </button>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-semibold text-violet-700">
            🎯 针对性变式练习 · {panel.knowledgePoint}
          </p>
          {panel.exercises.map((ex, j) => {
            const checked = panel.checked[j];
            const picked = panel.picked[j] ?? null;
            const fillVal = panel.fillText[j] ?? "";
            const fillCorrect =
              fillVal.trim().toLowerCase() === ex.answer.trim().toLowerCase();
            return (
              <div key={j} className="space-y-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium text-slate-800">
                  {j + 1}. {ex.question}
                </p>

                {ex.type === "choice" ? (
                  <div className="space-y-1.5">
                    {ex.options.map((opt, k) => {
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
                          key={k}
                          type="button"
                          disabled={checked}
                          onClick={() => onPick(j, opt)}
                          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-default ${cls}`}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-semibold opacity-70">
                            {String.fromCharCode(65 + k)}
                          </span>
                          <span className="flex-1">{opt}</span>
                          {checked && isAnswer && <span>✅</span>}
                          {checked && !isAnswer && isPicked && <span>❌</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={fillVal}
                      disabled={checked}
                      onChange={(e) => onFill(j, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && fillVal.trim())
                          onCheckFill(j);
                      }}
                      placeholder="填入英文答案"
                      className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 disabled:bg-slate-50"
                    />
                    {!checked && (
                      <button
                        type="button"
                        disabled={!fillVal.trim()}
                        onClick={() => onCheckFill(j)}
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                      >
                        提交
                      </button>
                    )}
                  </div>
                )}

                {checked && (
                  <div
                    className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                      ex.type === "choice"
                        ? picked === ex.answer
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-red-50 text-red-800"
                        : fillCorrect
                          ? "bg-emerald-50 text-emerald-800"
                          : "bg-red-50 text-red-800"
                    }`}
                  >
                    {ex.type === "choice"
                      ? picked === ex.answer
                        ? "✅ 答对了！"
                        : `❌ 正确答案是「${ex.answer}」。`
                      : fillCorrect
                        ? "✅ 答对了！"
                        : `❌ 正确答案是「${ex.answer}」。`}
                    {ex.explanation && (
                      <span className="mt-0.5 block text-slate-700">
                        💡 {ex.explanation}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
