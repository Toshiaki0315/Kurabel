import type { DirEntry, DiffRow } from "../types";
import { buildDirReport, buildTextReport, escapeHtml, nowLabel } from "./report";

const seg = (text: string, changed = false) => ({ text, changed });

describe("escapeHtml", () => {
  it("escapes every character that could change the markup", () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;");
    expect(escapeHtml("plain")).toBe("plain");
  });
});

describe("buildTextReport", () => {
  const rows: DiffRow[] = [
    { kind: "equal", left: { line_no: 1, segments: [seg("same")] }, right: { line_no: 1, segments: [seg("same")] } },
    { kind: "replace", left: { line_no: 2, segments: [seg("a "), seg("<old>", true)] }, right: { line_no: 2, segments: [seg("a "), seg("new & more", true)] } },
    { kind: "delete", left: { line_no: 3, segments: [seg("moved", true)] }, right: null, moved: true },
    { kind: "insert", left: null, right: { line_no: 3, segments: [seg("added", true)] } },
  ];
  const html = buildTextReport("/l/<a>.txt", "/r/b.txt", rows, "2026/1/2 03:04:05");

  it("is a complete, self-contained HTML document with no scripts", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
    expect(html).toContain("2026/1/2 03:04:05");
    expect(html).toContain("<dt>差分</dt><dd>3 行</dd>");
  });

  it("escapes paths and text", () => {
    expect(html).toContain("/l/&lt;a&gt;.txt");
    expect(html).not.toContain("<a>.txt");
    expect(html).toContain("<mark>&lt;old&gt;</mark>");
    expect(html).toContain("<mark>new &amp; more</mark>");
  });

  it("writes one row per line with its kind, line numbers and moved marker", () => {
    expect(html).toContain('<tr class="equal"><td class="ln">1</td><td class="code left">same</td><td class="ln">1</td><td class="code right">same</td></tr>');
    expect(html).toContain('<tr class="replace">');
    expect(html).toContain('<tr class="delete moved"><td class="ln">3</td><td class="code left"><mark>moved</mark></td><td class="ln"></td><td class="code right"></td></tr>');
    expect(html).toContain('<tr class="insert"><td class="ln"></td><td class="code left"></td><td class="ln">3</td>');
  });
});

describe("buildDirReport", () => {
  const entries: DirEntry[] = [
    { path: "sub", left: "directory", right: "directory", status: "same" },
    { path: "sub/<x>.txt", left: "file", right: "file", status: "modified", left_size: 1536, right_size: 10, left_modified: 2_000_000_000, right_modified: 1_000_000_000 },
    { path: "gone.txt", left: "file", right: null, status: "removed", left_size: 5, left_modified: 1_500_000_000 },
    { path: "new.txt", left: null, right: "file", status: "added", right_size: 7, right_modified: 1_600_000_000 },
    { path: "same.txt", left: "file", right: "file", status: "same", left_size: 1, right_size: 1 },
  ];
  const html = buildDirReport("/L", "/R/<dir>", entries, "now");

  it("summarizes the counts by status", () => {
    expect(html).toContain("変更 1 件 / 追加 1 件（右のみ）/ 削除 1 件（左のみ）/ 同一 2 件");
    expect(html).toContain("<h1>クラベル フォルダ比較レポート</h1>");
    expect(html).toContain("/R/&lt;dir&gt;");
  });

  it("lists each entry with status, sizes and dates, marking folders and escaping names", () => {
    expect(html).toContain("<td>sub/</td>");
    expect(html).toContain("<td>sub/&lt;x&gt;.txt</td><td>変更</td><td class=\"num\">1.5 KB</td>");
    expect(html).toContain('<tr class="removed"><td>gone.txt</td><td>削除</td>');
    expect(html).toContain('<tr class="added"><td>new.txt</td><td>追加</td><td class="num"></td><td class="num"></td><td class="num">7 B</td>');
    expect(html).not.toContain("<x>");
  });

  it("emphasizes the newer side of a modified file only", () => {
    const modifiedRow = html.split("\n").find((l) => l.includes("&lt;x&gt;.txt"))!;
    expect(modifiedRow.match(/class="num newer"/g)).toHaveLength(1);
    expect(modifiedRow.indexOf("newer")).toBeLessThan(modifiedRow.indexOf("10 B")); // 左（新しい側）
    expect(html.match(/class="num newer"/g)).toHaveLength(1);
  });

  it("copes with entries that have no metadata", () => {
    const bare = buildDirReport("/L", "/R", [{ path: "a", left: "file", right: "file", status: "modified" }], "now");
    expect(bare).toContain('<td class="num"></td>');
    expect(bare).not.toContain("num newer"); // CSS には newer が含まれるので、クラス指定で確認する
  });
});

describe("nowLabel", () => {
  it("formats the given date in the Japanese locale", () => {
    expect(nowLabel(new Date(2026, 0, 2, 3, 4, 5))).toMatch(/2026/);
    expect(typeof nowLabel()).toBe("string");
  });
});
