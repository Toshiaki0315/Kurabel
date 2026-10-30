import { useEffect, useMemo, useRef, useState } from "react";
import { diffText, saveText } from "../api";
import { applyBlock, blockLines, correspondingLine, findBlocks, type Side } from "../lib/merge";
import type { DiffMode, DiffOptions, DiffRow, TextEncoding } from "../types";
import { CellText } from "./Segments";
import { ToolbarPortal } from "./ToolbarSlot";
import { NumberedTextarea, type EditorHandle, type LineHighlight } from "./NumberedTextarea";

const REDIFF_DELAY_MS = 300;

function highlightsFor(rows: DiffRow[], side: Side): Map<number, LineHighlight> {
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
  options: DiffOptions;
  /** いずれかのペインに未保存の変更があるかどうかの通知（アンマウント時は false） */
  onDirtyChange?: (dirty: boolean) => void;
  /** どちらかが null = 1つだけ開いている。比較せず、閲覧専用で表示する（編集・保存・差分操作なし） */
  leftPath: string | null;
  rightPath: string | null;
  leftEncoding: TextEncoding;
  rightEncoding: TextEncoding;
}

export function TextCompare(props: Props) {
  const [leftText, setLeftText] = useState(props.leftText);
  const [rightText, setRightText] = useState(props.rightText);
  const [savedLeft, setSavedLeft] = useState(props.leftText);
  const [savedRight, setSavedRight] = useState(props.rightText);
  const [rows, setRows] = useState(props.rows);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const applied = useRef({ mode: props.mode, options: props.options });
  const diffed = useRef({ left: props.leftText, right: props.rightText });
  const seq = useRef(0);
  const root = useRef<HTMLElement>(null);
  const editors = { left: useRef<EditorHandle>(null), right: useRef<EditorHandle>(null) };

  const blocks = useMemo(() => findBlocks(rows), [rows]);
  const blockAt = useMemo(() => new Map(blocks.map((b, i) => [b.start, i])), [blocks]);

  const rediff = async (l: string, r: string, mode: DiffMode) => {
    if (props.leftPath === null || props.rightPath === null) return; // 1つだけのときは比較しない
    const id = ++seq.current;
    diffed.current = { left: l, right: r };
    try {
      const next = await diffText(l, r, mode, props.options);
      if (id !== seq.current) return; // より新しい比較が走っている
      setRows(next);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const save = async (side: Side) => {
    const [path, text, encoding] =
      side === "left" ? [props.leftPath, leftText, props.leftEncoding] : [props.rightPath, rightText, props.rightEncoding];
    if (path === null) return;
    try {
      await saveText(path, text, encoding);
      (side === "left" ? setSavedLeft : setSavedRight)(text);
      setError(null);
      await rediff(leftText, rightText, props.mode);
    } catch (e) {
      setError(String(e));
    }
  };

  // 編集欄へ insertText で反映するので、Cmd/Ctrl+Z でマージも元に戻せる
  const merge = (blockIndex: number, from: Side) => {
    const next = applyBlock(rows, blocks[blockIndex], from, leftText, rightText);
    const to: Side = from === "left" ? "right" : "left";
    editors[to].current?.replaceText(to === "left" ? next.leftText : next.rightText);
    void rediff(next.leftText, next.rightText, props.mode);
  };

  const goto = (index: number) => {
    setCursor(index);
    if (editing) {
      const { left, right } = blockLines(rows, blocks[index]);
      editors.left.current?.scrollToLine(Math.max(1, left - 2));
      editors.right.current?.scrollToLine(Math.max(1, right - 2));
    } else {
      root.current?.querySelector(`[data-block="${index}"]`)?.scrollIntoView?.({ block: "center" });
    }
  };
  const step = (delta: 1 | -1) => {
    if (blocks.length > 0) goto((cursor + delta + blocks.length) % blocks.length);
  };

  // F7 / Shift+F7 で次/前の差分へ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F7") return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    // 開発時の StrictMode では効果が二重に走るので、実際に値が変わったときだけ再比較する
    const prev = applied.current;
    if (prev.mode === props.mode && prev.options === props.options) return;
    applied.current = { mode: props.mode, options: props.options };
    void rediff(leftText, rightText, props.mode);
    // 表示モード・比較オプションの切替時のみ再計算する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, props.options]);

  // 入力が止まってから自動で再比較し、ハイライトを追従させる
  useEffect(() => {
    if (leftText === diffed.current.left && rightText === diffed.current.right) return;
    const timer = setTimeout(() => void rediff(leftText, rightText, props.mode), REDIFF_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftText, rightText]);

  const isDirty = (side: Side) => (side === "left" ? leftText !== savedLeft : rightText !== savedRight);
  // Cmd/Ctrl+S: カーソルのあるペインのみ保存
  const saveShortcut = (side: Side) => () => {
    if (isDirty(side)) void save(side);
  };
  // 一方のスクロールに、もう一方を対応する行で追従させる
  const syncFrom = (side: Side) => (line: number) => {
    const to: Side = side === "left" ? "right" : "left";
    editors[to].current?.scrollToLine(correspondingLine(rows, side, line));
  };

  const anyDirty = isDirty("left") || isDirty("right");
  useEffect(() => {
    props.onDirtyChange?.(anyDirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyDirty]);
  useEffect(
    () => () => props.onDirtyChange?.(false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const single = props.leftPath === null || props.rightPath === null;
  const diffCount = rows.filter((r) => r.kind !== "equal").length;
  const inCurrent = (i: number) => cursor >= 0 && blocks[cursor] && i >= blocks[cursor].start && i < blocks[cursor].end;

  return (
    <section className="text-compare" ref={root}>
      <ToolbarPortal>
        {!single && (
          <>
            <button onClick={() => setEditing((v) => !v)}>{editing ? "表示に戻る" : "編集"}</button>
            <button aria-label="前の差分" title="前の差分 (Shift+F7)" disabled={blocks.length === 0} onClick={() => step(-1)}>
              ▲
            </button>
            <button aria-label="次の差分" title="次の差分 (F7)" disabled={blocks.length === 0} onClick={() => step(1)}>
              ▼
            </button>
            <span className="summary">
              差分 {diffCount} 行{blocks.length > 0 && cursor >= 0 ? `（${cursor + 1} / ${blocks.length} 箇所）` : ""}
            </span>
          </>
        )}
        {error && <span role="alert" className="error">{error}</span>}
      </ToolbarPortal>
      {!single && (
      <div className="pane-actions">
        {(["left", "right"] as const).map((side) => (
          <PaneAction key={side} side={side} dirty={isDirty(side)} onSave={() => void save(side)} />
        ))}
      </div>
      )}
      {/* 編集→表示→編集でも元に戻す履歴を保つため、テキストエリアは常に保持し表示だけ切り替える */}
      <div className={editing && !single ? "edit-panes" : "edit-panes offscreen"} aria-hidden={!editing || single}>
        <NumberedTextarea ref={editors.left} label="左のテキスト" value={leftText} onChange={setLeftText} onSave={saveShortcut("left")} onScrollLine={syncFrom("left")} highlights={highlightsFor(rows, "left")} />
        <div className="mid" />
        <NumberedTextarea ref={editors.right} label="右のテキスト" value={rightText} onChange={setRightText} onSave={saveShortcut("right")} onScrollLine={syncFrom("right")} highlights={highlightsFor(rows, "right")} />
      </div>
      {(!editing || single) && (
        <table className="diff-table">
          <tbody>
            {rows.map((row, i) => {
              const b = blockAt.get(i);
              return (
                <tr key={i} className={`row-${row.kind}${inCurrent(i) ? " row-current" : ""}`} data-block={b}>
                  <td className="ln">{row.left?.line_no}</td>
                  <td className="code left">
                    <CellText cell={row.left} />
                  </td>
                  <td className="mid merge">
                    {b !== undefined && (
                      <>
                        <button aria-label={`差分${b + 1}を左から右へ反映`} title="左の内容を右へ反映" onClick={() => merge(b, "left")}>
                          →
                        </button>
                        <button aria-label={`差分${b + 1}を右から左へ反映`} title="右の内容を左へ反映" onClick={() => merge(b, "right")}>
                          ←
                        </button>
                      </>
                    )}
                  </td>
                  <td className="ln">{row.right?.line_no}</td>
                  <td className="code right">
                    <CellText cell={row.right} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PaneAction({ side, dirty, onSave }: { side: Side; dirty: boolean; onSave: () => void }) {
  const name = side === "left" ? "左" : "右";
  return (
    <>
      {side === "right" && <div className="mid" />}
      <div className={`pane-action ${side}`}>
        <button aria-label={`${name}を保存`} disabled={!dirty} onClick={onSave}>
          保存
        </button>
        {dirty && <span className="dirty">未保存の変更あり</span>}
      </div>
    </>
  );
}
