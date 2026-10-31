import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { DirEntry } from "../types";
const saveReport = vi.fn();
vi.mock("../lib/saveReport", () => ({ saveReport: (...a: unknown[]) => saveReport(...a) }));

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

  describe("copy / delete controls", () => {
    const setup = () => {
      const onCopy = vi.fn();
      const onDelete = vi.fn();
      render(<DirCompare entries={entries} onOpen={vi.fn()} onCopy={onCopy} onDelete={onDelete} />);
      return { onCopy, onDelete };
    };
    const select = (rel: string) => fireEvent.click(screen.getByRole("treeitem", { name: rel }));

    it("is disabled until an item is selected", () => {
      setup();
      for (const label of ["→ 右へコピー", "← 左へコピー", "左を削除", "右を削除"]) {
        expect(screen.getByText(label)).toBeDisabled();
      }
    });

    it("enables only the actions that apply to the selected item", () => {
      const { onCopy, onDelete } = setup();
      select("gone.txt"); // 左だけにある
      expect(screen.getByText("← 左へコピー")).toBeDisabled();
      expect(screen.getByText("右を削除")).toBeDisabled();
      fireEvent.click(screen.getByText("→ 右へコピー"));
      expect(onCopy).toHaveBeenLastCalledWith("gone.txt", "left", false);
      fireEvent.click(screen.getByText("左を削除"));
      expect(onDelete).toHaveBeenLastCalledWith("gone.txt", "left");
      select("new.txt"); // 右だけにある
      expect(screen.getByText("→ 右へコピー")).toBeDisabled();
      fireEvent.click(screen.getByText("← 左へコピー"));
      expect(onCopy).toHaveBeenLastCalledWith("new.txt", "right", false);
      fireEvent.click(screen.getByText("右を削除"));
      expect(onDelete).toHaveBeenLastCalledWith("new.txt", "right");
    });

    it("flags an overwrite when both sides have the item, and highlights the selection", () => {
      const { onCopy } = setup();
      select("sub/m.txt");
      expect(screen.getByRole("treeitem", { name: "sub/m.txt" })).toHaveClass("selected");
      fireEvent.click(screen.getByText("→ 右へコピー"));
      expect(onCopy).toHaveBeenLastCalledWith("sub/m.txt", "left", true);
      fireEvent.click(screen.getByText("← 左へコピー"));
      expect(onCopy).toHaveBeenLastCalledWith("sub/m.txt", "right", true);
    });

    it("has no controls in single mode", () => {
      render(<DirCompare entries={entries} onOpen={vi.fn()} single />);
      expect(screen.queryByText("→ 右へコピー")).toBeNull();
    });

    it("tolerates missing handlers", () => {
      render(<DirCompare entries={entries} onOpen={vi.fn()} />);
      select("gone.txt");
      fireEvent.click(screen.getByText("→ 右へコピー"));
      fireEvent.click(screen.getByText("左を削除"));
    });
  });

  describe("size and modified-time columns", () => {
    const meta: DirEntry[] = [
      { path: "a.txt", left: "file", right: "file", status: "modified", left_size: 2048, right_size: 100, left_modified: 2_000_000_000, right_modified: 1_000_000_000 },
      { path: "left.txt", left: "file", right: null, status: "removed", left_size: 5, left_modified: 1_500_000_000 },
      { path: "d", left: "directory", right: "directory", status: "same" },
    ];

    it("shows sizes and dates for files on each side, and nothing for folders", () => {
      render(<DirCompare entries={meta} onOpen={vi.fn()} />);
      const row = screen.getByRole("treeitem", { name: "a.txt" });
      expect(row).toHaveTextContent("2.0 KB");
      expect(row).toHaveTextContent("100 B");
      expect(screen.getByRole("treeitem", { name: "left.txt" })).toHaveTextContent("5 B");
      expect(screen.getByRole("treeitem", { name: "d" }).querySelectorAll(".dir-size")[0]).toHaveTextContent("");
    });

    it("emphasizes the newer date of a modified file only", () => {
      render(<DirCompare entries={meta} onOpen={vi.fn()} />);
      const dates = screen.getByRole("treeitem", { name: "a.txt" }).querySelectorAll(".dir-date");
      expect(dates[0]).toHaveClass("newer");
      expect(dates[1]).not.toHaveClass("newer");
      expect(screen.getByRole("treeitem", { name: "left.txt" }).querySelector(".newer")).toBeNull();
    });
  });

  describe("report", () => {
    beforeEach(() => saveReport.mockReset());

    it("saves an HTML report of all entries and confirms", async () => {
      saveReport.mockResolvedValue(true);
      render(<DirCompare entries={entries} onOpen={vi.fn()} leftRoot="/L" rightRoot="/R" />);
      fireEvent.click(screen.getByText("レポートを保存…"));
      expect(await screen.findByText("レポートを保存しました")).toBeInTheDocument();
      const [html, name] = saveReport.mock.calls[0];
      expect(html).toContain("/L");
      expect(html).toContain("gone.txt");
      expect(name).toBe("L-compare.html");
    });

    it("says nothing when the dialog is cancelled, and shows an error when saving fails", async () => {
      saveReport.mockResolvedValueOnce(false);
      render(<DirCompare entries={entries} onOpen={vi.fn()} />);
      fireEvent.click(screen.getByText("レポートを保存…"));
      await waitFor(() => expect(saveReport).toHaveBeenCalled());
      expect(screen.queryByText("レポートを保存しました")).toBeNull();
      expect(saveReport.mock.calls[0][1]).toBe("folder-compare.html");
      saveReport.mockRejectedValueOnce(new Error("拡張子が不正"));
      fireEvent.click(screen.getByText("レポートを保存…"));
      expect(await screen.findByRole("alert")).toHaveTextContent("拡張子が不正");
    });

    it("has no report button in single mode", () => {
      render(<DirCompare entries={entries} onOpen={vi.fn()} single />);
      expect(screen.queryByText("レポートを保存…")).toBeNull();
    });
  });

  describe("archive contents", () => {
    it("is read-only: no copy or delete controls, but filtering and the report remain", () => {
      render(<DirCompare entries={entries} onOpen={vi.fn()} archive leftRoot="/a.zip" rightRoot="/b.zip" />);
      for (const label of ["→ 右へコピー", "← 左へコピー", "左を削除", "右を削除"]) expect(screen.queryByText(label)).toBeNull();
      expect(screen.getByLabelText("表示する差分")).toBeInTheDocument();
      expect(screen.getByText("レポートを保存…")).toBeInTheDocument();
      expect(screen.getByText(/件の差分/)).toBeInTheDocument();
    });
  });
});
