import { useEffect, useRef, useState } from "react";
import { diffText } from "../api";
import type { DiffMode, DiffRow } from "../types";
import { CellText } from "./Segments";

interface Props {
  leftText: string;
  rightText: string;
  rows: DiffRow[];
  mode: DiffMode;
}

export function TextCompare(props: Props) {
  const [leftText, setLeftText] = useState(props.leftText);
  const [rightText, setRightText] = useState(props.rightText);
  const [rows, setRows] = useState(props.rows);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);

  const rediff = async (l: string, r: string, mode: DiffMode) => {
    try {
      setRows(await diffText(l, r, mode));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void rediff(leftText, rightText, props.mode);
    // 表示モード切替時のみ再計算する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode]);

  const diffCount = rows.filter((r) => r.kind !== "equal").length;

  return (
    <section className="text-compare">
      <div className="bar">
        <button onClick={() => setEditing((v) => !v)}>{editing ? "表示に戻る" : "編集"}</button>
        <button
          onClick={() => {
            setEditing(false);
            void rediff(leftText, rightText, props.mode);
          }}
        >
          再比較
        </button>
        <span className="summary">差分 {diffCount} 行</span>
        {error && <span role="alert" className="error">{error}</span>}
      </div>
      {editing ? (
        <div className="edit-panes">
          <textarea aria-label="左のテキスト" value={leftText} onChange={(e) => setLeftText(e.target.value)} spellCheck={false} />
          <textarea aria-label="右のテキスト" value={rightText} onChange={(e) => setRightText(e.target.value)} spellCheck={false} />
        </div>
      ) : (
        <table className="diff-table">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={`row-${row.kind}`}>
                <td className="ln">{row.left?.line_no}</td>
                <td className="code left">
                  <CellText cell={row.left} />
                </td>
                <td className="ln">{row.right?.line_no}</td>
                <td className="code right">
                  <CellText cell={row.right} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
