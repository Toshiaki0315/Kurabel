import { useRef } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** 行番号ガターつきテキストエリア（折り返しなしで行番号とずれないようにする）。 */
export function NumberedTextarea({ label, value, onChange }: Props) {
  const gutter = useRef<HTMLDivElement>(null);
  const count = value.split("\n").length;
  return (
    <div className="numbered">
      <div className="gutter" ref={gutter} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        aria-label={label}
        value={value}
        wrap="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // macOS の標準は Cmd+Shift+Z。Cmd/Ctrl+Y でもやり直せるようにする
          if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "y") {
            e.preventDefault();
            document.execCommand("redo");
          }
        }}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}
