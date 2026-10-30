import type { Block } from "../lib/merge";
import type { DiffRow } from "../types";

interface Props {
  rows: DiffRow[];
  blocks: Block[];
  /** 現在の差分(blocks のインデックス)。なければ -1 */
  cursor: number;
  onJump: (index: number) => void;
}

/** 全体のどこに差分があるかを示す縦長のバー。クリックでその差分へ移動する。 */
export function Overview({ rows, blocks, cursor, onJump }: Props) {
  const total = Math.max(rows.length, 1);
  return (
    <div className="overview" role="navigation" aria-label="差分の位置">
      {blocks.map((b, i) => (
        <button
          key={b.start}
          className={`ov-mark ov-${rows[b.start].kind}${rows[b.start].moved ? " ov-moved" : ""}${i === cursor ? " current" : ""}`}
          style={{ top: `${(b.start / total) * 100}%`, height: `${Math.max(((b.end - b.start) / total) * 100, 0.8)}%` }}
          aria-label={`差分${i + 1}へ移動`}
          onClick={() => onJump(i)}
        />
      ))}
    </div>
  );
}
