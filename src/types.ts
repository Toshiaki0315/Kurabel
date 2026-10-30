export type DiffMode = "line" | "word";

export interface DiffOptions {
  ignore_whitespace: boolean;
  ignore_case: boolean;
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
}

export interface TextEncoding {
  name: string;
  bom: boolean;
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
      rows: DiffRow[];
    }
  | { kind: "binary"; left_size: number; right_size: number; rows: BinaryRow[] }
  | { kind: "directory"; entries: DirEntry[] };
