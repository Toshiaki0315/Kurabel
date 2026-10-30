import { forwardRef, useImperativeHandle, useRef } from "react";
import type { RowKind, Segment } from "../types";

export const LINE_HEIGHT = 18;

export interface LineHighlight {
  kind: RowKind;
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
  /** Cmd/Ctrl+S が押されたとき（このペインにカーソルがある） */
  onSave?: () => void;
  /** ユーザー操作でスクロールされたとき、先頭に見えている行(1始まり) */
  onScrollLine?: (line: number) => void;
  /** 行番号(1始まり) → 差分ハイライト。本文と一致しない行（再比較前）は無視する。 */
  highlights?: Map<number, LineHighlight>;
}

/** 行番号ガターと差分ハイライト層つきテキストエリア（折り返しなしで行とずれないようにする）。 */
export const NumberedTextarea = forwardRef<EditorHandle, Props>(function NumberedTextarea(
  { label, value, onChange, onSave, onScrollLine, highlights },
  ref,
) {
  const gutter = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const programmatic = useRef<number | null>(null);
  const lines = value.split("\n");

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
    <div className="numbered">
      <div className="gutter" ref={gutter} aria-hidden="true">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="editor">
        {highlights && (
          <div className="hl-layer" ref={layer} aria-hidden="true">
            {lines.map((text, i) => {
              const h = highlights.get(i + 1);
              const fresh = h && h.segments.map((s) => s.text).join("") === text;
              return (
                <div key={i} className={fresh ? `hl-line hl-${h.kind}` : "hl-line"}>
                  {fresh
                    ? h.segments.map((s, j) => (s.changed ? <mark key={j} className="chg">{s.text}</mark> : <span key={j}>{s.text}</span>))
                    : text}
                </div>
              );
            })}
          </div>
        )}
        <textarea
          ref={area}
          aria-label={label}
          value={value}
          wrap="off"
          spellCheck={false}
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
