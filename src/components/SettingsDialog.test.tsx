import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { DEFAULT_OPTIONS } from "../types";
import { SettingsDialog } from "./SettingsDialog";

const setup = (settings = DEFAULT_SETTINGS) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsDialog settings={settings} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
};

describe("SettingsDialog", () => {
  it("reflects the current settings", () => {
    setup({ mode: "word", options: { ...DEFAULT_OPTIONS, ignore_whitespace: true } });
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
    expect(onChange).toHaveBeenLastCalledWith({ mode: "line", options: { ...DEFAULT_OPTIONS, ignore_whitespace: true } });
    fireEvent.click(screen.getByLabelText("大文字小文字の違い"));
    expect(onChange).toHaveBeenLastCalledWith({ mode: "line", options: { ...DEFAULT_OPTIONS, ignore_case: true } });
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
});
