export interface Slots {
  left: string | null;
  right: string | null;
}

/**
 * ドロップされたパスを左右に割り当てる。
 * 2つ以上: 先頭2つを左右へ。1つ: 空いている側（左優先）へ。両方埋まっていればドロップ位置の側を置換。
 */
export function assignDropped(paths: string[], current: Slots, side: "left" | "right"): Slots {
  if (paths.length >= 2) return { left: paths[0], right: paths[1] };
  if (paths.length === 1) {
    const target = !current.left ? "left" : !current.right ? "right" : side;
    return { ...current, [target]: paths[0] };
  }
  return current;
}
