import { useCallback, useEffect, useRef, useState } from "react";
import { comparePaths, pickPath } from "./api";
import { BinaryCompare } from "./components/BinaryCompare";
import { DirCompare } from "./components/DirCompare";
import { PathPicker } from "./components/PathPicker";
import { TextCompare } from "./components/TextCompare";
import { assignDropped } from "./lib/drop";
import { joinPath } from "./lib/path";
import { useDragDrop } from "./lib/useDragDrop";
import type { Comparison, DiffMode } from "./types";

interface Child {
  rel: string;
  left: string;
  right: string;
  result: Comparison;
}

function Result(props: { result: Comparison; mode: DiffMode; onOpen?: (rel: string) => void }) {
  const { result } = props;
  switch (result.kind) {
    case "text":
      return <TextCompare leftText={result.left_text} rightText={result.right_text} rows={result.rows} mode={props.mode} />;
    case "binary":
      return <BinaryCompare rows={result.rows} leftSize={result.left_size} rightSize={result.right_size} />;
    case "directory":
      return <DirCompare entries={result.entries} onOpen={props.onOpen ?? (() => {})} />;
  }
}

export default function App() {
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [mode, setMode] = useState<DiffMode>("line");
  const [result, setResult] = useState<Comparison | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setLeft((l) => assignDropped(paths, { left: l, right: null }, side).left);
    setRight((r) => assignDropped(paths, { left: null, right: r }, side).right);
  }, []);
  useDragDrop(onDrop);

  const pick = (side: "left" | "right") => async (directory: boolean) => {
    const path = await pickPath(directory);
    if (path) (side === "left" ? setLeft : setRight)(path);
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
        <PathPicker label="左" value={left} onPick={pick("left")} />
        <PathPicker label="右" value={right} onPick={pick("right")} />
        <label className="mode">
          ハイライト
          <select value={mode} onChange={(e) => setMode(e.target.value as DiffMode)}>
            <option value="line">行単位</option>
            <option value="word">単語単位</option>
          </select>
        </label>
      </header>
      {error && <div role="alert" className="error">{error}</div>}
      <main>
        {child ? (
          <>
            <div className="bar">
              <button onClick={() => setChild(null)}>← ディレクトリ比較に戻る</button>
              <span>{child.rel}</span>
            </div>
            <Result key={child.rel} result={child.result} mode={mode} />
          </>
        ) : result ? (
          <Result result={result} mode={mode} onOpen={openChild} />
        ) : (
          <p className="empty">比較する2つのファイルまたはフォルダを選択、またはウィンドウへドロップしてください。</p>
        )}
      </main>
    </div>
  );
}
