export interface Pair {
  left: string;
  right: string;
}

const KEY = "kurabel.recent";
export const MAX_RECENT = 10;

const valid = (p: unknown): p is Pair =>
  typeof p === "object" && p !== null && typeof (p as Pair).left === "string" && typeof (p as Pair).right === "string";

export function loadRecent(): Pair[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter(valid).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** 先頭に追加（重複は除く）して保存し、新しい一覧を返す。保存に失敗しても一覧は返す。 */
export function addRecent(list: Pair[], pair: Pair): Pair[] {
  const next = [pair, ...list.filter((p) => p.left !== pair.left || p.right !== pair.right)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても動作には影響しない
  }
  return next;
}

export const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
