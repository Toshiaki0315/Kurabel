//! テキストの差分抽出（行単位・単語単位）。

use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices_deadline, Algorithm, ChangeTag, DiffOp, TextDiff};
use regex::{Regex, RegexBuilder};
use std::collections::HashMap;
use std::time::{Duration, Instant};

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
    /// 別の場所へ移動した行（削除側・追加側の両方に付く）
    pub moved: bool,
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
            DiffRow { kind: RowKind::Equal, left, right, moved: false }
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
    /// 空行の追加・削除を差分として扱わない
    pub ignore_blank_lines: bool,
    /// コメントの違い（`comment_prefixes` から行末までと、コメントだけの行の追加・削除）を無視する
    pub ignore_comments: bool,
    /// 行コメントの開始文字列（例: `//`、`#`）
    pub comment_prefixes: Vec<String>,
    /// この正規表現に一致する行を、比較から外す（例: `^\s*Last updated:`）。不正なパターンは無視する
    pub ignore_line_patterns: Vec<String>,
    /// 移動した行（別の場所へ丸ごと移された連続行）を検出して印を付ける
    pub detect_moves: bool,
    /// フォルダ比較で除外するパターン（`*` と `?` が使える。`/` を含むものは相対パス、含まないものは名前に一致）
    pub exclude: Vec<String>,
    /// フォルダ比較でサブフォルダも含めるか
    pub recursive: bool,
    /// フォルダ比較で内容ではなくサイズと更新日時で判定するか（高速）
    pub quick: bool,
}

impl Default for DiffOptions {
    fn default() -> Self {
        DiffOptions {
            ignore_whitespace: false,
            ignore_case: false,
            ignore_blank_lines: false,
            ignore_comments: false,
            comment_prefixes: vec!["//".to_string(), "#".to_string()],
            ignore_line_patterns: Vec::new(),
            detect_moves: true,
            exclude: Vec::new(),
            recursive: true,
            quick: false,
        }
    }
}

/// 比較用に正規化した1行と、差分として扱わない行（空行・コメントだけの行）かどうか。
struct Line {
    key: String,
    ignorable: bool,
}

/// 正規表現を安全にコンパイルする。サイズ上限を設け、不正なものはエラーにする。
pub fn compile_pattern(pattern: &str) -> Result<Regex, String> {
    RegexBuilder::new(pattern).size_limit(1 << 20).build().map_err(|e| e.to_string())
}

fn analyze(line: &str, options: &DiffOptions, filters: &[Regex]) -> Line {
    // フィルタに一致する行は、内容によらず同じ（空の）キーにして、互いに対応づける
    if filters.iter().any(|f| f.is_match(line)) {
        return Line { key: String::new(), ignorable: true };
    }
    let mut body = line;
    let mut comment_only = false;
    if options.ignore_comments {
        let cut = options.comment_prefixes.iter().filter(|p| !p.is_empty()).filter_map(|p| line.find(p.as_str())).min();
        if let Some(pos) = cut {
            body = line[..pos].trim_end();
            comment_only = body.is_empty();
        }
    }
    let mut key = if options.ignore_whitespace {
        body.split_whitespace().collect::<Vec<_>>().join(" ")
    } else {
        body.to_string()
    };
    if options.ignore_case {
        key = key.to_lowercase();
    }
    let ignorable = (options.ignore_blank_lines && line.trim().is_empty()) || comment_only;
    Line { key, ignorable }
}

/// unified diff 形式のパッチ文字列を作る（差分がなければ空文字列）。
pub fn unified_patch(left: &str, right: &str, left_label: &str, right_label: &str) -> String {
    TextDiff::from_lines(left, right).unified_diff().context_radius(3).header(left_label, right_label).to_string()
}

/// 巨大で大きく異なるファイルでも固まらないよう、差分計算に時間制限を設ける（超えたら近似結果）。
const DIFF_DEADLINE: Duration = Duration::from_secs(10);

/// 差分として扱わない行だけの差を「差分なし」に直す。
fn neutralize_ignorable(rows: &mut [DiffRow], old_ign: &[bool], new_ign: &[bool]) {
    let ignorable = |cell: &Option<Cell>, flags: &[bool]| cell.as_ref().is_some_and(|c| flags[c.line_no - 1]);
    for row in rows.iter_mut() {
        let skip = match row.kind {
            RowKind::Delete => ignorable(&row.left, old_ign),
            RowKind::Insert => ignorable(&row.right, new_ign),
            RowKind::Replace => ignorable(&row.left, old_ign) && ignorable(&row.right, new_ign),
            RowKind::Equal => false,
        };
        if skip {
            row.kind = RowKind::Equal;
            for cell in [&mut row.left, &mut row.right].into_iter().flatten() {
                cell.segments.iter_mut().for_each(|s| s.changed = false);
            }
        }
    }
}

