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
    render(<BinaryCompare rows={rows} />);
    expect(screen.getAllByRole("row")).toHaveLength(500);
    fireEvent.click(screen.getByText(/もっと表示/));
    expect(screen.getAllByRole("row")).toHaveLength(501);
    expect(screen.queryByText(/もっと表示/)).toBeNull();
  });
});
