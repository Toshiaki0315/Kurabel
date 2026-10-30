import type { MergeChunk } from "../types";
import { buildResult, conflictIndexes, resultLines, unresolvedCount } from "./merge3";

const chunks: MergeChunk[] = [
  { kind: "stable", lines: ["a"] },
  { kind: "left", base: ["b"], left: ["B"] },
  { kind: "conflict", base: ["c"], left: ["L"], right: ["R"] },
  { kind: "right", base: ["d"], right: ["D"] },
  { kind: "same", base: ["e"], lines: ["E"] },
  { kind: "conflict", base: [], left: [], right: ["new"] },
];

describe("merge3 helpers", () => {
  it("finds conflicts and counts unresolved ones", () => {
    expect(conflictIndexes(chunks)).toEqual([2, 5]);
    expect(unresolvedCount(chunks, {})).toBe(2);
    expect(unresolvedCount(chunks, { 2: "left" })).toBe(1);
    expect(unresolvedCount(chunks, { 2: "left", 5: "base" })).toBe(0);
  });

  it("takes auto-merged chunks as they are", () => {
    expect(resultLines(chunks[0])).toEqual(["a"]);
    expect(resultLines(chunks[1])).toEqual(["B"]);
    expect(resultLines(chunks[3])).toEqual(["D"]);
    expect(resultLines(chunks[4])).toEqual(["E"]);
  });

  it("applies each way of resolving a conflict", () => {
    const c = chunks[2];
    expect(resultLines(c, "left")).toEqual(["L"]);
    expect(resultLines(c, "base")).toEqual(["c"]);
    expect(resultLines(c, "right")).toEqual(["R"]);
    expect(resultLines(c, "leftright")).toEqual(["L", "R"]);
    expect(resultLines(c, "rightleft")).toEqual(["R", "L"]);
  });

  it("keeps an unresolved conflict between markers", () => {
    expect(resultLines(chunks[2])).toEqual(["<<<<<<< 左", "L", "=======", "R", ">>>>>>> 右"]);
  });

  it("builds the result with the given line ending and trailing newline", () => {
    const r = buildResult(chunks, { 2: "left", 5: "right" }, "\r\n", true);
    expect(r).toBe("a\r\nB\r\nL\r\nD\r\nE\r\nnew\r\n");
    expect(buildResult(chunks.slice(0, 2), {}, "\n", false)).toBe("a\nB");
    expect(buildResult([], {}, "\n", true)).toBe("");
    expect(buildResult([{ kind: "conflict", base: ["x"], left: [], right: [] }], { 0: "left" }, "\n", true)).toBe("");
  });
});
