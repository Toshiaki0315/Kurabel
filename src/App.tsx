import { useCallback, useEffect, useRef, useState } from "react";
import { comparePaths, confirmDiscard, pathKind, pickPath } from "./api";
import { BinaryCompare } from "./components/BinaryCompare";
import { DirCompare } from "./components/DirCompare";
import { PathPicker } from "./components/PathPicker";
import { ToolbarSlotContext } from "./components/ToolbarSlot";
import { TextCompare } from "./components/TextCompare";
import { assignDropped, type Slots } from "./lib/drop";
import { joinPath } from "./lib/path";
import { addRecent, baseName, loadRecent } from "./lib/recent";
import { useCloseGuard } from "./lib/useCloseGuard";
import { useDragDrop } from "./lib/useDragDrop";
import { SettingsDialog } from "./components/SettingsDialog";
import { loadSettings, saveSettings } from "./lib/settings";
import { useTauriEvent } from "./lib/useTauriEvent";
import type { Comparison, DiffMode, DiffOptions, TextEncoding } from "./types";

interface Child {
  rel: string;
  left: string;
  right: string;
  result: Comparison;
}

const encodingLabel = (e: TextEncoding) => (e.bom ? `${e.name} (BOM)` : e.name);

/** 各ペインのヘッダーに、テキストなら文字コードと改行コード、バイナリならファイルサイズを出す。 */
function sizeInfo(result: Comparison | null, child: Child | null, side: "left" | "right"): string | undefined {
  const shown = child?.result ?? result;
  if (shown?.kind === "text") {
    const left = side === "left";
    return `${encodingLabel(left ? shown.left_encoding : shown.right_encoding)} / ${left ? shown.left_eol : shown.right_eol}`;
  }
  if (shown?.kind !== "binary") return undefined;
  return `${side === "left" ? shown.left_size : shown.right_size} バイト`;
}

