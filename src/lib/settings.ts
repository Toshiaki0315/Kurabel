import { DEFAULT_OPTIONS, type DiffMode, type DiffOptions } from "../types";

export interface Settings {
  mode: DiffMode;
  options: DiffOptions;
}

export const DEFAULT_SETTINGS: Settings = { mode: "line", options: DEFAULT_OPTIONS };

const KEY = "kurabel.settings";

/** 除外パターンの入力欄（改行・カンマ区切り）を配列にする。 */
export function parseExclude(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** 正規表現の入力欄（1行に1パターン）を配列にする。カンマや空白は正規表現の一部なので、区切りには使わない。 */
export function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.replace(/\r$/, ""))
    .filter((s) => s !== "");
}

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const o = v?.options;
    return {
      mode: v?.mode === "word" ? "word" : "line",
      options: {
        ignore_whitespace: o?.ignore_whitespace === true,
        ignore_case: o?.ignore_case === true,
        ignore_blank_lines: o?.ignore_blank_lines === true,
        ignore_comments: o?.ignore_comments === true,
        comment_prefixes: Array.isArray(o?.comment_prefixes)
          ? o.comment_prefixes.filter((x: unknown): x is string => typeof x === "string")
          : DEFAULT_OPTIONS.comment_prefixes,
        ignore_line_patterns: Array.isArray(o?.ignore_line_patterns)
          ? o.ignore_line_patterns.filter((x: unknown): x is string => typeof x === "string")
          : [],
        detect_moves: o?.detect_moves !== false,
        exclude: Array.isArray(o?.exclude) ? o.exclude.filter((x: unknown): x is string => typeof x === "string") : [],
        recursive: o?.recursive !== false,
        quick: o?.quick === true,
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

export type { DiffOptions };
