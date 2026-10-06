"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase, type GrammarCard } from "@/lib/supabase";
import { Card } from "@/components/GrammarCardView";
import { SiteNav } from "@/components/SiteNav";
import type { Exercise } from "@/lib/exercise";
import {
  extractKeywords,
  searchReferences,
  type ReferenceItem,
} from "@/lib/search";
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

/** 维度评价等级 */
type EvalLevel = "优秀" | "良好" | "一般" | "待提高";

/** 细化维度评价（词汇/句式/衔接/连贯） */
interface DimensionEval {
  level: EvalLevel;
  comment: string;
}

/** 按写作范围评分维度的单项评价 */
interface ScoreItem {
  name: string;
  level: EvalLevel;
  comment: string;
}

/** 高级表达推荐条目 */
interface AdvancedExpression {
  original: string;
  better: string;
  note: string;
}

/** /api/essay 返回的作文分析结果 */
interface EssayResult {
  onTopic: boolean;
  onTopicComment: string;
  structure: string;
  language: string;
  dimensions: {
    vocabulary: DimensionEval;
    sentence_variety: DimensionEval;
    cohesive_devices: DimensionEval;
    coherence: DimensionEval;
  };
  scores: ScoreItem[];
  advancedExpressions: AdvancedExpression[];
  modelEssay: string;
  scopeLabel: string;
  errors: AnalysisError[];
}

/** 写作范围分组下拉选项 */
const ESSAY_SCOPE_GROUPS: { group: string; items: string[] }[] = [
  { group: "国内考试", items: ["中考", "高考"] },
  { group: "单元作文", items: ["七上", "七下", "八上", "八下", "九上", "九下"] },
  { group: "剑桥英语", items: ["KET", "PET", "FCE", "CAE"] },
  { group: "出国考试", items: ["雅思", "托福"] },
];

