import { assignDropped } from "./drop";

describe("assignDropped", () => {
  it("uses the first two paths as left/right", () => {
    expect(assignDropped(["/a", "/b", "/c"], { left: "/l", right: null }, "left")).toEqual({ left: "/a", right: "/b" });
  });
  it("fills the empty slot first, left before right", () => {
    expect(assignDropped(["/a"], { left: null, right: null }, "right")).toEqual({ left: "/a", right: null });
    expect(assignDropped(["/b"], { left: "/a", right: null }, "left")).toEqual({ left: "/a", right: "/b" });
    expect(assignDropped(["/a"], { left: null, right: "/r" }, "right")).toEqual({ left: "/a", right: "/r" });
  });
  it("replaces the dropped side when both are filled", () => {
    const cur = { left: "/l", right: "/r" };
    expect(assignDropped(["/a"], cur, "left")).toEqual({ left: "/a", right: "/r" });
    expect(assignDropped(["/a"], cur, "right")).toEqual({ left: "/l", right: "/a" });
  });
  it("ignores empty drops", () => {
    const cur = { left: "/l", right: null };
    expect(assignDropped([], cur, "left")).toBe(cur);
  });
});
