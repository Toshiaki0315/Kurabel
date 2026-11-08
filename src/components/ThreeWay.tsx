import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeEol, withEol } from "../lib/eol";
import { confirmAction, createText, pickSavePath, saveText } from "../api";
import { buildResult, conflictIndexes, RESOLUTIONS, unresolvedCount, type Resolution, type Resolutions } from "../lib/merge3";
import { baseName } from "../lib/recent";
import type { Merge3, MergeChunk } from "../types";
import { NumberedTextarea } from "./NumberedTextarea";
import { ToolbarPortal } from "./ToolbarSlot";

interface Props {
  data: Merge3;
  basePath: string;
  leftPath: string;
  rightPath: string;
  /** 結果に未保存の変更があるか（アンマウント時は false） */
  onDirtyChange?: (dirty: boolean) => void;
  onClose: () => void;
}

const COLLAPSE_OVER = 8;
const CONTEXT = 3;

/** 共通部分が長いときは、前後だけを残して間を省略する。 */
function shown(lines: string[], collapse: boolean): string[] {
  if (!collapse || lines.length <= COLLAPSE_OVER) return lines;
  return [...lines.slice(0, CONTEXT), `⋯ ${lines.length - CONTEXT * 2} 行は共通 ⋯`, ...lines.slice(-CONTEXT)];
}

function Column({ lines, className }: { lines: string[]; className: string }) {
  return <pre className={`tw-col ${className}`}>{lines.length > 0 ? lines.join("\n") : <span className="dim">（行なし）</span>}</pre>;
}

/** 各断片を左・基準・右の3列で表示するための、列ごとの行と見た目。 */
function columns(c: MergeChunk): { left: string[]; base: string[]; right: string[]; cls: [string, string, string] } {
  switch (c.kind) {
    case "stable":
      return { left: c.lines, base: c.lines, right: c.lines, cls: ["", "", ""] };
    case "left":
      return { left: c.left, base: c.base, right: c.base, cls: ["tw-mod", "", ""] };
    case "right":
      return { left: c.base, base: c.base, right: c.right, cls: ["", "", "tw-mod"] };
    case "same":
      return { left: c.lines, base: c.base, right: c.lines, cls: ["tw-mod", "", "tw-mod"] };
    case "conflict":
      return { left: c.left, base: c.base, right: c.right, cls: ["tw-conflict", "tw-conflict", "tw-conflict"] };
  }
}

