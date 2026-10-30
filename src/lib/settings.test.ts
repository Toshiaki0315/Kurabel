import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

describe("settings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", () => {
    const s = { mode: "word" as const, options: { ignore_whitespace: true, ignore_case: true } };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it("sanitizes unexpected values and corrupt data", () => {
    localStorage.setItem("kurabel.settings", JSON.stringify({ mode: "bogus", options: { ignore_case: "yes" } }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
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
});
