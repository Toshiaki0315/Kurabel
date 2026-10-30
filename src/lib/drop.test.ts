import { assignDropped } from "./drop";

describe("assignDropped", () => {
  const cur = { left: "/l", right: null };
  it("uses the first two paths as left/right", () => {
    expect(assignDropped(["/a", "/b", "/c"], cur, "left")).toEqual({ left: "/a", right: "/b" });
  });
  it("assigns a single path to the dropped side", () => {
    expect(assignDropped(["/a"], cur, "right")).toEqual({ left: "/l", right: "/a" });
    expect(assignDropped(["/a"], cur, "left")).toEqual({ left: "/a", right: null });
  });
  it("ignores empty drops", () => {
    expect(assignDropped([], cur, "left")).toBe(cur);
  });
});
