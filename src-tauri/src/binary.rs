//! バイナリの判定と16進ダンプ差分。

use serde::Serialize;

pub const BYTES_PER_ROW: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ByteCell {
    pub hex: String,
    pub ascii: String,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BinaryRow {
    pub offset: u64,
    pub left: Vec<ByteCell>,
    pub right: Vec<ByteCell>,
}

fn cell(byte: u8, other: Option<&u8>) -> ByteCell {
    let ascii = if (0x20..0x7f).contains(&byte) { byte as char } else { '.' };
    ByteCell {
        hex: hex::encode([byte]),
        ascii: ascii.to_string(),
        changed: other != Some(&byte),
    }
}

/// 片方だけ開いているとき用の16進ダンプ（ハイライトなし、反対側は空）。
pub fn dump_single(data: &[u8], left_side: bool) -> Vec<BinaryRow> {
    data.chunks(BYTES_PER_ROW)
        .enumerate()
        .map(|(i, chunk)| {
            let cells: Vec<ByteCell> = chunk.iter().map(|b| cell(*b, Some(b))).collect();
            let (left, right) = if left_side { (cells, vec![]) } else { (vec![], cells) };
            BinaryRow { offset: (i * BYTES_PER_ROW) as u64, left, right }
        })
        .collect()
}

pub fn dump_diff(left: &[u8], right: &[u8]) -> Vec<BinaryRow> {
    let total = left.len().max(right.len());
    let mut rows = Vec::new();
    let mut offset = 0;
    while offset < total {
        let end = (offset + BYTES_PER_ROW).min(total);
        let side = |data: &[u8], other: &[u8]| -> Vec<ByteCell> {
            (offset..end)
                .filter_map(|i| data.get(i).map(|b| cell(*b, other.get(i))))
                .collect()
        };
        rows.push(BinaryRow {
            offset: offset as u64,
            left: side(left, right),
            right: side(right, left),
        });
        offset = end;
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_data_has_no_changes() {
        let rows = dump_diff(b"ABC", b"ABC");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].left.iter().all(|c| !c.changed));
        assert_eq!(rows[0].left[0].hex, "41");
        assert_eq!(rows[0].left[0].ascii, "A");
    }

    #[test]
    fn marks_differing_and_missing_bytes() {
        let rows = dump_diff(&[0x41, 0x00], &[0x41, 0x01, 0x02]);
        assert!(!rows[0].left[0].changed);
        assert!(rows[0].left[1].changed);
        assert_eq!(rows[0].left[1].ascii, ".");
        assert_eq!(rows[0].left.len(), 2);
        assert_eq!(rows[0].right.len(), 3);
        assert!(rows[0].right[2].changed);
    }

    #[test]
    fn splits_into_rows_of_16() {
        let data = vec![7u8; 33];
        let rows = dump_diff(&data, &data);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1].offset, 16);
        assert_eq!(rows[2].left.len(), 1);
    }

    #[test]
    fn empty_inputs_yield_no_rows() {
        assert!(dump_diff(&[], &[]).is_empty());
    }

    #[test]
    fn dump_single_has_no_highlights_and_one_empty_side() {
        let rows = dump_single(&[0x41; 17], true);
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.right.is_empty() && r.left.iter().all(|c| !c.changed)));
        let rows = dump_single(b"AB", false);
        assert!(rows[0].left.is_empty() && rows[0].right.len() == 2);
        assert!(dump_single(&[], true).is_empty());
    }
}
