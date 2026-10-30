import { useState } from "react";
import type { BinaryRow, ByteCell } from "../types";

const PAGE = 500;

function Side({ cells }: { cells: ByteCell[] }) {
  return (
    <>
      <td className="hex">
        {cells.map((c, i) => (
          <span key={i} className={c.changed ? "byte chg" : "byte"}>
            {c.hex}
          </span>
        ))}
      </td>
      <td className="ascii">
        {cells.map((c, i) => (
          <span key={i} className={c.changed ? "chg" : undefined}>
            {c.ascii}
          </span>
        ))}
      </td>
    </>
  );
}

export function BinaryCompare(props: { rows: BinaryRow[]; leftSize: number; rightSize: number }) {
  const [shown, setShown] = useState(PAGE);
  const visible = props.rows.slice(0, shown);
  return (
    <section className="binary-compare">
      <div className="bar">
        <span>バイナリ比較（読み取り専用）</span>
        <span className="summary">
          左 {props.leftSize} バイト / 右 {props.rightSize} バイト
        </span>
      </div>
      <table className="diff-table mono">
        <tbody>
          {visible.map((r) => (
            <tr key={r.offset}>
              <td className="ln">{r.offset.toString(16).padStart(8, "0")}</td>
              <Side cells={r.left} />
              <Side cells={r.right} />
            </tr>
          ))}
        </tbody>
      </table>
      {shown < props.rows.length && (
        <button onClick={() => setShown((n) => n + PAGE)}>もっと表示 ({props.rows.length - shown} 行)</button>
      )}
    </section>
  );
}
