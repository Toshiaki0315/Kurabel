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

  it("filters to differences only", () => {
    render(<DirCompare entries={entries} onOpen={vi.fn()} />);
    expect(screen.getByRole("treeitem", { name: "sub/same.txt" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("差分のみ表示"));
    expect(screen.queryByRole("treeitem", { name: "sub/same.txt" })).toBeNull();
    expect(screen.queryByRole("treeitem", { name: "other" })).toBeNull();
    expect(screen.getByRole("treeitem", { name: "sub" })).toBeInTheDocument();
  });
});
