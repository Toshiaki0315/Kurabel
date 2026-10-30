import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { NumberedTextarea, type LineHighlight } from "./NumberedTextarea";

describe("NumberedTextarea", () => {
  it("shows one line number per line and reports changes", () => {
    const onChange = vi.fn();
    render(<NumberedTextarea label="t" value={"a\nb\nc"} onChange={onChange} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("t"), { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("redoes with Cmd/Ctrl+Y only", () => {
    const exec = vi.fn();
    document.execCommand = exec;
    render(<NumberedTextarea label="t" value="a" onChange={vi.fn()} />);
    const ta = screen.getByLabelText("t");
    fireEvent.keyDown(ta, { key: "y", metaKey: true });
    fireEvent.keyDown(ta, { key: "Y", ctrlKey: true });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledWith("redo");
    fireEvent.keyDown(ta, { key: "y" });
    fireEvent.keyDown(ta, { key: "y", metaKey: true, shiftKey: true });
    fireEvent.keyDown(ta, { key: "z", metaKey: true });
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("overlays highlights only on lines that still match the diff", () => {
    const highlights = new Map<number, LineHighlight>([
      [1, { kind: "replace", segments: [{ text: "a ", changed: false }, { text: "old", changed: true }] }],
      [2, { kind: "delete", segments: [{ text: "gone", changed: true }] }],
    ]);
    const { container } = render(<NumberedTextarea label="t" value={"a old\nedited"} onChange={vi.fn()} highlights={highlights} />);
    expect(container.querySelector(".hl-replace")).not.toBeNull();
    expect(screen.getByText("old").tagName).toBe("MARK");
    // 2行目は本文が変わっているのでハイライトしない
    expect(container.querySelector(".hl-delete")).toBeNull();
    fireEvent.scroll(screen.getByLabelText("t"), { target: { scrollTop: 5, scrollLeft: 3 } });
    expect(container.querySelector<HTMLElement>(".hl-layer")!.scrollTop).toBe(5);
  });

  it("calls onSave on Cmd/Ctrl+S and prevents the browser default", () => {
    const onSave = vi.fn();
    render(<NumberedTextarea label="t" value="a" onChange={vi.fn()} onSave={onSave} />);
    const ta = screen.getByLabelText("t");
    expect(fireEvent.keyDown(ta, { key: "s", metaKey: true })).toBe(false);
    fireEvent.keyDown(ta, { key: "S", ctrlKey: true });
    fireEvent.keyDown(ta, { key: "s" });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("ignores Cmd+S when no handler is given", () => {
    render(<NumberedTextarea label="t" value="a" onChange={vi.fn()} />);
    fireEvent.keyDown(screen.getByLabelText("t"), { key: "s", metaKey: true });
  });
});
