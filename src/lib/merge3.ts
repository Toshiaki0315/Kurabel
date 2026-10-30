import type { MergeChunk } from "../types";

/** 競合の解決方法: 左 / 基準 / 右を採用、または左→右・右→左の順に両方を残す */
export type Resolution = "left" | "base" | "right" | "leftright" | "rightleft";

export const RESOLUTIONS: { value: Resolution; label: string }[] = [
  { value: "left", label: "左を採用" },
  { value: "base", label: "基準を採用" },
  { value: "right", label: "右を採用" },
  { value: "leftright", label: "左→右" },
  { value: "rightleft", label: "右→左" },
];

export type Resolutions = Record<number, Resolution>;

/** 競合の断片の位置（chunks のインデックス）一覧 */
export function conflictIndexes(chunks: MergeChunk[]): number[] {
  return chunks.flatMap((c, i) => (c.kind === "conflict" ? [i] : []));
}

export function unresolvedCount(chunks: MergeChunk[], resolutions: Resolutions): number {
  return conflictIndexes(chunks).filter((i) => resolutions[i] === undefined).length;
}

/** 断片が結果に出力する行。未解決の競合は、両側を競合マーカーで挟んで残す。 */
export function resultLines(chunk: MergeChunk, resolution?: Resolution): string[] {
  switch (chunk.kind) {
    case "stable":
    case "same":
      return chunk.lines;
    case "left":
      return chunk.left;
    case "right":
      return chunk.right;
    case "conflict":
      switch (resolution) {
        case "left":
          return chunk.left;
        case "base":
          return chunk.base;
        case "right":
          return chunk.right;
        case "leftright":
          return [...chunk.left, ...chunk.right];
        case "rightleft":
          return [...chunk.right, ...chunk.left];
        default:
          return ["<<<<<<< 左", ...chunk.left, "=======", ...chunk.right, ">>>>>>> 右"];
      }
  }
}

export function buildResult(chunks: MergeChunk[], resolutions: Resolutions, eol: string, trailingNewline: boolean): string {
  const lines = chunks.flatMap((c, i) => resultLines(c, resolutions[i]));
  if (lines.length === 0) return "";
  return lines.join(eol) + (trailingNewline ? eol : "");
}
