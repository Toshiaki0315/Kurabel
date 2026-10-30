import type { Cell } from "../types";

export function CellText({ cell }: { cell: Cell | null }) {
  if (!cell) return null;
  return (
    <>
      {cell.segments.map((s, i) =>
        s.changed ? (
          <mark key={i} className="chg">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
