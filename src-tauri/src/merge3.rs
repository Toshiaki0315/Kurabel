//! 3ウェイマージ（共通の祖先 `base` と、そこから分かれた `left` / `right`）。
//! 行単位の diff3: base に対する左右の変更箇所を重ね合わせ、片側だけの変更は自動で取り込み、
//! 両側が重なって異なる内容にした箇所を「競合」として返す。

use serde::Serialize;
use similar::{capture_diff_slices, Algorithm, DiffOp};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MergeChunk {
    /// 3つとも同じ
    Stable { lines: Vec<String> },
    /// 左だけが変更した（左を採用）
    Left { base: Vec<String>, left: Vec<String> },
    /// 右だけが変更した（右を採用）
    Right { base: Vec<String>, right: Vec<String> },
    /// 左右が同じ変更をした
    Same { base: Vec<String>, lines: Vec<String> },
    /// 左右が重なる箇所を異なる内容に変更した
    Conflict { base: Vec<String>, left: Vec<String>, right: Vec<String> },
}

/// base[start..end] を `lines` に置き換える変更
struct Hunk {
    start: usize,
    end: usize,
    lines: Vec<String>,
}

fn strings(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|s| s.to_string()).collect()
}

fn hunks(base: &[&str], other: &[&str]) -> Vec<Hunk> {
    capture_diff_slices(Algorithm::Myers, base, other)
        .into_iter()
        .filter_map(|op| match op {
            DiffOp::Equal { .. } => None,
            DiffOp::Delete { old_index, old_len, .. } => {
                Some(Hunk { start: old_index, end: old_index + old_len, lines: vec![] })
            }
            DiffOp::Insert { old_index, new_index, new_len } => {
                Some(Hunk { start: old_index, end: old_index, lines: strings(&other[new_index..new_index + new_len]) })
            }
            DiffOp::Replace { old_index, old_len, new_index, new_len } => Some(Hunk {
                start: old_index,
                end: old_index + old_len,
                lines: strings(&other[new_index..new_index + new_len]),
            }),
        })
        .collect()
}

/// base[start..end] に、領域内の変更 `hunks` を適用した行を返す。
fn apply(base: &[&str], start: usize, end: usize, hunks: &[Hunk]) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = start;
    for h in hunks {
        out.extend(strings(&base[cur..h.start]));
        out.extend(h.lines.iter().cloned());
        cur = h.end;
    }
    out.extend(strings(&base[cur..end]));
    out
}

