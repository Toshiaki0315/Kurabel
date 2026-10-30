import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Comparison, DiffMode, DiffRow, TextEncoding } from "./types";

export function comparePaths(left: string, right: string, mode: DiffMode): Promise<Comparison> {
  return invoke<Comparison>("compare_paths", { left, right, mode });
}

export function diffText(left: string, right: string, mode: DiffMode): Promise<DiffRow[]> {
  return invoke<DiffRow[]>("diff_text", { left, right, mode });
}

/** 読み込み時の文字コード（BOM含む）のまま書き戻す。 */
export function saveText(path: string, content: string, encoding: TextEncoding): Promise<void> {
  return invoke("save_text", { path, content, encoding });
}

export function pathKind(path: string): Promise<"file" | "directory"> {
  return invoke("path_kind", { path });
}

/** ダイアログでファイルまたはディレクトリを1つ選ぶ。キャンセル時は null。 */
export async function pickPath(directory: boolean): Promise<string | null> {
  const selected = await open({ directory, multiple: false });
  return typeof selected === "string" ? selected : null;
}
