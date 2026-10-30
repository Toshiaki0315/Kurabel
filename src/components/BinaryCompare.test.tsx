import { fireEvent, render, screen } from "@testing-library/react";
import type { BinaryRow } from "../types";
import { BinaryCompare } from "./BinaryCompare";

const cell = (hex: string, ascii: string, changed = false) => ({ hex, ascii, changed });

describe("BinaryCompare", () => {
  it("shows offsets, hex, ascii, highlights and sizes", () => {
    const rows: BinaryRow[] = [
      { offset: 16, left: [cell("41", "A"), cell("00", ".", true)], right: [cell("41", "A"), cell("01", ".", true)] },
    ];
    const { container } = render(<BinaryCompare rows={rows} leftSize={2} rightSize={2} />);
    expect(screen.getByText("00000010")).toBeInTheDocument();
    expect(screen.getByText("00")).toHaveClass("chg");
    expect(screen.getByText("01")).toHaveClass("chg");
    expect(screen.getAllByText("41")[0]).not.toHaveClass("chg");
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(screen.getByText(/左 2 バイト/)).toBeInTheDocument();
  });

  it("paginates large dumps", () => {
    const rows: BinaryRow[] = Array.from({ length: 501 }, (_, i) => ({
      offset: i * 16, left: [cell("41", "A")], right: [cell("41", "A")],
    }));
    render(<BinaryCompare rows={rows} leftSize={1} rightSize={1} />);
    expect(screen.getAllByRole("row")).toHaveLength(500);
    fireEvent.click(screen.getByText(/もっと表示/));
    expect(screen.getAllByRole("row")).toHaveLength(501);
    expect(screen.queryByText(/もっと表示/)).toBeNull();
  });
});
