import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { DiffRow } from "../types";

const diffText = vi.fn();
const saveText = vi.fn();
vi.mock("../api", () => ({
  diffText: (...a: unknown[]) => diffText(...a),
  saveText: (...a: unknown[]) => saveText(...a),
}));

import { TextCompare } from "./TextCompare";

const seg = (text: string, changed = false) => ({ text, changed });
const rows: DiffRow[] = [
  { kind: "equal", left: { line_no: 1, segments: [seg("same")] }, right: { line_no: 1, segments: [seg("same")] } },
  { kind: "replace", left: { line_no: 2, segments: [seg("a ", false), seg("old", true)] }, right: { line_no: 2, segments: [seg("a ", false), seg("new", true)] } },
];

const setup = (mode: "line" | "word" = "line") =>
  render(<TextCompare leftText={"same\na old"} rightText={"same\na new"} rows={rows} mode={mode} leftPath="/l.txt" rightPath="/r.txt" />);

describe("TextCompare", () => {
  beforeEach(() => {
    diffText.mockReset();
    saveText.mockReset();
  });

  it("renders line numbers, text, highlights and the diff count in view mode", () => {
    const { container } = setup();
    expect(container.querySelector(".diff-table mark")!.textContent).toBe("old");
    expect(screen.getByText("差分 1 行")).toBeInTheDocument();
    expect(screen.queryByText("再比較")).toBeNull();
    expect(container.querySelector(".edit-panes")).toHaveAttribute("hidden");
  });

  it("re-diffs automatically after editing, without a button", async () => {
    diffText.mockResolvedValue([]);
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("右のテキスト"), { target: { value: "y" } });
    expect(screen.getAllByText("1")).toHaveLength(2); // 左右の編集ペインそれぞれに行番号
    fireEvent.scroll(screen.getByLabelText("左のテキスト"), { target: { scrollTop: 10 } });
    await waitFor(() => expect(diffText).toHaveBeenCalledWith("x", "y", "line"), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText("差分 0 行")).toBeInTheDocument());
  });

  it("keeps the editors (and their undo history) mounted across edit/view toggles", () => {
    const { container } = setup();
    fireEvent.click(screen.getByText("編集"));
    const ta = screen.getByLabelText("左のテキスト");
    expect(container.querySelector(".edit-panes")).not.toHaveAttribute("hidden");
    expect(container.querySelector(".diff-table")).toBeNull();
    fireEvent.click(screen.getByText("表示に戻る"));
    expect(container.querySelector(".diff-table")).not.toBeNull();
    expect(container.querySelector(".edit-panes")).toHaveAttribute("hidden");
    fireEvent.click(screen.getByText("編集"));
    expect(screen.getByLabelText("左のテキスト")).toBe(ta);
    expect(diffText).not.toHaveBeenCalled();
  });

  it("re-diffs when the highlight mode changes", async () => {
    diffText.mockResolvedValue(rows);
    const { rerender } = setup("line");
    expect(diffText).not.toHaveBeenCalled();
    rerender(<TextCompare leftText={"same\na old"} rightText={"same\na new"} rows={rows} mode="word" leftPath="/l.txt" rightPath="/r.txt" />);
    await waitFor(() => expect(diffText).toHaveBeenCalledWith("same\na old", "same\na new", "word"));
  });

  it("shows an error when re-diff fails", async () => {
    diffText.mockImplementation(() => Promise.reject(new Error("boom")));
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "x" } });
    expect(await screen.findByRole("alert", undefined, { timeout: 2000 })).toHaveTextContent("boom");
  });

  it("saves only the edited pane and clears the dirty marker", async () => {
    saveText.mockResolvedValue(undefined);
    diffText.mockResolvedValue([]);
    setup();
    expect(screen.getByRole("button", { name: "左を保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "右を保存" })).toBeDisabled();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("右のテキスト"), { target: { value: "edited" } });
    expect(screen.getByText("未保存の変更あり")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "左を保存" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "右を保存" }));
    await waitFor(() => expect(saveText).toHaveBeenCalledWith("/r.txt", "edited"));
    await waitFor(() => expect(screen.queryByText("未保存の変更あり")).toBeNull());
    expect(diffText).toHaveBeenCalled();
  });

  it("saves the left pane and keeps the dirty marker when saving fails", async () => {
    saveText.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    diffText.mockResolvedValue([]);
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "L" } });
    fireEvent.click(screen.getByRole("button", { name: "左を保存" }));
    await waitFor(() => expect(saveText).toHaveBeenCalledWith("/l.txt", "L"));
    await waitFor(() => expect(screen.queryByText("未保存の変更あり")).toBeNull());
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "L2" } });
    fireEvent.click(screen.getByRole("button", { name: "左を保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("denied");
    expect(screen.getByText("未保存の変更あり")).toBeInTheDocument();
  });

  it("Cmd/Ctrl+S saves the focused pane only, and only when it has changes", async () => {
    saveText.mockResolvedValue(undefined);
    diffText.mockResolvedValue([]);
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.keyDown(screen.getByLabelText("右のテキスト"), { key: "s", metaKey: true });
    expect(saveText).not.toHaveBeenCalled(); // 変更なし
    fireEvent.change(screen.getByLabelText("右のテキスト"), { target: { value: "R" } });
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "L" } });
    fireEvent.keyDown(screen.getByLabelText("右のテキスト"), { key: "s", ctrlKey: true });
    await waitFor(() => expect(saveText).toHaveBeenCalledTimes(1));
    expect(saveText).toHaveBeenCalledWith("/r.txt", "R");
  });

  it("keeps highlights in edit mode", () => {
    const { container } = setup();
    fireEvent.click(screen.getByText("編集"));
    expect(container.querySelector(".hl-replace")).not.toBeNull();
    expect(container.querySelector(".hl-layer mark")!.textContent).toBe("old");
  });

  it("ignores out-of-date re-diff results", async () => {
    let resolveFirst: (v: DiffRow[]) => void = () => {};
    diffText.mockImplementationOnce(() => new Promise<DiffRow[]>((r) => (resolveFirst = r)));
    diffText.mockResolvedValueOnce([]);
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "a" } });
    await waitFor(() => expect(diffText).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "b" } });
    await waitFor(() => expect(screen.getByText("差分 0 行")).toBeInTheDocument(), { timeout: 2000 });
    resolveFirst(rows);
    await Promise.resolve();
    expect(screen.getByText("差分 0 行")).toBeInTheDocument();
  });
});
