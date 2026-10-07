import { parseRulesTable, type TableData } from "@/lib/rules-table";
import type { GrammarCard } from "@/lib/supabase";

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

/** 知识点卡片完整视图 */
export function Card({ card }: { card: GrammarCard }) {
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