/// 削除された連続行と、追加された連続行が同じ内容なら、移動したものとして印を付ける。
fn mark_moves(rows: &mut [DiffRow], old_keys: &[String], new_keys: &[String]) {
    struct Run {
        start: usize,
        end: usize,
        key: String,
    }
    let (mut deleted, mut inserted) = (Vec::new(), Vec::new());
    let mut i = 0;
    while i < rows.len() {
        let kind = rows[i].kind;
        if kind != RowKind::Delete && kind != RowKind::Insert {
            i += 1;
            continue;
        }
        let start = i;
        let mut parts: Vec<&str> = Vec::new();
        while i < rows.len() && rows[i].kind == kind {
            parts.push(if kind == RowKind::Delete {
                &old_keys[rows[i].left.as_ref().map_or(0, |c| c.line_no) - 1]
            } else {
                &new_keys[rows[i].right.as_ref().map_or(0, |c| c.line_no) - 1]
            });
            i += 1;
        }
        // 閉じ括弧1つのような短い行は、偶然一致しやすいので対象にしない
        let significant = parts.iter().any(|p| !p.trim().is_empty())
            && (parts.len() >= 2 || parts.iter().map(|p| p.trim().chars().count()).sum::<usize>() >= 4);
        if significant {
            let run = Run { start, end: i, key: parts.join("\n") };
            if kind == RowKind::Delete { deleted.push(run) } else { inserted.push(run) }
        }
    }
    let mut by_key: HashMap<String, Vec<(usize, usize)>> = HashMap::new();
    for run in deleted {
        by_key.entry(run.key).or_default().push((run.start, run.end));
    }
    for run in inserted {
        if let Some((start, end)) = by_key.get_mut(&run.key).and_then(|list| list.pop()) {
            rows[start..end].iter_mut().for_each(|r| r.moved = true);
            rows[run.start..run.end].iter_mut().for_each(|r| r.moved = true);
        }
    }
}

