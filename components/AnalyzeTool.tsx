"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase, getStoredSession } from "@/lib/supabase";
import { SiteNav } from "@/components/SiteNav";
import { Mascot, type MascotMood } from "@/components/Mascot";
import type { Exercise } from "@/lib/exercise";
import { searchReferences, type ReferenceItem } from "@/lib/search";
import type { User } from "@supabase/supabase-js";

/** AI 分析返回的单个语法错误 */
interface AnalysisError {
  original: string;
  corrected: string;
  reason?: string; // 错误原因（含学生犯错的心理）
  explanation?: string; // 兼容旧字段
  context_note?: string; // 语境/搭配解释，可为空
  suggestion?: string; // 修改建议（作文分析使用）
  knowledge_point?: string; // 细化知识点（作文分析使用，如"主谓一致 - 就近一致"）
  exercises?: Exercise[]; // 作文分析现场生成的针对性练习
  keywords?: string[]; // 旧字段（单题分析已改用 knowledge_point）
}

/** 选择题解题模式：单个选项分析 */
interface QuizOption {
  letter: string;
  text: string;
  is_correct: boolean;
  analysis: string;
}

/** 选择题解题模式结果（未做的选择题：正确答案 + 考点 + 逐项分析） */
interface QuizSolution {
  answer_letter: string;
  answer_text: string;
  knowledge_point: string;
  explanation: string;
  options: QuizOption[];
}

/** AI 分析与外部搜索参考资料的对照结论 */
interface ReferenceCheck {
  status: "consistent" | "difference" | "none";
  comment: string;
}

/** 已上传的错题图片（Supabase Storage 公共 URL） */
interface SelectedImage {
  url: string;
  name: string;
}

/** 图片识别结果确认面板（识别后先校对再分析）；past/future 为撤销/重做栈 */
interface OcrConfirm {
  target: "topic" | "essay";
  text: string;
  past: string[];
  future: string[];
}

/** 维度评价等级 */
type EvalLevel = "超出预期" | "优秀" | "良好" | "一般" | "待提高";

/** 按写作类型评分维度的单项评价 */
interface ScoreItem {
  name: string;
  level: EvalLevel;
  comment: string;
}

/** 作文亮点摘录条目（亮点词汇 / 亮点句式） */
interface HighlightItem {
  text: string;
  kind: "亮点词汇" | "亮点句式";
  level: string;
  note: string;
}

/** 作文改进建议条目 */
interface ImprovementItem {
  issue: string;
  suggestion: string;
}

/** /api/essay 返回的作文分析结果 */
interface EssayResult {
  onTopic: boolean;
  onTopicComment: string;
  overallSummary: string;
  scores: ScoreItem[];
  highlights: HighlightItem[];
  improvements: ImprovementItem[];
  modelEssay: string;
  scopeLabel: string;
  errors: AnalysisError[];
}

/** 写作类型分组下拉选项 */
const ESSAY_SCOPE_GROUPS: { group: string; items: string[] }[] = [
  { group: "国内考试", items: ["中考", "高考"] },
  { group: "单元作文", items: ["七上", "七下", "八上", "八下", "九上", "九下"] },
  { group: "剑桥英语", items: ["KET", "PET", "FCE", "CAE"] },
  { group: "出国考试", items: ["雅思", "托福"] },
];

