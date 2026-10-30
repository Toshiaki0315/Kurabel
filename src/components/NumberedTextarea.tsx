import { useRef } from "react";
import type { RowKind, Segment } from "../types";

export interface LineHighlight {
  kind: RowKind;
  segments: Segment[];
}

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Cmd/Ctrl+S が押されたとき（このペインにカーソルがある） */
  onSave?: () => void;
  /** 行番号(1始まり) → 差分ハイライト。本文と一致しない行（再比較前）は無視する。 */
  highlights?: Map<number, LineHighlight>;
}

/** 行番号ガターと差分ハイライト層つきテキストエリア（折り返しなしで行とずれないようにする）。 */
export function NumberedTextarea({ label, value, onChange, onSave, highlights }: Props) {
  const gutter = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const lines = value.split("\n");
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
          }}
        />
      </div>
    </div>
  );
}
