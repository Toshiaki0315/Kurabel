import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { NumberedTextarea } from "./NumberedTextarea";

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
});