pub fn diff_text(left: &str, right: &str, mode: DiffMode, options: &DiffOptions) -> Vec<DiffRow> {
    let old = split_lines(left);
    let new = split_lines(right);
    let filters: Vec<Regex> = options.ignore_line_patterns.iter().filter_map(|p| compile_pattern(p).ok()).collect();
    let (old_lines, new_lines): (Vec<Line>, Vec<Line>) = (
        old.iter().map(|l| analyze(l, options, &filters)).collect(),
        new.iter().map(|l| analyze(l, options, &filters)).collect(),
    );
    let old_keys: Vec<String> = old_lines.iter().map(|l| l.key.clone()).collect();
    let new_keys: Vec<String> = new_lines.iter().map(|l| l.key.clone()).collect();
    let mut rows = Vec::new();
    let ops = capture_diff_slices_deadline(Algorithm::Myers, &old_keys, &new_keys, Some(Instant::now() + DIFF_DEADLINE));
    for op in ops {
        match op {
            DiffOp::Equal { old_index, new_index, len } => {
                for i in 0..len {
                    // 左右が同じ文なら右の本文は省く（巨大なファイルで通信量が倍になるのを避ける。フロント側で左から補う）
                    let same = old[old_index + i] == new[new_index + i];
                    let right = if same {
                        Cell { line_no: new_index + i + 1, segments: Vec::new() }
                    } else {
                        plain(new_index + i + 1, new[new_index + i], false)
                    };
                    rows.push(DiffRow {
                        kind: RowKind::Equal,
                        left: Some(plain(old_index + i + 1, old[old_index + i], false)),
                        right: Some(right),
                        moved: false,
                    });
                }
            }
            DiffOp::Delete { old_index, old_len, .. } => {
                for i in 0..old_len {
                    rows.push(DiffRow {
                        kind: RowKind::Delete,
                        left: Some(plain(old_index + i + 1, old[old_index + i], true)),
                        right: None,
                        moved: false,
                    });
                }
            }
            DiffOp::Insert { new_index, new_len, .. } => {
                for i in 0..new_len {
                    rows.push(DiffRow {
                        kind: RowKind::Insert,
                        left: None,
                        right: Some(plain(new_index + i + 1, new[new_index + i], true)),
                        moved: false,
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
                        moved: false,
                    });
                }
                for i in paired..old_len {
                    rows.push(DiffRow {
                        kind: RowKind::Delete,
                        left: Some(plain(old_index + i + 1, old[old_index + i], true)),
                        right: None,
                        moved: false,
                    });
                }
                for i in paired..new_len {
                    rows.push(DiffRow {
                        kind: RowKind::Insert,
                        left: None,
                        right: Some(plain(new_index + i + 1, new[new_index + i], true)),
                        moved: false,
                    });
                }
            }
        }
    }
    if options.ignore_blank_lines || options.ignore_comments || !filters.is_empty() {
        let (old_ign, new_ign): (Vec<bool>, Vec<bool>) =
            (old_lines.iter().map(|l| l.ignorable).collect(), new_lines.iter().map(|l| l.ignorable).collect());
        neutralize_ignorable(&mut rows, &old_ign, &new_ign);
    }
    if options.detect_moves {
        mark_moves(&mut rows, &old_keys, &new_keys);
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
        // 同じ文の行は、右側の本文を省略して送る
        assert!(rows[0].right.as_ref().unwrap().segments.is_empty());
        assert_eq!(rows[1].right.as_ref().unwrap().line_no, 2);
    }

    #[test]
    fn equal_rows_keep_the_right_text_when_it_differs_only_by_ignored_things() {
        let opts = DiffOptions { ignore_case: true, ..Default::default() };
        let rows = diff_text("Hello\n", "hello\n", DiffMode::Line, &opts);
        assert_eq!(rows[0].kind, RowKind::Equal);
        assert_eq!(rows[0].right.as_ref().unwrap().segments[0].text, "hello");
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

    #[test]
    fn ignore_blank_lines_hides_added_and_removed_blank_lines() {
        let opts = DiffOptions { ignore_blank_lines: true, ..Default::default() };
        let rows = diff_text("a\nb\n", "a\n\n\nb\n", DiffMode::Line, &opts);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal));
        assert_eq!(rows.len(), 4); // 空行は表示上の対応行として残る
        let rows = diff_text("a\n\nb\n", "a\nb\n", DiffMode::Line, &opts);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal));
        assert!(rows.iter().flat_map(|r| r.left.iter().chain(r.right.iter())).flat_map(|c| &c.segments).all(|s| !s.changed));
        // 設定しなければ差分
        assert!(dt("a\nb\n", "a\n\nb\n", DiffMode::Line).iter().any(|r| r.kind == RowKind::Insert));
        // 空行以外の変更は残る
        assert!(diff_text("a\n\n", "x\n", DiffMode::Line, &opts).iter().any(|r| r.kind != RowKind::Equal));
    }

    #[test]
    fn ignore_comments_strips_trailing_comments_and_ignores_comment_only_lines() {
        let opts = DiffOptions { ignore_comments: true, ..Default::default() };
        let left = "let a = 1; // one\n// only a comment\nlet b = 2;\n";
        let right = "let a = 1; // uno\nlet b = 2; # python style\n";
        let rows = diff_text(left, right, DiffMode::Line, &opts);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal), "{rows:?}");
        // コードの変更は残る
        let rows = diff_text("x = 1 // a\n", "x = 2 // a\n", DiffMode::Line, &opts);
        assert_eq!(kinds(&rows), vec![RowKind::Replace]);
        // 無効なら差分
        assert!(dt(left, right, DiffMode::Line).iter().any(|r| r.kind != RowKind::Equal));
        // 空の開始文字列は無視する
        let empty = DiffOptions { ignore_comments: true, comment_prefixes: vec!["".into()], ..Default::default() };
        assert!(diff_text("a\n", "b\n", DiffMode::Line, &empty).iter().any(|r| r.kind != RowKind::Equal));
    }

    #[test]
    fn detects_blocks_moved_to_another_place() {
        let left = "intro\nmoved block text\nmid1\nmid2\noutro\n";
        let right = "intro\nmid1\nmid2\nmoved block text\noutro\n";
        let rows = dt(left, right, DiffMode::Line);
        let moved: Vec<_> = rows.iter().filter(|r| r.moved).map(|r| r.kind).collect();
        assert_eq!(moved, vec![RowKind::Delete, RowKind::Insert]);
        // 複数行のブロックも、まとめて移動として扱う
        let left = "a1\nblock line 1\nblock line 2\nz1\nz2\nz3\nz4\nz5\n";
        let right = "a1\nz1\nz2\nz3\nz4\nz5\nblock line 1\nblock line 2\n";
        assert_eq!(dt(left, right, DiffMode::Line).iter().filter(|r| r.moved).count(), 4);
        // 無効にすれば印は付かない
        let off = DiffOptions { detect_moves: false, ..Default::default() };
        assert!(diff_text(left, right, DiffMode::Line, &off).iter().all(|r| !r.moved));
    }

    #[test]
    fn does_not_flag_trivial_or_changed_blocks_as_moved() {
        // 閉じ括弧1つ
        assert!(dt("}\nx\n", "x\n}\n", DiffMode::Line).iter().all(|r| !r.moved));
        // 内容が変わっている
        assert!(dt("a1\nb1\nmid\n", "mid\na2\nb2\n", DiffMode::Line).iter().all(|r| !r.moved));
        // 空行だけ
        assert!(dt("\n\nx\n", "x\n\n\n", DiffMode::Line).iter().all(|r| !r.moved));
        // 同じブロックが片側にしかなければ（単なる追加）印は付かない
        assert!(dt("a\n", "a\nlong new block\n", DiffMode::Line).iter().all(|r| !r.moved));
    }

    #[test]
    fn each_moved_block_pairs_only_once() {
        let rows = dt("dupdup\nmid1\nmid2\nmid3\nmid4\n", "mid1\nmid2\ndupdup\nmid3\nmid4\ndupdup\n", DiffMode::Line);
        assert_eq!(rows.iter().filter(|r| r.moved && r.kind == RowKind::Insert).count(), 1);
        assert_eq!(rows.iter().filter(|r| r.moved && r.kind == RowKind::Delete).count(), 1);
        assert_eq!(rows.iter().filter(|r| r.kind == RowKind::Insert).count(), 2);
    }

    #[test]
    fn options_have_sensible_defaults_for_the_new_fields() {
        let o: DiffOptions = serde_json::from_str("{}").unwrap();
        assert!(o.detect_moves && !o.ignore_blank_lines && !o.ignore_comments);
        assert_eq!(o.comment_prefixes, vec!["//".to_string(), "#".to_string()]);
    }

    #[test]
    fn ignore_line_patterns_skip_matching_lines_on_both_sides() {
        let opts = DiffOptions { ignore_line_patterns: vec![r"^\s*Last updated:".into(), r"\$Id.*\$".into()], ..Default::default() };
        let left = "title\nLast updated: 2024-01-01\nbody $Id: 1 $\nend\n";
        let right = "title\n  Last updated: 2025-12-31\nbody $Id: 2 $\nend\n";
        let rows = diff_text(left, right, DiffMode::Line, &opts);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal), "{rows:?}");
        // 表示は元の行のまま
        assert_eq!(rows[1].left.as_ref().unwrap().segments[0].text, "Last updated: 2024-01-01");
        assert_eq!(rows[1].right.as_ref().unwrap().segments[0].text, "  Last updated: 2025-12-31");
        // パターンなしなら差分
        assert!(dt(left, right, DiffMode::Line).iter().any(|r| r.kind != RowKind::Equal));
        // 一致しない行の変更は残る
        let rows = diff_text("title\nx\n", "title\ny\n", DiffMode::Line, &opts);
        assert_eq!(kinds(&rows), vec![RowKind::Equal, RowKind::Replace]);
    }

    #[test]
    fn a_filtered_line_that_exists_on_only_one_side_is_not_a_difference() {
        let opts = DiffOptions { ignore_line_patterns: vec!["^#".into()], ..Default::default() };
        let rows = diff_text("a\n# note\nb\n", "a\nb\n", DiffMode::Line, &opts);
        assert!(rows.iter().all(|r| r.kind == RowKind::Equal));
    }

    #[test]
    fn invalid_or_oversized_patterns_are_ignored_and_reported_by_compile_pattern() {
        assert!(compile_pattern("(unclosed").is_err());
        assert!(compile_pattern(r"a{1000}{1000}{1000}").is_err());
        assert!(compile_pattern(r"^\d+$").is_ok());
        let opts = DiffOptions { ignore_line_patterns: vec!["(unclosed".into()], ..Default::default() };
        assert!(diff_text("a\n", "b\n", DiffMode::Line, &opts).iter().any(|r| r.kind != RowKind::Equal));
    }
}
