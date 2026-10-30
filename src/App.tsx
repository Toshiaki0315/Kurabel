import { useCallback, useEffect, useRef, useState } from "react";
import { comparePaths, pathKind, pickPath } from "./api";
import { BinaryCompare } from "./components/BinaryCompare";
import { DirCompare } from "./components/DirCompare";
import { PathPicker } from "./components/PathPicker";
import { ToolbarSlotContext } from "./components/ToolbarSlot";
import { TextCompare } from "./components/TextCompare";
import { assignDropped, type Slots } from "./lib/drop";
import { joinPath } from "./lib/path";
import { useDragDrop } from "./lib/useDragDrop";
import type { Comparison, DiffMode } from "./types";

interface Child {
  rel: string;
  left: string;
  right: string;
  result: Comparison;
}

/** バイナリ比較時のみ、各ペインのヘッダーにファイルサイズを出す。 */
function sizeInfo(result: Comparison | null, child: Child | null, side: "left" | "right"): string | undefined {
  const shown = child?.result ?? result;
  if (shown?.kind !== "binary") return undefined;
  return `${side === "left" ? shown.left_size : shown.right_size} バイト`;
}

function Result(props: { result: Comparison; mode: DiffMode; leftPath: string; rightPath: string; onOpen?: (rel: string) => void }) {
  const { result } = props;
  switch (result.kind) {
    case "text":
      return <TextCompare leftText={result.left_text} rightText={result.right_text} rows={result.rows} mode={props.mode} leftPath={props.leftPath} rightPath={props.rightPath} />;
    case "binary":
      return <BinaryCompare rows={result.rows} />;
    case "directory":
      return <DirCompare entries={result.entries} onOpen={props.onOpen ?? (() => {})} />;
  }
}

export default function App() {
  const [slots, setSlots] = useState<Slots>({ left: null, right: null });
  const { left, right } = slots;
  const [choosing, setChoosing] = useState<"left" | "right" | null>(null);
  const [mode, setMode] = useState<DiffMode>("line");
  const [result, setResult] = useState<Comparison | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    setChild(null);
    setResult(null);
    setError(null);
    if (!left || !right) return;
    let stale = false;
    comparePaths(left, right, modeRef.current).then(
      (r) => !stale && setResult(r),
      (e) => !stale && setError(String(e)),
    );
    return () => {
      stale = true;
    };
  }, [left, right]);

  const onDrop = useCallback((paths: string[], side: "left" | "right") => {
    setSlots((cur) => assignDropped(paths, cur, side));
  }, []);
  useDragDrop(onDrop);

  const choose = (side: "left" | "right") => async (directory: boolean) => {
    setChoosing(null);
    const path = await pickPath(directory);
    if (path) setSlots((cur) => ({ ...cur, [side]: path }));
  };

  // 相手側が選択済みなら同じ種別のダイアログを開く。未選択ならファイル/フォルダを尋ねる。
  const pick = (side: "left" | "right") => async () => {
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

  const openChild = async (rel: string) => {
    if (!left || !right) return;
    const l = joinPath(left, rel);
    const r = joinPath(right, rel);
    try {
      setChild({ rel, left: l, right: r, result: await comparePaths(l, r, mode) });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="app">
      <header className="toolbar">
        <label className="mode">
          ハイライト
          <select value={mode} onChange={(e) => setMode(e.target.value as DiffMode)}>
            <option value="line">行単位</option>
            <option value="word">単語単位</option>
          </select>
        </label>
        <div className="toolbar-slot" ref={setSlot} />
      </header>
      <div className="pane-headers">
        <PathPicker side="left" value={left} info={sizeInfo(result ?? null, child, "left")} choosing={choosing === "left"} onPick={pick("left")} onChoose={choose("left")} />
        <PathPicker side="right" value={right} info={sizeInfo(result ?? null, child, "right")} choosing={choosing === "right"} onPick={pick("right")} onChoose={choose("right")} />
      </div>
      {error && <div role="alert" className="error">{error}</div>}
      <ToolbarSlotContext.Provider value={slot}>
      <main>
        {child ? (
          <>
            <div className="bar">
              <button onClick={() => setChild(null)}>← ディレクトリ比較に戻る</button>
              <span>{child.rel}</span>
            </div>
            <Result key={child.rel} result={child.result} mode={mode} leftPath={child.left} rightPath={child.right} />
          </>
        ) : result ? (
          <Result result={result} mode={mode} leftPath={left ?? ""} rightPath={right ?? ""} onOpen={openChild} />
        ) : (
          <p className="empty">比較する2つのファイルまたはフォルダを選択、またはウィンドウへドロップしてください。</p>
        )}
      </main>
      </ToolbarSlotContext.Provider>
    </div>
  );
}
