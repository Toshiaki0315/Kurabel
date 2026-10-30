import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { PathPicker } from "./PathPicker";

describe("PathPicker", () => {
  it("has a folder-icon button inside the path box and no choice by default", () => {
    const onPick = vi.fn();
    render(<PathPicker side="left" value={null} choosing={false} onPick={onPick} onChoose={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/未選択/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "左を選択" });
    expect(btn).toHaveTextContent("📁");
    fireEvent.click(btn);
    expect(onPick).toHaveBeenCalled();
    expect(screen.queryByText("ファイル")).toBeNull();
  });

  it("offers file/folder when choosing and shows path and info", () => {
    const onChoose = vi.fn();
    render(<PathPicker side="right" value="/tmp/a" info="3 バイト" choosing onPick={vi.fn()} onChoose={onChoose} onClose={vi.fn()} />);
    expect(screen.getByText("/tmp/a")).toBeInTheDocument();
    expect(screen.getByText("3 バイト")).toBeInTheDocument();
    fireEvent.click(screen.getByText("ファイル"));
    expect(onChoose).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("フォルダ"));
    expect(onChoose).toHaveBeenLastCalledWith(true);
  });

  it("has a close button to the right of the folder icon, enabled only when a path is open", () => {
    const onClose = vi.fn();
    const { rerender } = render(<PathPicker side="left" value={null} choosing={false} onPick={vi.fn()} onChoose={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole("button", { name: "左を閉じる" })).toBeDisabled();
    rerender(<PathPicker side="left" value="/tmp/a" choosing={false} onPick={vi.fn()} onChoose={vi.fn()} onClose={onClose} />);
    const [pick, close] = screen.getAllByRole("button");
    expect(pick).toHaveTextContent("📁");
    expect(close).toHaveTextContent("✕");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
