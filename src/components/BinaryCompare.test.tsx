import { fireEvent, render, screen } from "@testing-library/react";
import type { BinaryRow } from "../types";
import { BinaryCompare } from "./BinaryCompare";

const cell = (hex: string, ascii: string, changed = false) => ({ hex, ascii, changed });

describe("BinaryCompare", () => {
  it("shows offsets, hex, ascii, highlights and sizes", () => {
    const rows: BinaryRow[] = [
      { offset: 16, left: [cell("41", "A"), cell("00", ".", true)], right: [cell("41", "A"), cell("01", ".", true)] },
    ];
    const { container } = render(<BinaryCompare rows={rows} />);
    expect(screen.getAllByText("00000010")).toHaveLength(2); // 左右ペインそれぞれにオフセット
    expect(screen.getByText("00")).toHaveClass("chg");
    expect(screen.getByText("01")).toHaveClass("chg");
    expect(screen.getAllByText("41")[0]).not.toHaveClass("chg");
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("paginates large dumps", () => {
    const rows: BinaryRow[] = Array.from({ length: 501 }, (_, i) => ({
      offset: i * 16, left: [cell("41", "A")], right: [cell("41", "A")],
    }));
    const { container } = render(<BinaryCompare rows={rows} />);
    const count = () => container.querySelectorAll("tbody tr").length; // role クエリは行数が多いと非常に遅い
    expect(count()).toBe(500);
    fireEvent.click(screen.getByText(/もっと表示/));
    expect(count()).toBe(501);
    expect(screen.queryByText(/もっと表示/)).toBeNull();
  });

  it("tells the user when only the beginning of a huge file is shown", () => {
    const rows: BinaryRow[] = Array.from({ length: 3 }, (_, i) => ({ offset: i * 16, left: [cell("41", "A")], right: [cell("41", "A")] }));
    const { rerender } = render(<BinaryCompare rows={rows} truncated />);
    expect(screen.getByText("大きいため、先頭 48 バイトのみ表示しています")).toBeInTheDocument();
    rerender(<BinaryCompare rows={rows} />);
    expect(screen.queryByText(/先頭/)).toBeNull();
  });
});
