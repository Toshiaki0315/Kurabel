import { vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
const confirm = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => open(...a),
  confirm: (...a: unknown[]) => confirm(...a),
}));

import { comparePaths, confirmDiscard, diffText, pathKind, pickPath, saveText } from "./api";
import { DEFAULT_OPTIONS } from "./types";

describe("api", () => {
  it("invokes compare_paths", async () => {
    invoke.mockResolvedValue({ kind: "directory", entries: [] });
    await comparePaths("/a", "/b", "line", DEFAULT_OPTIONS);
    expect(invoke).toHaveBeenCalledWith("compare_paths", { left: "/a", right: "/b", mode: "line", options: DEFAULT_OPTIONS });
  });

  it("invokes diff_text", async () => {
    invoke.mockResolvedValue([]);
    await diffText("a", "b", "word", DEFAULT_OPTIONS);
    expect(invoke).toHaveBeenCalledWith("diff_text", { left: "a", right: "b", mode: "word", options: DEFAULT_OPTIONS });
  });

  it("invokes path_kind", async () => {
    invoke.mockResolvedValue("file");
    expect(await pathKind("/x")).toBe("file");
    expect(invoke).toHaveBeenCalledWith("path_kind", { path: "/x" });
  });

  it("invokes save_text", async () => {
    invoke.mockResolvedValue(undefined);
    const encoding = { name: "Shift_JIS", bom: false };
    await saveText("/x", "body", encoding);
    expect(invoke).toHaveBeenCalledWith("save_text", { path: "/x", content: "body", encoding });
  });

  it("returns the selected path, or null when cancelled", async () => {
    open.mockResolvedValueOnce("/x");
    expect(await pickPath(true)).toBe("/x");
    expect(open).toHaveBeenCalledWith({ directory: true, multiple: false });
    open.mockResolvedValueOnce(null);
    expect(await pickPath(false)).toBeNull();
  });

  it("asks for confirmation before discarding", async () => {
    confirm.mockResolvedValue(true);
    expect(await confirmDiscard()).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("未保存"), expect.objectContaining({ kind: "warning" }));
  });
});
