import { useEffect, useRef, useState } from "react";
import { diffText, saveText } from "../api";
import type { DiffMode, DiffRow } from "../types";
import { ToolbarPortal } from "./ToolbarSlot";
import { NumberedTextarea, type LineHighlight } from "./NumberedTextarea";
import { CellText } from "./Segments";

const REDIFF_DELAY_MS = 300;

function highlightsFor(rows: DiffRow[], side: "left" | "right"): Map<number, LineHighlight> {
  const map = new Map<number, LineHighlight>();
  for (const row of rows) {
    const cell = row[side];
    if (cell && row.kind !== "equal") map.set(cell.line_no, { kind: row.kind, segments: cell.segments });
  }
  return map;
}

interface Props {
  leftText: string;
  rightText: string;
  rows: DiffRow[];
  mode: DiffMode;
  leftPath: string;
  rightPath: string;
}

export function TextCompare(props: Props) {
  const [leftText, setLeftText] = useState(props.leftText);
  const [rightText, setRightText] = useState(props.rightText);
  const [savedLeft, setSavedLeft] = useState(props.leftText);
  const [savedRight, setSavedRight] = useState(props.rightText);
  const [rows, setRows] = useState(props.rows);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const diffed = useRef({ left: props.leftText, right: props.rightText });
  const seq = useRef(0);

  const rediff = async (l: string, r: string, mode: DiffMode) => {
    const id = ++seq.current;
    diffed.current = { left: l, right: r };
    try {
      const next = await diffText(l, r, mode);
      if (id !== seq.current) return; // より新しい比較が走っている
      setRows(next);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const save = async (side: "left" | "right") => {
    const [path, text] = side === "left" ? [props.leftPath, leftText] : [props.rightPath, rightText];
    try {
      await saveText(path, text);
      (side === "left" ? setSavedLeft : setSavedRight)(text);
      setError(null);
      await rediff(leftText, rightText, props.mode);
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

  // 入力が止まってから自動で再比較し、ハイライトを追従させる
  useEffect(() => {
    if ((leftText === diffed.current.left && rightText === diffed.current.right)) return;
    const timer = setTimeout(() => void rediff(leftText, rightText, props.mode), REDIFF_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftText, rightText]);

  const isDirty = (side: "left" | "right") => (side === "left" ? leftText !== savedLeft : rightText !== savedRight);
  // Cmd/Ctrl+S: カーソルのあるペインのみ保存
  const saveShortcut = (side: "left" | "right") => () => {
    if (isDirty(side)) void save(side);
  };

  const diffCount = rows.filter((r) => r.kind !== "equal").length;

  return (
    <section className="text-compare">
      <ToolbarPortal>
        <button onClick={() => setEditing((v) => !v)}>{editing ? "表示に戻る" : "編集"}</button>
        <span className="summary">差分 {diffCount} 行</span>
        {error && <span role="alert" className="error">{error}</span>}
      </ToolbarPortal>
      <div className="pane-actions">
        {(["left", "right"] as const).map((side) => {
          const dirty = isDirty(side);
          return (
            <div key={side} className={`pane-action ${side}`}>
              <button aria-label={`${side === "left" ? "左" : "右"}を保存`} disabled={!dirty} onClick={() => void save(side)}>
                保存
              </button>
              {dirty && <span className="dirty">未保存の変更あり</span>}
            </div>
          );
        })}
      </div>
      {/* 編集→表示→編集でも元に戻す履歴を保つため、テキストエリアは常に保持し表示だけ切り替える */}
      <div className="edit-panes" hidden={!editing}>
        <NumberedTextarea label="左のテキスト" value={leftText} onChange={setLeftText} onSave={saveShortcut("left")} highlights={highlightsFor(rows, "left")} />
        <NumberedTextarea label="右のテキスト" value={rightText} onChange={setRightText} onSave={saveShortcut("right")} highlights={highlightsFor(rows, "right")} />
      </div>
      {!editing && (
        <table className="diff-table">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={`row-${row.kind}`}>
                <td className="ln">{row.left?.line_no}</td>
                <td className="code left">
                  <CellText cell={row.left} />
                </td>
                <td className="ln divider">{row.right?.line_no}</td>
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