/** 等级徽章配色 */
function levelBadgeClass(level: EvalLevel): string {
  switch (level) {
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

export default function Home() {
  // 当前登录用户（Supabase Auth，null = 未登录）
  const [user, setUser] = useState<User | null>(null);

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
  // 选择题解题模式结果（输入为未做的选择题时使用，与 analysisErrors 互斥）
  const [quizSolution, setQuizSolution] = useState<QuizSolution | null>(null);
  // 外部参考资料搜索结果（标题+摘要）及 AI 对照结论，解题/批改两种模式共用
  const [referenceItems, setReferenceItems] = useState<ReferenceItem[]>([]);
  const [referenceCheck, setReferenceCheck] =
    useState<ReferenceCheck | null>(null);
  // 单题分析每处错误的"讲解 + 练习"面板，key 为错误下标
  const [analyzePanels, setAnalyzePanels] = useState<
    Record<number, AnalyzePanel>
  >({});

  // 分步引导答题状态
  const [mode, setMode] = useState<"analyze" | "guide" | "essay" | null>(null);
  // 作文分析（两步流程）：①题目要求 ②作文
  const [topicText, setTopicText] = useState("");
  const [essayScope, setEssayScope] = useState(""); // 写作范围，空 = 默认中考标准
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

  // 监听登录状态（AuthArea 挂在 SiteNav，这里独立同步一份 user）
  useEffect(() => {
    const sb = getSupabase();
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
    setAnalyzePanels({});
    setAnalyzeSnapshot(null);
    setAChatMessages([]);
    setAChatInput("");
    setMode(null);
    setGuide(null);
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
      const keywords = extractKeywords(text);
      if (keywords.length > 0) {
        references = await searchReferences(keywords);
      }
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
            comment: "未找到外部参考，以下为纯 AI 分析",
          };
    setReferenceCheck(refCheck);

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
    const emptyDim: DimensionEval = { level: "一般", comment: "" };
    const d = data?.dimensions ?? {};
    const pickDim = (v: unknown): DimensionEval => {
      const x = (v ?? {}) as Record<string, unknown>;
      return {
        level: (["优秀", "良好", "一般", "待提高"] as const).includes(
          x.level as EvalLevel
        )
          ? (x.level as EvalLevel)
          : "一般",
        comment: typeof x.comment === "string" ? x.comment : "",
      };
    };
    setEssayResult({
      onTopic: data?.on_topic?.is_on_topic !== false,
      onTopicComment:
        typeof data?.on_topic?.comment === "string"
          ? data.on_topic.comment
          : "",
      structure: typeof data?.structure === "string" ? data.structure : "",
      language: typeof data?.language === "string" ? data.language : "",
      dimensions: {
        vocabulary: pickDim(d.vocabulary) ?? emptyDim,
        sentence_variety: pickDim(d.sentence_variety) ?? emptyDim,
        cohesive_devices: pickDim(d.cohesive_devices) ?? emptyDim,
        coherence: pickDim(d.coherence) ?? emptyDim,
      },
      scores: Array.isArray(data?.scores) ? data.scores : [],
      advancedExpressions: Array.isArray(data?.advanced_expressions)
        ? data.advanced_expressions
        : [],
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
    const dimLines = [
      ["词汇丰富度", r.dimensions.vocabulary],
      ["句式多样性", r.dimensions.sentence_variety],
      ["衔接词使用", r.dimensions.cohesive_devices],
      ["逻辑连贯性", r.dimensions.coherence],
    ] as const;
    const lines = [
      `写作范围：${r.scopeLabel}`,
      `扣题判断：${r.onTopic ? "切题" : "偏题"}。${r.onTopicComment}`,
      r.structure ? `结构评价：${r.structure}` : "",
      r.language ? `语言评价：${r.language}` : "",
      r.scores.length
        ? "评分维度：\n" +
          r.scores.map((s) => `- ${s.name}：${s.level}。${s.comment}`).join("\n")
        : "",
      "细化维度评价：\n" +
        dimLines
          .map(([n, d]) => `- ${n}（${d.level}）：${d.comment}`)
          .join("\n"),
      r.advancedExpressions.length
        ? "高级表达推荐：\n" +
          r.advancedExpressions
            .map((a) => `- ${a.original} → ${a.better}（${a.note}）`)
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
              <span className="text-indigo-600">· 单题语法分析</span>
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              粘贴英文句子，或上传错题图片，AI 自动找出语法错误、讲解细化知识点并生成针对性练习
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
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  写作范围
                  <select
                    value={essayScope}
                    onChange={(e) => setEssayScope(e.target.value)}
                    disabled={busy}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 outline-none transition hover:bg-slate-100 focus:border-indigo-400 disabled:opacity-60"
                  >
                    <option value="">通用（默认中考标准）</option>
                    {ESSAY_SCOPE_GROUPS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.items.map((it) => (
                          <option key={it} value={it}>
                            {it}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
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
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
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
            </div>
            <textarea
              value={topicText}
              onChange={(e) => setTopicText(e.target.value)}
              rows={2}
              placeholder="粘贴作文题目要求（中文也可以），或点右侧按钮上传作文题目的图片自动识别…"
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
              placeholder="粘贴你的作文（作文分析用），或一句/一段英文（单题分析、分步引导用）；也可以点下方按钮上传图片自动识别…"
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
              上传作文/单题
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
                <>📋 作文分析</>
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
                <>✨ 单题语法分析</>
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
              「作文分析」需要先填①题目要求和②作文；其余按钮只需填②
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

              {/* 按写作范围的评分维度 */}
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
                          {s.level}
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

              {/* 细化维度评价：词汇/句式/衔接/连贯 */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400">
                  细化维度评价
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {(
                    [
                      ["词汇丰富度", essayResult.dimensions.vocabulary],
                      ["句式多样性", essayResult.dimensions.sentence_variety],
                      ["衔接词使用", essayResult.dimensions.cohesive_devices],
                      ["逻辑连贯性", essayResult.dimensions.coherence],
                    ] as const
                  ).map(([name, d]) => (
                    <div
                      key={name}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">
                          {name}
                        </p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${levelBadgeClass(d.level)}`}
                        >
                          {d.level}
                        </span>
                      </div>
                      {d.comment && (
                        <p className="mt-1.5 text-sm whitespace-pre-line text-slate-600">
                          {d.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
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

            {/* 高级表达推荐 */}
            {essayResult.advancedExpressions.length > 0 && (
              <div className="space-y-3 rounded-2xl border border-amber-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">
                  ✨ 高级表达推荐
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    在「{essayResult.scopeLabel}」范围内更地道的写法
                  </span>
                </h3>
                <ul className="space-y-2.5">
                  {essayResult.advancedExpressions.map((a, i) => (
                    <li
                      key={i}
                      className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3"
                    >
                      <p className="text-sm">
                        <span className="text-slate-500 line-through">
                          {a.original}
                        </span>
                        <span className="mx-1.5 text-slate-400">→</span>
                        <span className="font-medium text-amber-800">
                          {a.better}
                        </span>
                      </p>
                      {a.note && (
                        <p className="mt-1 text-xs whitespace-pre-line text-amber-700/80">
                          {a.note}
                        </p>
                      )}
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

        {/* 搜索二次确认：外部参考资料对照状态（解题 / 批改两种模式通用） */}
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
            <p
              className={`font-medium ${
                referenceCheck.status === "difference"
                  ? "text-amber-800"
                  : referenceCheck.status === "consistent"
                    ? "text-emerald-700"
                    : "text-slate-600"
              }`}
            >
              {referenceCheck.status === "difference"
                ? "⚠️ AI 分析与外部参考存在差异"
                : referenceCheck.status === "consistent"
                  ? "✅ AI 分析已与外部参考对照，结论一致"
                  : "🔍 未找到外部参考，以下为纯 AI 分析"}
            </p>
            {referenceCheck.comment &&
              referenceCheck.comment !==
                "未找到外部参考，以下为纯 AI 分析" && (
                <p className="whitespace-pre-line text-xs leading-5 text-slate-600">
                  {referenceCheck.comment}
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
          </div>
        )}

        {!quizSolution && analysisErrors && !busy && (
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
              粘贴英文句子或上传错题图片，选择单题语法分析、作文分析或分步引导答题
            </p>
          </div>
        )}
      </main>
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
