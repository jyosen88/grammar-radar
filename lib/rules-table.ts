export interface TableData {
  headers: string[];
  rows: string[][];
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/**
 * 把 rules_table 字段解析为可渲染的表格数据。
 * 依次尝试：JSON（数组/对象）、Markdown 表格字符串、普通文本兜底。
 */
export function parseRulesTable(raw: unknown): TableData | string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  let value: unknown = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("[") || t.startsWith("{")) {
      try {
        value = JSON.parse(t);
      } catch {
        // 不是合法 JSON，按普通文本处理
      }
    }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const first = value[0];
    if (Array.isArray(first)) {
      const rows = (value as unknown[][]).map((r) => r.map(String));
      return { headers: rows[0], rows: rows.slice(1) };
    }
    if (typeof first === "object" && first !== null) {
      const headers = [
        ...new Set(value.flatMap((o) => Object.keys(o as object))),
      ];
      return {
        headers,
        rows: (value as Record<string, unknown>[]).map((o) =>
          headers.map((h) =>
            o[h] === null || o[h] === undefined ? "" : String(o[h])
          )
        ),
      };
    }
    return { headers: ["规则"], rows: value.map((v) => [String(v)]) };
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return null;
    return {
      headers: ["项目", "说明"],
      rows: entries.map(([k, v]) => [k, v === null ? "" : String(v)]),
    };
  }

  // 字符串：尝试按 Markdown 表格解析
  const lines = String(value)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const pipeLines = lines.filter((l) => l.includes("|"));
  if (pipeLines.length >= 2) {
    const headers = splitMarkdownRow(pipeLines[0]);
    const rows = pipeLines
      .slice(1)
      .map(splitMarkdownRow)
      .filter((cells) => !isSeparatorRow(cells))
      .map((cells) => {
        while (cells.length < headers.length) cells.push("");
        return cells.slice(0, headers.length);
      });
    if (headers.some(Boolean) || rows.length) {
      return { headers, rows };
    }
  }

  return String(value).trim();
}
