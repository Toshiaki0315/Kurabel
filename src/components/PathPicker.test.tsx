import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { PathPicker } from "./PathPicker";

describe("PathPicker", () => {
  it("requests file or directory selection", () => {
    const onPick = vi.fn();
    render(<PathPicker label="左" value={null} onPick={onPick} />);
    expect(screen.getByText(/未選択/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("左のファイル…"));
    expect(onPick).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("左のフォルダ…"));
    expect(onPick).toHaveBeenLastCalledWith(true);
  });

  it("shows the chosen path", () => {
    render(<PathPicker label="右" value="/tmp/a" onPick={vi.fn()} />);
    expect(screen.getByText("/tmp/a")).toBeInTheDocument();
  });
});
