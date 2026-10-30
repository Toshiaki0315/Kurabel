import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { SettingsDialog } from "./SettingsDialog";

const setup = (settings = DEFAULT_SETTINGS) => {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(<SettingsDialog settings={settings} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
};

describe("SettingsDialog", () => {
  it("reflects the current settings", () => {
    setup({ mode: "word", options: { ignore_whitespace: true, ignore_case: false } });
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
    expect(onChange).toHaveBeenLastCalledWith({ mode: "line", options: { ignore_whitespace: true, ignore_case: false } });
    fireEvent.click(screen.getByLabelText("大文字小文字の違い"));
    expect(onChange).toHaveBeenLastCalledWith({ mode: "line", options: { ignore_whitespace: false, ignore_case: true } });
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
});
