//! テキストの差分抽出（行単位・単語単位）。

use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices, Algorithm, ChangeTag, DiffOp, TextDiff};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffMode {
    Line,
    Word,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RowKind {
    Equal,
    Insert,
    Delete,
    Replace,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Segment {
    pub text: String,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Cell {
    pub line_no: usize,
    pub segments: Vec<Segment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiffRow {
    pub kind: RowKind,
    pub left: Option<Cell>,
    pub right: Option<Cell>,
}

fn split_lines(text: &str) -> Vec<&str> {
    text.lines().collect()
}

fn plain(line_no: usize, text: &str, changed: bool) -> Cell {
    Cell {
        line_no,
        segments: vec![Segment { text: text.to_string(), changed }],
    }
}

fn push_segment(segs: &mut Vec<Segment>, text: &str, changed: bool) {
    match segs.last_mut() {
        Some(last) if last.changed == changed => last.text.push_str(text),
        _ => segs.push(Segment { text: text.to_string(), changed }),
    }
}

/// 置換された1行ペアを単語単位で比較し、左右のセグメントを返す。
fn word_segments(old: &str, new: &str) -> (Vec<Segment>, Vec<Segment>) {
    let mut left = Vec::new();
    let mut right = Vec::new();
    for change in TextDiff::from_words(old, new).iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                push_segment(&mut left, change.value(), false);
                push_segment(&mut right, change.value(), false);
            }
            ChangeTag::Delete => push_segment(&mut left, change.value(), true),
            ChangeTag::Insert => push_segment(&mut right, change.value(), true),
        }
    }
    (left, right)
}

pub fn diff_text(left: &str, right: &str, mode: DiffMode) -> Vec<DiffRow> {
    let old = split_lines(left);
    let new = split_lines(right);
    let mut rows = Vec::new();
    for op in capture_diff_slices(Algorithm::Myers, &old, &new) {
        match op {
            DiffOp::Equal { old_index, new_index, len } => {
                for i in 0..len {
                    rows.push(DiffRow {
                        kind: RowKind::Equal,
                        left: Some(plain(old_index + i + 1, old[old_index + i], false)),
                        right: Some(plain(new_index + i + 1, new[new_index + i], false)),
                    });
                }
            }
            DiffOp::Delete { old_index, old_len, .. } => {
                for i in 0..old_len {
                    rows.push(DiffRow {
                        kind: RowKind::Delete,
                        left: Some(plain(old_index + i + 1, old[old_index + i], true)),
                        right: None,
                    });
                }
            }
            DiffOp::Insert { new_index, new_len, .. } => {
                for i in 0..new_len {
                    rows.push(DiffRow {
                        kind: RowKind::Insert,
                        left: None,
                        right: Some(plain(new_index + i + 1, new[new_index + i], true)),
                    });
                }
            }
            DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                let paired = old_len.min(new_len);
                for i in 0..paired {
                    let (o, n) = (old[old_index + i], new[new_index + i]);
                    let (lseg, rseg) = match mode {
                        DiffMode::Line => (plain(0, o, true).segments, plain(0, n, true).segments),
                        DiffMode::Word => word_segments(o, n),
                    };
                    rows.push(DiffRow {
                        kind: RowKind::Replace,
                        left: Some(Cell { line_no: old_index + i + 1, segments: lseg }),
                        right: Some(Cell { line_no: new_index + i + 1, segments: rseg }),
                    });
                }
                for i in paired..old_len {
                    rows.push(DiffRow {
                        kind: RowKind::Delete,
                        left: Some(plain(old_index + i + 1, old[old_index + i], true)),
                        right: None,
                    });
                }
                for i in paired..new_len {
                    rows.push(DiffRow {
                        kind: RowKind::Insert,
                        left: None,
                        right: Some(plain(new_index + i + 1, new[new_index + i], true)),
                    });
                }
            }
        }
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(rows: &[DiffRow]) -> Vec<RowKind> {
        rows.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn identical_texts_are_all_equal() {
        let rows = diff_text("a\nb\n", "a\nb\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Equal, RowKind::Equal]);
        assert_eq!(rows[1].left.as_ref().unwrap().line_no, 2);
        assert!(!rows[0].left.as_ref().unwrap().segments[0].changed);
    }

    #[test]
    fn empty_inputs_yield_no_rows() {
        assert!(diff_text("", "", DiffMode::Line).is_empty());
    }

    #[test]
    fn detects_insert_and_delete() {
        let rows = diff_text("a\nb\n", "a\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Equal, RowKind::Delete]);
        assert!(rows[1].right.is_none());
        let rows = diff_text("a\n", "a\nb\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Equal, RowKind::Insert]);
        assert!(rows[1].left.is_none());
        assert_eq!(rows[1].right.as_ref().unwrap().line_no, 2);
    }

    #[test]
    fn line_mode_marks_whole_line() {
        let rows = diff_text("hello world\n", "hello there\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Replace]);
        let segs = &rows[0].left.as_ref().unwrap().segments;
        assert_eq!(segs.len(), 1);
        assert!(segs[0].changed);
    }

    #[test]
    fn word_mode_marks_only_changed_words() {
        let rows = diff_text("hello world\n", "hello there\n", DiffMode::Word);
        let left = &rows[0].left.as_ref().unwrap().segments;
        let right = &rows[0].right.as_ref().unwrap().segments;
        assert_eq!(left[0], Segment { text: "hello ".into(), changed: false });
        assert_eq!(left[1], Segment { text: "world".into(), changed: true });
        assert_eq!(right[1], Segment { text: "there".into(), changed: true });
    }

    #[test]
    fn replace_with_unequal_lengths_splits_extra_lines() {
        let rows = diff_text("a\nb\nc\n", "x\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Replace, RowKind::Delete, RowKind::Delete]);
        let rows = diff_text("x\n", "a\nb\nc\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Replace, RowKind::Insert, RowKind::Insert]);
    }

    #[test]
    fn crlf_is_treated_like_lf() {
        let rows = diff_text("a\r\nb\r\n", "a\nb\n", DiffMode::Line);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal));
    }

    #[test]
    fn mode_deserializes_from_lowercase() {
        let m: DiffMode = serde_json::from_str("\"word\"").unwrap();
        assert_eq!(m, DiffMode::Word);
        let json = serde_json::to_string(&RowKind::Replace).unwrap();
        assert_eq!(json, "\"replace\"");
    }
}
