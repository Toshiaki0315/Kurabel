import { vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
const confirm = vi.fn();
const save = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => open(...a),
  confirm: (...a: unknown[]) => confirm(...a),
  save: (...a: unknown[]) => save(...a),
}));

import {
  comparePaths,
  confirmAction,
  confirmDiscard,
  copyEntry,
  createText,
  deleteEntry,
  diffText,
  initialPaths,
  makePatch,
  merge3Files,
  pathKind,
  pickPatchPath,
  pickPath,
  pickSavePath,
  saveText,
  writePatch,
} from "./api";
import { AUTO_ENCODING, DEFAULT_OPTIONS } from "./types";

describe("api", () => {
  it("invokes compare_paths", async () => {
    invoke.mockResolvedValue({ kind: "directory", entries: [] });
    await comparePaths("/a", "/b", "line", DEFAULT_OPTIONS);
    expect(invoke).toHaveBeenCalledWith("compare_paths", { left: "/a", right: "/b", mode: "line", options: DEFAULT_OPTIONS, encodings: AUTO_ENCODING });
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

  it("passes manual encodings and supports a single side", async () => {
    invoke.mockResolvedValue({});
    const encodings = { left: "Shift_JIS", right: null };
    await comparePaths("/a", null, "word", DEFAULT_OPTIONS, encodings);
    expect(invoke).toHaveBeenCalledWith("compare_paths", { left: "/a", right: null, mode: "word", options: DEFAULT_OPTIONS, encodings });
  });

  it("wraps the folder, patch and startup commands", async () => {
    invoke.mockResolvedValue(["/x"]);
    expect(await initialPaths()).toEqual(["/x"]);
    expect(invoke).toHaveBeenLastCalledWith("initial_paths");
    await copyEntry("/s", "/d", "a/b");
    expect(invoke).toHaveBeenLastCalledWith("copy_entry", { srcRoot: "/s", dstRoot: "/d", rel: "a/b" });
    await deleteEntry("/r", "a");
    expect(invoke).toHaveBeenLastCalledWith("delete_entry", { root: "/r", rel: "a" });
    await makePatch("l", "r", "L", "R");
    expect(invoke).toHaveBeenLastCalledWith("make_patch", { leftText: "l", rightText: "r", leftLabel: "L", rightLabel: "R" });
    await writePatch("/p.patch", "body");
    expect(invoke).toHaveBeenLastCalledWith("write_patch", { path: "/p.patch", content: "body" });
  });

  it("asks where to save a patch and for confirmation of irreversible actions", async () => {
    save.mockResolvedValue("/out.patch");
    expect(await pickPatchPath("a.patch")).toBe("/out.patch");
    expect(save).toHaveBeenCalledWith({ defaultPath: "a.patch", filters: [{ name: "パッチ", extensions: ["patch", "diff", "txt"] }] });
    confirm.mockResolvedValue(true);
    expect(await confirmAction("削除しますか？", "削除")).toBe(true);
    expect(confirm).toHaveBeenLastCalledWith("削除しますか？", expect.objectContaining({ okLabel: "削除", cancelLabel: "キャンセル" }));
  });

  it("wraps merge3 / create_text and the plain save dialog", async () => {
    invoke.mockResolvedValue({});
    await merge3Files("/b", "/l", "/r");
    expect(invoke).toHaveBeenLastCalledWith("merge3", { base: "/b", left: "/l", right: "/r" });
    const encoding = { name: "UTF-8", bom: false };
    await createText("/n.txt", "x", encoding);
    expect(invoke).toHaveBeenLastCalledWith("create_text", { path: "/n.txt", content: "x", encoding });
    save.mockResolvedValue("/chosen");
    expect(await pickSavePath("a.txt")).toBe("/chosen");
    expect(save).toHaveBeenLastCalledWith({ defaultPath: "a.txt" });
  });
});
