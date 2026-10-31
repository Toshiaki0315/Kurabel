import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diffText, makePatch, pickPatchPath, saveText, writePatch } from "../api";
import { findMatches, replaceAll, replaceMatch, type Match } from "../lib/find";
import { baseName } from "../lib/recent";
import { buildTextReport, nowLabel } from "../lib/report";
import { languageFor, SYNTAX_MAX_LINES, tokenizeLines, type Token } from "../lib/syntax";
import { saveReport } from "../lib/saveReport";
import { applyBlock, blockLines, correspondingLine, findBlocks, type Side } from "../lib/merge";
import type { Cell, DiffMode, DiffOptions, DiffRow, TextEncoding } from "../types";
import { CellText } from "./Segments";
import { Overview } from "./Overview";
import { OverviewPortal, ToolbarPortal } from "./ToolbarSlot";
import { LINE_HEIGHT, NumberedTextarea, type EditorHandle, type LineHighlight } from "./NumberedTextarea";

const REDIFF_DELAY_MS = 300;
/** これを超える行数の差分表は、画面に見える範囲の行だけを描画する（1行の高さを固定して位置を計算する） */
export const VIRTUAL_ROWS = 2000;
const OVERSCAN = 40;

function highlightsFor(rows: DiffRow[], side: Side): Map<number, LineHighlight> {
  const map = new Map<number, LineHighlight>();
  for (const row of rows) {
    const cell = row[side];
    if (cell && row.kind !== "equal") map.set(cell.line_no, { kind: row.kind, moved: row.moved, segments: cell.segments });
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
  /** アーカイブ内のファイルなど、書き込めないもの。編集・保存・マージはできず、比較の確認だけができる */
  readOnly?: boolean;
  /** シンタックスハイライトの言語判定に使う名前（アーカイブ内のファイル名など）。省略時は左のパス */
  languagePath?: string;
  /** 空白・タブ・改行を記号で表示する */
  showWhitespace?: boolean;
  /** シンタックスハイライトを使う（既定: オン） */
  syntax?: boolean;
  /** 3ウェイマージを始める（基準ファイルの選択から） */
  onThreeWay?: () => void;
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
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [replacement, setReplacement] = useState("");
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoValue, setGotoValue] = useState("");
  // 行番号ジャンプで移動した行（検索の一致と同じ見た目で示す）
  const [jump, setJump] = useState<{ side: Side; line: number } | null>(null);
  // 検索・置換の対象は、最後にフォーカス（またはクリック）したペイン
  const [activeSide, setActiveSide] = useState<Side>("left");
  const [notice, setNotice] = useState<string | null>(null);
  const applied = useRef({ mode: props.mode, options: props.options });
  const diffed = useRef({ left: props.leftText, right: props.rightText });
  const seq = useRef(0);
  const root = useRef<HTMLElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [win, setWin] = useState({ start: 0, end: 200 });
  const ticking = useRef(false);
  const editors = { left: useRef<EditorHandle>(null), right: useRef<EditorHandle>(null) };

  const blocks = useMemo(() => findBlocks(rows), [rows]);
  const blockAt = useMemo(() => new Map(blocks.map((b, i) => [b.start, i])), [blocks]);

  // 大きなファイル: スクロール位置から、描画する行の範囲を求める
  const virtual = rows.length > VIRTUAL_ROWS;
  const scroller = (): HTMLElement | null => root.current?.closest("main") ?? root.current?.parentElement ?? null;
  const tableTop = (el: HTMLElement) =>
    table.current ? table.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : 0;
  const updateWindow = useCallback(() => {
    const el = scroller();
    if (!el || !table.current) return;
    const first = Math.max(0, Math.floor((el.scrollTop - tableTop(el)) / LINE_HEIGHT));
    const start = Math.max(0, first - OVERSCAN);
    const end = Math.min(rows.length, first + Math.ceil((el.clientHeight || 800) / LINE_HEIGHT) + OVERSCAN);
    setWin((w) => (w.start === start && w.end === end ? w : { start, end }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);
  const scrollToRow = (index: number) => {
    const el = scroller();
    if (el) el.scrollTop = Math.max(0, tableTop(el) + index * LINE_HEIGHT - (el.clientHeight || 800) / 2);
  };

  // シンタックスハイライト用の行とトークン（\r は除く。巨大なファイルでは行わない）
  const stripCr = (l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l);
  const leftLines = useMemo(() => leftText.split("\n").map(stripCr), [leftText]);
  const rightLines = useMemo(() => rightText.split("\n").map(stripCr), [rightText]);
  const language = props.syntax === false ? null : languageFor(props.languagePath ?? props.leftPath ?? props.rightPath);
  const leftTokens = useMemo(() => (language && leftLines.length <= SYNTAX_MAX_LINES ? tokenizeLines(leftLines, language) : undefined), [language, leftLines]);
  const rightTokens = useMemo(() => (language && rightLines.length <= SYNTAX_MAX_LINES ? tokenizeLines(rightLines, language) : undefined), [language, rightLines]);
  /** 差分の行と本文が一致する（再比較の前で古くなっていない）ときだけ、トークンを使う */
  const tokensFor = (side: Side, cell: Cell | null): Token[] | undefined => {
    if (!cell) return undefined;
    const toks = (side === "left" ? leftTokens : rightTokens)?.[cell.line_no - 1];
    const text = (side === "left" ? leftLines : rightLines)[cell.line_no - 1];
    return toks && text === cell.segments.map((s) => s.text).join("") ? toks : undefined;
  };
  const showWs = props.showWhitespace === true;

  // 検索（⌘F）: フォーカスのあるペインのテキストから一致箇所を列挙し、現在の一致を表示位置まで移動する
  const activeText = activeSide === "left" ? leftText : rightText;
  const matches = useMemo(() => (findOpen ? findMatches(activeText, query) : []), [findOpen, activeText, query]);
  const active: Match | null = matches.length > 0 ? matches[Math.min(findIndex, matches.length - 1)] : null;
  const isHit = (side: Side, line: number | undefined) =>
    (active !== null && side === activeSide && active.line === line) || (jump !== null && jump.side === side && jump.line === line);
  const hitIn = (side: Side) => {
    if (active && side === activeSide) return { line: active.line, start: active.start, length: active.length };
    return jump && jump.side === side ? { line: jump.line, start: 0, length: (side === "left" ? leftLines : rightLines)[jump.line - 1]?.length ?? 0 } : undefined;
  };

  useEffect(() => {
    const el = scroller();
    if (!virtual || !el) return;
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      const apply = () => {
        ticking.current = false;
        updateWindow();
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
      else apply();
    };
    updateWindow();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtual, updateWindow, editing]);

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
      if (virtual) scrollToRow(blocks[index].start);
      else root.current?.querySelector(`[data-block="${index}"]`)?.scrollIntoView?.({ block: "center" });
    }
  };
  const step = (delta: 1 | -1) => {
    if (blocks.length > 0) goto((cursor + delta + blocks.length) % blocks.length);
  };

  const stepFind = (delta: 1 | -1) => {
    if (matches.length > 0) setFindIndex((i) => (Math.min(i, matches.length - 1) + delta + matches.length) % matches.length);
  };

  // 現在の一致が変わったら、その位置までスクロールする
  /** 指定したペインの行(1始まり)が見える位置まで移動する */
  const reveal = (side: Side, line: number) => {
    if (editing) editors[side].current?.scrollToLine(Math.max(1, line - 2));
    else if (virtual) scrollToRow(Math.max(0, rows.findIndex((r) => r[side]?.line_no === line)));
    else root.current?.querySelector(`[data-${side}-line="${line}"]`)?.scrollIntoView?.({ block: "center" });
  };
  useEffect(() => {
    if (active) reveal(activeSide, active.line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSide, active?.line, active?.start, editing]);

  // 行番号ジャンプ（⌘G）: フォーカスのあるペインの、指定した行へ移動する
  const gotoLine = () => {
    const total = (activeSide === "left" ? leftLines : rightLines).length;
    const n = Number.parseInt(gotoValue, 10);
    if (Number.isNaN(n)) return;
    const line = Math.min(Math.max(n, 1), total);
    setJump({ side: activeSide, line });
    reveal(activeSide, line);
  };

  // 置換は編集モードのときだけ。insertText 経由で反映するので、⌘Z で元に戻せる
  const replaceCurrent = () => {
    if (!editing || !active) return;
    editors[activeSide].current?.replaceText(replaceMatch(activeText, active, replacement));
  };
  const replaceEvery = () => {
    if (!editing || matches.length === 0) return;
    editors[activeSide].current?.replaceText(replaceAll(activeText, query, replacement));
  };

  const exportReport = async () => {
    if (props.leftPath === null || props.rightPath === null) return;
    try {
      const html = buildTextReport(props.leftPath, props.rightPath, rows, nowLabel());
      if (await saveReport(html, `${baseName(props.leftPath)}.html`)) {
        setNotice("レポートを保存しました");
        setTimeout(() => setNotice(null), 4000);
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const exportPatch = async () => {
    if (props.leftPath === null || props.rightPath === null) return;
    try {
      const patch = await makePatch(leftText, rightText, props.leftPath, props.rightPath);
      if (patch === "") {
        setNotice("差分がないため、パッチは作成しませんでした");
      } else {
        const path = await pickPatchPath(`${baseName(props.leftPath)}.patch`);
        if (!path) return;
        await writePatch(path, patch);
        setNotice("パッチを保存しました");
      }
      setError(null);
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      setError(String(e));
    }
  };

  // F7 / Shift+F7 で次/前の差分へ、⌘F / Ctrl+F で検索、Esc で検索を閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && !single) {
        e.preventDefault();
        setFindOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g" && !single) {
        e.preventDefault();
        setGotoOpen(true);
      } else if (e.key === "Escape" && (findOpen || gotoOpen)) {
        setFindOpen(false);
        setGotoOpen(false);
        setJump(null);
      }
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
  const locked = props.readOnly === true; // 編集・保存・マージはできない
  const diffCount = rows.filter((r) => r.kind !== "equal").length;
  const inCurrent = (i: number) => cursor >= 0 && blocks[cursor] && i >= blocks[cursor].start && i < blocks[cursor].end;

  return (
    <section className="text-compare" ref={root}>
      <ToolbarPortal>
        {!single && (
          <>
            {!locked && <button onClick={() => setEditing((v) => !v)}>{editing ? "表示に戻る" : "編集"}</button>}
            <button aria-label="前の差分" title="前の差分 (Shift+F7)" disabled={blocks.length === 0} onClick={() => step(-1)}>
              ▲
            </button>
            <button aria-label="次の差分" title="次の差分 (F7)" disabled={blocks.length === 0} onClick={() => step(1)}>
              ▼
            </button>
            <span className="summary">
              差分 {diffCount} 行{blocks.length > 0 && cursor >= 0 ? `（${cursor + 1} / ${blocks.length} 箇所）` : ""}
            </span>
            <button onClick={() => void exportPatch()}>パッチを保存…</button>
            <button onClick={() => void exportReport()}>レポートを保存…</button>
            {props.onThreeWay && <button onClick={props.onThreeWay}>3ウェイ…</button>}
            <button title="行番号を指定して移動 (⌘G / Ctrl+G)" onClick={() => setGotoOpen(true)}>
              行へ移動
            </button>
            {gotoOpen && (
              <span className="find">
                <input
                  autoFocus
                  type="number"
                  min={1}
                  aria-label="行番号"
                  placeholder="行番号"
                  value={gotoValue}
                  onChange={(e) => setGotoValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") gotoLine();
                  }}
                />
                <button onClick={gotoLine}>移動</button>
                <span className="summary">
                  対象: {activeSide === "left" ? "左" : "右"}ペイン（1〜{(activeSide === "left" ? leftLines : rightLines).length} 行）
                </span>
                <button
                  aria-label="行移動を閉じる"
                  onClick={() => {
                    setGotoOpen(false);
                    setJump(null);
                  }}
                >
                  ✕
                </button>
              </span>
            )}
            {notice && <span className="summary">{notice}</span>}
            {findOpen && (
              <span className="find">
                <input
                  autoFocus
                  type="search"
                  aria-label="検索"
                  placeholder="検索"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setFindIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") stepFind(e.shiftKey ? -1 : 1);
                  }}
                />
                <button aria-label="前の一致" disabled={matches.length === 0} onClick={() => stepFind(-1)}>
                  ◀
                </button>
                <button aria-label="次の一致" disabled={matches.length === 0} onClick={() => stepFind(1)}>
                  ▶
                </button>
                <span className="summary">
                  {active ? `${Math.min(findIndex, matches.length - 1) + 1} / ${matches.length}` : query !== "" ? "見つかりません" : ""}
                </span>
                <button aria-label="検索を閉じる" onClick={() => setFindOpen(false)}>
                  ✕
                </button>
                <span className="summary">対象: {activeSide === "left" ? "左" : "右"}ペイン</span>
                {editing && (
                  <>
                    <input
                      type="text"
                      aria-label="置換後"
                      placeholder="置換後"
                      value={replacement}
                      onChange={(e) => setReplacement(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") replaceCurrent();
                      }}
                    />
                    <button disabled={!active} onClick={replaceCurrent}>
                      置換
                    </button>
                    <button disabled={matches.length === 0} onClick={replaceEvery}>
                      すべて置換
                    </button>
                  </>
                )}
              </span>
            )}
          </>
        )}
        {error && <span role="alert" className="error">{error}</span>}
      </ToolbarPortal>
      {!single && (
        <OverviewPortal>
          <Overview rows={rows} blocks={blocks} cursor={cursor} onJump={goto} />
        </OverviewPortal>
      )}
      {!single && !locked && (
      <div className="pane-actions">
        {(["left", "right"] as const).map((side) => (
          <PaneAction key={side} side={side} dirty={isDirty(side)} onSave={() => void save(side)} />
        ))}
      </div>
      )}
      {/* 編集→表示→編集でも元に戻す履歴を保つため、テキストエリアは常に保持し表示だけ切り替える */}
      <div className={editing && !single ? "edit-panes" : "edit-panes offscreen"} aria-hidden={!editing || single}>
        <NumberedTextarea ref={editors.left} label="左のテキスト" value={leftText} onChange={setLeftText} onSave={saveShortcut("left")} onScrollLine={syncFrom("left")} highlights={highlightsFor(rows, "left")} findHit={hitIn("left")} tokens={leftTokens} showWs={showWs} onFocusPane={() => setActiveSide("left")} active={findOpen && editing && activeSide === "left"} />
        <div className="mid" />
        <NumberedTextarea ref={editors.right} label="右のテキスト" value={rightText} onChange={setRightText} onSave={saveShortcut("right")} onScrollLine={syncFrom("right")} highlights={highlightsFor(rows, "right")} findHit={hitIn("right")} tokens={rightTokens} showWs={showWs} onFocusPane={() => setActiveSide("right")} active={findOpen && editing && activeSide === "right"} />
      </div>
      {(!editing || single) && (
        <table className={virtual ? "diff-table virtual" : "diff-table"} ref={table}>
          <tbody>
            {virtual && win.start > 0 && (
              <tr aria-hidden="true" style={{ height: win.start * LINE_HEIGHT }}>
                <td colSpan={5} />
              </tr>
            )}
            {(virtual ? rows.slice(win.start, win.end) : rows).map((row, k) => {
              const i = virtual ? win.start + k : k;
              const b = blockAt.get(i);
              return (
                <tr key={i} className={`row-${row.kind}${row.moved ? " row-moved" : ""}${inCurrent(i) ? " row-current" : ""}`} title={row.moved ? "別の場所から移動した行" : undefined} data-block={b}>
                  <td className="ln">{row.left?.line_no}</td>
                  <td className={`code left${isHit("left", row.left?.line_no) ? " find-hit-cell" : ""}`} data-left-line={row.left?.line_no} onMouseDown={() => setActiveSide("left")}>
                    <CellText cell={row.left} tokens={tokensFor("left", row.left)} showWs={showWs} />
                  </td>
                  <td className="mid merge">
                    {b !== undefined && !locked && (
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
                  <td className={`code right${isHit("right", row.right?.line_no) ? " find-hit-cell" : ""}`} data-right-line={row.right?.line_no} onMouseDown={() => setActiveSide("right")}>
                    <CellText cell={row.right} tokens={tokensFor("right", row.right)} showWs={showWs} />
                  </td>
                </tr>
              );
            })}
            {virtual && win.end < rows.length && (
              <tr aria-hidden="true" style={{ height: (rows.length - win.end) * LINE_HEIGHT }}>
                <td colSpan={5} />
              </tr>
            )}
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
