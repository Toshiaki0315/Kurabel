import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { DiffRow, RowKind } from "../types";
import { Overview } from "./Overview";

const row = (kind: RowKind): DiffRow => ({ kind, left: null, right: null });

describe("Overview", () => {
  const rows = [row("equal"), row("replace"), row("replace"), row("equal"), row("insert"), row("equal"), row("equal"), row("equal"), row("equal"), row("equal")];
  const blocks = [{ start: 1, end: 3 }, { start: 4, end: 5 }];

  it("places a mark per block proportionally and highlights the current one", () => {
    render(<Overview rows={rows} blocks={blocks} cursor={1} onJump={vi.fn()} />);
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveClass("ov-replace");
    expect(first).not.toHaveClass("current");
    expect(first.style.top).toBe("10%");
    expect(first.style.height).toBe("20%");
    expect(second).toHaveClass("ov-insert", "current");
  });

  it("jumps to the clicked difference", () => {
    const onJump = vi.fn();
    render(<Overview rows={rows} blocks={blocks} cursor={-1} onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: "差分2へ移動" }));
    expect(onJump).toHaveBeenCalledWith(1);
  });

  it("keeps tiny blocks visible and tolerates no rows", () => {
    const many = Array.from({ length: 1000 }, () => row("replace"));
    render(<Overview rows={many} blocks={[{ start: 5, end: 6 }]} cursor={-1} onJump={vi.fn()} />);
    expect(screen.getByRole("button").style.height).toBe("0.8%");
    render(<Overview rows={[]} blocks={[]} cursor={-1} onJump={vi.fn()} />);
  });
});
