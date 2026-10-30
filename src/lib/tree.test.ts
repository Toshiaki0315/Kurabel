import { buildTree, collapsibleDirs, hasDiff, isDirNode, isVisible } from "./tree";
import type { DirEntry } from "../types";

const e = (path: string, left: DirEntry["left"], right: DirEntry["right"], status: DirEntry["status"]): DirEntry => ({
  path, left, right, status,
});

describe("buildTree", () => {
  const entries = [
    e("a", "directory", "directory", "same"),
    e("a/b.txt", "file", "file", "modified"),
    e("c.txt", "file", null, "removed"),
  ];

  it("nests children under parents", () => {
    const tree = buildTree(entries);
    expect(tree.map((n) => n.name)).toEqual(["a", "c.txt"]);
    expect(tree[0].children[0].name).toBe("b.txt");
    expect(tree[0].children[0].path).toBe("a/b.txt");
  });

  it("treats orphan paths as roots", () => {
    expect(buildTree([e("x/y", "file", "file", "same")])).toHaveLength(1);
  });

  it("detects nested differences", () => {
    const tree = buildTree(entries);
    expect(hasDiff(tree[0])).toBe(true);
    expect(hasDiff(buildTree([e("z", "file", "file", "same")])[0])).toBe(false);
  });

  it("identifies directory nodes", () => {
    expect(isDirNode({ left: "directory", right: "directory" })).toBe(true);
    expect(isDirNode({ left: "directory", right: null })).toBe(true);
    expect(isDirNode({ left: null, right: "directory" })).toBe(true);
    expect(isDirNode({ left: "file", right: "directory" })).toBe(false);
    expect(isDirNode({ left: "file", right: "file" })).toBe(false);
  });
});

describe("isVisible / collapsibleDirs", () => {
  const tree = buildTree([
    e("sub", "directory", "directory", "same"),
    e("sub/Mod.txt", "file", "file", "modified"),
    e("sub/same.txt", "file", "file", "same"),
    e("gone.txt", "file", null, "removed"),
    e("new.txt", null, "file", "added"),
  ]);
  const [sub, gone, added] = [tree[0], tree[1], tree[2]];

  it("filters by status, keeping ancestors of matches", () => {
    expect(isVisible(sub, "all", "")).toBe(true);
    expect(isVisible(sub, "modified", "")).toBe(true); // 配下に変更あり
    expect(isVisible(sub, "removed", "")).toBe(false);
    expect(isVisible(gone, "removed", "")).toBe(true);
    expect(isVisible(gone, "added", "")).toBe(false);
    expect(isVisible(added, "diff", "")).toBe(true);
    expect(isVisible(sub.children[1], "diff", "")).toBe(false);
  });

  it("filters by name, case-insensitively", () => {
    expect(isVisible(sub, "all", "mod")).toBe(true);
    expect(isVisible(sub.children[1], "all", " MOD ")).toBe(false);
    expect(isVisible(sub.children[0], "all", "mod")).toBe(true);
    expect(isVisible(gone, "all", "mod")).toBe(false);
  });

  it("lists directories that have children", () => {
    expect(collapsibleDirs(tree)).toEqual(["sub"]);
  });
});
