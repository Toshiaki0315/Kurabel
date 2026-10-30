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

/// 片方だけ開いているとき用に、差分なしの行を返す（反対側は空）。
pub fn plain_rows(text: &str, left_side: bool) -> Vec<DiffRow> {
    split_lines(text)
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let cell = Some(plain(i + 1, line, false));
            let (left, right) = if left_side { (cell, None) } else { (None, cell) };
            DiffRow { kind: RowKind::Equal, left, right }
        })
        .collect()
}

/// 比較時のオプション（テキストの無視設定と、フォルダ比較の設定）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DiffOptions {
    /// 行頭・行末の空白と、連続する空白の量の違いを無視する
    pub ignore_whitespace: bool,
    pub ignore_case: bool,
    /// フォルダ比較で除外するパターン（`*` と `?` が使える。`/` を含むものは相対パス、含まないものは名前に一致）
    pub exclude: Vec<String>,
    /// フォルダ比較でサブフォルダも含めるか
    pub recursive: bool,
    /// フォルダ比較で内容ではなくサイズと更新日時で判定するか（高速）
    pub quick: bool,
}

impl Default for DiffOptions {
    fn default() -> Self {
        DiffOptions { ignore_whitespace: false, ignore_case: false, exclude: Vec::new(), recursive: true, quick: false }
    }
}

fn normalize(line: &str, options: &DiffOptions) -> String {
    let mut key = if options.ignore_whitespace {
        line.split_whitespace().collect::<Vec<_>>().join(" ")
    } else {
        line.to_string()
    };
    if options.ignore_case {
        key = key.to_lowercase();
    }
    key
}

/// unified diff 形式のパッチ文字列を作る（差分がなければ空文字列）。
pub fn unified_patch(left: &str, right: &str, left_label: &str, right_label: &str) -> String {
    TextDiff::from_lines(left, right).unified_diff().context_radius(3).header(left_label, right_label).to_string()
}

pub fn diff_text(left: &str, right: &str, mode: DiffMode, options: &DiffOptions) -> Vec<DiffRow> {
    let old = split_lines(left);
    let new = split_lines(right);
    let old_keys: Vec<String> = old.iter().map(|l| normalize(l, options)).collect();
    let new_keys: Vec<String> = new.iter().map(|l| normalize(l, options)).collect();
    let mut rows = Vec::new();
    for op in capture_diff_slices(Algorithm::Myers, &old_keys, &new_keys) {
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

    fn dt(l: &str, r: &str, m: DiffMode) -> Vec<DiffRow> {
        diff_text(l, r, m, &DiffOptions::default())
    }

    fn kinds(rows: &[DiffRow]) -> Vec<RowKind> {
        rows.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn identical_texts_are_all_equal() {
        let rows = dt("a\nb\n", "a\nb\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Equal, RowKind::Equal]);
        assert_eq!(rows[1].left.as_ref().unwrap().line_no, 2);
        assert!(!rows[0].left.as_ref().unwrap().segments[0].changed);
    }

    #[test]
    fn empty_inputs_yield_no_rows() {
        assert!(dt("", "", DiffMode::Line).is_empty());
    }

    #[test]
    fn detects_insert_and_delete() {
        let rows = dt("a\nb\n", "a\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Equal, RowKind::Delete]);
        assert!(rows[1].right.is_none());
        let rows = dt("a\n", "a\nb\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Equal, RowKind::Insert]);
        assert!(rows[1].left.is_none());
        assert_eq!(rows[1].right.as_ref().unwrap().line_no, 2);
    }

    #[test]
    fn line_mode_marks_whole_line() {
        let rows = dt("hello world\n", "hello there\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Replace]);
        let segs = &rows[0].left.as_ref().unwrap().segments;
        assert_eq!(segs.len(), 1);
        assert!(segs[0].changed);
    }

    #[test]
    fn word_mode_marks_only_changed_words() {
        let rows = dt("hello world\n", "hello there\n", DiffMode::Word);
        let left = &rows[0].left.as_ref().unwrap().segments;
        let right = &rows[0].right.as_ref().unwrap().segments;
        assert_eq!(left[0], Segment { text: "hello ".into(), changed: false });
        assert_eq!(left[1], Segment { text: "world".into(), changed: true });
        assert_eq!(right[1], Segment { text: "there".into(), changed: true });
    }

    #[test]
    fn replace_with_unequal_lengths_splits_extra_lines() {
        let rows = dt("a\nb\nc\n", "x\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Replace, RowKind::Delete, RowKind::Delete]);
        let rows = dt("x\n", "a\nb\nc\n", DiffMode::Line);
        assert_eq!(kinds(&rows), vec![RowKind::Replace, RowKind::Insert, RowKind::Insert]);
    }

    #[test]
    fn crlf_is_treated_like_lf() {
        let rows = dt("a\r\nb\r\n", "a\nb\n", DiffMode::Line);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal));
    }

    #[test]
    fn mode_deserializes_from_lowercase() {
        let m: DiffMode = serde_json::from_str("\"word\"").unwrap();
        assert_eq!(m, DiffMode::Word);
        let json = serde_json::to_string(&RowKind::Replace).unwrap();
        assert_eq!(json, "\"replace\"");
    }

    #[test]
    fn ignore_whitespace_option() {
        let opts = DiffOptions { ignore_whitespace: true, ..Default::default() };
        let rows = diff_text("a   b \n  c\n", "a b\nc\n", DiffMode::Line, &opts);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal));
        // 表示は元の行のまま
        assert_eq!(rows[0].left.as_ref().unwrap().segments[0].text, "a   b ");
        assert_eq!(kinds(&dt("a   b\n", "a b\n", DiffMode::Line)), vec![RowKind::Replace]);
        assert_eq!(kinds(&diff_text("ab\n", "a b\n", DiffMode::Line, &opts)), vec![RowKind::Replace]);
    }

    #[test]
    fn ignore_case_option() {
        let opts = DiffOptions { ignore_case: true, ..Default::default() };
        assert!(diff_text("Hello\n", "hELLO\n", DiffMode::Line, &opts).iter().all(|r| r.kind == RowKind::Equal));
        assert_eq!(kinds(&dt("Hello\n", "hello\n", DiffMode::Line)), vec![RowKind::Replace]);
    }

    #[test]
    fn options_default_when_fields_are_missing() {
        let o: DiffOptions = serde_json::from_str("{}").unwrap();
        assert_eq!(o, DiffOptions::default());
        assert!(o.recursive && !o.quick && o.exclude.is_empty());
        let o: DiffOptions = serde_json::from_str("{\"ignore_case\":true}").unwrap();
        assert!(o.ignore_case && !o.ignore_whitespace);
    }

    #[test]
    fn plain_rows_fill_one_side_only() {
        let rows = plain_rows("a\nb\n", true);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal && r.right.is_none()));
        assert_eq!(rows[1].left.as_ref().unwrap().line_no, 2);
        let rows = plain_rows("x", false);
        assert!(rows[0].left.is_none() && rows[0].right.is_some());
        assert!(plain_rows("", true).is_empty());
    }

    #[test]
    fn unified_patch_has_headers_and_hunks() {
        let patch = unified_patch("a\nb\nc\n", "a\nB\nc\n", "left.txt", "right.txt");
        assert!(patch.starts_with("--- left.txt\n+++ right.txt\n"));
        assert!(patch.contains("-b\n+B\n"));
        assert_eq!(unified_patch("same\n", "same\n", "a", "b"), "");
    }
}
