import { vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => open(...a) }));

import { comparePaths, diffText, pickPath } from "./api";

describe("api", () => {
  it("invokes compare_paths", async () => {
    invoke.mockResolvedValue({ kind: "directory", entries: [] });
    await comparePaths("/a", "/b", "line");
    expect(invoke).toHaveBeenCalledWith("compare_paths", { left: "/a", right: "/b", mode: "line" });
  });

  it("invokes diff_text", async () => {
    invoke.mockResolvedValue([]);
    await diffText("a", "b", "word");
    expect(invoke).toHaveBeenCalledWith("diff_text", { left: "a", right: "b", mode: "word" });
  });

  it("returns the selected path, or null when cancelled", async () => {
    open.mockResolvedValueOnce("/x");
    expect(await pickPath(true)).toBe("/x");
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
    open.mockResolvedValueOnce(null);
    expect(await pickPath(false)).toBeNull();
  });
});
