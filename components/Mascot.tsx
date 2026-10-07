"use client";

export type MascotMood = "idle" | "happy" | "thinking";

/**
 * 页面角落的吉祥物"小雷达"：
 * - idle：平静微笑，雷达扫描 + 轻轻浮动
 * - happy（答对）：眯眼大笑 + 腮红 + 弹跳
 * - thinking（答错）：歪头思考 + 思考泡泡
 * 纯装饰元素，pointer-events-none 不挡任何操作。
 */
export function Mascot({ mood }: { mood: MascotMood }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-3 right-2 z-40 select-none sm:bottom-4 sm:right-3"
    >
      <style>{`
        @keyframes mascotBounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-10px) scale(1.06)}55%{transform:translateY(0)}75%{transform:translateY(-4px)}}
        @keyframes mascotSway{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}
        @keyframes mascotFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes mascotSweep{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes mascotBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
        .mascot-anim-idle{animation:mascotFloat 3s ease-in-out infinite}
        .mascot-anim-happy{animation:mascotBounce .9s ease}
        .mascot-anim-thinking{animation:mascotSway 1.8s ease-in-out infinite}
        .mascot-sweep{animation:mascotSweep 5s linear infinite}
        .mascot-antenna{animation:mascotBob 2.2s ease-in-out infinite}
      `}</style>
      <div
        className={
          mood === "happy"
            ? "mascot-anim-happy"
            : mood === "thinking"
              ? "mascot-anim-thinking"
              : "mascot-anim-idle"
        }
      >
        <svg width="72" height="72" viewBox="0 0 100 100" fill="none">
          <defs>
            <linearGradient id="mascotBody" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#7c3aed" />
            </linearGradient>
          </defs>

          {/* 天线 + 信号球 */}
          <line
            x1="50"
            y1="26"
            x2="50"
            y2="15"
            stroke="#7c3aed"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <circle className="mascot-antenna" cx="50" cy="11" r="4.5" fill="#c4b5fd" />

          {/* 头：雷达外罩 + 屏幕 */}
          <circle cx="50" cy="58" r="32" fill="url(#mascotBody)" />
          <circle cx="50" cy="58" r="24" fill="#f5f1fe" stroke="#ddd1fa" strokeWidth="1.5" />

          {/* 雷达扫描（表情后面，淡淡的） */}
          <g className="mascot-sweep" style={{ transformOrigin: "50px 58px" }}>
            <path
              d="M50 58 L50 37 A21 21 0 0 1 64.8 43.2 Z"
              fill="#c4b5fd"
              opacity="0.5"
            />
          </g>
          <circle cx="50" cy="58" r="14" stroke="#e6dcfb" strokeWidth="1.5" fill="none" />

          {mood === "happy" ? (
            <>
              {/* 眯眯笑眼 */}
              <path d="M34 56 Q40 49 46 56" stroke="#5b21b6" strokeWidth="3" strokeLinecap="round" fill="none" />
              <path d="M54 56 Q60 49 66 56" stroke="#5b21b6" strokeWidth="3" strokeLinecap="round" fill="none" />
              {/* 开心大嘴 */}
              <path d="M40 64 A10 9 0 0 0 60 64 Z" fill="#8b5cf6" />
              {/* 腮红 */}
              <circle cx="32" cy="64" r="4" fill="#f9a8d4" opacity="0.75" />
              <circle cx="68" cy="64" r="4" fill="#f9a8d4" opacity="0.75" />
            </>
          ) : mood === "thinking" ? (
            <>
              {/* 歪头思考：眉毛 + 看向一边的眼睛 + 波浪嘴 + 思考泡泡 */}
              <path d="M35 45 L45 47.5" stroke="#5b21b6" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M55 44.5 L65 42.5" stroke="#5b21b6" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="39" cy="54" r="3" fill="#5b21b6" />
              <circle cx="61" cy="53" r="3" fill="#5b21b6" />
              <path d="M42 68 Q46 64 50 68 Q54 72 58 68" stroke="#5b21b6" strokeWidth="2.5" strokeLinecap="round" fill="none" />
              <circle cx="77" cy="35" r="3" fill="#ddd6fe" />
              <circle cx="84" cy="26" r="4.5" fill="#ddd6fe" />
              <circle cx="92" cy="15" r="6" fill="#ddd6fe" />
            </>
          ) : (
            <>
              {/* 平静微笑 */}
              <circle cx="40" cy="55" r="3" fill="#5b21b6" />
              <circle cx="60" cy="55" r="3" fill="#5b21b6" />
              <path d="M42 66 Q50 73 58 66" stroke="#5b21b6" strokeWidth="2.8" strokeLinecap="round" fill="none" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