/** 写作类型自定义下拉：文字在按钮内绝对居中（箭头绝对定位在右侧，不占居中空间） */
function EssayTypeSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-full sm:w-40">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="relative flex h-10 w-full items-center justify-center rounded-2xl border border-[#ddcbfa] bg-white px-3 text-sm font-medium text-slate-700 outline-none transition hover:bg-[#f6f0fe] focus:border-[#b79df2] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* 文字在整按钮宽度内绝对居中 */}
        <span className="truncate">{value || "写作类型"}</span>
        {/* 箭头绝对贴右，不参与居中布局；展开时翻转 */}
        <svg
          className={`absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 z-30 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-[#ecebfa] bg-white py-1 shadow-[0_12px_30px_-14px_rgba(108,79,216,0.4)]"
        >
          {/* 首项：写作类型（重置为默认中考标准） */}
          <button
            type="button"
            role="option"
            aria-selected={value === ""}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`block w-full px-3 py-1.5 text-left text-sm transition hover:bg-indigo-50 ${
              value === "" ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-700"
            }`}
          >
            写作类型
          </button>
          <div className="mx-2 my-1 border-t border-slate-100" />
          {ESSAY_SCOPE_GROUPS.map((g) => (
            <div key={g.group}>
              <p className="px-3 pt-1 pb-0.5 text-xs font-semibold text-slate-400">{g.group}</p>
              {g.items.map((it) => (
                <button
                  key={it}
                  type="button"
                  role="option"
                  aria-selected={value === it}
                  onClick={() => {
                    onChange(it);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-sm transition hover:bg-indigo-50 ${
                    value === it ? "font-semibold text-indigo-700" : "text-slate-700"
                  }`}
                >
                  {it}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 等级徽章配色 */
function levelBadgeClass(level: EvalLevel): string {
  switch (level) {
    case "超出预期":
      return "border-amber-300 bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800";
    case "优秀":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "良好":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "一般":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-red-200 bg-red-50 text-red-700";
  }
}

/** 等级徽章展示文案（超出预期加星标） */
function levelBadgeText(level: EvalLevel): string {
  return level === "超出预期" ? "🌟 超出预期" : level;
}

/** 追问对话消息 */
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/** 作文分析中每处错误的练习题作答状态，key 为错误下标 */
interface PracticePanel {
  picked: (string | null)[]; // 选择题每题已选选项
  fillText: string[]; // 填空题每题输入
  checked: boolean[]; // 每题是否已提交答案（提交后显示解析）
  loadingMore: boolean; // "生成更多"请求中
  moreError?: string; // "生成更多"失败提示
}

/** 练习题作答状态（单题分析与作文分析共用） */
interface ExerciseState {
  picked: (string | null)[];
  fillText: string[];
  checked: boolean[];
}

/** /api/explain 返回的知识点现场讲解 */
interface KnowledgeExplain {
  knowledge_point: string;
  rules: string;
  examples: string;
  confusions: string;
  common_mistakes: string;
}

/** 单题语法分析中每处错误的交互面板（讲解 + 练习），key 为错误下标 */
interface AnalyzePanel extends ExerciseState {
  explainBusy: boolean;
  explainOpen: boolean; // 讲解区是否展开
  explain?: KnowledgeExplain;
  explainError?: string;
  exBusy: boolean; // 生成练习题请求中
  exercises: Exercise[];
  exError?: string;
}

/**
 * 语法分析工具（单题语法分析 / 作文分析共用同一套逻辑与结果展示）。
 * variant="single"：只显示单题分析；variant="essay"：显示题目要求 + 作文分析。
 */
export default function AnalyzeTool({
  variant = "single",
}: {
  variant?: "single" | "essay";
}) {
  // 当前登录用户（Supabase Auth，null = 未登录）
  const [user, setUser] = useState<User | null>(null);

  // 输入与分析状态
  const [analysisText, setAnalysisText] = useState("");
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(
    null
  );
  // 图片识别结果确认面板：识别完成后先让用户校对、可撤销/重做，确认后再分析
  const [ocrConfirm, setOcrConfirm] = useState<OcrConfirm | null>(null);
  // 最近一次编辑时间戳：连续输入 700ms 内合并为一个撤销检查点，避免逐字撤销
  const ocrEditAtRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState(""); // 上传中 / 识别图片中 / AI 分析中
  const [analysisErrors, setAnalysisErrors] = useState<AnalysisError[] | null>(
    null
  );
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  // 选择题解题模式结果（输入为未做的选择题时使用，与 analysisErrors 互斥）
  const [quizSolution, setQuizSolution] = useState<QuizSolution | null>(null);
  // 外部参考资料搜索结果（标题+摘要）及 AI 对照结论，解题/批改两种模式共用
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>([]);
  const [referenceCheck, setReferenceCheck] =
    useState<ReferenceCheck | null>(null);
  // 外部参考对照横幅详情默认收起，点击标题展开
  const [refBannerOpen, setRefBannerOpen] = useState(false);
  // 吉祥物"小雷达"情绪：答对笑、答错思考，几秒后回到平静
  const [mascotMood, setMascotMood] = useState<MascotMood>("idle");
  const [mascotTick, setMascotTick] = useState(0);
  const mascotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 单题分析每处错误的"讲解 + 练习"面板，key 为错误下标
  const [analyzePanels, setAnalyzePanels] = useState<
    Record<number, AnalyzePanel>
  >({});

  // 分析模式状态
  const [mode, setMode] = useState<"analyze" | "essay" | null>(null);
  // 作文分析（两步流程）：①题目要求 ②作文
  const [topicText, setTopicText] = useState("");
  const [essayScope, setEssayScope] = useState(""); // 写作类型，空 = 默认中考标准
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
  // 单题分析时的原文快照，供追问使用（用户之后可能改了输入框）
  const [analyzeSnapshot, setAnalyzeSnapshot] = useState<string | null>(null);
  // 单题分析追问对话
  const [aChatMessages, setAChatMessages] = useState<ChatMsg[]>([]);
  const [aChatInput, setAChatInput] = useState("");
  const [aChatBusy, setAChatBusy] = useState(false);
  // 每处错误的练习面板，key 为错误在 errors 中的下标
  const [practicePanels, setPracticePanels] = useState<
    Record<number, PracticePanel>
  >({});

  // 错题图片上传
  const ERROR_BUCKET = "error-bank";
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicFileInputRef = useRef<HTMLInputElement>(null);

  // 监听登录状态（AuthArea 挂在 SiteNav，这里独立同步一份 user）
  useEffect(() => {
    const sb = getSupabase();

    // 本地缓存会话即时填充（弱网下保证图片上传路径立即使用 user_id 而非 anonymous/）
    const cached = getStoredSession()?.user;
    if (cached?.id) {
      setUser({ id: cached.id, email: cached.email ?? null } as User);
    }

    sb.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  /** 分析完成后保存记录到 user_records；未登录则提示“请先登录”，不尝试插入 */
  async function saveRecord(params: {
    inputText: string;
    imageUrl?: string | null;
    analysisResult: unknown;
    knowledgePoints: string[];
  }) {
    // 以服务端校验过的最新身份为准，而不是 React state（避免 session 过期还拿着旧 user）
    const {
      data: { user: currentUser },
    } = await getSupabase().auth.getUser();
    if (!currentUser) {
      setAnalysisError("记录未保存：请先登录后再进行分析");
      return;
    }
    const { error: insErr } = await getSupabase()
      .from("user_records")
      .insert({
        user_id: currentUser.id, // 显式传 user_id，RLS 的 with check 依赖它
        image_url: params.imageUrl ?? null,
        input_text: params.inputText.slice(0, 4000),
        analysis_result: params.analysisResult,
        knowledge_points: params.knowledgePoints,
      });
    if (insErr) {
      setAnalysisError(`记录保存失败：${insErr.message}（分析结果不受影响）`);
    }
  }

  function resetResults() {
    setAnalysisError(null);
    setAnalysisErrors(null);
    setQuizSolution(null);
    setReferenceItems([]);
    setReferenceCheck(null);
    setRefBannerOpen(false);
    setMascotMood("idle");
    setAnalyzePanels({});
    setAnalyzeSnapshot(null);
    setAChatMessages([]);
    setAChatInput("");
    setMode(null);
    setEssayResult(null);
    setEssaySnapshot(null);
    setChatMessages([]);
    setChatInput("");
    setPracticePanels({});
  }

  /**
   * 调用 /api/analyze 单题语法分析（无卡片，错误自带细化知识点与三段讲解）。
   * 分析前先做"搜索二次确认"：提取题干关键词 → 搜外部参考资料（占位接口，
   * 暂不可用时返回空数组）→ 参考资料随题目一起发给 DeepSeek 对照。
   */
  async function runAnalysis(text: string) {
    // 第一步：搜索外部参考资料。接口约定失败不抛错，这里再包一层 try 双保险，
    // 任何异常都降级为空参考（纯 AI 分析）。
    setBusyHint("正在搜索外部参考资料…");
    let references: ReferenceItem[] = [];
    try {
      references = await searchReferences(text);
    } catch {
      references = [];
    }
    setReferenceItems(references);

    // 第二步：题目 + 参考资料一起发给 AI，AI 先独立分析再对照
    setBusyHint("AI 正在分析语法…");
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, references }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "分析失败，请重试");

    // 对照结论（服务端已保证字段存在且合法）
    const refCheck: ReferenceCheck =
      data?.reference_check?.status === "consistent" ||
      data?.reference_check?.status === "difference" ||
      data?.reference_check?.status === "none"
        ? {
            status: data.reference_check.status,
            comment: String(data.reference_check.comment ?? ""),
          }
        : {
            status: "none",
            comment:
              "未找到明确的外部参考，以下为纯 AI 分析，本题建议核对课本或询问老师",
          };
    setReferenceCheck(refCheck);
    setRefBannerOpen(false);

    // 未做的选择题 → 解题模式；已完成句子 → 批改模式
    if (data?.input_type === "quiz" && data.quiz) {
      const quiz = data.quiz as QuizSolution;
      setQuizSolution(quiz);
      setAnalysisErrors([]);
      setAnalyzePanels({});
      setAnalyzeSnapshot(text);
      setAChatMessages([]);
      setAChatInput("");
      setMode("analyze");
      // 保存到学习记录
      saveRecord({
        inputText: text,
        imageUrl: selectedImage?.url ?? null,
        analysisResult: {
          type: "analyze-quiz",
          quiz,
          reference_check: refCheck,
        },
        knowledgePoints: quiz.knowledge_point ? [quiz.knowledge_point] : [],
      });
      return;
    }

    const errors: AnalysisError[] = Array.isArray(data?.errors)
      ? data.errors
      : [];
    setQuizSolution(null);
    setAnalysisErrors(errors);
    setAnalyzePanels({});
    setAnalyzeSnapshot(text);
    setAChatMessages([]);
    setAChatInput("");
    setMode("analyze");
    // 保存到学习记录
    saveRecord({
      inputText: text,
      imageUrl: selectedImage?.url ?? null,
      analysisResult: { type: "analyze", errors, reference_check: refCheck },
      knowledgePoints: errors
        .map((e) => e.knowledge_point ?? "")
        .filter(Boolean),
    });
  }

  /** 文本框直接分析；overrideText 用于图片识别确认后立即分析（绕过异步 setState） */
  async function handleAnalyze(overrideText?: string) {
    const text = (overrideText ?? analysisText).trim();
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

  /** 调用 /api/essay：题目+作文分析，每处错误自带细化知识点、三段讲解和练习题 */
  async function runEssay(topic: string, essay: string) {
    setBusyHint("AI 正在批改作文并生成针对性练习…");
    const res = await fetch("/api/essay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, essay, scope: essayScope }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "作文分析失败，请重试");

    const errors: AnalysisError[] = Array.isArray(data?.errors)
      ? data.errors
      : [];
    const LEVELS = ["超出预期", "优秀", "良好", "一般", "待提高"];
    const pickLevel = (v: unknown): EvalLevel =>
      typeof v === "string" && (LEVELS as string[]).includes(v.trim())
        ? (v.trim() as EvalLevel)
        : "良好";
    const highlights: HighlightItem[] = Array.isArray(data?.highlights)
      ? data.highlights
          .map((h: Record<string, unknown>) => ({
            text: typeof h?.text === "string" ? h.text.trim() : "",
            kind:
              typeof h?.kind === "string" && h.kind.includes("句式")
                ? ("亮点句式" as const)
                : ("亮点词汇" as const),
            level: typeof h?.level === "string" ? h.level.trim() : "",
            note: typeof h?.note === "string" ? h.note.trim() : "",
          }))
          .filter((h: HighlightItem) => h.text)
      : [];
    const improvements: ImprovementItem[] = Array.isArray(data?.improvements)
      ? data.improvements
          .map((it: Record<string, unknown>) => ({
            issue: typeof it?.issue === "string" ? it.issue.trim() : "",
            suggestion:
              typeof it?.suggestion === "string" ? it.suggestion.trim() : "",
          }))
          .filter((it: ImprovementItem) => it.issue && it.suggestion)
      : [];
    setEssayResult({
      onTopic: data?.on_topic?.is_on_topic !== false,
      onTopicComment:
        typeof data?.on_topic?.comment === "string"
          ? data.on_topic.comment
          : "",
      overallSummary:
        typeof data?.overall_summary === "string" ? data.overall_summary : "",
      scores: Array.isArray(data?.scores)
        ? data.scores.map((s: Record<string, unknown>) => ({
            name: typeof s?.name === "string" ? s.name : "",
            level: pickLevel(s?.level),
            comment: typeof s?.comment === "string" ? s.comment : "",
          })).filter((s: ScoreItem) => s.name)
        : [],
      highlights,
      improvements,
      modelEssay: typeof data?.model_essay === "string" ? data.model_essay : "",
      scopeLabel: essayScope || "中考（默认）",
      errors,
    });

    // 初始化每处错误的练习题作答状态
    setPracticePanels(
      Object.fromEntries(
        errors.map((e, i) => [
          i,
          {
            picked: (e.exercises ?? []).map(() => null),
            fillText: (e.exercises ?? []).map(() => ""),
            checked: (e.exercises ?? []).map(() => false),
            loadingMore: false,
          },
        ])
      )
    );
    setMode("essay");
    setEssaySnapshot({ topic, essay });
    // 保存到学习记录
    saveRecord({
      inputText: `【题目】${topic}\n\n【作文】${essay}`,
      imageUrl: selectedImage?.url ?? null,
      analysisResult: { type: "essay", result: data },
      knowledgePoints: errors
        .map((e) => e.knowledge_point ?? "")
        .filter(Boolean),
    });
  }

  /** 把已有作文分析结果拼成纯文本，作为追问时的上下文 */
  function buildAnalysisContext(r: EssayResult): string {
    const lines = [
      `写作类型：${r.scopeLabel}`,
      `扣题判断：${r.onTopic ? "切题" : "偏题"}。${r.onTopicComment}`,
      r.overallSummary ? `一句话总评：${r.overallSummary}` : "",
      r.scores.length
        ? "评分维度：\n" +
          r.scores.map((s) => `- ${s.name}：${s.level}。${s.comment}`).join("\n")
        : "",
      r.highlights.length
        ? "亮点摘录：\n" +
          r.highlights
            .map((h) => `- 【${h.kind}】${h.text}（${h.level}）：${h.note}`)
            .join("\n")
        : "",
      r.improvements.length
        ? "明显需要改善的地方：\n" +
          r.improvements
            .map((it) => `- ${it.issue} → ${it.suggestion}`)
            .join("\n")
        : "",
      r.modelEssay ? `参考范文：\n${r.modelEssay}` : "",
      r.errors.length
        ? "语法错误：\n" +
          r.errors
            .map((e, i) => {
              const parts = [
                `${i + 1}. ${e.original} → ${e.corrected}`,
                e.knowledge_point ? `知识点：${e.knowledge_point}` : "",
                e.reason || e.explanation
                  ? `错误原因：${e.reason ?? e.explanation}`
                  : "",
                e.context_note ? `语境解释：${e.context_note}` : "",
                e.suggestion ? `修改建议：${e.suggestion}` : "",
              ];
              return parts.filter(Boolean).join("\n");
            })
            .join("\n\n")
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

  /** "生成更多练习题"：按细化知识点追加新题，带上已出题列表避免重复 */
  async function loadMoreExercises(idx: number) {
    if (!essayResult) return;
    const err = essayResult.errors[idx];
    const panel = practicePanels[idx];
    if (!err || !panel || panel.loadingMore) return;

    const existed = err.exercises ?? [];
    setPracticePanels((p) =>
      p[idx]
        ? { ...p, [idx]: { ...p[idx], loadingMore: true, moreError: undefined } }
        : p
    );
    try {
      const res = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_point: err.knowledge_point ?? "",
          original: err.original,
          corrected: err.corrected,
          reason:
            [err.reason ?? err.explanation, err.suggestion]
              .filter(Boolean)
              .join("\n修改建议：") || "",
          exclude: existed.map((ex) => ex.question),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成练习题失败");
      const more = (Array.isArray(data?.exercises)
        ? data.exercises
        : []) as Exercise[];
      if (more.length === 0) throw new Error("AI 没有生成新的练习题");

      // 追加到该错误的题目列表
      setEssayResult((r) => {
        if (!r) return r;
        const errors = [...r.errors];
        errors[idx] = {
          ...errors[idx],
          knowledge_point:
            String(data?.knowledge_point ?? "") || errors[idx].knowledge_point,
          exercises: [...(errors[idx].exercises ?? []), ...more],
        };
        return { ...r, errors };
      });
      setPracticePanels((p) => {
        const cur = p[idx];
        if (!cur) return p;
        return {
          ...p,
          [idx]: {
            ...cur,
            loadingMore: false,
            picked: [...cur.picked, ...more.map(() => null)],
            fillText: [...cur.fillText, ...more.map(() => "")],
            checked: [...cur.checked, ...more.map(() => false)],
          },
        };
      });
    } catch (e) {
      setPracticePanels((p) =>
        p[idx]
          ? {
              ...p,
              [idx]: {
                ...p[idx],
                loadingMore: false,
                moreError: e instanceof Error ? e.message : "生成失败，请重试",
              },
            }
          : p
      );
    }
  }

  /** 吉祥物情绪闪现：答对笑、答错思考，3.5 秒后回到平静；tick 用于重放动画 */
  function flashMascot(mood: "happy" | "thinking") {
    setMascotMood(mood);
    setMascotTick((t) => t + 1);
    if (mascotTimer.current) clearTimeout(mascotTimer.current);
    mascotTimer.current = setTimeout(() => setMascotMood("idle"), 3500);
  }

  /** 按用户答案与标准答案判定吉祥物反应 */
  function judgeMascot(answer: string | undefined, user: string | null | undefined) {
    if (!answer) return;
    const u = (user ?? "").trim().toLowerCase();
    if (!u) return;
    flashMascot(u === answer.trim().toLowerCase() ? "happy" : "thinking");
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
    // 提交作答时让吉祥物"小雷达"做出反应（作文分析的练习题在 essayResult.errors 里）
    if (patch.checked) {
      judgeMascot(
        essayResult?.errors[errIdx]?.exercises?.[exIdx]?.answer,
        patch.picked !== undefined ? patch.picked : practicePanels[errIdx]?.fillText[exIdx]
      );
    }
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

  /** 更新单题分析面板里某道题的作答状态 */
  function updateAnalyzeExercise(
    errIdx: number,
    exIdx: number,
    patch: Partial<{
      picked: string | null;
      fillText: string;
      checked: boolean;
    }>
  ) {
    // 提交作答时让吉祥物"小雷达"做出反应（单题分析的练习题在 analyzePanels 里）
    if (patch.checked) {
      judgeMascot(
        analyzePanels[errIdx]?.exercises[exIdx]?.answer,
        patch.picked !== undefined ? patch.picked : analyzePanels[errIdx]?.fillText[exIdx]
      );
    }
    setAnalyzePanels((p) => {
      const panel = p[errIdx];
      if (!panel) return p;
      const next: AnalyzePanel = {
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

  /** "更多知识点讲解"：调 /api/explain 现场讲解；已有讲解时点击为收起/展开 */
  async function handleExplainKnowledge(idx: number) {
    if (!analysisErrors) return;
    const err = analysisErrors[idx];
    if (!err) return;
    const panel = analyzePanels[idx];
    if (panel?.explain) {
      setAnalyzePanels((p) =>
        p[idx] ? { ...p, [idx]: { ...p[idx], explainOpen: !p[idx].explainOpen } } : p
      );
      return;
    }
    if (panel?.explainBusy) return;

    setAnalyzePanels((p) => ({
      ...p,
      [idx]: {
        explainBusy: true,
        explainOpen: true,
        exercises: p[idx]?.exercises ?? [],
        picked: p[idx]?.picked ?? [],
        fillText: p[idx]?.fillText ?? [],
        checked: p[idx]?.checked ?? [],
        exBusy: p[idx]?.exBusy ?? false,
      },
    }));
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_point: err.knowledge_point ?? "",
          original: err.original,
          corrected: err.corrected,
          reason:
            [err.reason ?? err.explanation, err.suggestion]
              .filter(Boolean)
              .join("\n修改建议：") || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成讲解失败");
      setAnalyzePanels((p) =>
        p[idx]
          ? {
              ...p,
              [idx]: {
                ...p[idx],
                explainBusy: false,
                explainOpen: true,
                explain: {
                  knowledge_point: String(data?.knowledge_point ?? ""),
                  rules: String(data?.rules ?? ""),
                  examples: String(data?.examples ?? ""),
                  confusions: String(data?.confusions ?? ""),
                  common_mistakes: String(data?.common_mistakes ?? ""),
                },
              },
            }
          : p
      );
    } catch (e) {
      setAnalyzePanels((p) =>
        p[idx]
          ? {
              ...p,
              [idx]: {
                ...p[idx],
                explainBusy: false,
                explainError:
                  e instanceof Error ? e.message : "生成讲解失败，请重试",
              },
            }
          : p
      );
    }
  }

  /** "举一反三练习 / 生成更多练习题"：每次固定生成 3 道，追加并排除已出题 */
  async function handleAnalyzeExercises(idx: number) {
    if (!analysisErrors) return;
    const err = analysisErrors[idx];
    const panel = analyzePanels[idx];
    if (!err || panel?.exBusy) return;

    setAnalyzePanels((p) => ({
      ...p,
      [idx]: {
        explainBusy: p[idx]?.explainBusy ?? false,
        explainOpen: p[idx]?.explainOpen ?? false,
        explain: p[idx]?.explain,
        exBusy: true,
        exError: undefined,
        exercises: p[idx]?.exercises ?? [],
        picked: p[idx]?.picked ?? [],
        fillText: p[idx]?.fillText ?? [],
        checked: p[idx]?.checked ?? [],
      },
    }));
    try {
      const existed = panel?.exercises ?? [];
      const res = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_point: err.knowledge_point ?? "",
          original: err.original,
          corrected: err.corrected,
          reason:
            [err.reason ?? err.explanation, err.suggestion]
              .filter(Boolean)
              .join("\n修改建议：") || "",
          exclude: existed.map((ex) => ex.question),
          count: 3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成练习题失败");
      const more = (Array.isArray(data?.exercises) ? data.exercises : []) as Exercise[];
      if (more.length === 0) throw new Error("AI 没有生成有效的练习题");

      setAnalyzePanels((p) => {
        const cur = p[idx];
        if (!cur) return p;
        return {
          ...p,
          [idx]: {
            ...cur,
            exBusy: false,
            exercises: [...cur.exercises, ...more],
            picked: [...cur.picked, ...more.map(() => null)],
            fillText: [...cur.fillText, ...more.map(() => "")],
            checked: [...cur.checked, ...more.map(() => false)],
          },
        };
      });
    } catch (e) {
      setAnalyzePanels((p) =>
        p[idx]
          ? {
              ...p,
              [idx]: {
                ...p[idx],
                exBusy: false,
                exError: e instanceof Error ? e.message : "生成失败，请重试",
              },
            }
          : p
      );
    }
  }

  /** 把单题分析结果拼成纯文本，作为追问时的上下文 */
  function buildAnalyzeContext(errors: AnalysisError[]): string {
    if (errors.length === 0) return "AI 判定该句子没有明显语法错误。";
    return "发现的语法错误：\n" +
      errors
        .map((e, i) => {
          const parts = [
            `${i + 1}. ${e.original} → ${e.corrected}`,
            e.knowledge_point ? `知识点：${e.knowledge_point}` : "",
            e.reason || e.explanation
              ? `错误原因：${e.reason ?? e.explanation}`
              : "",
            e.context_note ? `语境解释：${e.context_note}` : "",
            e.suggestion ? `修改建议：${e.suggestion}` : "",
          ];
          return parts.filter(Boolean).join("\n");
        })
        .join("\n\n");
  }

  /** 把选择题解题结果拼成纯文本，作为追问时的上下文 */
  function buildQuizContext(quiz: QuizSolution): string {
    const lines = [
      `这是一道未作答的选择题，AI 给出了解题结果：`,
      `正确答案：${quiz.answer_letter}. ${quiz.answer_text}`,
      quiz.knowledge_point ? `考查知识点：${quiz.knowledge_point}` : "",
      `题目解析：${quiz.explanation}`,
      `逐项分析：`,
      ...quiz.options.map(
        (o) =>
          `${o.letter}. ${o.text}（${o.is_correct ? "正确" : "错误"}）：${o.analysis}`
      ),
    ];
    return lines.filter(Boolean).join("\n");
  }

  /** 无错误句子 / 选择题场景：生成知识点讲解 */
  async function handleGeneralExplain() {
    const panel = analyzePanels[-1];
    if (panel?.explain) {
      setAnalyzePanels((p) =>
        p[-1] ? { ...p, [-1]: { ...p[-1], explainOpen: !p[-1].explainOpen } } : p
      );
      return;
    }
    if (panel?.explainBusy) return;

    setAnalyzePanels((p) => ({
      ...p,
      [-1]: {
        explainBusy: true,
        explainOpen: true,
        exercises: p[-1]?.exercises ?? [],
        picked: p[-1]?.picked ?? [],
        fillText: p[-1]?.fillText ?? [],
        checked: p[-1]?.checked ?? [],
        exBusy: p[-1]?.exBusy ?? false,
      },
    }));

    const knowledgePoint = quizSolution?.knowledge_point ?? "";
    const context = quizSolution
      ? buildQuizContext(quizSolution)
      : `题目：${analyzeSnapshot ?? ""}\nAI 判定该句子没有明显语法错误。`;

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_point: knowledgePoint,
          context,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成讲解失败");
      setAnalyzePanels((p) =>
        p[-1]
          ? {
              ...p,
              [-1]: {
                ...p[-1],
                explainBusy: false,
                explainOpen: true,
                explain: {
                  knowledge_point: String(data?.knowledge_point ?? ""),
                  rules: String(data?.rules ?? ""),
                  examples: String(data?.examples ?? ""),
                  confusions: String(data?.confusions ?? ""),
                  common_mistakes: String(data?.common_mistakes ?? ""),
                },
              },
            }
          : p
      );
    } catch (e) {
      setAnalyzePanels((p) =>
        p[-1]
          ? {
              ...p,
              [-1]: {
                ...p[-1],
                explainBusy: false,
                explainError:
                  e instanceof Error ? e.message : "生成讲解失败，请重试",
              },
            }
          : p
      );
    }
  }

  /** 无错误句子 / 选择题场景：生成举一反三练习题 */
  async function handleGeneralExercises() {
    const panel = analyzePanels[-1];
    if (panel?.exBusy) return;

    setAnalyzePanels((p) => ({
      ...p,
      [-1]: {
        explainBusy: p[-1]?.explainBusy ?? false,
        explainOpen: p[-1]?.explainOpen ?? false,
        explain: p[-1]?.explain,
        exBusy: true,
        exError: undefined,
        exercises: p[-1]?.exercises ?? [],
        picked: p[-1]?.picked ?? [],
        fillText: p[-1]?.fillText ?? [],
        checked: p[-1]?.checked ?? [],
      },
    }));

    const knowledgePoint = quizSolution?.knowledge_point ?? "";
    const context = quizSolution
      ? buildQuizContext(quizSolution)
      : `题目：${analyzeSnapshot ?? ""}\nAI 判定该句子没有明显语法错误。`;

    try {
      const existed = panel?.exercises ?? [];
      const res = await fetch("/api/practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledge_point: knowledgePoint,
          context,
          exclude: existed.map((ex) => ex.question),
          count: 3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成练习题失败");
      const more = (Array.isArray(data?.exercises) ? data.exercises : []) as Exercise[];
      if (more.length === 0) throw new Error("AI 没有生成有效的练习题");

      setAnalyzePanels((p) => {
        const cur = p[-1];
        if (!cur) return p;
        return {
          ...p,
          [-1]: {
            ...cur,
            exBusy: false,
            exercises: [...cur.exercises, ...more],
            picked: [...cur.picked, ...more.map(() => null)],
            fillText: [...cur.fillText, ...more.map(() => "")],
            checked: [...cur.checked, ...more.map(() => false)],
          },
        };
      });
    } catch (e) {
      setAnalyzePanels((p) =>
        p[-1]
          ? {
              ...p,
              [-1]: {
                ...p[-1],
                exBusy: false,
                exError: e instanceof Error ? e.message : "生成失败，请重试",
              },
            }
          : p
      );
    }
  }

  /** 单题分析追问 */
  async function handleAnalyzeFollowup() {
    const question = aChatInput.trim();
    if (
      aChatBusy ||
      !question ||
      analyzeSnapshot === null ||
      (!analysisErrors && !quizSolution)
    )
      return;
    const history = aChatMessages;
    setAChatMessages((m) => [...m, { role: "user", content: question }]);
    setAChatInput("");
    setAChatBusy(true);
    try {
      const res = await fetch("/api/analyze-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: analyzeSnapshot,
          analysis: quizSolution
            ? buildQuizContext(quizSolution)
            : buildAnalyzeContext(analysisErrors ?? []),
          history,
          question,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "追问失败，请重试");
      setAChatMessages((m) => [
        ...m,
        { role: "assistant", content: String(data.answer ?? "") },
      ]);
    } catch (e) {
      // 失败时保留用户消息，追加错误提示，方便直接重发
      setAChatMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `⚠️ ${e instanceof Error ? e.message : "追问失败，请重试"}`,
        },
      ]);
    } finally {
      setAChatBusy(false);
    }
  }

  /** 两步作文分析；overrideTopic/overrideEssay 用于图片识别确认后立即分析 */
  async function handleEssay(
    overrideTopic?: string,
    overrideEssay?: string
  ) {
    const topic = (overrideTopic ?? topicText).trim();
    const essay = (overrideEssay ?? analysisText).trim();
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
      // 1. 上传到 Supabase Storage 的 error-bank（按 用户ID/文件名 归档，未登录归 anonymous/）
      setBusyHint("正在上传图片…");
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      // 时间戳 + 随机数，避免重名
      const path = `${user ? user.id : "anonymous"}/${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.${ext}`;
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
      if (!text) {
        throw new Error("没有从图片中识别到文字，请换一张更清晰的图片");
      }
      // 不直接进入分析：先把识别结果放进可编辑的确认面板，让用户校对
      ocrEditAtRef.current = 0;
      setOcrConfirm({ target, text, past: [], future: [] });
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : "处理失败，请重试");
    } finally {
      setBusy(false);
      setBusyHint("");
    }
  }

  /** 识别结果面板：编辑文本。连续 700ms 内的修改合并为一个撤销检查点；撤销/重做后的新编辑必定存档 */
  function handleOcrEdit(next: string) {
    setOcrConfirm((cur) => {
      if (!cur || next === cur.text) return cur;
      const now = Date.now();
      const checkpoint =
        now - ocrEditAtRef.current > 700 || cur.future.length > 0;
      ocrEditAtRef.current = now;
      return checkpoint
        ? { ...cur, text: next, past: [...cur.past, cur.text], future: [] }
        : { ...cur, text: next };
    });
  }

  /** 识别结果面板：撤销到上一个编辑状态 */
  function handleOcrUndo() {
    setOcrConfirm((cur) => {
      if (!cur || cur.past.length === 0) return cur;
      const prev = cur.past[cur.past.length - 1];
      ocrEditAtRef.current = 0; // 撤销后再编辑，必须产生新检查点
      return {
        ...cur,
        text: prev,
        past: cur.past.slice(0, -1),
        future: [cur.text, ...cur.future],
      };
    });
  }

  /** 识别结果面板：重做被撤销的编辑 */
  function handleOcrRedo() {
    setOcrConfirm((cur) => {
      if (!cur || cur.future.length === 0) return cur;
      const next = cur.future[0];
      ocrEditAtRef.current = 0;
      return {
        ...cur,
        text: next,
        past: [...cur.past, cur.text],
        future: cur.future.slice(1),
      };
    });
  }

  /** 放弃识别结果（图片保留，文字仍可手动输入） */
  function handleOcrCancel() {
    ocrEditAtRef.current = 0;
    setOcrConfirm(null);
  }

  /** 确认识别文字：回填到对应输入框并关闭面板；返回回填文本供立即分析使用 */
  function commitOcrText(): { target: "topic" | "essay"; text: string } | null {
    if (!ocrConfirm) return null;
    const { target, text } = ocrConfirm;
    if (target === "topic") setTopicText(text);
    else setAnalysisText(text);
    ocrEditAtRef.current = 0;
    setOcrConfirm(null);
    return { target, text };
  }

  /** 仅确认文字，不自动分析（用户之后可继续编辑或自己点分析按钮） */
  function handleOcrConfirmOnly() {
    commitOcrText();
  }

  /** 确认文字并立即进入分析：题目框只回填；作文/单题框按是否已有题目要求自动选择作文分析或单题分析 */
  async function handleOcrConfirmAnalyze() {
    if (busy) return;
    const committed = commitOcrText();
    if (!committed) return;
    if (!committed.text.trim()) {
      setAnalysisError("识别内容为空，请重新上传或手动输入");
      return;
    }
    if (committed.target === "topic") return; // 题目确认后等待作文输入，不自动分析
    const topic = topicText.trim();
    if (topic) {
      await handleEssay(topic, committed.text);
    } else {
      await handleAnalyze(committed.text);
    }
  }

  const canAnalyze = !busy && !!analysisText.trim();
  const canEssay = !busy && !!analysisText.trim() && !!topicText.trim();

  return (
    <div className="min-h-screen bg-[#f8f5fe]">
      <SiteNav />
      <header className="bg-transparent">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
              {variant === "essay" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/logo.png"
                  alt="Grammar Radar"
                  className="h-9 w-9 shrink-0 object-contain"
                />
              )}
              <span>
                Grammar Radar{" "}
                <span className="bg-gradient-to-r from-[#1a2388] to-[#9c5cf0] bg-clip-text text-transparent">
                  · {variant === "essay" ? "作文分析" : "单题语法分析"}
                </span>
              </span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {variant === "essay"
                ? "输入作文题目要求和你的作文，AI 按所选写作类型批改"
                : "粘贴英文句子，或上传错题图片，AI 自动找出语法错误、讲解细化知识点并生成针对性练习"}
            </p>
          </div>

          {/* 第一步：题目要求（仅作文分析） */}
          {variant === "essay" && (
          <div className="space-y-3 rounded-2xl border border-[#ecdcfb] bg-[#fdfbff] p-4 shadow-[0_10px_30px_-18px_rgba(108,79,216,0.35)] sm:p-6">
            {/* 标题独立一行 */}
            <label className="block text-xl font-semibold text-slate-800">📝 ① 题目要求</label>
            {/* 说明文字：小字灰色，单独一行 */}
            <p className="text-sm text-gray-500">
              （作文分析必填，如：请以 My Favorite Season 为题写一篇 80 词作文）
            </p>
            {/* 工具行：手机端上下排列各占满整行；sm 以上并排、两框等宽同高并整体靠右对齐粘贴框右缘 */}
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <EssayTypeSelect
                value={essayScope}
                onChange={setEssayScope}
                disabled={busy}
              />
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
                className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-[#ddcbfa] bg-[#f6f0ff] px-3 text-sm font-medium text-[#6d3fd4] transition hover:bg-[#eee4fd] disabled:cursor-not-allowed disabled:opacity-60 sm:w-40"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
                上传作文题目
              </button>
            </div>
            <textarea
              value={topicText}
              onChange={(e) => setTopicText(e.target.value)}
              rows={4}
              placeholder="粘贴作文题目要求（中文也可以），或点上方按钮上传作文题目的图片自动识别…"
              className="min-h-[120px] w-full rounded-2xl border border-[#e9dcfb] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-300 focus:border-[#b9a6f5] focus:ring-2 focus:ring-[#ece5fc]"
            />
          </div>
          )}

          {/* 第二步：作文 / 句子输入 */}
          <div
            className={
              variant === "essay"
                ? "space-y-3 rounded-2xl border border-[#ecdcfb] bg-[#fdfbff] p-4 shadow-[0_10px_30px_-18px_rgba(108,79,216,0.35)] sm:p-6"
                : "space-y-2"
            }
          >
            <label className="text-xl font-semibold text-slate-800">
              {variant === "essay" ? "📄 ② 我的作文" : "① 我的句子"}
            </label>
            <textarea
              value={analysisText}
              onChange={(e) => setAnalysisText(e.target.value)}
              rows={6}
              placeholder={
                variant === "essay"
                  ? "粘贴你的作文，或点下方按钮上传作文图片自动识别…"
                  : "粘贴一句/一段英文，或点下方按钮上传错题图片自动识别…"
              }
              className={
                variant === "essay"
                  ? "w-full rounded-2xl border border-[#e9dcfb] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-300 focus:border-[#b9a6f5] focus:ring-2 focus:ring-[#ece5fc]"
                  : "w-full rounded-2xl border border-[#e9dcfb] bg-white px-4 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-300 focus:border-[#b9a6f5] focus:ring-2 focus:ring-[#ece5fc]"
              }
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
                onClick={() => {
                  setSelectedImage(null);
                  setOcrConfirm(null);
                }}
                disabled={busy}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
              >
                ✕ 移除
              </button>
            </div>
          )}

          {/* 图片识别结果确认：先校对识别文字（可撤销/重做），确认后再分析 */}
          {ocrConfirm && (
            <div className="space-y-2.5 rounded-2xl border border-amber-300 bg-amber-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-amber-800">
                  🔍 请确认识别结果
                  <span className="ml-2 text-xs font-normal text-amber-600">
                    OCR 可能有误，请校对后再
                    {ocrConfirm.target === "topic" ? "确认题目" : "分析"}；不修改直接确认则按原文处理
                  </span>
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleOcrUndo}
                    disabled={ocrConfirm.past.length === 0}
                    title="撤销上一次编辑"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↶ 撤销
                  </button>
                  <button
                    type="button"
                    onClick={handleOcrRedo}
                    disabled={ocrConfirm.future.length === 0}
                    title="重做被撤销的编辑"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↷ 重做
                  </button>
                </div>
              </div>
              <textarea
                value={ocrConfirm.text}
                onChange={(e) => handleOcrEdit(e.target.value)}
                rows={ocrConfirm.target === "topic" ? 2 : 7}
                autoFocus
                className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleOcrCancel}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleOcrConfirmOnly}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  仅填入输入框
                </button>
                <button
                  type="button"
                  onClick={handleOcrConfirmAnalyze}
                  disabled={busy || !ocrConfirm.text.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? "分析中…"
                    : ocrConfirm.target === "topic"
                      ? "✓ 确认题目"
                      : "✓ 确认无误，开始分析"}
                </button>
              </div>
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
              className="inline-flex items-center gap-1.5 rounded-2xl border border-[#ddcbfa] bg-[#f6f0ff] px-4 py-2.5 text-sm font-medium text-[#6d3fd4] transition hover:bg-[#eee4fd] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              {variant === "essay" ? "上传作文" : "上传单题图片"}
            </button>
            {variant === "essay" && (
            <button
              type="button"
              onClick={() => handleEssay()}
              disabled={!canEssay}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#4f46e5] to-[#9c5cf0] px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_-10px_rgba(93,62,220,0.6)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
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
                <>📋 开始作文分析</>
              )}
            </button>
            )}
            {variant === "single" && (
            <button
              type="button"
              onClick={() => handleAnalyze()}
              disabled={!canAnalyze}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#4f46e5] to-[#9c5cf0] px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_24px_-10px_rgba(93,62,220,0.6)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
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
                <>✨ 单题语法分析</>
              )}
            </button>
            )}
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
              {essayResult.overallSummary && (
                <div className="rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50 px-4 py-3">
                  <p className="text-xs font-semibold text-violet-400">
                    一句话总评
                  </p>
                  <p className="mt-1 text-sm font-medium whitespace-pre-line text-violet-900">
                    {essayResult.overallSummary}
                  </p>
                </div>
              )}

              {/* 按写作类型的评分维度 */}
              {essayResult.scores.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-400">
                    评分维度（{essayResult.scopeLabel}）
                  </p>
                  <ul className="space-y-1.5">
                    {essayResult.scores.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-4 py-2.5"
                      >
                        <span
                          className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${levelBadgeClass(s.level)}`}
                        >
                          {levelBadgeText(s.level)}
                        </span>
                        <p className="text-sm text-slate-700">
                          <span className="font-semibold text-slate-800">
                            {s.name}
                          </span>
                          {s.comment && (
                            <span className="text-slate-500">
                              ：{s.comment}
                            </span>
                          )}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            </div>

            {/* 亮点摘录 */}
            {essayResult.highlights.length > 0 && (
              <div className="space-y-3 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">
                  🌟 亮点摘录
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    这些表达写得很出彩
                  </span>
                </h3>
                <ul className="space-y-2.5">
                  {essayResult.highlights.map((h, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          {h.kind}
                        </span>
                        {h.level && (
                          <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-700">
                            {h.level}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-slate-800">
                        “{h.text}”
                      </p>
                      {h.note && (
                        <p className="mt-1 text-xs whitespace-pre-line text-amber-700/80">
                          {h.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
                      {(() => {
                        // 与"单题语法分析"统一的三段风格：
                        // 错误原因（灰框）→ 语境解释（琥珀框）→ 修改建议（绿框）
                        const reason = err.reason || err.explanation || "";
                        const contextNote = (err.context_note ?? "").trim();
                        const suggestion = (err.suggestion ?? "").trim();
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
                            {suggestion && (
                              <div className="rounded-md bg-emerald-50 px-3 py-2">
                                <p className="text-xs font-semibold text-emerald-600">
                                  修改建议
                                </p>
                                <p className="mt-1 text-sm whitespace-pre-line text-emerald-900">
                                  {suggestion}
                                </p>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {err.knowledge_point && (
                        <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                          📌 {err.knowledge_point}
                        </span>
                      )}

                      {/* 针对性练习：分析时已由 AI 现场生成，直接展示 */}
                      {((err.exercises?.length ?? 0) > 0 ||
                        practicePanels[i]?.moreError) && (
                        <ErrorExercises
                          exercises={err.exercises ?? []}
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
                          onMore={() => loadMoreExercises(i)}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 明显需要改善的地方 */}
            {essayResult.improvements.length > 0 && (
              <div className="space-y-3 rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">
                  🔧 明显需要改善的地方
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    哪里可以改、改成什么
                  </span>
                </h3>
                <ul className="space-y-2.5">
                  {essayResult.improvements.map((it, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3"
                    >
                      <p className="text-sm text-slate-700">
                        <span className="font-semibold text-slate-800">
                          {i + 1}. 哪里改：
                        </span>
                        <span className="whitespace-pre-line">{it.issue}</span>
                      </p>
                      <p className="mt-1 text-sm whitespace-pre-line text-sky-800">
                        <span className="font-semibold">✅ 改成：</span>
                        {it.suggestion}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 参考范文 */}
            {essayResult.modelEssay && (
              <div className="space-y-3 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">
                  📝 参考范文
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    按「{essayResult.scopeLabel}」的词汇和句式难度重写
                  </span>
                </h3>
                <p className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm leading-7 whitespace-pre-wrap text-slate-800">
                  {essayResult.modelEssay}
                </p>
              </div>
            )}

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

        {/* 搜索二次确认：外部参考资料对照状态（解题 / 批改两种模式通用，详情默认收起） */}
        {mode === "analyze" && referenceCheck && !busy && (
          <div
            className={`space-y-1.5 rounded-xl border px-4 py-3 text-sm ${
              referenceCheck.status === "difference"
                ? "border-amber-300 bg-amber-50"
                : referenceCheck.status === "consistent"
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-slate-200 bg-slate-50"
            }`}
          >
            <button
              type="button"
              onClick={() => setRefBannerOpen((v) => !v)}
              className={`flex w-full items-center justify-between gap-2 text-left font-medium ${
                referenceCheck.status === "difference"
                  ? "text-amber-800"
                  : referenceCheck.status === "consistent"
                    ? "text-emerald-700"
                    : "text-slate-600"
              }`}
            >
              <span>
                {referenceCheck.status === "difference"
                  ? "⚠️ AI 分析与外部参考存在差异"
                  : referenceCheck.status === "consistent"
                    ? "✅ AI 分析已与外部参考对照，结论一致"
                    : "🔍 未找到明确的外部参考，以下为纯 AI 分析"}
              </span>
              <span
                className={`shrink-0 text-xs text-slate-400 transition-transform ${
                  refBannerOpen ? "rotate-90" : ""
                }`}
              >
                ▶
              </span>
            </button>
            {refBannerOpen && (
              <>
                {referenceCheck.comment &&
                  referenceCheck.comment !==
                    "未找到明确的外部参考，以下为纯 AI 分析" && (
                    <p className="whitespace-pre-line text-xs leading-5 text-slate-600">
                      {referenceCheck.comment}
                    </p>
                  )}
                {referenceCheck.status === "none" && (
                  <p className="text-xs leading-5 text-slate-600">
                    本题建议核对课本或询问老师。
                  </p>
                )}
                {referenceItems.length > 0 && (
                  <ul className="space-y-0.5 pt-0.5">
                    {referenceItems.map((r, i) => (
                      <li
                        key={i}
                        className="truncate text-xs text-slate-400"
                        title={r.snippet}
                      >
                        参考 {i + 1}：{r.title || r.snippet.slice(0, 60)}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {/* 选择题解题模式：正确答案 + 考点 + 逐项分析 */}
        {quizSolution && !busy && (
          <div className="space-y-4 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                📝 选择题 · AI 解题
              </span>
              {quizSolution.knowledge_point && (
                <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                  📌 {quizSolution.knowledge_point}
                </span>
              )}
            </div>

            {/* 正确答案 */}
            <div className="rounded-xl bg-emerald-50 px-4 py-3">
              <p className="text-xs font-semibold text-emerald-600">
                正确答案
              </p>
              <p className="mt-1 text-lg font-bold text-emerald-700">
                {quizSolution.answer_letter}. {quizSolution.answer_text}
              </p>
            </div>

            {/* 题目解析 */}
            {quizSolution.explanation && (
              <div className="rounded-md bg-slate-50 px-3 py-2">
                <p className="text-xs font-semibold text-slate-400">
                  题目解析
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-700">
                  {quizSolution.explanation}
                </p>
              </div>
            )}

            {/* 逐项分析 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">
                逐个选项分析
              </p>
              <ul className="space-y-2">
                {quizSolution.options.map((opt) => (
                  <li
                    key={opt.letter}
                    className={`rounded-lg border px-3 py-2 ${
                      opt.is_correct
                        ? "border-emerald-200 bg-emerald-50/60"
                        : "border-slate-200 bg-slate-50/60"
                    }`}
                  >
                    <p className="flex items-start gap-2 text-sm">
                      <span
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          opt.is_correct
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-300 text-white"
                        }`}
                      >
                        {opt.letter}
                      </span>
                      <span className="font-medium text-slate-800">
                        {opt.text}
                      </span>
                      <span
                        className={`ml-auto shrink-0 text-xs font-semibold ${
                          opt.is_correct
                            ? "text-emerald-600"
                            : "text-slate-400"
                        }`}
                      >
                        {opt.is_correct ? "✓ 正确" : "✗ 错误"}
                      </span>
                    </p>
                    {opt.analysis && (
                      <p className="mt-1 pl-7 text-xs leading-5 text-slate-600">
                        {opt.analysis}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* 选择题模式下也提供知识点讲解与举一反三练习 */}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={handleGeneralExplain}
                disabled={analyzePanels[-1]?.explainBusy}
                className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
              >
                {analyzePanels[-1]?.explainBusy
                  ? "正在生成讲解…"
                  : analyzePanels[-1]?.explain
                    ? analyzePanels[-1].explainOpen
                      ? "📕 收起知识点讲解"
                      : "📖 更多知识点讲解"
                    : "📖 更多知识点讲解"}
              </button>
              {(analyzePanels[-1]?.exercises.length ?? 0) === 0 && (
                <button
                  type="button"
                  onClick={handleGeneralExercises}
                  disabled={analyzePanels[-1]?.exBusy}
                  className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
                >
                  {analyzePanels[-1]?.exBusy
                    ? "正在生成 3 道练习题…"
                    : "🎯 举一反三练习"}
                </button>
              )}
            </div>

            {analyzePanels[-1]?.explainError && (
              <p className="text-xs text-red-600">
                ⚠️ {analyzePanels[-1].explainError}
              </p>
            )}
            {analyzePanels[-1]?.explainOpen &&
              (analyzePanels[-1].explainBusy ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-600">
                  老师正在组织讲解内容…
                </div>
              ) : (
                analyzePanels[-1].explain && (
                  <KnowledgeExplainView explain={analyzePanels[-1].explain!} />
                )
              ))}

            {analyzePanels[-1]?.exError && (
              <p className="text-xs text-red-600">
                ⚠️ {analyzePanels[-1].exError}
              </p>
            )}
            {analyzePanels[-1] && analyzePanels[-1].exercises.length > 0 && (
              <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-3">
                  <ExerciseList
                    exercises={analyzePanels[-1].exercises}
                    state={analyzePanels[-1]}
                    onPick={(exIdx, opt) =>
                      updateAnalyzeExercise(-1, exIdx, {
                        picked: opt,
                        checked: true,
                      })
                    }
                    onFill={(exIdx, text) =>
                      updateAnalyzeExercise(-1, exIdx, { fillText: text })
                    }
                    onCheckFill={(exIdx) =>
                      updateAnalyzeExercise(-1, exIdx, { checked: true })
                    }
                  />

                  {analyzePanels[-1].exercises.length > 0 &&
                    analyzePanels[-1].exercises.every(
                      (_, j) => analyzePanels[-1].checked[j]
                    ) && (
                      <div className="space-y-1.5 border-t border-slate-100 pt-3 text-center">
                        <button
                          type="button"
                          onClick={handleGeneralExercises}
                          disabled={analyzePanels[-1].exBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3.5 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {analyzePanels[-1].exBusy ? (
                            <>
                              <svg
                                className="h-3.5 w-3.5 animate-spin"
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
                              正在生成 3 道新题…
                            </>
                          ) : (
                            "🔄 生成更多练习题"
                          )}
                        </button>
                        <p className="text-xs text-slate-400">
                          已出 {analyzePanels[-1].exercises.length} 道，新题不会与已有题目重复
                        </p>
                        {analyzePanels[-1].exError && (
                          <p className="text-xs text-red-600">
                            ⚠️ {analyzePanels[-1].exError}
                          </p>
                        )}
                      </div>
                    )}
                </div>
              </div>
            )}
          </div>
        )}

        {!quizSolution && analysisErrors && !busy && (
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {analysisErrors.length === 0 ? (
              <>
                <p className="py-2 text-center text-sm text-emerald-700">
                  ✅ 未发现明显语法错误
                </p>

                {/* 无错误时也提供知识点讲解与举一反三练习 */}
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={handleGeneralExplain}
                    disabled={analyzePanels[-1]?.explainBusy}
                    className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                  >
                    {analyzePanels[-1]?.explainBusy
                      ? "正在生成讲解…"
                      : analyzePanels[-1]?.explain
                        ? analyzePanels[-1].explainOpen
                          ? "📕 收起知识点讲解"
                          : "📖 这道题考什么？点这里深入了解"
                        : "📖 这道题考什么？点这里深入了解"}
                  </button>
                  {(analyzePanels[-1]?.exercises.length ?? 0) === 0 && (
                    <button
                      type="button"
                      onClick={handleGeneralExercises}
                      disabled={analyzePanels[-1]?.exBusy}
                      className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
                    >
                      {analyzePanels[-1]?.exBusy
                        ? "正在生成 3 道练习题…"
                        : "🎯 举一反三练习"}
                    </button>
                  )}
                </div>

                {analyzePanels[-1]?.explainError && (
                  <p className="text-xs text-red-600">
                    ⚠️ {analyzePanels[-1].explainError}
                  </p>
                )}
                {analyzePanels[-1]?.explainOpen &&
                  (analyzePanels[-1].explainBusy ? (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-600">
                      老师正在组织讲解内容…
                    </div>
                  ) : (
                    analyzePanels[-1].explain && (
                      <KnowledgeExplainView explain={analyzePanels[-1].explain!} />
                    )
                  ))}

                {analyzePanels[-1]?.exError && (
                  <p className="text-xs text-red-600">
                    ⚠️ {analyzePanels[-1].exError}
                  </p>
                )}
                {analyzePanels[-1] && analyzePanels[-1].exercises.length > 0 && (
                  <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-3">
                      <ExerciseList
                        exercises={analyzePanels[-1].exercises}
                        state={analyzePanels[-1]}
                        onPick={(exIdx, opt) =>
                          updateAnalyzeExercise(-1, exIdx, {
                            picked: opt,
                            checked: true,
                          })
                        }
                        onFill={(exIdx, text) =>
                          updateAnalyzeExercise(-1, exIdx, { fillText: text })
                        }
                        onCheckFill={(exIdx) =>
                          updateAnalyzeExercise(-1, exIdx, { checked: true })
                        }
                      />

                      {analyzePanels[-1].exercises.length > 0 &&
                        analyzePanels[-1].exercises.every(
                          (_, j) => analyzePanels[-1].checked[j]
                        ) && (
                          <div className="space-y-1.5 border-t border-slate-100 pt-3 text-center">
                            <button
                              type="button"
                              onClick={handleGeneralExercises}
                              disabled={analyzePanels[-1].exBusy}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3.5 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {analyzePanels[-1].exBusy ? (
                                <>
                                  <svg
                                    className="h-3.5 w-3.5 animate-spin"
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
                                  正在生成 3 道新题…
                                </>
                              ) : (
                                "🔄 生成更多练习题"
                              )}
                            </button>
                            <p className="text-xs text-slate-400">
                              已出 {analyzePanels[-1].exercises.length} 道，新题不会与已有题目重复
                            </p>
                            {analyzePanels[-1].exError && (
                              <p className="text-xs text-red-600">
                                ⚠️ {analyzePanels[-1].exError}
                              </p>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-slate-900">
                  AI 分析结果（{analysisErrors.length} 处错误）
                </h3>
                <ul className="space-y-4">
                  {analysisErrors.map((err, i) => {
                    const reason = err.reason || err.explanation || "";
                    const contextNote = (err.context_note ?? "").trim();
                    const suggestion = (err.suggestion ?? "").trim();
                    const panel = analyzePanels[i];
                    const aExercises = panel?.exercises ?? [];
                    // 当前批次全部作答后，才允许生成下一批
                    const allChecked =
                      aExercises.length > 0 &&
                      aExercises.every((_, j) => panel?.checked[j]);
                    return (
                    <li
                      key={i}
                      className="space-y-2 border-l-4 border-amber-300 pl-3"
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
                      {suggestion && (
                        <div className="rounded-md bg-emerald-50 px-3 py-2">
                          <p className="text-xs font-semibold text-emerald-600">
                            修改建议
                          </p>
                          <p className="mt-1 text-sm whitespace-pre-line text-emerald-900">
                            {suggestion}
                          </p>
                        </div>
                      )}
                      {err.knowledge_point && (
                        <span className="inline-flex items-center rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                          📌 {err.knowledge_point}
                        </span>
                      )}

                      {/* 讲解 / 练习 两个按钮并排同一行 */}
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleExplainKnowledge(i)}
                          disabled={panel?.explainBusy}
                          className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                        >
                          {panel?.explainBusy
                            ? "正在生成讲解…"
                            : panel?.explain
                              ? panel.explainOpen
                                ? "📕 收起知识点讲解"
                                : "📖 更多知识点讲解"
                              : "📖 更多知识点讲解"}
                        </button>
                        {/* 还没有题目时显示"举一反三练习"；题目生成后这个按钮移到练习区底部 */}
                        {aExercises.length === 0 && (
                          <button
                            type="button"
                            onClick={() => handleAnalyzeExercises(i)}
                            disabled={panel?.exBusy}
                            className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
                          >
                            {panel?.exBusy
                              ? "正在生成 3 道练习题…"
                              : "🎯 举一反三练习"}
                          </button>
                        )}
                      </div>

                      {panel?.explainError && (
                        <p className="text-xs text-red-600">
                          ⚠️ {panel.explainError}
                        </p>
                      )}
                      {panel?.explainOpen &&
                        (panel.explainBusy ? (
                          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-600">
                            老师正在组织讲解内容…
                          </div>
                        ) : (
                          panel.explain && (
                            <KnowledgeExplainView explain={panel.explain} />
                          )
                        ))}

                      {panel?.exError && (
                        <p className="text-xs text-red-600">⚠️ {panel.exError}</p>
                      )}
                      {panel && aExercises.length > 0 && (
                        <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-3">
                            <ExerciseList
                              exercises={aExercises}
                              state={panel}
                              onPick={(exIdx, opt) =>
                                updateAnalyzeExercise(i, exIdx, {
                                  picked: opt,
                                  checked: true,
                                })
                              }
                              onFill={(exIdx, text) =>
                                updateAnalyzeExercise(i, exIdx, { fillText: text })
                              }
                              onCheckFill={(exIdx) =>
                                updateAnalyzeExercise(i, exIdx, { checked: true })
                              }
                            />

                            {/* 当前题目全部做完后出现，再生成 3 道不重复的新题 */}
                            {allChecked && (
                              <div className="space-y-1.5 border-t border-slate-100 pt-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleAnalyzeExercises(i)}
                                  disabled={panel.exBusy}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3.5 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {panel.exBusy ? (
                                    <>
                                      <svg
                                        className="h-3.5 w-3.5 animate-spin"
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
                                      正在生成 3 道新题…
                                    </>
                                  ) : (
                                    "🔄 生成更多练习题"
                                  )}
                                </button>
                                <p className="text-xs text-slate-400">
                                  已出 {aExercises.length} 道，新题不会与已有题目重复
                                </p>
                                {panel.exError && (
                                  <p className="text-xs text-red-600">
                                    ⚠️ {panel.exError}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        {/* 单题分析追问对话框（批改 / 解题两种模式通用） */}
        {mode === "analyze" && (analysisErrors || quizSolution) && !busy && (
          <div className="space-y-3 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">
              💬 对结果有疑问？继续问老师
            </h3>

            {aChatMessages.length === 0 && (
              <p className="text-xs text-slate-400">
                例如：这里为什么要用 was 不用 were？every 和 each 到底有什么区别？
              </p>
            )}

            {aChatMessages.length > 0 && (
              <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
                {aChatMessages.map((m, i) => (
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
                {aChatBusy && (
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
                value={aChatInput}
                onChange={(e) => setAChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAnalyzeFollowup();
                  }
                }}
                placeholder="输入你的问题，回车发送"
                className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
              />
              <button
                type="button"
                onClick={handleAnalyzeFollowup}
                disabled={aChatBusy || !aChatInput.trim()}
                className="shrink-0 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                发送
              </button>
            </div>
          </div>
        )}

        {mode === null && !analysisError && !busy && (
          <div className="py-16 text-center text-slate-400">
            <p className="text-4xl">✍️</p>
            <p className="mt-3 text-sm">
              粘贴英文句子或上传错题图片，选择单题语法分析或作文分析
            </p>
          </div>
        )}
      </main>
      {/* 吉祥物"小雷达"：页面右下角，答对笑 / 答错思考（key 变化重放动画） */}
      <Mascot mood={mascotMood} key={mascotTick} />
    </div>
  );
}

/** 练习题列表（单题分析与作文分析共用）：作答 + 即时判分 + 解析 */
function ExerciseList(props: {
  exercises: Exercise[];
  state?: ExerciseState;
  onPick: (exIdx: number, opt: string) => void;
  onFill: (exIdx: number, text: string) => void;
  onCheckFill: (exIdx: number) => void;
}) {
  const { exercises, state, onPick, onFill, onCheckFill } = props;
  return (
    <>
      <p className="text-xs font-semibold text-violet-700">
        🎯 针对性变式练习（共 {exercises.length} 道）
      </p>
      {exercises.map((ex, j) => {
        const checked = state?.checked[j] ?? false;
        const picked = state?.picked[j] ?? null;
        const fillVal = state?.fillText[j] ?? "";
        const fillCorrect =
          fillVal.trim().toLowerCase() === ex.answer.trim().toLowerCase();
        return (
          <div
            key={j}
            className="space-y-2 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0"
          >
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
    </>
  );
}

/** 知识点现场讲解（/api/explain）：规则 / 例句 / 易混淆点 / 常见错误 */
function KnowledgeExplainView({ explain }: { explain: KnowledgeExplain }) {
  const sections: { title: string; cls: string; body: string }[] = [
    { title: "📐 核心规则", cls: "bg-slate-50 text-slate-700", body: explain.rules },
    { title: "📝 例句", cls: "bg-emerald-50 text-emerald-900", body: explain.examples },
    { title: "🔀 易混淆点", cls: "bg-amber-50 text-amber-900", body: explain.confusions },
    { title: "⚠️ 常见错误", cls: "bg-rose-50 text-rose-900", body: explain.common_mistakes },
  ];
  return (
    <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
      <p className="text-xs font-semibold text-sky-700">
        📖 知识点讲解 · {explain.knowledge_point}
      </p>
      {sections
        .filter((s) => s.body.trim())
        .map((s) => (
          <div key={s.title} className={`rounded-lg px-3 py-2 ${s.cls}`}>
            <p className="text-xs font-semibold opacity-70">{s.title}</p>
            <p className="mt-1 text-sm whitespace-pre-line leading-relaxed">
              {s.body}
            </p>
          </div>
        ))}
    </div>
  );
}

/** 作文分析每处错误下方的练习区（练习在批改时已生成，底部可追加） */
function ErrorExercises(props: {
  exercises: Exercise[];
  panel?: PracticePanel;
  onPick: (exIdx: number, opt: string) => void;
  onFill: (exIdx: number, text: string) => void;
  onCheckFill: (exIdx: number) => void;
  onMore: () => void;
}) {
  const { exercises, panel, onPick, onFill, onCheckFill, onMore } = props;

  return (
    <div className="space-y-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-3">
        <ExerciseList
          exercises={exercises}
          state={panel}
          onPick={onPick}
          onFill={onFill}
          onCheckFill={onCheckFill}
        />

        {/* 生成更多练习题 */}
        <div className="space-y-1.5 border-t border-slate-100 pt-3 text-center">
          <button
            type="button"
            onClick={onMore}
            disabled={panel?.loadingMore}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3.5 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {panel?.loadingMore ? (
              <>
                <svg
                  className="h-3.5 w-3.5 animate-spin"
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
                正在生成新题目…
              </>
            ) : (
              <>🔄 生成更多练习题</>
            )}
          </button>
          <p className="text-xs text-slate-400">
            已出 {exercises.length} 道，新题不会与已有题目重复
          </p>
          {panel?.moreError && (
            <p className="text-xs text-red-600">⚠️ {panel.moreError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
