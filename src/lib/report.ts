import type { DirEntry, DiffRow } from "../types";
import { formatDate, formatSize } from "./format";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STYLE = `
body { font-family: system-ui, "Hiragino Sans", sans-serif; margin: 24px; color: #1d2433; }
h1 { font-size: 20px; margin: 0 0 12px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0 0 16px; }
dt { font-weight: 600; } dd { margin: 0; word-break: break-all; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
td, th { border: 1px solid #d5dbe8; padding: 2px 8px; vertical-align: top; }
th { background: #eef2fb; text-align: left; }
td.ln { width: 3.5em; text-align: right; color: #7a8499; user-select: none; }
td.code { font-family: ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
.insert td.right, .added td { background: #d9f7e6; } .delete td.left, .removed td { background: #ffe0de; }
.replace td.code, .modified td { background: #fff3c4; } .moved td.code { background: #e3d6ff; }
mark { background: #ffb454; color: inherit; }
.num { text-align: right; white-space: nowrap; } .newer { font-weight: 700; }
.summary { margin: 0 0 16px; }
`;

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function cellHtml(cell: DiffRow["left"]): string {
  if (!cell) return "";
  return cell.segments.map((s) => (s.changed ? `<mark>${escapeHtml(s.text)}</mark>` : escapeHtml(s.text))).join("");
}

/** 2つのテキストの比較レポート（左右に並べた全行。差分は色付き、変更箇所は強調）。 */
export function buildTextReport(leftPath: string, rightPath: string, rows: DiffRow[], generatedAt: string): string {
  const differing = rows.filter((r) => r.kind !== "equal").length;
  const body = rows
    .map((r) => {
      const cls = `${r.kind}${r.moved ? " moved" : ""}`;
      return `<tr class="${cls}"><td class="ln">${r.left?.line_no ?? ""}</td><td class="code left">${cellHtml(r.left)}</td><td class="ln">${r.right?.line_no ?? ""}</td><td class="code right">${cellHtml(r.right)}</td></tr>`;
    })
    .join("\n");
  return document(
    "クラベル 比較レポート",
    `<h1>クラベル 比較レポート</h1>
<dl>
<dt>左</dt><dd>${escapeHtml(leftPath)}</dd>
<dt>右</dt><dd>${escapeHtml(rightPath)}</dd>
<dt>作成日時</dt><dd>${escapeHtml(generatedAt)}</dd>
<dt>差分</dt><dd>${differing} 行</dd>
</dl>
<table>
<tbody>
${body}
</tbody>
</table>`,
  );
}

const STATUS_LABEL = { same: "同一", added: "追加", removed: "削除", modified: "変更" } as const;

/** フォルダ比較のレポート（状態・サイズ・更新日時の一覧）。 */
export function buildDirReport(leftRoot: string, rightRoot: string, entries: DirEntry[], generatedAt: string): string {
  const count = (s: DirEntry["status"]) => entries.filter((e) => e.status === s).length;
  const newer = (e: DirEntry, side: "left" | "right") => {
    const [mine, other] = side === "left" ? [e.left_modified, e.right_modified] : [e.right_modified, e.left_modified];
    return e.status === "modified" && mine != null && other != null && mine > other ? " newer" : "";
  };
  const body = entries
    .map((e) => {
      const isDir = (e.right ?? e.left) === "directory";
      const name = `${escapeHtml(e.path)}${isDir ? "/" : ""}`;
      return `<tr class="${e.status}"><td>${name}</td><td>${STATUS_LABEL[e.status]}</td><td class="num">${formatSize(e.left_size)}</td><td class="num${newer(e, "left")}">${formatDate(e.left_modified)}</td><td class="num">${formatSize(e.right_size)}</td><td class="num${newer(e, "right")}">${formatDate(e.right_modified)}</td></tr>`;
    })
    .join("\n");
  return document(
    "クラベル フォルダ比較レポート",
    `<h1>クラベル フォルダ比較レポート</h1>
<dl>
<dt>左</dt><dd>${escapeHtml(leftRoot)}</dd>
<dt>右</dt><dd>${escapeHtml(rightRoot)}</dd>
<dt>作成日時</dt><dd>${escapeHtml(generatedAt)}</dd>
</dl>
<p class="summary">変更 ${count("modified")} 件 / 追加 ${count("added")} 件（右のみ）/ 削除 ${count("removed")} 件（左のみ）/ 同一 ${count("same")} 件</p>
<table>
<thead><tr><th>パス</th><th>状態</th><th>左のサイズ</th><th>左の更新日時</th><th>右のサイズ</th><th>右の更新日時</th></tr></thead>
<tbody>
${body}
</tbody>
</table>`,
  );
}

/** レポートの「作成日時」表記。 */
export function nowLabel(date = new Date()): string {
  return date.toLocaleString("ja-JP");
}
