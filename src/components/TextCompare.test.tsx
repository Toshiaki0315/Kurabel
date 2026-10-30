import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { DiffRow } from "../types";

const diffText = vi.fn();
vi.mock("../api", () => ({ diffText: (...a: unknown[]) => diffText(...a) }));

import { TextCompare } from "./TextCompare";

const seg = (text: string, changed = false) => ({ text, changed });
const rows: DiffRow[] = [
  { kind: "equal", left: { line_no: 1, segments: [seg("same")] }, right: { line_no: 1, segments: [seg("same")] } },
  { kind: "replace", left: { line_no: 2, segments: [seg("a ", false), seg("old", true)] }, right: { line_no: 2, segments: [seg("a ", false), seg("new", true)] } },
];

const setup = (mode: "line" | "word" = "line") =>
  render(<TextCompare leftText={"same\na old"} rightText={"same\na new"} rows={rows} mode={mode} />);

describe("TextCompare", () => {
  beforeEach(() => {
    diffText.mockReset();
  });

  it("renders line numbers, text, highlights and the diff count", () => {
    setup();
    expect(screen.getByText("old").tagName).toBe("MARK");
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText("差分 1 行")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2);
  });

  it("edits text and re-diffs with the edited content", async () => {
    diffText.mockResolvedValue([]);
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.change(screen.getByLabelText("左のテキスト"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("右のテキスト"), { target: { value: "y" } });
    fireEvent.click(screen.getByText("再比較"));
    await waitFor(() => expect(diffText).toHaveBeenCalledWith("x", "y", "line"));
    await waitFor(() => expect(screen.getByText("差分 0 行")).toBeInTheDocument());
    expect(screen.queryByLabelText("左のテキスト")).toBeNull();
  });

  it("toggles back to the view without re-diffing", () => {
    setup();
    fireEvent.click(screen.getByText("編集"));
    fireEvent.click(screen.getByText("表示に戻る"));
    expect(screen.getByText("old")).toBeInTheDocument();
    expect(diffText).not.toHaveBeenCalled();
  });

  it("re-diffs when the highlight mode changes", async () => {
    diffText.mockResolvedValue(rows);
    const { rerender } = setup("line");
    expect(diffText).not.toHaveBeenCalled();
    rerender(<TextCompare leftText={"same\na old"} rightText={"same\na new"} rows={rows} mode="word" />);
    await waitFor(() => expect(diffText).toHaveBeenCalledWith("same\na old", "same\na new", "word"));
  });

  it("shows an error when re-diff fails", async () => {
    diffText.mockImplementation(() => Promise.reject(new Error("boom")));
    setup();
    fireEvent.click(screen.getByText("再比較"));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});
