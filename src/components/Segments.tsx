import { Fragment, type ReactNode } from "react";
import type { Token, TokenType } from "../lib/syntax";
import type { Cell, Segment } from "../types";

/** 空白を見える記号にする。空白は ·、全角空白は □、タブは下線つきのタブ（幅を変えない）。 */
function visible(text: string): ReactNode[] {
  return text
    .split(/( +|\t+|　+)/)
    .filter((p) => p !== "")
    .map((p, i) => {
      if (p[0] === " ") return <span key={i} className="ws">{"·".repeat(p.length)}</span>;
      if (p[0] === "\t") return <span key={i} className="ws tab">{p}</span>;
      if (p[0] === "　") return <span key={i} className="ws">{"□".repeat(p.length)}</span>;
      return p;
    });
}

/** 行末の改行を示す印。 */
export function EolMarker() {
  return (
    <span className="ws eol" aria-hidden="true">
      ↵
    </span>
  );
}

/** セグメント（text のうち offset から始まる範囲）を、トークンの境界で分割する。 */
function pieces(text: string, offset: number, tokens: Token[]): { text: string; type?: TokenType }[] {
  const out: { text: string; type?: TokenType }[] = [];
  let pos = 0;
  for (const t of tokens) {
    if (t.end <= offset || t.start >= offset + text.length) continue;
    const start = Math.max(t.start, offset) - offset;
    const end = Math.min(t.end, offset + text.length) - offset;
    if (start > pos) out.push({ text: text.slice(pos, start) });
    out.push({ text: text.slice(start, end), type: t.type });
    pos = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** 差分のセグメント（変更箇所は強調）を、シンタックスの色と空白記号つきで描画する。 */
export function renderSegments(segments: Segment[], tokens?: Token[], showWs = false): ReactNode[] {
  let offset = 0;
  return segments.map((s, si) => {
    const plain = !showWs && (!tokens || tokens.length === 0);
    const inner: ReactNode = plain
      ? s.text
      : pieces(s.text, offset, tokens ?? []).map((p, pi) => {
          const content = showWs ? visible(p.text) : p.text;
          return p.type ? (
            <span key={pi} className={`tok-${p.type}`}>
              {content}
            </span>
          ) : (
            <Fragment key={pi}>{content}</Fragment>
          );
        });
    offset += s.text.length;
    return s.changed ? (
      <mark key={si} className="chg">
        {inner}
      </mark>
    ) : (
      <span key={si}>{inner}</span>
    );
  });
}

export function CellText({ cell, tokens, showWs }: { cell: Cell | null; tokens?: Token[]; showWs?: boolean }) {
  if (!cell) return null;
  return (
    <>
      {renderSegments(cell.segments, tokens, showWs)}
      {showWs && <EolMarker />}
    </>
  );
}