export function ThreeWay({ data, basePath, leftPath, rightPath, onDirtyChange, onClose }: Props) {
  const { chunks } = data;
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [manual, setManual] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);

  const conflicts = useMemo(() => conflictIndexes(chunks), [chunks]);
  const unresolved = unresolvedCount(chunks, resolutions);
  const auto = useMemo(() => buildResult(chunks, resolutions, data.eol, data.trailing_newline), [chunks, resolutions, data]);
  // textarea は改行を LF に正規化するので、表示は LF、保存時に元の改行へ戻す
  const result = normalizeEol(manual ?? auto);

  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  useEffect(
    () => () => onDirtyChange?.(false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const resolve = (chunkIndex: number, resolution: Resolution) => {
    setResolutions((cur) => ({ ...cur, [chunkIndex]: resolution }));
    setDirty(true);
  };

  const goto = (n: number) => {
    setCursor(n);
    root.current?.querySelector(`[data-chunk="${conflicts[n]}"]`)?.scrollIntoView?.({ block: "center" });
  };
  const step = (delta: 1 | -1) => {
    if (conflicts.length > 0) goto((cursor + delta + conflicts.length) % conflicts.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F7") return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const saved = (message: string) => {
    setDirty(false);
    setError(null);
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };
  const confirmUnresolved = async () =>
    unresolved === 0 ||
    confirmAction(`未解決の競合が ${unresolved} 件あります。競合マーカーを含めたまま保存しますか？`, "保存");

  const saveTo = (side: "left" | "right") => async () => {
    const path = side === "left" ? leftPath : rightPath;
    const encoding = side === "left" ? data.left_encoding : data.right_encoding;
    if (!(await confirmUnresolved())) return;
    if (!(await confirmAction(`「${path}」を、マージ結果で上書きします。`, "上書き"))) return;
    try {
      await saveText(path, withEol(result, data.eol), encoding);
      saved(`${side === "left" ? "左" : "右"}のファイルに保存しました`);
    } catch (e) {
      setError(String(e));
    }
  };
  const saveAs = async () => {
    try {
      const path = await pickSavePath(baseName(leftPath));
      if (!path || !(await confirmUnresolved())) return;
      await createText(path, withEol(result, data.eol), data.left_encoding);
      saved(`保存しました: ${path}`);
    } catch (e) {
      setError(String(e));
    }
  };

  let conflictNo = 0;
  return (
    <section className="three-way" ref={root}>
      <ToolbarPortal>
        <button onClick={onClose}>← 2ウェイ比較に戻る</button>
        <span className="summary">{unresolved === 0 ? "競合はすべて解決済み" : `未解決の競合 ${unresolved} 件（全 ${conflicts.length} 件）`}</span>
        <button aria-label="前の競合" title="前の競合 (Shift+F7)" disabled={conflicts.length === 0} onClick={() => step(-1)}>
          ▲
        </button>
        <button aria-label="次の競合" title="次の競合 (F7)" disabled={conflicts.length === 0} onClick={() => step(1)}>
          ▼
        </button>
        {manual !== null && <button onClick={() => setManual(null)}>自動結果に戻す</button>}
        <button onClick={() => void saveTo("left")()}>左へ保存</button>
        <button onClick={() => void saveTo("right")()}>右へ保存</button>
        <button onClick={() => void saveAs()}>名前を付けて保存…</button>
        {notice && <span className="summary">{notice}</span>}
        {error && <span role="alert" className="error">{error}</span>}
      </ToolbarPortal>
      <div className="tw-headers">
        {[["左", leftPath], ["基準", basePath], ["右", rightPath]].map(([label, path]) => (
          <div key={label} title={path}>
            <strong>{label}</strong> {baseName(path)}
          </div>
        ))}
      </div>
      <div className="tw-chunks">
        {chunks.map((chunk, i) => {
          const col = columns(chunk);
          const collapse = chunk.kind === "stable";
          const isConflict = chunk.kind === "conflict";
          const n = isConflict ? ++conflictNo : 0;
          return (
            <div key={i} className={`tw-chunk${isConflict && cursor >= 0 && conflicts[cursor] === i ? " current" : ""}`} data-chunk={i}>
              {isConflict && (
                <div className="tw-resolve">
                  <strong>競合 {n}</strong>
                  {RESOLUTIONS.map((r) => (
                    <button
                      key={r.value}
                      aria-label={`競合${n}: ${r.label}`}
                      aria-pressed={resolutions[i] === r.value}
                      className={resolutions[i] === r.value ? "on" : undefined}
                      disabled={manual !== null}
                      onClick={() => resolve(i, r.value)}
                    >
                      {r.label}
                    </button>
                  ))}
                  {resolutions[i] === undefined && <span className="dirty">未解決</span>}
                </div>
              )}
              <div className="tw-row">
                <Column lines={shown(col.left, collapse)} className={col.cls[0]} />
                <Column lines={shown(col.base, collapse)} className={col.cls[1]} />
                <Column lines={shown(col.right, collapse)} className={col.cls[2]} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="tw-result">
        <div className="tw-result-bar">
          <strong>結果</strong>
          <span className="summary">
            {manual !== null ? "手動で編集中（競合の選択ボタンは無効です）" : "競合を選ぶと更新されます。直接編集することもできます"}
          </span>
        </div>
        <NumberedTextarea
          label="マージ結果"
          value={result}
          onChange={(v) => {
            setManual(v);
            setDirty(true);
          }}
        />
      </div>
    </section>
  );
}
