import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { createRef } from "react";
import { waitFor } from "@testing-library/react";
import { LINE_HEIGHT, NumberedTextarea, WINDOW_LINES, type EditorHandle, type LineHighlight } from "./NumberedTextarea";

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

  it("reports the top visible line on user scroll but not on programmatic scroll", () => {
    const onScrollLine = vi.fn();
    const ref = createRef<EditorHandle>();
    render(<NumberedTextarea ref={ref} label="t" value={"1\n2\n3\n4\n5\n6"} onChange={vi.fn()} onScrollLine={onScrollLine} />);
    const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
    fireEvent.scroll(ta, { target: { scrollTop: 36 } });
    expect(onScrollLine).toHaveBeenLastCalledWith(3);
    onScrollLine.mockClear();
    ref.current!.scrollToLine(4); // 54px
    expect(ta.scrollTop).toBe(54);
    fireEvent.scroll(ta, { target: { scrollTop: 54 } });
    expect(onScrollLine).not.toHaveBeenCalled();
    ref.current!.scrollToLine(4); // 変化なしなら何もしない
    fireEvent.scroll(ta, { target: { scrollTop: 18 } });
    expect(onScrollLine).toHaveBeenLastCalledWith(2);
  });

  describe("replaceText", () => {
    const run = (value: string, next: string, exec?: unknown) => {
      const onChange = vi.fn();
      const ref = createRef<EditorHandle>();
      document.execCommand = exec as typeof document.execCommand;
      render(<NumberedTextarea ref={ref} label="t" value={value} onChange={onChange} />);
      ref.current!.replaceText(next);
      return { onChange, ta: screen.getByLabelText("t") as HTMLTextAreaElement };
    };

    it("replaces only the changed range through insertText", () => {
      const exec = vi.fn(() => true);
      const { ta } = run("a\nX\nc", "a\nb\nc", exec);
      expect(exec).toHaveBeenCalledWith("insertText", false, "b");
      expect([ta.selectionStart, ta.selectionEnd]).toEqual([2, 3]);
    });

    it("uses delete for pure deletions", () => {
      const exec = vi.fn(() => true);
      run("a\nb\nc", "a\nc", exec);
      expect(exec).toHaveBeenCalledWith("delete");
    });

    it("falls back to onChange when execCommand is missing", () => {
      expect(run("a", "b", undefined).onChange).toHaveBeenCalledWith("b");
    });

    it("falls back to onChange when execCommand does not apply the change", () => {
      expect(run("a", "b", vi.fn(() => false)).onChange).toHaveBeenCalledWith("b");
    });
  });

  it("marks the current search hit, over a differing line too", () => {
    const highlights = new Map<number, LineHighlight>([[2, { kind: "replace", segments: [{ text: "foo bar", changed: true }] }]]);
    const { container } = render(
      <NumberedTextarea label="t" value={"x\nfoo bar"} onChange={vi.fn()} highlights={highlights} findHit={{ line: 2, start: 4, length: 3 }} />,
    );
    const hit = container.querySelector("mark.find-hit")!;
    expect(hit.textContent).toBe("bar");
    expect(container.querySelector(".hl-replace")).not.toBeNull(); // 行の背景色は保つ
    const { container: c2 } = render(<NumberedTextarea label="u" value="abc" onChange={vi.fn()} findHit={{ line: 2, start: 0, length: 1 }} />);
    expect(c2.querySelector("mark.find-hit")).toBeNull();
  });

  it("marks lines moved from elsewhere", () => {
    const highlights = new Map<number, LineHighlight>([[1, { kind: "delete", moved: true, segments: [{ text: "x", changed: true }] }]]);
    const { container } = render(<NumberedTextarea label="t" value="x" onChange={vi.fn()} highlights={highlights} />);
    expect(container.querySelector(".hl-delete.hl-moved")).not.toBeNull();
  });

  it("reports focus and the active (search target) state", () => {
    const onFocusPane = vi.fn();
    const { container, rerender } = render(<NumberedTextarea label="t" value="x" onChange={vi.fn()} onFocusPane={onFocusPane} />);
    fireEvent.focus(screen.getByLabelText("t"));
    expect(onFocusPane).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".numbered")).not.toHaveClass("active-pane");
    rerender(<NumberedTextarea label="t" value="x" onChange={vi.fn()} active />);
    expect(container.querySelector(".numbered")).toHaveClass("active-pane");
  });

  describe("very large texts", () => {
    const total = WINDOW_LINES + 1500;
    const value = Array.from({ length: total }, (_, i) => `line ${i + 1}`).join("\n");
    const gutterNumbers = (container: HTMLElement) => Array.from(container.querySelectorAll(".gutter div div div")).map((d) => d.textContent);

    it("renders only the lines around the viewport, and follows the scroll", async () => {
      const highlights = new Map<number, LineHighlight>([[2501, { kind: "replace", segments: [{ text: "line 2501", changed: true }] }]]);
      const { container } = render(<NumberedTextarea label="t" value={value} onChange={vi.fn()} highlights={highlights} findHit={{ line: 2502, start: 5, length: 4 }} />);
      const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
      Object.defineProperty(ta, "clientHeight", { value: 600, configurable: true });
      expect(gutterNumbers(container).length).toBeLessThan(200);
      expect(gutterNumbers(container)).toContain("1");
      expect(gutterNumbers(container)).not.toContain("2500");
      expect(container.querySelector(".hl-layer")!.textContent).not.toContain("line 2500");
      // 全体の高さは確保されている
      expect((container.querySelector(".gutter > div") as HTMLElement).style.height).toBe(`${total * LINE_HEIGHT}px`);
      fireEvent.scroll(ta, { target: { scrollTop: 2495 * LINE_HEIGHT } });
      await waitFor(() => expect(gutterNumbers(container)).toContain("2500"));
      expect(gutterNumbers(container)).not.toContain("1");
      expect(container.querySelector(".hl-layer .hl-replace")).not.toBeNull();
      expect(container.querySelector("mark.find-hit")!.textContent).toBe("2502");
    });

    it("keeps the window in sync when scrolled by line (search / jump)", async () => {
      const ref = createRef<EditorHandle>();
      const { container } = render(<NumberedTextarea ref={ref} label="t" value={value} onChange={vi.fn()} highlights={new Map()} />);
      ref.current!.scrollToLine(3000);
      const ta = screen.getByLabelText("t") as HTMLTextAreaElement;
      fireEvent.scroll(ta, { target: { scrollTop: ta.scrollTop } });
      await waitFor(() => expect(gutterNumbers(container)).toContain("3000"));
    });

    it("falls back to a synchronous update when animation frames are unavailable", () => {
      const raf = window.requestAnimationFrame;
      // @ts-expect-error requestAnimationFrame を無効にして、フォールバックを確認する
      window.requestAnimationFrame = undefined;
      const { container } = render(<NumberedTextarea label="t" value={value} onChange={vi.fn()} />);
      fireEvent.scroll(screen.getByLabelText("t"), { target: { scrollTop: 3000 * LINE_HEIGHT } });
      expect(gutterNumbers(container)).toContain("3001");
      window.requestAnimationFrame = raf;
    });
  });
});
