import { applyBlock, blockLines, correspondingLine, findBlocks } from "./merge";
import type { DiffRow, RowKind } from "../types";

const cell = (n: number, text: string) => ({ line_no: n, segments: [{ text, changed: false }] });
function row(kind: RowKind, l?: [number, string], r?: [number, string]): DiffRow {
  return { kind, left: l ? cell(...l) : null, right: r ? cell(...r) : null };
}

// left: a b c d   right: a X d e
const rows: DiffRow[] = [
  row("equal", [1, "a"], [1, "a"]),
  row("replace", [2, "b"], [2, "X"]),
  row("delete", [3, "c"]),
  row("equal", [4, "d"], [3, "d"]),
  row("insert", undefined, [4, "e"]),
];
const L = "a\nb\nc\nd";
const R = "a\nX\nd\ne";

describe("findBlocks", () => {
  it("groups contiguous differing rows", () => {
    expect(findBlocks(rows)).toEqual([{ start: 1, end: 3 }, { start: 4, end: 5 }]);
    expect(findBlocks([row("equal", [1, "a"], [1, "a"])])).toEqual([]);
    expect(findBlocks([])).toEqual([]);
  });
});

describe("applyBlock", () => {
  it("copies a replaced block left to right", () => {
    expect(applyBlock(rows, { start: 1, end: 3 }, "left", L, R)).toEqual({ leftText: L, rightText: "a\nb\nc\nd\ne" });
  });
  it("copies a replaced block right to left", () => {
    expect(applyBlock(rows, { start: 1, end: 3 }, "right", L, R)).toEqual({ leftText: "a\nX\nd", rightText: R });
  });
  it("removes lines when the source side has none (pure insert)", () => {
    expect(applyBlock(rows, { start: 4, end: 5 }, "left", L, R)).toEqual({ leftText: L, rightText: "a\nX\nd" });
  });
  it("inserts after the previous corresponding line (pure insert to the other side)", () => {
    expect(applyBlock(rows, { start: 4, end: 5 }, "right", L, R)).toEqual({ leftText: "a\nb\nc\nd\ne", rightText: R });
  });
  it("inserts at the top when there is no previous corresponding line", () => {
    const r: DiffRow[] = [row("insert", undefined, [1, "new"]), row("equal", [1, "a"], [2, "a"])];
    expect(applyBlock(r, { start: 0, end: 1 }, "right", "a", "new\na")).toEqual({ leftText: "new\na", rightText: "new\na" });
  });
  it("keeps the destination's CRLF line endings", () => {
    const r: DiffRow[] = [row("replace", [1, "x"], [1, "y"])];
    expect(applyBlock(r, { start: 0, end: 1 }, "left", "x\n", "y\r\nz\r\n")).toEqual({ leftText: "x\n", rightText: "x\r\nz\r\n" });
  });
  it("tolerates a missing source line", () => {
    const r: DiffRow[] = [row("replace", [5, "?"], [1, "y"])];
    expect(applyBlock(r, { start: 0, end: 1 }, "left", "x", "y").rightText).toBe("");
  });
});

describe("line mapping", () => {
  it("maps lines across panes", () => {
    expect(correspondingLine(rows, "left", 2)).toBe(2);
    expect(correspondingLine(rows, "left", 3)).toBe(2); // 右に対応行なし → 直前
    expect(correspondingLine(rows, "right", 4)).toBe(4);
    expect(correspondingLine(rows, "left", 99)).toBe(99);
    expect(correspondingLine([row("delete", [1, "a"])], "left", 1)).toBe(1);
  });
  it("gives the first lines of a block on both sides", () => {
    expect(blockLines(rows, { start: 1, end: 3 })).toEqual({ left: 2, right: 2 });
    expect(blockLines(rows, { start: 4, end: 5 })).toEqual({ left: 4, right: 4 });
    expect(blockLines(rows, { start: 2, end: 3 })).toEqual({ left: 3, right: 2 });
  });
});
