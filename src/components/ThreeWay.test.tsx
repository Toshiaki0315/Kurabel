import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { Merge3 } from "../types";

const confirmAction = vi.fn();
const saveText = vi.fn();
const createText = vi.fn();
const pickSavePath = vi.fn();
vi.mock("../api", () => ({
  confirmAction: (...a: unknown[]) => confirmAction(...a),
  saveText: (...a: unknown[]) => saveText(...a),
  createText: (...a: unknown[]) => createText(...a),
  pickSavePath: (...a: unknown[]) => pickSavePath(...a),
}));

import { ThreeWay } from "./ThreeWay";

const UTF8 = { name: "UTF-8", bom: false };
const SJIS = { name: "Shift_JIS", bom: false };
const long = Array.from({ length: 12 }, (_, i) => `common${i}`);

const data: Merge3 = {
  chunks: [
    { kind: "stable", lines: long },
    { kind: "left", base: ["b"], left: ["B"] },
    { kind: "conflict", base: ["c"], left: ["L1", "L2"], right: ["R"] },
    { kind: "right", base: ["d"], right: ["D"] },
    { kind: "same", base: ["e"], lines: ["E"] },
    { kind: "conflict", base: [], left: [], right: ["new"] },
  ],
  left_encoding: SJIS,
  base_encoding: UTF8,
  right_encoding: UTF8,
  eol: "\n",
  trailing_newline: true,
};

const setup = (onDirtyChange = vi.fn(), onClose = vi.fn()) => {
  const r = render(<ThreeWay data={data} basePath="/x/base.txt" leftPath="/x/left.txt" rightPath="/x/right.txt" onDirtyChange={onDirtyChange} onClose={onClose} />);
  return { onDirtyChange, onClose, ...r };
};
const result = () => (screen.getByLabelText("マージ結果") as HTMLTextAreaElement).value;

