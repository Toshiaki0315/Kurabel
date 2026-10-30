export interface Match {
  /** 1始まりの行番号 */
  line: number;
  /** 行内の開始位置（文字数） */
  start: number;
  length: number;
}

export const MAX_MATCHES = 5000;

/** テキストから、大文字小文字を区別せずに一致箇所を上から順に列挙する。 */
export function findMatches(text: string, query: string): Match[] {
  if (query === "") return [];
  const needle = query.toLowerCase();
  const matches: Match[] = [];
  const lines = text.toLowerCase().split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (let at = lines[i].indexOf(needle); at >= 0; at = lines[i].indexOf(needle, at + needle.length)) {
      if (matches.length >= MAX_MATCHES) return matches;
      matches.push({ line: i + 1, start: at, length: needle.length });
    }
  }
  return matches;
}

/** 一致箇所のテキスト全体での位置。 */
function offsetOf(text: string, m: Match): number {
  let offset = 0;
  const lines = text.split("\n");
  for (let i = 0; i < m.line - 1; i++) offset += lines[i].length + 1;
  return offset + m.start;
}

/** 一致箇所1つを置き換えたテキストを返す。 */
export function replaceMatch(text: string, m: Match, replacement: string): string {
  const at = offsetOf(text, m);
  return text.slice(0, at) + replacement + text.slice(at + m.length);
}

/** すべての一致箇所（大文字小文字を区別しない）を置き換えたテキストを返す。 */
export function replaceAll(text: string, query: string, replacement: string): string {
  if (query === "") return text;
  const needle = query.toLowerCase();
  const lower = text.toLowerCase();
  let out = "";
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
    out += text.slice(from, at) + replacement;
    from = at + needle.length;
  }
  return out + text.slice(from);
}
