import { useCallback, useEffect, useRef, useState } from "react";
import { comparePaths, confirmAction, confirmDiscard, copyEntry, deleteEntry, initialPaths, merge3Files, pathKind, pickPath } from "./api";
import { BinaryCompare } from "./components/BinaryCompare";
import { DirCompare } from "./components/DirCompare";
import { PathPicker } from "./components/PathPicker";
import { OverviewSlotContext, ToolbarSlotContext } from "./components/ToolbarSlot";
import { TextCompare } from "./components/TextCompare";
import { assignDropped, type Slots } from "./lib/drop";
import { joinPath } from "./lib/path";
import { addRecent, baseName, loadRecent } from "./lib/recent";
import { useCloseGuard } from "./lib/useCloseGuard";
import { useDragDrop } from "./lib/useDragDrop";
import { ThreeWay } from "./components/ThreeWay";
import { SettingsDialog } from "./components/SettingsDialog";
import { loadSettings, saveSettings } from "./lib/settings";
import { useTauriEvent } from "./lib/useTauriEvent";
import { AUTO_ENCODING, type Comparison, type DiffMode, type DiffOptions, type EncodingChoice, type Merge3, type TextEncoding } from "./types";

interface Child {
  rel: string;
  left: string;
  right: string;
  result: Comparison;
}

const encodingLabel = (e: TextEncoding) => (e.bom ? `${e.name} (BOM)` : e.name);

/** 各ペインのヘッダーに、テキストなら改行コード、バイナリならファイルサイズを出す（文字コードは選択欄に出す）。 */
function sizeInfo(result: Comparison | null, child: Child | null, side: "left" | "right"): string | undefined {
  const shown = child?.result ?? result;
  if (shown?.kind === "text") return side === "left" ? shown.left_eol : shown.right_eol;
  if (shown?.kind !== "binary") return undefined;
  return `${side === "left" ? shown.left_size : shown.right_size} バイト`;
}

/** 自動判定された文字コード（トップレベルがテキストのときだけ）。 */
function detectedEncoding(result: Comparison | null, side: "left" | "right"): string | undefined {
  if (result?.kind !== "text") return undefined;
  return encodingLabel(side === "left" ? result.left_encoding : result.right_encoding);
}

