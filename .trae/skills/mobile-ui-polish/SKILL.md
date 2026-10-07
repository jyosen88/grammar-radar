---
name: mobile-ui-polish
description: Visual-only mobile UI polish for Grammar Radar pages — brand colors, radius, shadows, spacing — without changing text, positions, or logic. Use for design-spec beautification or crowded/misaligned mobile layouts. Not for feature or layout-structure changes.
---

# Mobile UI Polish (Grammar Radar)

Visual-only edits for this Next.js 16 + Tailwind v4 (`@import "tailwindcss"` in app/globals.css) project. The hard rule: texts, prompts, control order/positions, handlers, and business logic stay byte-identical — only className/style change.

## 0. Extract a parameter table first

Turn the user's spec into an exact list (hex colors, radius px, shadow, font px, which element). Apply values literally — never substitute "nicer" colors, never add unrequested effects (no gloss sweep, glassmorphism, extra gradients). Ambiguity that changes scope (e.g. one row vs two rows for nav buttons) gets one AskUserQuestion with concrete pixel trade-offs.

Current brand tokens:
- Gradient: `from-[#1a2388] to-[#9c5cf0]` (deep blue → light purple); active/primary fills white text
- Page tint: `#fafbff`; inactive chip: `#f0f2fb`; soft input fills: `#f4f6fe` / `#f5f6fd`
- Light-purple borders: `#e2e4f5` (inputs), `#ecebfa` (cards), `#e4dcfb` (secondary buttons)
- Secondary button: bg `#f2edfe`, text `#6d3fd4`
- Soft shadow: `shadow-[0_10px_30px_-18px_rgba(108,79,216,0.35)]` (cards), `shadow-[0_8px_20px_-10px_rgba(93,62,220,0.6)]` (active/primary buttons) — never hard black shadows
- Radius 16px = `rounded-2xl`; `rounded-xl` is 12px — replace per spec
- Logo asset is `/logo.png` (transparent G radar); homepage also draws decorative ring SVG

## 1. Locate impact surface before editing

- Grep the user-visible Chinese label AND the icon/emoji text of every target element across app/ and components/ (excluding node_modules/.next). Shared components (components/SiteNav.tsx, components/AuthArea.tsx) render on multiple pages — a class change there is global by default.
- If one component serves several pages (AnalyzeTool.tsx takes `variant: "single" | "essay"`), isolate styles with conditional classes keyed on variant so untouched pages keep their old classNames exactly. Pattern: className={variant === "essay" ? NEW : OLD}.
- Never use Write to overwrite a file for styling work — Read the exact fragment, then Edit minimal class strings. Do not move/delete DOM nodes, do not touch imports unless an element was actually removed.
- Text constraints: leave placeholder strings and all copy exactly as-is. Adding an emoji prefix the user explicitly listed (e.g. 📝/📄 before a label) is allowed; changing wording is not.

## 2. Mobile-first mechanics that recurred here

- Phone portrait baseline: 390px viewport; also check 360px for wrap behavior. Grid for 4 equal nav chips: `grid grid-cols-4 gap-0.5`; links `flex items-center justify-center text-center whitespace-normal px-1`. Desktop (`md:` = 768px) keeps the single-row layout via `md:flex-row md:contents md:whitespace-nowrap`.
- Auth/button weight reduction: smaller px/py, pale purple bg + thin light-purple border.
- Gradient text: `bg-gradient-to-r from-[#1a2388] to-[#9c5cf0] bg-clip-text text-transparent`.
- Header transparency on a tinted page: swap the default `border-b bg-white` header to `bg-transparent` only for the targeted variant.

## 3. Verify before committing

1. `npx tsc --noEmit` (zero output expected). A `.next/types/validator.ts` "cannot find module" error for a deleted route is stale cache, not a code error — next build regenerates it.
2. Browser verification with a browser_use subagent via same-origin iframes (media queries key off iframe width): inject `<iframe style="width:390px;height:...">` to the target URL, wait for readyState complete + 2s, measure with getBoundingClientRect/getComputedStyle (computed bg, border-radius, border color, boxShadow rgba, scrollWidth ≤ frame width), screenshot. Repeat at 360px and 1200px.
3. Auth-guarded pages (/essay /single /sentence /records are wrapped by components/AuthGuard.tsx, client-only session in localStorage, key `grammar-radar-auth`): iframes do not share the parent's localStorage context. Set the fake session inside the iframe after load (or seed via same-origin parent before navigation), never create real Supabase users. auth-js v2.117+ stores the SESSION OBJECT DIRECTLY (top-level access_token; no legacy `{currentSession}` wrapper): `localStorage.setItem("grammar-radar-auth", JSON.stringify({access_token:"x."+btoa(JSON.stringify({exp:4070908800,sub:"00000000-0000-0000-0000-000000000000",role:"authenticated"})),refresh_token:"fake",token_type:"bearer",expires_in:3600,expires_at:4070908800,user:{id:"00000000-0000-0000-0000-000000000000",email:"ui-test@example.com",aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-10-01T00:00:00Z"}}))`. lib/supabase.ts getStoredSession() parses both shapes.
4. Managed browser may cache Next dev fixed-name chunks; server-fetched HTML and computed styles are reliable evidence — prefer measurement over screenshots when they disagree.
5. `npx next build`; confirm the route table still includes the touched routes.

## 4. "Element the user sees but grep cannot find"

Before claiming an element exists: grep all source (case variants, Chinese labels, IP regex `\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}`), then have the browser TreeWalker TEXT_NODEs plus `<a href>`/`<script>` scan the rendered DOM. A LAN IP like 192.168.31.162 with no DOM hit is the phone browser's address bar showing the dev server URL, not page content — report that and ask for a screenshot instead of inventing code to delete.

## 5. Finish

- `git status` first: stage only the style files for this task; surface unrelated changes to the user.
- Commit with a Chinese message summarizing visual changes and explicitly noting what stayed untouched; push, retry once after 5s on connection reset. PowerShell 5.1: use single-quoted `-m '...'` (curly Chinese quotes break double-quoted args).
- Report per-spec PASS with measured values; note anything unverified (e.g. real-account flows) honestly.
