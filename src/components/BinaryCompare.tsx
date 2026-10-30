import { useState } from "react";
import { ToolbarPortal } from "./ToolbarSlot";
import type { BinaryRow, ByteCell } from "../types";

const PAGE = 500;

function Side({ offset, cells }: { offset: number; cells: ByteCell[] }) {
  return (
    <>
      <td className="ln">{offset.toString(16).padStart(8, "0")}</td>
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

export function BinaryCompare(props: { rows: BinaryRow[]; truncated?: boolean }) {
  const [shown, setShown] = useState(PAGE);
  const visible = props.rows.slice(0, shown);
  return (
    <section className="binary-compare">
      <ToolbarPortal>
        <span>バイナリ比較（読み取り専用）</span>
        {props.truncated && <span className="summary">大きいため、先頭 {props.rows.length * 16} バイトのみ表示しています</span>}
      </ToolbarPortal>
      <table className="diff-table mono">
        <tbody>
          {visible.map((r) => (
            <tr key={r.offset}>
              <Side offset={r.offset} cells={r.left} />
              <td className="mid" />
              <Side offset={r.offset} cells={r.right} />
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
