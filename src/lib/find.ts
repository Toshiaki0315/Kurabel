export type FindSide = "left" | "right";

export interface Match {
  side: FindSide;
  /** 1始まりの行番号 */
  line: number;
  /** 行内の開始位置（文字数） */
  start: number;
  length: number;
}

export const MAX_MATCHES = 5000;

/** 左右のテキストから、大文字小文字を区別せずに一致箇所を列挙する（左→右、上→下の順）。 */
export function findMatches(leftText: string, rightText: string, query: string): Match[] {
  if (query === "") return [];
  const needle = query.toLowerCase();
  const matches: Match[] = [];
  for (const [side, text] of [["left", leftText], ["right", rightText]] as const) {
    const lines = text.toLowerCase().split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (let at = lines[i].indexOf(needle); at >= 0; at = lines[i].indexOf(needle, at + needle.length)) {
        if (matches.length >= MAX_MATCHES) return matches;
        matches.push({ side, line: i + 1, start: at, length: needle.length });
      }
    }
  }
  return matches;
}
