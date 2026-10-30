export type DiffMode = "line" | "word";
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

export type Comparison =
  | { kind: "text"; left_text: string; right_text: string; rows: DiffRow[] }
  | { kind: "binary"; left_size: number; right_size: number; rows: BinaryRow[] }
  | { kind: "directory"; entries: DirEntry[] };
