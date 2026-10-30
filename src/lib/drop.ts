export interface Slots {
  left: string | null;
  right: string | null;
}

/**
 * ドロップされたパスを左右に割り当てる。
 * 2つ以上: 先頭2つを左右へ。1つ: ドロップ位置（左半分/右半分）の側へ。
 */
export function assignDropped(paths: string[], current: Slots, side: "left" | "right"): Slots {
  if (paths.length >= 2) return { left: paths[0], right: paths[1] };
  if (paths.length === 1) return { ...current, [side]: paths[0] };
  return current;
}
