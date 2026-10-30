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

/// NUL バイトを含む、または UTF-8 として不正ならバイナリとみなす。
pub fn is_binary(data: &[u8]) -> bool {
    data.contains(&0) || std::str::from_utf8(data).is_err()
}

fn cell(byte: u8, other: Option<&u8>) -> ByteCell {
    let ascii = if (0x20..0x7f).contains(&byte) { byte as char } else { '.' };
    ByteCell {
        hex: hex::encode([byte]),
        ascii: ascii.to_string(),
        changed: other != Some(&byte),
    }
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
    fn detects_binary() {
        assert!(is_binary(&[1, 0, 2]));
        assert!(is_binary(&[0xff, 0xfe]));
        assert!(!is_binary("こんにちは\n".as_bytes()));
        assert!(!is_binary(b""));
    }

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
}
