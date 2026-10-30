import { invoke } from "@tauri-apps/api/core";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import type { Comparison, DiffMode, DiffOptions, DiffRow, TextEncoding } from "./types";

/** 片方が null のときは、もう片方だけをそのまま表示する。 */
export function comparePaths(left: string | null, right: string | null, mode: DiffMode, options: DiffOptions): Promise<Comparison> {
  return invoke<Comparison>("compare_paths", { left, right, mode, options });
}

export function diffText(left: string, right: string, mode: DiffMode, options: DiffOptions): Promise<DiffRow[]> {
  return invoke<DiffRow[]>("diff_text", { left, right, mode, options });
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

/** 未保存の変更を破棄してよいか確認する。 */
export function confirmDiscard(): Promise<boolean> {
  return confirm("未保存の変更があります。破棄しますか？", {
    title: "クラベル",
    kind: "warning",
    okLabel: "破棄",
    cancelLabel: "キャンセル",
  });
}
