import type { DiffRow } from "../types";

export type Side = "left" | "right";

/** 連続する差分行の範囲 [start, end)（rows のインデックス） */
export interface Block {
  start: number;
  end: number;
}

export function findBlocks(rows: DiffRow[]): Block[] {
  const blocks: Block[] = [];
  let start = -1;
  rows.forEach((row, i) => {
    if (row.kind !== "equal" && start < 0) start = i;
    if (row.kind === "equal" && start >= 0) {
      blocks.push({ start, end: i });
      start = -1;
    }
  });
  if (start >= 0) blocks.push({ start, end: rows.length });
  return blocks;
}

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/** 差分ブロックの内容を `from` 側から反対側へ反映した、新しい左右のテキストを返す。 */
export function applyBlock(
  rows: DiffRow[],
  block: Block,
  from: Side,
  leftText: string,
  rightText: string,
): { leftText: string; rightText: string } {
  const to = other(from);
  const slice = rows.slice(block.start, block.end);
  const srcText = from === "left" ? leftText : rightText;
  const dstText = from === "left" ? rightText : leftText;
  const srcLines = srcText.split("\n");
  const dstLines = dstText.split("\n");
  const eol = dstText.includes("\r\n") ? "\r" : "";

  const srcNos = slice.flatMap((r) => (r[from] ? [r[from]!.line_no] : []));
  const dstNos = slice.flatMap((r) => (r[to] ? [r[to]!.line_no] : []));
  const insert = srcNos.map((n) => (srcLines[n - 1] ?? "").replace(/\r$/, "") + eol);

  if (dstNos.length > 0) {
    dstLines.splice(dstNos[0] - 1, dstNos.length, ...insert);
  } else {
    // 反対側に対応行がない（純粋な追加/削除）: 直前の対応行の後ろに挿入する
    let at = 0;
    for (let i = block.start - 1; i >= 0; i--) {
      const cell = rows[i][to];
      if (cell) {
        at = cell.line_no;
        break;
      }
    }
    dstLines.splice(at, 0, ...insert);
  }
  const merged = dstLines.join("\n");
  return from === "left" ? { leftText, rightText: merged } : { leftText: merged, rightText };
}

/** `from` 側の行番号に対応する反対側の行番号（対応行がなければ直前の対応行）。 */
export function correspondingLine(rows: DiffRow[], from: Side, line: number): number {
  const to = other(from);
  const idx = rows.findIndex((r) => r[from]?.line_no === line);
  if (idx < 0) return line;
  for (let i = idx; i >= 0; i--) {
    const cell = rows[i][to];
    if (cell) return cell.line_no;
  }
  return 1;
}

/** ブロックの先頭に対応する左右の行番号（対応行がない側は直前の行）。 */
export function blockLines(rows: DiffRow[], block: Block): { left: number; right: number } {
  const first = rows[block.start];
  const left = first.left?.line_no ?? correspondingLine(rows, "right", first.right!.line_no);
  const right = first.right?.line_no ?? correspondingLine(rows, "left", first.left!.line_no);
  return { left, right };
}
