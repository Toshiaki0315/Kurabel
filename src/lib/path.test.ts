import { joinPath } from "./path";

describe("joinPath", () => {
  it("joins posix paths", () => {
    expect(joinPath("/a/b", "c/d.txt")).toBe("/a/b/c/d.txt");
    expect(joinPath("/a/b/", "c")).toBe("/a/b/c");
  });
  it("joins windows paths", () => {
    expect(joinPath("C:\\a", "c/d.txt")).toBe("C:\\a\\c\\d.txt");
  });
});
