import { DEFAULT_SETTINGS, loadSettings, parseExclude, saveSettings } from "./settings";

describe("settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", () => {
    const s = {
      mode: "word" as const,
      options: { ...DEFAULT_SETTINGS.options, ignore_whitespace: true, ignore_case: true, exclude: [".git", "*.obj"], recursive: false, quick: true, ignore_comments: true, comment_prefixes: ["--"], detect_moves: false },
    };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it("sanitizes unexpected values and corrupt data", () => {
    localStorage.setItem("kurabel.settings", JSON.stringify({ mode: "bogus", options: { ignore_case: "yes", exclude: [1, "ok", null], recursive: "no", quick: 1 } }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, options: { ...DEFAULT_SETTINGS.options, exclude: ["ok"] } });
    localStorage.setItem("kurabel.settings", "not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores storage failures when saving", () => {
    const spy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    spy.mockRestore();
  });

  it("parses the exclude pattern input", () => {
    expect(parseExclude(" .git, *.obj\n\n node_modules ,, ")).toEqual([".git", "*.obj", "node_modules"]);
    expect(parseExclude("")).toEqual([]);
  });

  it("sanitizes the new comparison options", () => {
    localStorage.setItem("kurabel.settings", JSON.stringify({ options: { comment_prefixes: ["//", 1], detect_moves: false, ignore_blank_lines: true } }));
    const o = loadSettings().options;
    expect(o.comment_prefixes).toEqual(["//"]);
    expect(o.detect_moves).toBe(false);
    expect(o.ignore_blank_lines).toBe(true);
    localStorage.setItem("kurabel.settings", JSON.stringify({ options: { comment_prefixes: "nope" } }));
    expect(loadSettings().options.comment_prefixes).toEqual(DEFAULT_SETTINGS.options.comment_prefixes);
    expect(loadSettings().options.detect_moves).toBe(true);
  });
});