pub fn merge3(base: &str, left: &str, right: &str) -> Vec<MergeChunk> {
    let b: Vec<&str> = base.lines().collect();
    let (l, r): (Vec<&str>, Vec<&str>) = (left.lines().collect(), right.lines().collect());
    let (hl, hr) = (hunks(&b, &l), hunks(&b, &r));
    let (mut i, mut j, mut pos) = (0, 0, 0);
    let mut chunks = Vec::new();
    while i < hl.len() || j < hr.len() {
        let start = match (hl.get(i), hr.get(j)) {
            (Some(a), Some(c)) => a.start.min(c.start),
            (Some(a), None) => a.start,
            (None, Some(c)) => c.start,
            (None, None) => unreachable!(),
        };
        if start > pos {
            chunks.push(MergeChunk::Stable { lines: strings(&b[pos..start]) });
        }
        // 接している・重なっている変更を、左右をまたいで1つの領域にまとめる
        let (first_l, first_r) = (i, j);
        let mut end = start;
        loop {
            let before = (i, j);
            while i < hl.len() && hl[i].start <= end {
                end = end.max(hl[i].end);
                i += 1;
            }
            while j < hr.len() && hr[j].start <= end {
                end = end.max(hr[j].end);
                j += 1;
            }
            if (i, j) == before {
                break;
            }
        }
        let (lh, rh) = (&hl[first_l..i], &hr[first_r..j]);
        let base_lines = strings(&b[start..end]);
        chunks.push(match (lh.is_empty(), rh.is_empty()) {
            (false, true) => MergeChunk::Left { base: base_lines, left: apply(&b, start, end, lh) },
            (true, false) => MergeChunk::Right { base: base_lines, right: apply(&b, start, end, rh) },
            _ => {
                let (lc, rc) = (apply(&b, start, end, lh), apply(&b, start, end, rh));
                if lc == rc {
                    MergeChunk::Same { base: base_lines, lines: lc }
                } else {
                    MergeChunk::Conflict { base: base_lines, left: lc, right: rc }
                }
            }
        });
        pos = end;
    }
    if pos < b.len() {
        chunks.push(MergeChunk::Stable { lines: strings(&b[pos..]) });
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(lines: &[&str]) -> Vec<String> {
        strings(lines)
    }

    #[test]
    fn identical_inputs_are_one_stable_chunk() {
        assert_eq!(merge3("a\nb\n", "a\nb\n", "a\nb\n"), vec![MergeChunk::Stable { lines: v(&["a", "b"]) }]);
        assert!(merge3("", "", "").is_empty());
    }

    #[test]
    fn takes_a_change_made_on_one_side_only() {
        let m = merge3("a\nb\nc\n", "a\nB\nc\n", "a\nb\nc\n");
        assert_eq!(
            m,
            vec![
                MergeChunk::Stable { lines: v(&["a"]) },
                MergeChunk::Left { base: v(&["b"]), left: v(&["B"]) },
                MergeChunk::Stable { lines: v(&["c"]) },
            ]
        );
        let m = merge3("a\nb\nc\n", "a\nb\nc\n", "a\nb\nC\n");
        assert_eq!(m[1], MergeChunk::Right { base: v(&["c"]), right: v(&["C"]) });
    }

    #[test]
    fn merges_separate_changes_from_both_sides_without_conflict() {
        let m = merge3("1\n2\n3\n4\n5\n", "1\nL\n3\n4\n5\n", "1\n2\n3\n4\nR\n");
        assert_eq!(
            m,
            vec![
                MergeChunk::Stable { lines: v(&["1"]) },
                MergeChunk::Left { base: v(&["2"]), left: v(&["L"]) },
                MergeChunk::Stable { lines: v(&["3", "4"]) },
                MergeChunk::Right { base: v(&["5"]), right: v(&["R"]) },
            ]
        );
    }

    #[test]
    fn identical_changes_on_both_sides_are_not_a_conflict() {
        let m = merge3("a\nb\n", "a\nX\n", "a\nX\n");
        assert_eq!(m[1], MergeChunk::Same { base: v(&["b"]), lines: v(&["X"]) });
    }

    #[test]
    fn different_changes_to_the_same_line_conflict() {
        let m = merge3("a\nb\nc\n", "a\nL\nc\n", "a\nR\nc\n");
        assert_eq!(m[1], MergeChunk::Conflict { base: v(&["b"]), left: v(&["L"]), right: v(&["R"]) });
    }

    #[test]
    fn adjacent_changes_conflict() {
        let m = merge3("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nC\nd\n");
        assert_eq!(
            m[1],
            MergeChunk::Conflict { base: v(&["b", "c"]), left: v(&["B", "c"]), right: v(&["b", "C"]) }
        );
    }

    #[test]
    fn deletion_against_modification_conflicts() {
        let m = merge3("a\nb\nc\n", "a\nc\n", "a\nB\nc\n");
        assert_eq!(m[1], MergeChunk::Conflict { base: v(&["b"]), left: v(&[]), right: v(&["B"]) });
    }

    #[test]
    fn handles_insertions_at_the_start_and_end() {
        let m = merge3("a\n", "top\na\n", "a\nbottom\n");
        assert_eq!(
            m,
            vec![
                MergeChunk::Left { base: v(&[]), left: v(&["top"]) },
                MergeChunk::Stable { lines: v(&["a"]) },
                MergeChunk::Right { base: v(&[]), right: v(&["bottom"]) },
            ]
        );
    }

    #[test]
    fn both_inserting_different_text_at_the_same_point_conflicts() {
        let m = merge3("a\n", "a\nL\n", "a\nR\n");
        assert_eq!(m[1], MergeChunk::Conflict { base: v(&[]), left: v(&["L"]), right: v(&["R"]) });
    }

    #[test]
    fn an_empty_base_with_different_sides_is_one_conflict() {
        let m = merge3("", "x\n", "y\n");
        assert_eq!(m, vec![MergeChunk::Conflict { base: v(&[]), left: v(&["x"]), right: v(&["y"]) }]);
    }

    #[test]
    fn a_large_change_on_one_side_swallows_overlapping_small_ones() {
        let m = merge3("1\n2\n3\n4\n", "1\nA\nB\n4\n", "1\n2\nX\n4\n");
        assert_eq!(
            m[1],
            MergeChunk::Conflict { base: v(&["2", "3"]), left: v(&["A", "B"]), right: v(&["2", "X"]) }
        );
    }

    #[test]
    fn serializes_with_a_lowercase_kind_tag() {
        let json = serde_json::to_string(&MergeChunk::Stable { lines: v(&["a"]) }).unwrap();
        assert_eq!(json, r#"{"kind":"stable","lines":["a"]}"#);
    }
}
