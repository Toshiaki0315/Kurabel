import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { DiffRow } from "../types";

const diffText = vi.fn();
const saveText = vi.fn();
const makePatch = vi.fn();
const pickPatchPath = vi.fn();
const writePatch = vi.fn();
vi.mock("../api", () => ({
  makePatch: (...a: unknown[]) => makePatch(...a),
  pickPatchPath: (...a: unknown[]) => pickPatchPath(...a),
  writePatch: (...a: unknown[]) => writePatch(...a),
  diffText: (...a: unknown[]) => diffText(...a),
  saveText: (...a: unknown[]) => saveText(...a),
}));

import { DEFAULT_OPTIONS } from "../types";
import { TextCompare } from "./TextCompare";

const OPTS = DEFAULT_OPTIONS;
const SJIS = { name: "Shift_JIS", bom: false };
const UTF8 = { name: "UTF-8", bom: false };
const seg = (text: string, changed = false) => ({ text, changed });
const rows: DiffRow[] = [
  { kind: "equal", left: { line_no: 1, segments: [seg("same")] }, right: { line_no: 1, segments: [seg("same")] } },
  { kind: "replace", left: { line_no: 2, segments: [seg("a ", false), seg("old", true)] }, right: { line_no: 2, segments: [seg("a ", false), seg("new", true)] } },
];

const setup = (mode: "line" | "word" = "line") =>
  render(<TextCompare leftText={"same\na old"} rightText={"same\na new"} rows={rows} mode={mode} leftPath="/l.txt" rightPath="/r.txt" options={OPTS} leftEncoding={SJIS} rightEncoding={UTF8} />);

/** jsdom には execCommand が無いので、フォーカス中の textarea の選択範囲を置換する簡易版を用意する。 */
function installExecCommand() {
  document.execCommand = vi.fn((cmd: string, _ui?: boolean, value?: string) => {
    const ta = document.activeElement as HTMLTextAreaElement | null;
    if (!ta || ta.tagName !== "TEXTAREA") return false;
    const next = ta.value.slice(0, ta.selectionStart) + (cmd === "delete" ? "" : value ?? "") + ta.value.slice(ta.selectionEnd);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, next);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }) as unknown as typeof document.execCommand;
}

