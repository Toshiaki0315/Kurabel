import { invoke } from "@tauri-apps/api/core";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { AUTO_ENCODING, type Comparison, type DiffMode, type DiffOptions, type DiffRow, type EncodingChoice, type Merge3, type TextEncoding } from "./types";

/**
 * バックエンドは、左右が同じ文の行では右の本文を省いて送る（通信量の削減）。左の内容で補う。
 * 配列は書き換えて返す。
 */
export function expandRows(rows: DiffRow[]): DiffRow[] {
  for (const r of rows) {
    if (r.right && r.left && r.right.segments.length === 0) r.right = { ...r.right, segments: r.left.segments };
  }
  return rows;
}

/** 片方が null のときは、もう片方だけをそのまま表示する。 */
export function comparePaths(
  left: string | null,
  right: string | null,
  mode: DiffMode,
  options: DiffOptions,
  encodings: EncodingChoice = AUTO_ENCODING,
): Promise<Comparison> {
  return invoke<Comparison>("compare_paths", { left, right, mode, options, encodings }).then((c) => {
    if (c?.kind === "text") expandRows(c.rows);
    return c;
  });
}

export function diffText(left: string, right: string, mode: DiffMode, options: DiffOptions): Promise<DiffRow[]> {
  return invoke<DiffRow[]>("diff_text", { left, right, mode, options }).then(expandRows);
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

/** 起動時のコマンドライン引数で指定された比較対象（最大2つ） */
export function initialPaths(): Promise<string[]> {
  return invoke<string[]>("initial_paths");
}

export function copyEntry(srcRoot: string, dstRoot: string, rel: string): Promise<void> {
  return invoke("copy_entry", { srcRoot, dstRoot, rel });
}

export function deleteEntry(root: string, rel: string): Promise<void> {
  return invoke("delete_entry", { root, rel });
}

export function makePatch(leftText: string, rightText: string, leftLabel: string, rightLabel: string): Promise<string> {
  return invoke<string>("make_patch", { leftText, rightText, leftLabel, rightLabel });
}

export function writePatch(path: string, content: string): Promise<void> {
  return invoke("write_patch", { path, content });
}

/** パッチの保存先をダイアログで選ぶ。キャンセル時は null。 */
export async function pickPatchPath(defaultName: string): Promise<string | null> {
  return save({ defaultPath: defaultName, filters: [{ name: "パッチ", extensions: ["patch", "diff", "txt"] }] });
}

/** 取り消せない操作の前の確認 */
export function confirmAction(message: string, okLabel: string): Promise<boolean> {
  return confirm(message, { title: "クラベル", kind: "warning", okLabel, cancelLabel: "キャンセル" });
}

export function merge3Files(base: string, left: string, right: string): Promise<Merge3> {
  return invoke<Merge3>("merge3", { base, left, right });
}

/** 新しいファイルとして保存する（既存のファイルは上書きされない） */
export function createText(path: string, content: string, encoding: TextEncoding): Promise<void> {
  return invoke("create_text", { path, content, encoding });
}

/** 名前を付けて保存する場所をダイアログで選ぶ。キャンセル時は null。 */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  return save({ defaultPath: defaultName });
}

/** レポート（HTML）の保存先をダイアログで選ぶ。キャンセル時は null。 */
export async function pickReportPath(defaultName: string): Promise<string | null> {
  return save({ defaultPath: defaultName, filters: [{ name: "HTML レポート", extensions: ["html", "htm"] }] });
}

export function writeReport(path: string, content: string): Promise<void> {
  return invoke("write_report", { path, content });
}

/** 正規表現として有効か確認する。無効なら理由を投げる。 */
export function checkRegex(pattern: string): Promise<void> {
  return invoke("check_regex", { pattern });
}
