export type DiffMode = "line" | "word";

export interface DiffOptions {
  ignore_whitespace: boolean;
  ignore_case: boolean;
  /** 空行の追加・削除を差分として扱わない */
  ignore_blank_lines: boolean;
  /** コメントの違いを無視する */
  ignore_comments: boolean;
  /** 行コメントの開始文字列（例: `//`、`#`） */
  comment_prefixes: string[];
  /** この正規表現に一致する行を比較から外す（1行に1パターン） */
  ignore_line_patterns: string[];
  /** 移動した行を検出して印を付ける */
  detect_moves: boolean;
  /** フォルダ比較で除外するパターン（`*` と `?` が使える） */
  exclude: string[];
  /** フォルダ比較でサブフォルダも含める */
  recursive: boolean;
  /** フォルダ比較を内容ではなくサイズと更新日時で判定する（高速） */
  quick: boolean;
}

export const DEFAULT_OPTIONS: DiffOptions = {
  ignore_whitespace: false,
  ignore_case: false,
  ignore_blank_lines: false,
  ignore_comments: false,
  comment_prefixes: ["//", "#"],
  ignore_line_patterns: [],
  detect_moves: true,
  exclude: [],
  recursive: true,
  quick: false,
};

/** ファイルごとの文字コードの手動指定（null = 自動判定） */
export interface EncodingChoice {
  left: string | null;
  right: string | null;
}

export const AUTO_ENCODING: EncodingChoice = { left: null, right: null };

export const ENCODINGS = ["UTF-8", "Shift_JIS", "EUC-JP", "ISO-2022-JP", "UTF-16LE", "UTF-16BE", "windows-1252"];
export type RowKind = "equal" | "insert" | "delete" | "replace";

export interface Segment {
  text: string;
  changed: boolean;
}
export interface Cell {
  line_no: number;
  segments: Segment[];
}
export interface DiffRow {
  kind: RowKind;
  left: Cell | null;
  right: Cell | null;
  /** 別の場所へ移動した行（削除側・追加側の両方に付く） */
  moved?: boolean;
}

export interface ByteCell {
  hex: string;
  ascii: string;
  changed: boolean;
}
export interface BinaryRow {
  offset: number;
  left: ByteCell[];
  right: ByteCell[];
}

export type NodeKind = "file" | "directory";
export type DirStatus = "same" | "added" | "removed" | "modified";
export interface DirEntry {
  path: string;
  left: NodeKind | null;
  right: NodeKind | null;
  status: DirStatus;
  /** ファイルのサイズ（バイト）。フォルダ・存在しない側は null */
  left_size?: number | null;
  right_size?: number | null;
  /** ファイルの更新日時（UNIX 秒） */
  left_modified?: number | null;
  right_modified?: number | null;
}

export interface TextEncoding {
  name: string;
  bom: boolean;
}

/** 3ウェイマージの断片（左・右は base から分かれたファイル） */
export type MergeChunk =
  | { kind: "stable"; lines: string[] }
  | { kind: "left"; base: string[]; left: string[] }
  | { kind: "right"; base: string[]; right: string[] }
  | { kind: "same"; base: string[]; lines: string[] }
  | { kind: "conflict"; base: string[]; left: string[]; right: string[] };

export interface Merge3 {
  chunks: MergeChunk[];
  left_encoding: TextEncoding;
  base_encoding: TextEncoding;
  right_encoding: TextEncoding;
  /** 結果を組み立てるときの改行 ("\n" または "\r\n") */
  eol: string;
  trailing_newline: boolean;
}

export type Comparison =
  | {
      kind: "text";
      left_text: string;
      right_text: string;
      left_encoding: TextEncoding;
      right_encoding: TextEncoding;
      left_eol: string;
      right_eol: string;
      /** 読み込み時の更新日時（UNIX ミリ秒）。保存時に他のアプリによる変更を検出する。アーカイブ内などは省略 */
      left_mtime?: number | null;
      right_mtime?: number | null;
      rows: DiffRow[];
    }
  | { kind: "binary"; left_size: number; right_size: number; truncated: boolean; rows: BinaryRow[] }
  | { kind: "directory"; entries: DirEntry[]; archive?: boolean };
