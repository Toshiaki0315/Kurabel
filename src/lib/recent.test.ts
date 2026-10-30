import { addRecent, baseName, loadRecent, MAX_RECENT } from "./recent";

describe("recent", () => {
  beforeEach(() => localStorage.clear());

  it("adds to the front, de-duplicates, caps the list and persists", () => {
    let list = addRecent([], { left: "/a", right: "/b" });
    list = addRecent(list, { left: "/c", right: "/d" });
    list = addRecent(list, { left: "/a", right: "/b" });
    expect(list).toEqual([{ left: "/a", right: "/b" }, { left: "/c", right: "/d" }]);
    expect(loadRecent()).toEqual(list);
    for (let i = 0; i < MAX_RECENT + 3; i++) list = addRecent(list, { left: `/l${i}`, right: "/r" });
    expect(list).toHaveLength(MAX_RECENT);
  });

  it("returns an empty list for missing or corrupt data", () => {
    expect(loadRecent()).toEqual([]);
    localStorage.setItem("kurabel.recent", "not json");
    expect(loadRecent()).toEqual([]);
    localStorage.setItem("kurabel.recent", '{"a":1}');
    expect(loadRecent()).toEqual([]);
    localStorage.setItem("kurabel.recent", JSON.stringify([{ left: "/a", right: "/b" }, { left: 1 }, null]));
    expect(loadRecent()).toEqual([{ left: "/a", right: "/b" }]);
  });

  it("still returns the list when storage is unavailable", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(addRecent([], { left: "/a", right: "/b" })).toHaveLength(1);
    spy.mockRestore();
  });

  it("extracts base names", () => {
    expect(baseName("/a/b/c.txt")).toBe("c.txt");
    expect(baseName("C:\\x\\y.md")).toBe("y.md");
    expect(baseName("/")).toBe("/");
  });
});
