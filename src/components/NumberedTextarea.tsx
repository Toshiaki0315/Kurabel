import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import type { Token } from "../lib/syntax";
import type { RowKind, Segment } from "../types";
import { EolMarker, renderSegments } from "./Segments";

export const LINE_HEIGHT = 18;
/** これを超える行数では、画面に見える範囲の行だけを描画する（巨大なファイルで重くならないように） */
export const WINDOW_LINES = 2000;
const OVERSCAN = 30;

export interface LineHighlight {
  kind: RowKind;
  /** 別の場所から移動した行 */
  moved?: boolean;
  segments: Segment[];
}

export interface EditorHandle {
  /** 指定行(1始まり)が先頭に来る位置までスクロールする（onScrollLine は発火しない） */
  scrollToLine: (line: number) => void;
  /**
   * 本文を差し替える。ユーザー入力と同じ経路 (insertText) で反映するため、Cmd/Ctrl+Z で元に戻せる。
   * 変更範囲（先頭・末尾の共通部分を除いた部分）だけを置換するので、スクロール位置も保たれる。
   */
  replaceText: (next: string) => void;
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** このペインにフォーカスが移ったとき */
  onFocusPane?: () => void;
  /** 検索・置換の対象になっているペイン */
  active?: boolean;
  /** Cmd/Ctrl+S が押されたとき（このペインにカーソルがある） */
  onSave?: () => void;
  /** ユーザー操作でスクロールされたとき、先頭に見えている行(1始まり) */
  onScrollLine?: (line: number) => void;
  /** 行ごとのシンタックスのトークン。指定すると、本文の文字を透明にして、背後の色付きの文字を見せる */
  tokens?: Token[][];
  /** 空白・タブ・改行を記号で表示する */
  showWs?: boolean;
  /** 画面に出ていない（表示モード中など）。Tab でフォーカスが入らないようにする */
  hidden?: boolean;
  /** 検索中の一致箇所（行は1始まり、start は行内の文字位置） */
  findHit?: { line: number; start: number; length: number };
  /** 行番号(1始まり) → 差分ハイライト。本文と一致しない行（再比較前）は無視する。 */
  highlights?: Map<number, LineHighlight>;
}

/** 行番号ガターと差分ハイライト層つきテキストエリア（折り返しなしで行とずれないようにする）。 */
export const NumberedTextarea = forwardRef<EditorHandle, Props>(function NumberedTextarea(
  { label, value, onChange, onSave, onScrollLine, highlights, findHit, onFocusPane, active, tokens, showWs, hidden },
  ref,
) {
  const gutter = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const programmatic = useRef<number | null>(null);
  const lines = value.split("\n");
  const virtual = lines.length > WINDOW_LINES;
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const ticking = useRef(false);
  // スクロールのたびに再描画しないよう、フレームごとに1回だけ見える範囲を更新する
  const updateViewport = () => {
    if (!virtual || ticking.current) return;
    ticking.current = true;
    const apply = () => {
      ticking.current = false;
      const ta = area.current;
      if (ta) setViewport({ top: ta.scrollTop, height: ta.clientHeight || 800 });
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
    else apply();
  };
  const first = Math.floor(viewport.top / LINE_HEIGHT);
  const from = virtual ? Math.max(0, first - OVERSCAN) : 0;
  const to = virtual ? Math.min(lines.length, first + Math.ceil(viewport.height / LINE_HEIGHT) + OVERSCAN) : lines.length;
  /** 仮想化しているときは、全体の高さを確保した枠の中の正しい位置へ、見える行だけを置く */
  const windowed = (content: ReactNode) =>
    virtual ? (
      <div style={{ height: lines.length * LINE_HEIGHT, position: "relative" }}>
        <div style={{ position: "absolute", top: from * LINE_HEIGHT, left: 0, right: 0 }}>{content}</div>
      </div>
    ) : (
      content
    );

  useImperativeHandle(ref, () => ({
    replaceText(next) {
      const ta = area.current;
      if (!ta) return;
      const prev = ta.value;
      const max = Math.min(prev.length, next.length);
      let head = 0;
      while (head < max && prev[head] === next[head]) head++;
      let tail = 0;
      while (tail < max - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
      const inserted = next.slice(head, next.length - tail);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(head, prev.length - tail);
      if (typeof document.execCommand === "function") {
        if (inserted === "") document.execCommand("delete");
        else document.execCommand("insertText", false, inserted);
      }
      // execCommand が使えない環境では履歴は残らないが、内容は正しく反映する
      if (ta.value !== next) onChange(next);
    },
    scrollToLine(line) {
      const top = Math.max(0, (line - 1) * LINE_HEIGHT);
      if (area.current && area.current.scrollTop !== top) {
        programmatic.current = top;
        area.current.scrollTop = top;
      }
    },
  }));

  return (
    <div className={`numbered${active ? " active-pane" : ""}${tokens ? " syntax-on" : ""}`}>
      <div className="gutter" ref={gutter} aria-hidden="true">
        {windowed(
          lines.slice(from, to).map((_, k) => (
            <div key={from + k}>{from + k + 1}</div>
          )),
        )}
      </div>
      <div className="editor">
        {highlights && (
          <div className="hl-layer" ref={layer} aria-hidden="true">
            {windowed(
              lines.slice(from, to).map((raw, k) => {
                const i = from + k;
                const text = raw.replace(/\r$/, ""); // CRLF の \r は本文に含めない（差分の行と照合できるように）
                const h = highlights.get(i + 1);
                const fresh = h && h.segments.map((s) => s.text).join("") === text;
                const hit = findHit && findHit.line === i + 1 ? findHit : null;
                const toks = tokens?.[i];
                return (
                  <div key={i} className={fresh ? `hl-line hl-${h.kind}${h.moved ? " hl-moved" : ""}` : "hl-line"}>
                    {hit ? (
                      <>
                        {text.slice(0, hit.start)}
                        <mark className="find-hit">{text.slice(hit.start, hit.start + hit.length)}</mark>
                        {text.slice(hit.start + hit.length)}
                      </>
                    ) : fresh ? (
                      renderSegments(h.segments, toks, showWs)
                    ) : toks || showWs ? (
                      renderSegments([{ text, changed: false }], toks, showWs)
                    ) : (
                      text
                    )}
                    {showWs && <EolMarker />}
                  </div>
                );
              }),
            )}
          </div>
        )}
        <textarea
          ref={area}
          aria-label={label}
          value={value}
          wrap="off"
          tabIndex={hidden ? -1 : undefined}
          spellCheck={false}
          onFocus={onFocusPane}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              onSave?.();
            }
            // macOS の標準は Cmd+Shift+Z。Cmd/Ctrl+Y でもやり直せるようにする
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "y") {
              e.preventDefault();
              document.execCommand("redo");
            }
          }}
          onScroll={(e) => {
            const { scrollTop, scrollLeft } = e.currentTarget;
            updateViewport();
            if (gutter.current) gutter.current.scrollTop = scrollTop;
            if (layer.current) {
              layer.current.scrollTop = scrollTop;
              layer.current.scrollLeft = scrollLeft;
            }
            const expected = programmatic.current;
            programmatic.current = null;
            if (expected !== null && Math.abs(scrollTop - expected) < 1) return; // プログラムによるスクロールは伝播しない
            onScrollLine?.(Math.floor(scrollTop / LINE_HEIGHT) + 1);
          }}
        />
      </div>
    </div>
  );
});