interface ResultProps {
  result: Comparison;
  mode: DiffMode;
  options: DiffOptions;
  leftPath: string | null;
  rightPath: string | null;
  onOpen?: (rel: string) => void;
  onThreeWay?: () => void;
  onCopy?: (rel: string, from: "left" | "right", overwrite: boolean) => void;
  onDelete?: (rel: string, side: "left" | "right") => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function Result(props: ResultProps) {
  const { result } = props;
  switch (result.kind) {
    case "text":
      return <TextCompare leftText={result.left_text} rightText={result.right_text} rows={result.rows} mode={props.mode} options={props.options} onDirtyChange={props.onDirtyChange} leftPath={props.leftPath} rightPath={props.rightPath} leftEncoding={result.left_encoding} rightEncoding={result.right_encoding} onThreeWay={props.onThreeWay} />;
    case "binary":
      return <BinaryCompare rows={result.rows} />;
    case "directory":
      return <DirCompare entries={result.entries} onOpen={props.onOpen ?? (() => {})} onCopy={props.onCopy} onDelete={props.onDelete} single={props.leftPath === null || props.rightPath === null} />;
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
  const [overviewSlot, setOverviewSlot] = useState<HTMLElement | null>(null);
  const [encodings, setEncodings] = useState<EncodingChoice>(AUTO_ENCODING);
  const [threeWay, setThreeWay] = useState<{ data: Merge3; basePath: string } | null>(null);
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
  const resultRef = useRef<Comparison | null>(null);
  resultRef.current = result;

  // 未保存の変更を持つ編集中の比較があるときは、破棄してよいか確認する
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const confirmLeave = useCallback(async () => !dirtyRef.current || (await confirmDiscard()), []);
  useCloseGuard(confirmLeave);

  // コマンドライン引数で渡されたパスを、起動時に左右へ開く
  useEffect(() => {
    initialPaths().then(
      (paths) => paths.length > 0 && setSlots((cur) => assignDropped(paths, cur, "left")),
      () => {},
    );
  }, []);

  useEffect(() => {
    setChild(null);
    setResult(null);
    setError(null);
    setEncodings(AUTO_ENCODING);
    setThreeWay(null);
    if (!left && !right) return;
    let stale = false;
    comparePaths(left, right, modeRef.current, optionsRef.current, AUTO_ENCODING).then(
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

  /** ディスクの内容を読み直して比較結果だけ差し替える（フォルダの表示状態は保つ）。 */
  const refresh = async () => {
    if (!left && !right) return;
    try {
      setResult(await comparePaths(left, right, mode, options, encodings));
    } catch (e) {
      setError(String(e));
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // フォルダの比較設定（除外・サブフォルダ・比較方法）が変わったら、フォルダ比較をやり直す
  const dirKey = JSON.stringify([options.exclude, options.recursive, options.quick]);
  useEffect(() => {
    if (resultRef.current?.kind !== "directory") return;
    const timer = setTimeout(() => void refreshRef.current(), 300);
    return () => clearTimeout(timer);
  }, [dirKey]);

  const SIDE_NAME = { left: "左", right: "右" } as const;
  const copyTo = async (rel: string, from: "left" | "right", overwrite: boolean) => {
    if (!left || !right) return;
    const [src, dst] = from === "left" ? [left, right] : [right, left];
    const toName = SIDE_NAME[from === "left" ? "right" : "left"];
    if (overwrite && !(await confirmAction(`「${rel}」は${toName}側に既にあります。上書きしますか？`, "上書き"))) return;
    try {
      await copyEntry(src, dst, rel);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };
  const removeFrom = async (rel: string, side: "left" | "right") => {
    const root = side === "left" ? left : right;
    if (!root) return;
    if (!(await confirmAction(`「${rel}」を${SIDE_NAME[side]}側から完全に削除します。元に戻せません。`, "削除"))) return;
    try {
      await deleteEntry(root, rel);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  // 文字コードを手動で切り替えて、そのファイルだけ読み直す
  const changeEncoding = (side: "left" | "right") => async (value: string | null) => {
    if (!(await confirmLeave())) return;
    const next = { ...encodings, [side]: value };
    try {
      const r = await comparePaths(left, right, mode, options, next);
      setEncodings(next);
      setResult(r);
      setRunId((n) => n + 1);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };
  const encodingControl = (side: "left" | "right") => {
    const detected = child ? undefined : detectedEncoding(result, side);
    return detected === undefined ? undefined : { detected, value: encodings[side], onChange: changeEncoding(side) };
  };

  /** 基準ファイルを選んで、左・右との3ウェイマージを始める。 */
  const startThreeWay = async () => {
    if (!left || !right || !(await confirmLeave())) return;
    try {
      const basePath = await pickPath(false);
      if (!basePath) return;
      setThreeWay({ data: await merge3Files(basePath, left, right), basePath });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };
  const closeThreeWay = async () => {
    if (!(await confirmLeave())) return;
    await refresh(); // マージ結果の保存で左右のファイルが変わっていることがあるので、先に読み直す
    setRunId((n) => n + 1);
    setThreeWay(null);
  };

  const openChild = async (rel: string) => {
    if (!left || !right) return;
    const l = joinPath(left, rel);
    const r = joinPath(right, rel);
    try {
      setChild({ rel, left: l, right: r, result: await comparePaths(l, r, mode, options, AUTO_ENCODING) });
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
      {!threeWay && (
      <div className="pane-headers">
        <PathPicker side="left" value={left} info={left ? sizeInfo(result ?? null, child, "left") : undefined} encoding={left ? encodingControl("left") : undefined} choosing={choosing === "left"} onPick={pick("left")} onChoose={choose("left")} onClose={close("left")} />
        <div className="mid" />
        <PathPicker side="right" value={right} info={right ? sizeInfo(result ?? null, child, "right") : undefined} encoding={right ? encodingControl("right") : undefined} choosing={choosing === "right"} onPick={pick("right")} onChoose={choose("right")} onClose={close("right")} />
      </div>
      )}
      {error && <div role="alert" className="error">{error}</div>}
      <ToolbarSlotContext.Provider value={slot}>
      <OverviewSlotContext.Provider value={overviewSlot}>
      <div className="main-wrap">
      <main>
        {threeWay && left && right ? (
          <ThreeWay data={threeWay.data} basePath={threeWay.basePath} leftPath={left} rightPath={right} onDirtyChange={setDirty} onClose={() => void closeThreeWay()} />
        ) : child ? (
          <>
            <div className="bar">
              <button onClick={() => void back()}>← ディレクトリ比較に戻る</button>
              <span>{child.rel}</span>
            </div>
            <Result key={child.rel} result={child.result} mode={mode} options={options} onDirtyChange={setDirty} leftPath={child.left} rightPath={child.right} />
          </>
        ) : result ? (
          <Result key={runId} result={result} mode={mode} options={options} onDirtyChange={setDirty} leftPath={left} rightPath={right} onOpen={openChild} onThreeWay={() => void startThreeWay()} onCopy={copyTo} onDelete={removeFrom} />
        ) : (
          <p className="empty">比較する2つのファイルまたはフォルダを選択、またはウィンドウへドロップしてください。</p>
        )}
      </main>
      <div className="overview-slot" ref={setOverviewSlot} />
      </div>
      </OverviewSlotContext.Provider>
      </ToolbarSlotContext.Provider>
      {settingsOpen && <SettingsDialog settings={settings} onChange={setSettings} onClose={closeSettings} />}
    </div>
  );
}
