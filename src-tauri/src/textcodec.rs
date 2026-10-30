//! テキストの文字コード判定とエンコード（UTF-8/16、Shift_JIS、EUC-JP など）。

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextEncoding {
    /// WHATWG のエンコーディング名（例: "UTF-8", "Shift_JIS", "EUC-JP"）
    pub name: String,
    pub bom: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    pub text: String,
    pub encoding: TextEncoding,
}

/// 改行・タブ・ESC（ISO-2022-JP）以外の制御文字を含むものはバイナリとみなす。
fn has_binary_controls(text: &str) -> bool {
    text.chars().any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r' | '\x0b' | '\x0c' | '\x1b'))
}

fn finish(text: std::borrow::Cow<'_, str>, had_errors: bool, enc: &'static Encoding, bom: bool) -> Option<Decoded> {
    if had_errors || has_binary_controls(&text) {
        return None;
    }
    Some(Decoded { text: text.into_owned(), encoding: TextEncoding { name: enc.name().to_string(), bom } })
}

/// バイト列をテキストとして解釈する。テキストと見なせなければ None（バイナリ扱い）。
pub fn decode(data: &[u8]) -> Option<Decoded> {
    if let Some((enc, bom_len)) = Encoding::for_bom(data) {
        let (text, had_errors) = enc.decode_without_bom_handling(&data[bom_len..]);
        return finish(text, had_errors, enc, true);
    }
    if data.contains(&0) {
        return None;
    }
    if let Ok(s) = std::str::from_utf8(data) {
        return finish(s.into(), false, UTF_8, false);
    }
    let mut detector = EncodingDetector::new(Iso2022JpDetection::Allow);
    detector.feed(data, true);
    let enc = detector.guess(None, Utf8Detection::Deny);
    let (text, had_errors) = enc.decode_without_bom_handling(data);
    finish(text, had_errors, enc, false)
}

/// 元の文字コード（と BOM）でバイト列へ戻す。表現できない文字があればエラー。
pub fn encode(text: &str, encoding: &TextEncoding) -> Result<Vec<u8>, String> {
    let enc = Encoding::for_label(encoding.name.as_bytes())
        .ok_or_else(|| format!("未対応の文字コードです: {}", encoding.name))?;
    let mut out = Vec::new();
    if enc == UTF_16LE || enc == UTF_16BE {
        if encoding.bom {
            out.extend(if enc == UTF_16LE { [0xFF, 0xFE] } else { [0xFE, 0xFF] });
        }
        for unit in text.encode_utf16() {
            out.extend(if enc == UTF_16LE { unit.to_le_bytes() } else { unit.to_be_bytes() });
        }
        return Ok(out);
    }
    if enc == UTF_8 && encoding.bom {
        out.extend([0xEF, 0xBB, 0xBF]);
    }
    let (bytes, used, unmappable) = enc.encode(text);
    if unmappable || used != enc {
        return Err(format!("{} で表現できない文字が含まれています", encoding.name));
    }
    out.extend(bytes.iter());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::{EUC_JP, SHIFT_JIS};

    const JP: &str = "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。\nなんでも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。\n";

    fn enc(name: &str, bom: bool) -> TextEncoding {
        TextEncoding { name: name.into(), bom }
    }

    #[test]
    fn decodes_utf8_with_and_without_bom() {
        let d = decode("héllo\n日本語".as_bytes()).unwrap();
        assert_eq!(d.encoding, enc("UTF-8", false));
        let d = decode(&[0xEF, 0xBB, 0xBF, b'a']).unwrap();
        assert_eq!((d.text.as_str(), d.encoding), ("a", enc("UTF-8", true)));
        assert_eq!(decode(b"").unwrap().text, "");
    }

    #[test]
    fn detects_japanese_legacy_encodings() {
        for (e, name) in [(SHIFT_JIS, "Shift_JIS"), (EUC_JP, "EUC-JP")] {
            let (bytes, _, _) = e.encode(JP);
            let d = decode(&bytes).unwrap();
            assert_eq!(d.text, JP);
            assert_eq!(d.encoding, enc(name, false));
            assert_eq!(encode(&d.text, &d.encoding).unwrap(), bytes.to_vec());
        }
    }

    #[test]
    fn round_trips_utf16_with_bom() {
        for (name, bom) in [("UTF-16LE", [0xFF, 0xFE]), ("UTF-16BE", [0xFE, 0xFF])] {
            let e = enc(name, true);
            let bytes = encode("a日\n", &e).unwrap();
            assert_eq!(&bytes[..2], &bom);
            let d = decode(&bytes).unwrap();
            assert_eq!((d.text.as_str(), d.encoding.clone()), ("a日\n", e));
        }
        assert_eq!(encode("a", &enc("UTF-16LE", false)).unwrap(), vec![b'a', 0]);
    }

    #[test]
    fn round_trips_utf8_bom() {
        let bytes = encode("a", &enc("UTF-8", true)).unwrap();
        assert_eq!(bytes, vec![0xEF, 0xBB, 0xBF, b'a']);
    }

    #[test]
    fn treats_binary_as_none() {
        assert!(decode(&[1, 0, 2]).is_none());
        assert!(decode(&[0x41, 0x01, 0x42]).is_none()); // 制御文字
        assert!(decode(&[0xEF, 0xBB, 0xBF, 0xFF]).is_none()); // BOM付きだが不正
        assert!(decode(b"%PDF-1.7\n\x81\x82\x03\xff").is_none());
    }

    #[test]
    fn rejects_unmappable_and_unknown_encodings() {
        assert!(encode("😀", &enc("Shift_JIS", false)).unwrap_err().contains("表現できない"));
        assert!(encode("a", &enc("no-such-encoding", false)).is_err());
        assert!(encode("a", &enc("replacement", false)).is_err());
    }
}