describe("TextCompare", () => {
  beforeEach(() => {
    diffText.mockReset();
    saveText.mockReset();
    makePatch.mockReset();
    pickPatchPath.mockReset();
    writePatch.mockReset();
  });

  it("renders line numbers, text, highlights and the diff count in view mode", () => {
    const { container } = setup();
    expect(container.querySelector(".diff-table mark")!.textContent).toBe("old");
    expect(screen.getByText("差分 1 行")).toBeInTheDocument();
    expect(screen.queryByText("再比較")).toBeNull();
    expect(container.querySelector(".edit-panes")).toHaveClass("offscreen");
  });

  it("re-diffs automatically after editing, without a button", async () => {
    diffText.mockResolvedValue([]);
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("右のテキスト"), { target: { value: "y" } });
    expect(screen.getAllByText("1")).toHaveLength(2); // 左右の編集ペインそれぞれに行番号
    fireEvent.scroll(screen.getByLabelText("左のテキスト"), { target: { scrollTop: 10 } });
    await waitFor(() => expect(diffText).toHaveBeenCalledWith("x", "y", "line", OPTS), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText("差分 0 行")).toBeInTheDocument());
  });

  it("keeps the editors (and their undo history) mounted across edit/view toggles", () => {
    const { container } = setup();
    fireEvent.click(screen.getByText("編集"));
    const ta = screen.getByLabelText("左のテキスト");
    expect(container.querySelector(".edit-panes")).not.toHaveClass("offscreen");
    expect(container.querySelector(".diff-table")).toBeNull();
    fireEvent.click(screen.getByText("表示に戻る"));
    expect(container.querySelector(".diff-table")).not.toBeNull();
    expect(container.querySelector(".edit-panes")).toHaveClass("offscreen");
    fireEvent.click(screen.getByText("編集"));
    expect(screen.getByLabelText("左のテキスト")).toBe(ta);
    expect(diffText).not.toHaveBeenCalled();
  });

  it("re-diffs when the highlight mode changes", async () => {
    diffText.mockResolvedValue(rows);
    const { rerender } = setup("line");
    expect(diffText).not.toHaveBeenCalled();
    rerender(<TextCompare leftText={"same\na old"} rightText={"same\na new"} rows={rows} mode="word" leftPath="/l.txt" rightPath="/r.txt" options={OPTS} leftEncoding={SJIS} rightEncoding={UTF8} />);
    await waitFor(() => expect(diffText).toHaveBeenCalledWith("same\na old", "same\na new", "word", OPTS));
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
    await waitFor(() => expect(saveText).toHaveBeenCalledWith("/r.txt", "edited", UTF8));
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
    await waitFor(() => expect(saveText).toHaveBeenCalledWith("/l.txt", "L", SJIS));
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
    expect(saveText).toHaveBeenCalledWith("/r.txt", "R", UTF8);
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

  describe("merge and navigation", () => {
    beforeEach(installExecCommand);

    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
    const mrows: DiffRow[] = [
      { kind: "equal", left: cell(1, "a"), right: cell(1, "a") },
      { kind: "replace", left: cell(2, "b"), right: cell(2, "X") },
      { kind: "equal", left: cell(3, "c"), right: cell(3, "c") },
      { kind: "insert", left: null, right: cell(4, "e") },
    ];
    const msetup = () =>
      render(<TextCompare leftText={"a\nb\nc"} rightText={"a\nX\nc\ne"} rows={mrows} mode="line" leftPath="/l" rightPath="/r" options={OPTS} leftEncoding={UTF8} rightEncoding={UTF8} />);

    it("merges via insertText so the native undo history is kept, and re-diffs immediately", async () => {
      diffText.mockResolvedValue([]);
      msetup();
      fireEvent.click(screen.getByRole("button", { name: "差分1を左から右へ反映" }));
      expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "b");
      await waitFor(() => expect(diffText).toHaveBeenCalledWith("a\nb\nc", "a\nb\nc\ne", "line", OPTS));
      expect(screen.getByText("未保存の変更あり")).toBeInTheDocument();
      expect((screen.getByLabelText("右のテキスト") as HTMLTextAreaElement).value).toBe("a\nb\nc\ne");
      expect(screen.queryByText("マージを取り消す")).toBeNull();
    });

    it("uses the delete command when a merge only removes lines", async () => {
      diffText.mockResolvedValue([]);
      msetup();
      fireEvent.click(screen.getByRole("button", { name: "差分2を左から右へ反映" }));
      expect(document.execCommand).toHaveBeenCalledWith("delete");
      await waitFor(() => expect(diffText).toHaveBeenCalledWith("a\nb\nc", "a\nX\nc", "line", OPTS));
    });

    it("merges right to left", async () => {
      diffText.mockResolvedValue([]);
      msetup();
      fireEvent.click(screen.getByRole("button", { name: "差分2を右から左へ反映" }));
      await waitFor(() => expect(diffText).toHaveBeenCalledWith("a\nb\nc\ne", "a\nX\nc\ne", "line", OPTS));
      expect((screen.getByLabelText("左のテキスト") as HTMLTextAreaElement).value).toBe("a\nb\nc\ne");
    });

    it("jumps between differences with buttons and F7 / Shift+F7, wrapping around", () => {
      const { container } = msetup();
      expect(screen.getByText("差分 2 行")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "次の差分" }));
      expect(screen.getByText(/1 \/ 2 箇所/)).toBeInTheDocument();
      expect(container.querySelector(".row-current")).not.toBeNull();
      fireEvent.keyDown(window, { key: "F7" });
      expect(screen.getByText(/2 \/ 2 箇所/)).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "F7" });
      expect(screen.getByText(/1 \/ 2 箇所/)).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "F7", shiftKey: true });
      expect(screen.getByText(/2 \/ 2 箇所/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "前の差分" }));
      expect(screen.getByText(/1 \/ 2 箇所/)).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "a" });
      expect(screen.getByText(/1 \/ 2 箇所/)).toBeInTheDocument();
    });

    it("jumps in edit mode and keeps nav disabled without differences", () => {
      msetup();
      fireEvent.click(screen.getByText("編集"));
      fireEvent.click(screen.getByRole("button", { name: "次の差分" }));
      expect(screen.getByText(/1 \/ 2 箇所/)).toBeInTheDocument();
      fireEvent.scroll(screen.getByLabelText("左のテキスト"), { target: { scrollTop: 36 } });
      fireEvent.scroll(screen.getByLabelText("右のテキスト"), { target: { scrollTop: 36 } });
    });

    it("disables navigation when there are no differences", () => {
      render(<TextCompare leftText="a" rightText="a" rows={[{ kind: "equal", left: cell(1, "a"), right: cell(1, "a") }]} mode="line" leftPath="/l" rightPath="/r" options={OPTS} leftEncoding={UTF8} rightEncoding={UTF8} />);
      expect(screen.getByRole("button", { name: "次の差分" })).toBeDisabled();
      fireEvent.keyDown(window, { key: "F7" });
      expect(screen.queryByText(/箇所/)).toBeNull();
    });
  });

  it("re-diffs when the compare options change", async () => {
    diffText.mockResolvedValue([]);
    const { rerender } = setup("line");
    rerender(<TextCompare leftText={"same\na old"} rightText={"same\na new"} rows={rows} mode="line" options={{ ...OPTS, ignore_whitespace: true }} leftPath="/l.txt" rightPath="/r.txt" leftEncoding={SJIS} rightEncoding={UTF8} />);
    await waitFor(() => expect(diffText).toHaveBeenCalledWith("same\na old", "same\na new", "line", { ...OPTS, ignore_whitespace: true }));
  });

  it("reports unsaved changes and clears the flag on unmount", async () => {
    const onDirtyChange = vi.fn();
    saveText.mockResolvedValue(undefined);
    diffText.mockResolvedValue([]);
    const { unmount } = render(<TextCompare leftText="a" rightText="b" rows={[]} mode="line" options={OPTS} onDirtyChange={onDirtyChange} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "x" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "左を保存" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "y" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    unmount();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("shows a single file read-only: no edit, save, diff count or navigation", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
    const plain: DiffRow[] = [{ kind: "equal", left: cell(1, "only"), right: null }];
    const { container } = render(<TextCompare leftText="only" rightText="" rows={plain} mode="line" options={OPTS} leftPath="/l" rightPath={null} leftEncoding={UTF8} rightEncoding={UTF8} />);
    expect(container.querySelector(".diff-table")).toHaveTextContent("only");
    for (const label of ["編集", "差分", "保存"]) expect(screen.queryByText(new RegExp(label))).toBeNull();
    expect(screen.queryByRole("button", { name: "次の差分" })).toBeNull();
    expect(container.querySelector(".pane-actions")).toBeNull();
    expect(container.querySelector(".edit-panes")).toHaveClass("offscreen");
    fireEvent.keyDown(window, { key: "F7" });
    expect(saveText).not.toHaveBeenCalled();
  });

  it("does not re-diff on mount, even when effects run twice (StrictMode)", async () => {
    render(
      <StrictMode>
        <TextCompare leftText="a" rightText="b" rows={[]} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />
      </StrictMode>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(diffText).not.toHaveBeenCalled();
  });

  it("never diffs a single opened file against nothing, even if mode or text changes", async () => {
    const { rerender } = render(<TextCompare leftText="only" rightText="" rows={[]} mode="line" options={OPTS} leftPath="/l" rightPath={null} leftEncoding={UTF8} rightEncoding={UTF8} />);
    rerender(<TextCompare leftText="only" rightText="" rows={[]} mode="word" options={OPTS} leftPath="/l" rightPath={null} leftEncoding={UTF8} rightEncoding={UTF8} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(diffText).not.toHaveBeenCalled();
  });

  describe("search", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
    const srows: DiffRow[] = [
      { kind: "equal", left: cell(1, "Foo one"), right: cell(1, "Foo one") },
      { kind: "replace", left: cell(2, "two foo"), right: cell(2, "two") },
    ];
    const ssetup = () =>
      render(<TextCompare leftText={"Foo one\ntwo foo"} rightText={"Foo one\ntwo"} rows={srows} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);

    it("opens with Cmd/Ctrl+F, counts matches, steps through them with Enter and the buttons", () => {
      const { container } = ssetup();
      expect(screen.queryByLabelText("検索")).toBeNull();
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      const input = screen.getByLabelText("検索");
      fireEvent.change(input, { target: { value: "foo" } });
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-left-line", "1");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-left-line", "2");
      fireEvent.click(screen.getByRole("button", { name: "次の一致" }));
      expect(screen.getByText("3 / 3")).toBeInTheDocument();
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-right-line", "1");
      fireEvent.click(screen.getByRole("button", { name: "次の一致" }));
      expect(screen.getByText("1 / 3")).toBeInTheDocument(); // 一巡
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      expect(screen.getByText("3 / 3")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "前の一致" }));
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
      fireEvent.keyDown(input, { key: "a" });
    });

    it("says when nothing is found, and closes with Escape or the button", () => {
      ssetup();
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "zzz" } });
      expect(screen.getByText("見つかりません")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "次の一致" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "次の一致" }));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByLabelText("検索")).toBeNull();
      fireEvent.keyDown(window, { key: "Escape" }); // 閉じているときは何もしない
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.click(screen.getByRole("button", { name: "検索を閉じる" }));
      expect(screen.queryByLabelText("検索")).toBeNull();
    });

    it("marks the match inside the editor in edit mode and survives an empty query", () => {
      const { container } = ssetup();
      fireEvent.click(screen.getByText("編集"));
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "two" } });
      expect(container.querySelector("mark.find-hit")!.textContent).toBe("two");
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "" } });
      expect(container.querySelector("mark.find-hit")).toBeNull();
    });

    it("is not available for a single opened file", () => {
      render(<TextCompare leftText="a" rightText="" rows={[]} mode="line" options={OPTS} leftPath="/l" rightPath={null} leftEncoding={UTF8} rightEncoding={UTF8} />);
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      expect(screen.queryByLabelText("検索")).toBeNull();
    });
  });

  describe("patch export", () => {
    it("builds a patch from the current texts and saves it where the user chooses", async () => {
      makePatch.mockResolvedValue("--- a\n+++ b\n");
      pickPatchPath.mockResolvedValue("/out/x.patch");
      writePatch.mockResolvedValue(undefined);
      setup();
      fireEvent.click(screen.getByText("パッチを保存…"));
      await waitFor(() => expect(writePatch).toHaveBeenCalledWith("/out/x.patch", "--- a\n+++ b\n"));
      expect(makePatch).toHaveBeenCalledWith("same\na old", "same\na new", "/l.txt", "/r.txt");
      expect(pickPatchPath).toHaveBeenCalledWith("l.txt.patch");
      expect(await screen.findByText("パッチを保存しました")).toBeInTheDocument();
    });

    it("does nothing when the save dialog is cancelled", async () => {
      makePatch.mockResolvedValue("--- a\n");
      pickPatchPath.mockResolvedValue(null);
      setup();
      fireEvent.click(screen.getByText("パッチを保存…"));
      await waitFor(() => expect(pickPatchPath).toHaveBeenCalled());
      expect(writePatch).not.toHaveBeenCalled();
    });

    it("tells the user when there is no difference", async () => {
      makePatch.mockResolvedValue("");
      setup();
      fireEvent.click(screen.getByText("パッチを保存…"));
      expect(await screen.findByText(/パッチは作成しませんでした/)).toBeInTheDocument();
      expect(pickPatchPath).not.toHaveBeenCalled();
    });

    it("shows an error when saving fails", async () => {
      makePatch.mockResolvedValue("x");
      pickPatchPath.mockResolvedValue("/out.patch");
      writePatch.mockRejectedValue(new Error("拡張子が不正"));
      setup();
      fireEvent.click(screen.getByText("パッチを保存…"));
      expect(await screen.findByRole("alert")).toHaveTextContent("拡張子が不正");
    });
  });

  it("shows the difference map and jumps from it", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
    const r: DiffRow[] = [
      { kind: "equal", left: cell(1, "a"), right: cell(1, "a") },
      { kind: "replace", left: cell(2, "b"), right: cell(2, "X") },
    ];
    render(<TextCompare leftText={"a\nb"} rightText={"a\nX"} rows={r} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);
    fireEvent.click(screen.getByRole("button", { name: "差分1へ移動" }));
    expect(screen.getByText(/1 \/ 1 箇所/)).toBeInTheDocument();
  });

  it("offers 3-way merge only when the app provides a handler and two files are open", () => {
    const onThreeWay = vi.fn();
    const { unmount } = render(<TextCompare leftText="a" rightText="b" rows={[]} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} onThreeWay={onThreeWay} />);
    fireEvent.click(screen.getByText("3ウェイ…"));
    expect(onThreeWay).toHaveBeenCalledTimes(1);
    unmount();
    render(<TextCompare leftText="a" rightText="b" rows={[]} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);
    expect(screen.queryByText("3ウェイ…")).toBeNull();
  });
});
