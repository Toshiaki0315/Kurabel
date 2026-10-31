import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { DEFAULT_OPTIONS } from "../types";
const checkRegex = vi.fn();
vi.mock("../api", () => ({ checkRegex: (...a: unknown[]) => checkRegex(...a) }));

import { SettingsDialog } from "./SettingsDialog";

const setup = (settings = DEFAULT_SETTINGS) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsDialog settings={settings} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
};

describe("SettingsDialog", () => {
  it("reflects the current settings", () => {
    setup({ ...DEFAULT_SETTINGS, mode: "word", options: { ...DEFAULT_OPTIONS, ignore_whitespace: true } });
    expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
    expect(screen.getByLabelText("単語単位")).toBeChecked();
    expect(screen.getByLabelText("行単位")).not.toBeChecked();
    expect(screen.getByLabelText("空白の違い")).toBeChecked();
    expect(screen.getByLabelText("大文字小文字の違い")).not.toBeChecked();
  });

  it("reports each change immediately", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText("単語単位"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, mode: "word" });
    fireEvent.click(screen.getByLabelText("空白の違い"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, ignore_whitespace: true } });
    fireEvent.click(screen.getByLabelText("大文字小文字の違い"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, ignore_case: true } });
  });

  it("closes with the button, Escape or a click on the backdrop, but not on the dialog itself", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByText("閉じる"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("edits the folder-compare settings", () => {
    const { onChange } = setup({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, exclude: [".git"] } });
    const box = screen.getByLabelText("除外パターン") as HTMLTextAreaElement;
    expect(box.value).toBe(".git");
    fireEvent.change(box, { target: { value: ".git\n *.obj ,\n\nnode_modules" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, exclude: [".git", "*.obj", "node_modules"] } });
    expect(box.value).toBe(".git\n *.obj ,\n\nnode_modules"); // 入力中の文字列はそのまま保つ
    fireEvent.click(screen.getByLabelText("サブフォルダを含める"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, exclude: [".git"], recursive: false } });
    fireEvent.change(screen.getByLabelText("フォルダの比較方法"), { target: { value: "quick" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, exclude: [".git"], quick: true } });
    fireEvent.change(screen.getByLabelText("フォルダの比較方法"), { target: { value: "content" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, exclude: [".git"], quick: false } });
  });

  it("edits blank-line, comment and move-detection settings", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText("空行の追加・削除"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, ignore_blank_lines: true } });
    const prefixes = screen.getByLabelText("コメントの開始文字列") as HTMLInputElement;
    expect(prefixes).toBeDisabled(); // コメントを無視しない間は編集できない
    expect(prefixes.value).toBe("//, #");
    fireEvent.click(screen.getByLabelText("コメントの違い"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, ignore_comments: true } });
    fireEvent.click(screen.getByLabelText("移動した行を検出して印を付ける"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, detect_moves: false } });
  });

  it("parses the comment prefixes while keeping what was typed", () => {
    const { onChange } = setup({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, ignore_comments: true } });
    const prefixes = screen.getByLabelText("コメントの開始文字列") as HTMLInputElement;
    expect(prefixes).toBeEnabled();
    fireEvent.change(prefixes, { target: { value: "--, ; ,rem " } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      options: { ...DEFAULT_OPTIONS, ignore_comments: true, comment_prefixes: ["--", ";", "rem"] },
    });
    expect(prefixes.value).toBe("--, ; ,rem ");
  });

  describe("line-ignore patterns (regular expressions)", () => {
    beforeEach(() => checkRegex.mockReset());

    it("keeps commas and spaces, one pattern per line, and validates each with the backend", async () => {
      checkRegex.mockResolvedValue(undefined);
      const { onChange } = setup({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_OPTIONS, ignore_line_patterns: ["^#"] } });
      const box = screen.getByLabelText("無視する行のパターン") as HTMLTextAreaElement;
      expect(box.value).toBe("^#");
      fireEvent.change(box, { target: { value: "^#\nLast, updated: \\d+" } });
      expect(onChange).toHaveBeenLastCalledWith({
        ...DEFAULT_SETTINGS,
        options: { ...DEFAULT_OPTIONS, ignore_line_patterns: ["^#", "Last, updated: \\d+"] },
      });
      await waitFor(() => expect(checkRegex).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("lists the invalid patterns with the reason", async () => {
      checkRegex.mockImplementation((p: string) => (p === "(" ? Promise.reject("unclosed group") : Promise.resolve()));
      setup();
      fireEvent.change(screen.getByLabelText("無視する行のパターン"), { target: { value: "ok\n(" } });
      expect(await screen.findByRole("alert")).toHaveTextContent("無効な正規表現 — (: unclosed group");
      fireEvent.change(screen.getByLabelText("無視する行のパターン"), { target: { value: "ok" } });
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    });

    it("ignores a stale validation result that arrives after a newer one", async () => {
      let rejectFirst: (e: string) => void = () => {};
      checkRegex.mockImplementationOnce(() => new Promise((_, reject) => (rejectFirst = reject)));
      checkRegex.mockResolvedValue(undefined);
      setup();
      const box = screen.getByLabelText("無視する行のパターン");
      fireEvent.change(box, { target: { value: "(" } });
      fireEvent.change(box, { target: { value: "ok" } });
      await waitFor(() => expect(checkRegex).toHaveBeenCalledTimes(2));
      rejectFirst("late failure");
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("toggles whitespace markers and syntax highlighting", () => {
    const { onChange } = setup();
    expect(screen.getByLabelText("シンタックスハイライト（ファイルの拡張子から判定）")).toBeChecked();
    expect(screen.getByLabelText("空白・タブ・改行を記号で表示する")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("空白・タブ・改行を記号で表示する"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, showWhitespace: true });
    fireEvent.click(screen.getByLabelText("シンタックスハイライト（ファイルの拡張子から判定）"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, syntax: false });
  });
});
