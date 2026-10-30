import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { DirEntry } from "../types";
import { DirCompare } from "./DirCompare";

const entries: DirEntry[] = [
  { path: "sub", left: "directory", right: "directory", status: "same" },
  { path: "sub/m.txt", left: "file", right: "file", status: "modified" },
  { path: "sub/same.txt", left: "file", right: "file", status: "same" },
  { path: "gone.txt", left: "file", right: null, status: "removed" },
  { path: "new.txt", left: null, right: "file", status: "added" },
  { path: "kind", left: "file", right: "directory", status: "modified" },
  { path: "other", left: "directory", right: "directory", status: "same" },
];

const has = (name: string) => screen.queryByRole("treeitem", { name }) !== null;

describe("DirCompare", () => {
  it("shows statuses with highlight classes", () => {
    render(<DirCompare entries={entries} onOpen={vi.fn()} />);
    expect(screen.getByRole("treeitem", { name: "gone.txt" })).toHaveClass("st-removed");
    expect(screen.getByRole("treeitem", { name: "new.txt" })).toHaveClass("st-added");
    expect(screen.getByRole("treeitem", { name: "sub/m.txt" })).toHaveClass("st-modified");
    expect(screen.getByText("削除")).toBeInTheDocument();
    expect(screen.getByText("追加")).toBeInTheDocument();
    expect(screen.getByText("4 件の差分")).toBeInTheDocument();
  });

  it("opens files present on both sides", () => {
    const onOpen = vi.fn();
    render(<DirCompare entries={entries} onOpen={onOpen} />);
    fireEvent.click(screen.getAllByText("m.txt")[0]);
    expect(onOpen).toHaveBeenCalledWith("sub/m.txt");
    expect(screen.queryByRole("button", { name: "gone.txt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "kind" })).toBeNull();
  });

  it("filters by status, keeping the folders that contain matches", () => {
    render(<DirCompare entries={entries} onOpen={vi.fn()} />);
    const select = screen.getByLabelText("表示する差分");
    fireEvent.change(select, { target: { value: "diff" } });
    expect(has("sub/same.txt")).toBe(false);
    expect(has("other")).toBe(false);
    expect(has("sub")).toBe(true);
    fireEvent.change(select, { target: { value: "added" } });
    expect([has("new.txt"), has("gone.txt"), has("sub")]).toEqual([true, false, false]);
    fireEvent.change(select, { target: { value: "removed" } });
    expect([has("gone.txt"), has("new.txt")]).toEqual([true, false]);
    fireEvent.change(select, { target: { value: "modified" } });
    expect([has("sub/m.txt"), has("kind"), has("new.txt")]).toEqual([true, true, false]);
  });

  it("filters by name", () => {
    render(<DirCompare entries={entries} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("名前で絞り込み"), { target: { value: "SAME" } });
    expect(has("sub/same.txt")).toBe(true);
    expect(has("sub")).toBe(true);
    expect(has("gone.txt")).toBe(false);
  });

  it("collapses and expands folders", () => {
    render(<DirCompare entries={entries} onOpen={vi.fn()} />);
    expect(screen.getByRole("treeitem", { name: "sub" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "subを閉じる" }));
    expect(has("sub/m.txt")).toBe(false);
    expect(screen.getByRole("treeitem", { name: "sub" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "subを開く" }));
    expect(has("sub/m.txt")).toBe(true);
    // 子を持たないフォルダには開閉ボタンがない
    expect(screen.queryByRole("button", { name: /otherを/ })).toBeNull();
  });

  it("collapse-all / expand-all buttons, and search reveals collapsed matches", () => {
    render(<DirCompare entries={entries} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText("すべて閉じる"));
    expect(has("sub/m.txt")).toBe(false);
    fireEvent.change(screen.getByLabelText("名前で絞り込み"), { target: { value: "m.txt" } });
    expect(has("sub/m.txt")).toBe(true);
    fireEvent.change(screen.getByLabelText("名前で絞り込み"), { target: { value: "" } });
    expect(has("sub/m.txt")).toBe(false);
    fireEvent.click(screen.getByText("すべて開く"));
    expect(has("sub/m.txt")).toBe(true);
  });

  it("shows a single-sided listing without status labels or open links", () => {
    const single: DirEntry[] = [
      { path: "a", left: "directory", right: null, status: "same" },
      { path: "a/b.txt", left: "file", right: null, status: "same" },
    ];
    const onOpen = vi.fn();
    render(<DirCompare entries={single} onOpen={onOpen} single />);
    expect(screen.queryByText("同一")).toBeNull();
    expect(screen.queryByText(/件の差分/)).toBeNull();
    expect(screen.getByText("b.txt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "b.txt" })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