interface ResultProps {
  result: Comparison;
  mode: DiffMode;
  options: DiffOptions;
  leftPath: string | null;
  rightPath: string | null;
  onOpen?: (rel: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function Result(props: ResultProps) {
  const { result } = props;
  switch (result.kind) {
    case "text":
      return <TextCompare leftText={result.left_text} rightText={result.right_text} rows={result.rows} mode={props.mode} options={props.options} onDirtyChange={props.onDirtyChange} leftPath={props.leftPath} rightPath={props.rightPath} leftEncoding={result.left_encoding} rightEncoding={result.right_encoding} />;
    case "binary":
      return <BinaryCompare rows={result.rows} />;
    case "directory":
      return <DirCompare entries={result.entries} onOpen={props.onOpen ?? (() => {})} single={props.leftPath === null || props.rightPath === null} />;
  }
}

export default function App() {
  const [slots, setSlots] = useState<Slots>({ left: null, right: null });
  const { left, right } = slots;
  const [choosing, setChoosing] = useState<"left" | "right" | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { mode, options } = settings;
  const [result, setResult] = useState<Comparison | null>(null);
  const [runId, setRunId] = useState(0); // 比較のたびに増やし、編集中の状態を必ず作り直す
  const [child, setChild] = useState<Child | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  useEffect(() => saveSettings(settings), [settings]);
  // メニューバーの「設定…」(Rust 側から emit)
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  useTauriEvent("open-settings", openSettings);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 未保存の変更を持つ編集中の比較があるときは、破棄してよいか確認する
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const confirmLeave = useCallback(async () => !dirtyRef.current || (await confirmDiscard()), []);
  useCloseGuard(confirmLeave);

  useEffect(() => {
    setChild(null);
    setResult(null);
    setError(null);
    if (!left && !right) return;
    let stale = false;
    comparePaths(left, right, modeRef.current, optionsRef.current).then(
      (r) => {
        if (stale) return;
        setResult(r);
        setRunId((n) => n + 1);
        if (left && right) setRecent((list) => addRecent(list, { left, right }));
      },
      (e) => !stale && setError(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [left, right]);

  const onDrop = useCallback(
    async (paths: string[], side: "left" | "right") => {
      if (!(await confirmLeave())) return;
      setChoosing(null);
      setSlots((cur) => assignDropped(paths, cur, side));
    },
    [confirmLeave],
  );
  useDragDrop(onDrop);

  const choose = (side: "left" | "right") => async (directory: boolean) => {
    setChoosing(null);
    const path = await pickPath(directory);
    if (path) setSlots((cur) => ({ ...cur, [side]: path }));
  };

  // 相手側が選択済みなら同じ種別のダイアログを開く。未選択ならファイル/フォルダを尋ねる。
  const pick = (side: "left" | "right") => async () => {
    if (!(await confirmLeave())) return;
    const other = side === "left" ? right : left;
    if (!other) {
      setChoosing(side);
      return;
    }
    try {
      await choose(side)((await pathKind(other)) === "directory");
    } catch (e) {
      setError(String(e));
    }
  };

  const close = (side: "left" | "right") => async () => {
    if (!(await confirmLeave())) return;
    setChoosing(null);
    setSlots((cur) => ({ ...cur, [side]: null }));
  };

  const openChild = async (rel: string) => {
    if (!left || !right) return;
    const l = joinPath(left, rel);
    const r = joinPath(right, rel);
    try {
      setChild({ rel, left: l, right: r, result: await comparePaths(l, r, mode, options) });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const openRecent = async (index: number) => {
    const pair = recent[index];
    if (pair && (await confirmLeave())) setSlots(pair);
  };
  const back = async () => {
    if (await confirmLeave()) setChild(null);
  };

  return (
    <div className="app">
      <header className="toolbar">
        <button aria-label="設定" title="設定 (⌘,)" onClick={openSettings}>
          ⚙ 設定
        </button>
        <select aria-label="履歴" value="" onChange={(e) => void openRecent(Number(e.target.value))}>
          <option value="" disabled>
            履歴
          </option>
          {recent.map((p, i) => (
            <option key={`${p.left}\n${p.right}`} value={i} title={`${p.left} ⇄ ${p.right}`}>
              {baseName(p.left)} ⇄ {baseName(p.right)}
            </option>
          ))}
        </select>
        <div className="toolbar-slot" ref={setSlot} />
      </header>
      <div className="pane-headers">
        <PathPicker side="left" value={left} info={left ? sizeInfo(result ?? null, child, "left") : undefined} choosing={choosing === "left"} onPick={pick("left")} onChoose={choose("left")} onClose={close("left")} />
        <div className="mid" />
        <PathPicker side="right" value={right} info={right ? sizeInfo(result ?? null, child, "right") : undefined} choosing={choosing === "right"} onPick={pick("right")} onChoose={choose("right")} onClose={close("right")} />
      </div>
      {error && <div role="alert" className="error">{error}</div>}
      <ToolbarSlotContext.Provider value={slot}>
      <main>
        {child ? (
          <>
            <div className="bar">
              <button onClick={() => void back()}>← ディレクトリ比較に戻る</button>
              <span>{child.rel}</span>
            </div>
            <Result key={child.rel} result={child.result} mode={mode} options={options} onDirtyChange={setDirty} leftPath={child.left} rightPath={child.right} />
          </>
        ) : result ? (
          <Result key={runId} result={result} mode={mode} options={options} onDirtyChange={setDirty} leftPath={left} rightPath={right} onOpen={openChild} />
        ) : (
          <p className="empty">比較する2つのファイルまたはフォルダを選択、またはウィンドウへドロップしてください。</p>
        )}
      </main>
      </ToolbarSlotContext.Provider>
      {settingsOpen && <SettingsDialog settings={settings} onChange={setSettings} onClose={closeSettings} />}
    </div>
  );
}
