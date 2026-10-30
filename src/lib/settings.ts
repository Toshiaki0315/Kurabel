import { DEFAULT_OPTIONS, type DiffMode, type DiffOptions } from "../types";

export interface Settings {
  mode: DiffMode;
  options: DiffOptions;
}

export const DEFAULT_SETTINGS: Settings = { mode: "line", options: DEFAULT_OPTIONS };

const KEY = "kurabel.settings";

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return {
      mode: v?.mode === "word" ? "word" : "line",
      options: {
        ignore_whitespace: v?.options?.ignore_whitespace === true,
        ignore_case: v?.options?.ignore_case === true,
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 保存できなくても動作には影響しない
  }
}
