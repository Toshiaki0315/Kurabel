import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { DiffRow } from "../types";

const diffText = vi.fn();
const saveText = vi.fn();
const makePatch = vi.fn();
const pickPatchPath = vi.fn();
const writePatch = vi.fn();
const saveReport = vi.fn();
vi.mock("../lib/saveReport", () => ({ saveReport: (...a: unknown[]) => saveReport(...a) }));
vi.mock("../api", () => ({
  makePatch: (...a: unknown[]) => makePatch(...a),
  pickPatchPath: (...a: unknown[]) => pickPatchPath(...a),
  writePatch: (...a: unknown[]) => writePatch(...a),
  diffText: (...a: unknown[]) => diffText(...a),
  saveText: (...a: unknown[]) => saveText(...a),
}));

import { DEFAULT_OPTIONS } from "../types";
import { TextCompare, VIRTUAL_ROWS } from "./TextCompare";

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
    saveReport.mockReset();
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

  describe("search and replace (focused pane only)", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
    const srows: DiffRow[] = [
      { kind: "equal", left: cell(1, "Foo one"), right: cell(1, "Foo one") },
      { kind: "replace", left: cell(2, "two foo"), right: cell(2, "two") },
    ];
    const LEFT = "Foo one\ntwo foo";
    const RIGHT = "Foo one\ntwo";
    const ssetup = () =>
      render(<TextCompare leftText={LEFT} rightText={RIGHT} rows={srows} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);
    const open = () => fireEvent.keyDown(window, { key: "f", metaKey: true });
    const value = (label: string) => (screen.getByLabelText(label) as HTMLTextAreaElement).value;

    it("searches the left pane by default, counts matches and steps through them", () => {
      const { container } = ssetup();
      expect(screen.queryByLabelText("検索")).toBeNull();
      open();
      expect(screen.getByText("対象: 左ペイン")).toBeInTheDocument();
      const input = screen.getByLabelText("検索");
      fireEvent.change(input, { target: { value: "foo" } });
      expect(screen.getByText("1 / 2")).toBeInTheDocument(); // 右ペインの "Foo one" は数えない… 左は2か所
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-left-line", "1");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.getByText("2 / 2")).toBeInTheDocument();
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-left-line", "2");
      fireEvent.click(screen.getByRole("button", { name: "次の一致" }));
      expect(screen.getByText("1 / 2")).toBeInTheDocument(); // 一巡
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      expect(screen.getByText("2 / 2")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "前の一致" }));
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
      fireEvent.keyDown(input, { key: "a" });
    });

    it("follows the pane that was clicked (view mode) or focused (edit mode)", () => {
      const { container } = ssetup();
      open();
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "foo" } });
      expect(screen.getByText("1 / 2")).toBeInTheDocument();
      fireEvent.mouseDown(container.querySelector('td[data-right-line="1"]')!);
      expect(screen.getByText("対象: 右ペイン")).toBeInTheDocument();
      expect(screen.getByText("1 / 1")).toBeInTheDocument(); // 右には "Foo one" の1か所だけ
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-right-line", "1");
      fireEvent.mouseDown(container.querySelector('td[data-left-line="1"]')!);
      expect(screen.getByText("対象: 左ペイン")).toBeInTheDocument();
      fireEvent.click(screen.getByText("編集"));
      fireEvent.focus(screen.getByLabelText("右のテキスト"));
      expect(screen.getByText("対象: 右ペイン")).toBeInTheDocument();
      expect(container.querySelectorAll(".numbered.active-pane")).toHaveLength(1);
      fireEvent.focus(screen.getByLabelText("左のテキスト"));
      expect(screen.getByText("対象: 左ペイン")).toBeInTheDocument();
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
      fireEvent.keyDown(window, { key: "Escape" });
      open();
      fireEvent.click(screen.getByRole("button", { name: "検索を閉じる" }));
      expect(screen.queryByLabelText("検索")).toBeNull();
    });

    it("marks the match inside the focused editor and survives an empty query", () => {
      const { container } = ssetup();
      fireEvent.click(screen.getByText("編集"));
      open();
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "two" } });
      expect(container.querySelector("mark.find-hit")!.textContent).toBe("two");
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "" } });
      expect(container.querySelector("mark.find-hit")).toBeNull();
    });

    it("offers replace only in edit mode", () => {
      ssetup();
      open();
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "two" } });
      expect(screen.queryByLabelText("置換後")).toBeNull();
      expect(screen.queryByText("すべて置換")).toBeNull();
      fireEvent.click(screen.getByText("編集"));
      expect(screen.getByLabelText("置換後")).toBeInTheDocument();
      fireEvent.click(screen.getByText("表示に戻る"));
      expect(screen.queryByLabelText("置換後")).toBeNull();
    });

    describe("replace", () => {
      beforeEach(installExecCommand);
      const prepare = (query: string) => {
        ssetup();
        fireEvent.click(screen.getByText("編集"));
        open();
        fireEvent.change(screen.getByLabelText("検索"), { target: { value: query } });
      };

      it("replaces the current match in the focused pane only, through insertText (undoable)", () => {
        prepare("foo");
        fireEvent.change(screen.getByLabelText("置換後"), { target: { value: "BAR" } });
        fireEvent.click(screen.getByText("置換"));
        expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "BAR");
        expect(value("左のテキスト")).toBe("BAR one\ntwo foo");
        expect(value("右のテキスト")).toBe(RIGHT); // 右は変わらない
        expect(screen.getByText("1 / 1")).toBeInTheDocument(); // 次の一致へ進む
        fireEvent.keyDown(screen.getByLabelText("置換後"), { key: "Enter" });
        expect(value("左のテキスト")).toBe("BAR one\ntwo BAR");
        expect(screen.getByText("見つかりません")).toBeInTheDocument();
        expect(screen.getByText("置換")).toBeDisabled();
      });

      it("replaces every match in the focused pane in one step", () => {
        prepare("foo");
        fireEvent.focus(screen.getByLabelText("右のテキスト"));
        fireEvent.click(screen.getByText("すべて置換")); // 置換後が空 = 削除
        expect(value("右のテキスト")).toBe(" one\ntwo");
        expect(value("左のテキスト")).toBe(LEFT);
        fireEvent.focus(screen.getByLabelText("左のテキスト"));
        fireEvent.change(screen.getByLabelText("置換後"), { target: { value: "X" } });
        fireEvent.click(screen.getByText("すべて置換"));
        expect(value("左のテキスト")).toBe("X one\ntwo X");
        expect(screen.getByText("すべて置換")).toBeDisabled();
      });

      it("does nothing when there is no match", () => {
        prepare("zzz");
        fireEvent.click(screen.getByText("置換"));
        fireEvent.click(screen.getByText("すべて置換"));
        expect(document.execCommand).not.toHaveBeenCalled();
        expect(value("左のテキスト")).toBe(LEFT);
      });
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

  it("marks moved rows in the table, the editor and the difference map", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: true }] });
    const r: DiffRow[] = [
      { kind: "equal", left: { line_no: 1, segments: [{ text: "keep", changed: false }] }, right: { line_no: 1, segments: [{ text: "keep", changed: false }] } },
      { kind: "delete", left: cell(2, "moved text"), right: null, moved: true },
      { kind: "insert", left: null, right: cell(2, "moved text"), moved: true },
    ];
    const { container } = render(<TextCompare leftText={"keep\nmoved text"} rightText={"keep\nmoved text"} rows={r} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);
    expect(container.querySelectorAll("tr.row-moved")).toHaveLength(2);
    expect(container.querySelector("tr.row-moved")).toHaveAttribute("title", "別の場所から移動した行");
    expect(container.querySelector(".hl-moved")).not.toBeNull();
    expect(container.querySelector(".ov-moved")).not.toBeNull();
  });

  describe("very large diffs", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
    const N = VIRTUAL_ROWS + 800;
    const many: DiffRow[] = Array.from({ length: N }, (_, i) =>
      i === 2500
        ? { kind: "replace", left: cell(i + 1, `row ${i + 1}`), right: cell(i + 1, `row ${i + 1} edited`) }
        : { kind: "equal", left: cell(i + 1, `row ${i + 1}`), right: cell(i + 1, `row ${i + 1}`) },
    );
    const text = many.map((r) => r.left!.segments[0].text).join("\n");
    // jsdom は常に位置 0 を返すので、表の位置が親のスクロールに連動するようにする（実際のブラウザと同じ挙動）
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const scrolled = this.tagName === "TABLE" ? (this.closest("main") as HTMLElement | null)?.scrollTop ?? 0 : 0;
        return { top: -scrolled, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: -scrolled, toJSON: () => ({}) };
      });
    });
    afterEach(() => vi.restoreAllMocks());
    const setup = () => {
      const view = render(
        <main>
          <TextCompare leftText={text} rightText={text} rows={many} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />
        </main>,
      );
      const main = view.container.querySelector("main") as HTMLElement;
      Object.defineProperty(main, "clientHeight", { value: 600, configurable: true });
      return { ...view, main };
    };
    const bodyRows = (c: HTMLElement) => c.querySelectorAll("table.diff-table tbody tr:not([aria-hidden])").length;
    const tableText = (c: HTMLElement) => c.querySelector("table.diff-table")!.textContent!;

    it("renders only the rows around the viewport and follows the scroll", async () => {
      const { container, main } = setup();
      expect(container.querySelector("table.diff-table")).toHaveClass("virtual");
      expect(bodyRows(container)).toBeLessThan(250);
      expect(tableText(container)).toContain("row 1");
      expect(tableText(container)).not.toContain("row 3000 ");
      fireEvent.scroll(main, { target: { scrollTop: 1500 * 18 } });
      await waitFor(() => expect(tableText(container)).toContain("row 1501"));
      expect(tableText(container)).not.toContain("row 1 ");
      // 上下は、描画しない行の高さぶんの空白で埋める
      const spacers = container.querySelectorAll('tr[aria-hidden="true"]');
      expect(spacers.length).toBe(2);
      expect((spacers[0] as HTMLElement).style.height).toBe(`${(1500 - 40) * 18}px`);
      fireEvent.scroll(main, { target: { scrollTop: 0 } });
      await waitFor(() => expect(container.querySelectorAll('tr[aria-hidden="true"]').length).toBe(1));
    });

    it("jumps to a far-away difference by scrolling the container", async () => {
      const { container, main } = setup();
      fireEvent.click(screen.getByRole("button", { name: "次の差分" }));
      expect(main.scrollTop).toBe(2500 * 18 - 300);
      fireEvent.scroll(main);
      await waitFor(() => expect(tableText(container)).toContain("row 2501 edited"));
    });

    it("scrolls to a search hit that is not currently rendered", () => {
      const { main } = setup();
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "row 2400" } });
      expect(main.scrollTop).toBe(2399 * 18 - 300);
    });

    it("stops listening for scroll when it unmounts", () => {
      const { unmount, main } = setup();
      const remove = vi.spyOn(main, "removeEventListener");
      unmount();
      expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    });

    it("renders everything for a small diff and does not wait for animation frames when they are unavailable", () => {
      const small = many.slice(0, 50);
      const { container } = render(<TextCompare leftText="a" rightText="a" rows={small} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);
      expect(container.querySelector("table.diff-table")).not.toHaveClass("virtual");
      expect(container.querySelectorAll("table.diff-table tbody tr")).toHaveLength(50);
    });
  });

  describe("report export", () => {
    it("saves an HTML report of the current comparison and confirms", async () => {
      saveReport.mockResolvedValue(true);
      setup();
      fireEvent.click(screen.getByText("レポートを保存…"));
      expect(await screen.findByText("レポートを保存しました")).toBeInTheDocument();
      const [html, name] = saveReport.mock.calls[0];
      expect(html).toContain("/l.txt");
      expect(html).toContain("<mark>old</mark>");
      expect(name).toBe("l.txt.html");
    });

    it("does nothing visible when cancelled, and shows an error when saving fails", async () => {
      saveReport.mockResolvedValueOnce(false);
      setup();
      fireEvent.click(screen.getByText("レポートを保存…"));
      await waitFor(() => expect(saveReport).toHaveBeenCalled());
      expect(screen.queryByText("レポートを保存しました")).toBeNull();
      saveReport.mockRejectedValueOnce(new Error("書き込めません"));
      fireEvent.click(screen.getByText("レポートを保存…"));
      expect(await screen.findByRole("alert")).toHaveTextContent("書き込めません");
    });

    it("is not offered for a single opened file", () => {
      render(<TextCompare leftText="a" rightText="" rows={[]} mode="line" options={OPTS} leftPath="/l" rightPath={null} leftEncoding={UTF8} rightEncoding={UTF8} />);
      expect(screen.queryByText("レポートを保存…")).toBeNull();
    });
  });

  describe("syntax highlighting and whitespace markers", () => {
    const seg = (text: string, changed = false) => ({ text, changed });
    const rowsJs: DiffRow[] = [
      { kind: "equal", left: { line_no: 1, segments: [seg("const x = 1;")] }, right: { line_no: 1, segments: [seg("const x = 1;")] } },
      { kind: "replace", left: { line_no: 2, segments: [seg("\tlet  y = "), seg("2", true)] }, right: { line_no: 2, segments: [seg("\tlet  y = "), seg("3", true)] } },
    ];
    const TEXT_L = "const x = 1;\n\tlet  y = 2";
    const TEXT_R = "const x = 1;\n\tlet  y = 3";
    const mk = (props: Partial<React.ComponentProps<typeof TextCompare>> = {}) =>
      render(<TextCompare leftText={TEXT_L} rightText={TEXT_R} rows={rowsJs} mode="line" options={OPTS} leftPath="/src/app.js" rightPath="/src/app2.js" leftEncoding={UTF8} rightEncoding={UTF8} {...props} />);
    const table = (c: HTMLElement) => c.querySelector("table.diff-table")!;

    it("colors tokens from the file extension, on both sides, keeping the diff highlight", () => {
      const { container } = mk();
      const keywords = table(container).querySelectorAll(".tok-keyword");
      expect(Array.from(keywords).map((k) => k.textContent)).toEqual(["const", "const", "let", "let"]);
      expect(table(container).querySelector("mark.chg")!.textContent).toBe("2");
      expect(table(container).querySelector(".tok-number")).not.toBeNull();
    });

    it("can be turned off, and is skipped for unknown extensions", () => {
      expect(table(mk({ syntax: false }).container).querySelector("[class^=tok-]")).toBeNull();
      const { container } = mk({ leftPath: "/notes.txt", rightPath: "/notes2.txt" });
      expect(table(container).querySelector("[class^=tok-]")).toBeNull();
    });

    it("uses the language of the name given for archive entries", () => {
      const { container } = mk({ leftPath: "/a.zip", rightPath: "/b.zip", languagePath: "src/app.js", readOnly: true });
      expect(table(container).querySelector(".tok-keyword")).not.toBeNull();
    });

    it("does not color a row whose text no longer matches the current text (before the re-diff)", () => {
      const { container } = mk({ leftText: "const x = 1;\nCHANGED" });
      const left = table(container).querySelectorAll("tr")[1].querySelector("td.left")!;
      expect(left.querySelector(".tok-keyword")).toBeNull();
      expect(table(container).querySelectorAll("tr")[0].querySelector("td.left .tok-keyword")).not.toBeNull();
    });

    it("shows whitespace and end-of-line markers in the table and in the editor overlay", () => {
      const { container } = mk({ showWhitespace: true });
      expect(table(container).querySelectorAll(".ws.eol")).toHaveLength(4);
      expect(table(container).querySelector(".ws.tab")).not.toBeNull();
      expect(table(container).textContent).toContain("··");
      expect(container.querySelector(".hl-layer .ws")).not.toBeNull();
    });

    it("shows no markers by default", () => {
      expect(table(mk().container).querySelector(".ws")).toBeNull();
    });

    it("handles CRLF text: the editor overlay still highlights the differing line", () => {
      const { container } = mk({ leftText: TEXT_L.replace(/\n/g, "\r\n"), rightText: TEXT_R.replace(/\n/g, "\r\n") });
      fireEvent.click(screen.getByText("編集"));
      expect(container.querySelector(".hl-replace")).not.toBeNull();
    });
  });

  describe("go to line", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
    const grows: DiffRow[] = Array.from({ length: 30 }, (_, i) => ({ kind: "equal" as const, left: cell(i + 1, `L${i + 1}`), right: cell(i + 1, `R${i + 1}`) }));
    const LT = grows.map((r) => r.left!.segments[0].text).join("\n");
    const RT = grows.map((r) => r.right!.segments[0].text).join("\n");
    const gsetup = () => render(<TextCompare leftText={LT} rightText={RT} rows={grows} mode="line" options={OPTS} leftPath="/l" rightPath="/r" leftEncoding={UTF8} rightEncoding={UTF8} />);
    const open = () => fireEvent.keyDown(window, { key: "g", metaKey: true });

    it("opens with Cmd/Ctrl+G or the button, marks the line on the focused pane, and clamps the number", () => {
      const { container } = gsetup();
      expect(screen.queryByLabelText("行番号")).toBeNull();
      open();
      expect(screen.getByText("対象: 左ペイン（1〜30 行）")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("行番号"), { target: { value: "12" } });
      fireEvent.keyDown(screen.getByLabelText("行番号"), { key: "Enter" });
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-left-line", "12");
      fireEvent.change(screen.getByLabelText("行番号"), { target: { value: "999" } });
      fireEvent.click(screen.getByText("移動"));
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-left-line", "30");
      fireEvent.change(screen.getByLabelText("行番号"), { target: { value: "-5" } });
      fireEvent.keyDown(screen.getByLabelText("行番号"), { key: "Enter" });
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-left-line", "1");
      fireEvent.keyDown(screen.getByLabelText("行番号"), { key: "a" });
    });

    it("ignores an empty or non-numeric entry, and follows the clicked pane", () => {
      const { container } = gsetup();
      fireEvent.click(screen.getByText("行へ移動"));
      fireEvent.click(screen.getByText("移動"));
      expect(container.querySelector("td.find-hit-cell")).toBeNull();
      fireEvent.mouseDown(container.querySelector('td[data-right-line="3"]')!);
      expect(screen.getByText("対象: 右ペイン（1〜30 行）")).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("行番号"), { target: { value: "7" } });
      fireEvent.click(screen.getByText("移動"));
      expect(container.querySelector("td.find-hit-cell")).toHaveAttribute("data-right-line", "7");
    });

    it("closes with Escape or the button and clears the marker", () => {
      const { container } = gsetup();
      open();
      fireEvent.change(screen.getByLabelText("行番号"), { target: { value: "4" } });
      fireEvent.click(screen.getByText("移動"));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByLabelText("行番号")).toBeNull();
      expect(container.querySelector("td.find-hit-cell")).toBeNull();
      open();
      fireEvent.click(screen.getByRole("button", { name: "行移動を閉じる" }));
      expect(screen.queryByLabelText("行番号")).toBeNull();
    });

    it("marks the whole line in the focused editor in edit mode", () => {
      const { container } = gsetup();
      fireEvent.click(screen.getByText("編集"));
      fireEvent.focus(screen.getByLabelText("右のテキスト"));
      open();
      fireEvent.change(screen.getByLabelText("行番号"), { target: { value: "5" } });
      fireEvent.click(screen.getByText("移動"));
      expect(container.querySelector("mark.find-hit")!.textContent).toBe("R5");
    });

    it("is not available for a single opened file", () => {
      render(<TextCompare leftText="a" rightText="" rows={[]} mode="line" options={OPTS} leftPath="/l" rightPath={null} leftEncoding={UTF8} rightEncoding={UTF8} />);
      fireEvent.keyDown(window, { key: "g", ctrlKey: true });
      expect(screen.queryByLabelText("行番号")).toBeNull();
    });
  });

  describe("read-only (archive entries)", () => {
    const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: true }] });
    const r: DiffRow[] = [{ kind: "replace", left: cell(1, "a"), right: cell(1, "b") }];
    const ro = () => render(<TextCompare leftText="a" rightText="b" rows={r} mode="line" options={OPTS} leftPath="/a.zip" rightPath="/b.zip" leftEncoding={UTF8} rightEncoding={UTF8} readOnly />);

    it("has no editing, saving or merge controls, but keeps navigation, patch and report", () => {
      ro();
      for (const label of ["編集", "保存", "3ウェイ…"]) expect(screen.queryByText(label)).toBeNull();
      expect(screen.queryByRole("button", { name: "差分1を左から右へ反映" })).toBeNull();
      expect(screen.queryByRole("button", { name: "左を保存" })).toBeNull();
      expect(screen.getByRole("button", { name: "次の差分" })).toBeInTheDocument();
      expect(screen.getByText("パッチを保存…")).toBeInTheDocument();
      expect(screen.getByText("レポートを保存…")).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      fireEvent.change(screen.getByLabelText("検索"), { target: { value: "a" } });
      expect(screen.queryByLabelText("置換後")).toBeNull(); // 置換は編集モードのときだけ
    });
  });
});