describe("ThreeWay", () => {
  beforeEach(() => {
    confirmAction.mockReset();
    saveText.mockReset();
    createText.mockReset();
    pickSavePath.mockReset();
  });

  it("shows three columns with file names, collapsing long common sections", () => {
    const { container } = setup();
    expect(screen.getByText("left.txt")).toBeInTheDocument();
    expect(screen.getByText("base.txt")).toBeInTheDocument();
    expect(screen.getByText("right.txt")).toBeInTheDocument();
    const columnsText = container.querySelector(".tw-chunks")!.textContent!;
    expect(columnsText).toContain("⋯ 6 行は共通 ⋯");
    expect(columnsText).toContain("common2");
    expect(columnsText).toContain("common9");
    expect(columnsText).not.toContain("common5");
    expect(container.querySelectorAll(".tw-conflict").length).toBe(6);
    expect(columnsText).toContain("（行なし）");
    expect(screen.getByText("未解決の競合 2 件（全 2 件）")).toBeInTheDocument();
  });

  it("starts with auto-merged text and conflict markers for unresolved conflicts", () => {
    setup();
    expect(result()).toContain("B\n<<<<<<< 左\nL1\nL2\n=======\nR\n>>>>>>> 右\nD\nE\n");
    expect(result().startsWith("common0\n")).toBe(true);
    expect(result().endsWith(">>>>>>> 右\n")).toBe(true);
  });

  it("updates the result as conflicts are resolved and reports unsaved changes", () => {
    const { onDirtyChange } = setup();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "競合1: 左→右" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "競合1: 左→右" })).toHaveAttribute("aria-pressed", "true");
    expect(result()).toContain("B\nL1\nL2\nR\nD\nE\n<<<<<<< 左");
    fireEvent.click(screen.getByRole("button", { name: "競合1: 右→左" }));
    expect(result()).toContain("B\nR\nL1\nL2\nD");
    fireEvent.click(screen.getByRole("button", { name: "競合1: 基準を採用" }));
    expect(result()).toContain("B\nc\nD");
    fireEvent.click(screen.getByRole("button", { name: "競合1: 右を採用" }));
    fireEvent.click(screen.getByRole("button", { name: "競合1: 左を採用" }));
    fireEvent.click(screen.getByRole("button", { name: "競合2: 右を採用" }));
    expect(screen.getByText("競合はすべて解決済み")).toBeInTheDocument();
    expect(result()).toContain("B\nL1\nL2\nD\nE\nnew\n");
    expect(result()).not.toContain("<<<<<<<");
  });

  it("jumps between conflicts with the buttons and F7, wrapping around", () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "次の競合" }));
    expect(container.querySelector(".tw-chunk.current")).toHaveAttribute("data-chunk", "2");
    fireEvent.keyDown(window, { key: "F7" });
    expect(container.querySelector(".tw-chunk.current")).toHaveAttribute("data-chunk", "5");
    fireEvent.keyDown(window, { key: "F7" });
    expect(container.querySelector(".tw-chunk.current")).toHaveAttribute("data-chunk", "2");
    fireEvent.keyDown(window, { key: "F7", shiftKey: true });
    expect(container.querySelector(".tw-chunk.current")).toHaveAttribute("data-chunk", "5");
    fireEvent.click(screen.getByRole("button", { name: "前の競合" }));
    expect(container.querySelector(".tw-chunk.current")).toHaveAttribute("data-chunk", "2");
    fireEvent.keyDown(window, { key: "a" });
  });

  it("switches to manual editing when typing in the result, and can go back to the automatic result", () => {
    setup();
    fireEvent.change(screen.getByLabelText("マージ結果"), { target: { value: "hand written" } });
    expect(result()).toBe("hand written");
    expect(screen.getByText(/手動で編集中/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "競合1: 左を採用" })).toBeDisabled();
    fireEvent.click(screen.getByText("自動結果に戻す"));
    expect(result()).toContain("<<<<<<< 左");
    expect(screen.getByRole("button", { name: "競合1: 左を採用" })).toBeEnabled();
  });

  describe("saving", () => {
    const resolveAll = () => {
      fireEvent.click(screen.getByRole("button", { name: "競合1: 左を採用" }));
      fireEvent.click(screen.getByRole("button", { name: "競合2: 右を採用" }));
    };

    it("overwrites the left file in its own encoding after confirmation", async () => {
      saveText.mockResolvedValue(undefined);
      const { onDirtyChange } = setup();
      resolveAll();
      confirmAction.mockResolvedValueOnce(false);
      fireEvent.click(screen.getByText("左へ保存"));
      await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("/x/left.txt"), "上書き"));
      expect(saveText).not.toHaveBeenCalled();
      confirmAction.mockResolvedValueOnce(true);
      fireEvent.click(screen.getByText("左へ保存"));
      await waitFor(() => expect(saveText).toHaveBeenCalledWith("/x/left.txt", result(), SJIS));
      expect(await screen.findByText("左のファイルに保存しました")).toBeInTheDocument();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it("overwrites the right file", async () => {
      saveText.mockResolvedValue(undefined);
      setup();
      resolveAll();
      confirmAction.mockResolvedValue(true);
      fireEvent.click(screen.getByText("右へ保存"));
      await waitFor(() => expect(saveText).toHaveBeenCalledWith("/x/right.txt", result(), UTF8));
      expect(await screen.findByText("右のファイルに保存しました")).toBeInTheDocument();
    });

    it("warns about unresolved conflicts before saving", async () => {
      saveText.mockResolvedValue(undefined);
      setup();
      confirmAction.mockResolvedValueOnce(false);
      fireEvent.click(screen.getByText("左へ保存"));
      await waitFor(() => expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("未解決の競合が 2 件"), "保存"));
      expect(saveText).not.toHaveBeenCalled();
    });

    it("saves under a new name without overwriting, using the left encoding", async () => {
      createText.mockResolvedValue(undefined);
      pickSavePath.mockResolvedValue("/out/merged.txt");
      setup();
      resolveAll();
      fireEvent.click(screen.getByText("名前を付けて保存…"));
      await waitFor(() => expect(createText).toHaveBeenCalledWith("/out/merged.txt", result(), SJIS));
      expect(pickSavePath).toHaveBeenCalledWith("left.txt");
      expect(await screen.findByText("保存しました: /out/merged.txt")).toBeInTheDocument();
      expect(confirmAction).not.toHaveBeenCalled(); // 解決済みで、上書きでもないので確認なし
    });

    it("does nothing when the save dialog is cancelled or unresolved conflicts are declined", async () => {
      pickSavePath.mockResolvedValueOnce(null);
      setup();
      fireEvent.click(screen.getByText("名前を付けて保存…"));
      await waitFor(() => expect(pickSavePath).toHaveBeenCalled());
      expect(createText).not.toHaveBeenCalled();
      pickSavePath.mockResolvedValueOnce("/out/x.txt");
      confirmAction.mockResolvedValueOnce(false);
      fireEvent.click(screen.getByText("名前を付けて保存…"));
      await waitFor(() => expect(confirmAction).toHaveBeenCalled());
      expect(createText).not.toHaveBeenCalled();
    });

    it("shows the error when saving fails", async () => {
      saveText.mockRejectedValue(new Error("読み取り専用"));
      createText.mockRejectedValue(new Error("既に存在します"));
      pickSavePath.mockResolvedValue("/out/x.txt");
      setup();
      resolveAll();
      confirmAction.mockResolvedValue(true);
      fireEvent.click(screen.getByText("左へ保存"));
      expect(await screen.findByRole("alert")).toHaveTextContent("読み取り専用");
      fireEvent.click(screen.getByText("名前を付けて保存…"));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("既に存在します"));
    });
  });

  it("calls onClose, and clears the unsaved flag on unmount", () => {
    const { onClose, onDirtyChange, unmount } = setup();
    fireEvent.click(screen.getByText("← 2ウェイ比較に戻る"));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "競合1: 左を採用" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("handles a merge with no conflicts", () => {
    render(<ThreeWay data={{ ...data, chunks: [{ kind: "stable", lines: ["a"] }] }} basePath="/b" leftPath="/l" rightPath="/r" onClose={vi.fn()} />);
    expect(screen.getByText("競合はすべて解決済み")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次の競合" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "F7" });
    expect((screen.getByLabelText("マージ結果") as HTMLTextAreaElement).value).toBe("a\n");
  });
});
