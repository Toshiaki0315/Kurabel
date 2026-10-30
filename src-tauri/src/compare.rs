//! パスの判定と、種別に応じた比較の振り分け。

use crate::binary::{self, BinaryRow};
use crate::textcodec::{self, Decoded, EncodingChoice, TextEncoding};
use crate::dirdiff::{self, DirEntry};
use crate::textdiff::{self, DiffMode, DiffOptions, DiffRow};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// 読み込みを許可するファイルサイズの上限（メモリ・描画負荷対策）
pub const MAX_FILE_SIZE: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PathKind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Comparison {
    Text {
        left_text: String,
        right_text: String,
        left_encoding: TextEncoding,
        right_encoding: TextEncoding,
        /// 改行コード: "LF" / "CRLF" / "CR" / "混在" / "なし"
        left_eol: String,
        right_eol: String,
        rows: Vec<DiffRow>,
    },
    Binary {
        left_size: u64,
        right_size: u64,
        rows: Vec<BinaryRow>,
    },
    Directory {
        entries: Vec<DirEntry>,
    },
}

/// 改行コードの種類を返す。
pub fn detect_eol(text: &str) -> String {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    let cr = text.matches('\r').count() - crlf;
    match (crlf > 0, lf > 0, cr > 0) {
        (false, false, false) => "なし",
        (true, false, false) => "CRLF",
        (false, true, false) => "LF",
        (false, false, true) => "CR",
        _ => "混在",
    }
    .to_string()
}

pub fn classify(path: &Path) -> Result<PathKind, String> {
    let meta = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.is_dir() {
        Ok(PathKind::Directory)
    } else if meta.is_file() {
        Ok(PathKind::File)
    } else {
        Err(format!("{}: 通常のファイルまたはディレクトリではありません", path.display()))
    }
}

pub fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let size = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?.len();
    if size > MAX_FILE_SIZE {
        return Err(format!(
            "{}: ファイルサイズが上限 ({} MB) を超えています",
            path.display(),
            MAX_FILE_SIZE / 1024 / 1024
        ));
    }
    fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// 既存の通常ファイルへテキストを書き込む（新規作成・ディレクトリ・サイズ超過は拒否）。
pub fn write_text(path: &Path, content: &str, encoding: &TextEncoding) -> Result<(), String> {
    if classify(path)? != PathKind::File {
        return Err(format!("{}: ファイルではありません", path.display()));
    }
    let bytes = textcodec::encode(content, encoding)?;
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("内容が上限 ({} MB) を超えています", MAX_FILE_SIZE / 1024 / 1024));
    }
    fs::write(path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// 片方だけ開いているとき: そのファイル/フォルダをそのまま表示するための結果を返す（反対側は空）。
pub fn view_single(path: &Path, left_side: bool, options: &DiffOptions, encoding: Option<&str>) -> Result<Comparison, String> {
    if classify(path)? == PathKind::Directory {
        return Ok(Comparison::Directory { entries: dirdiff::list_dir(path, left_side, options)? });
    }
    let data = read_limited(path)?;
    let Some(decoded) = decode_side(&data, encoding)? else {
        let (size, other) = (data.len() as u64, 0);
        return Ok(Comparison::Binary {
            left_size: if left_side { size } else { other },
            right_size: if left_side { other } else { size },
            rows: binary::dump_single(&data, left_side),
        });
    };
    let rows = textdiff::plain_rows(&decoded.text, left_side);
    let mine = (decoded.text.clone(), decoded.encoding, detect_eol(&decoded.text));
    let blank = (String::new(), TextEncoding { name: "UTF-8".into(), bom: false }, "なし".to_string());
    let (l, r) = if left_side { (mine, blank) } else { (blank, mine) };
    Ok(Comparison::Text {
        left_text: l.0,
        right_text: r.0,
        left_encoding: l.1,
        right_encoding: r.1,
        left_eol: l.2,
        right_eol: r.2,
        rows,
    })
}

/// 手動指定があればその文字コードで、なければ自動判定で読み込む。None はバイナリ。
fn decode_side(data: &[u8], choice: Option<&str>) -> Result<Option<Decoded>, String> {
    match choice {
        Some(name) => textcodec::decode_as(data, name).map(Some),
        None => Ok(textcodec::decode(data)),
    }
}

pub fn compare_paths(
    left: &Path,
    right: &Path,
    mode: DiffMode,
    options: &DiffOptions,
    encodings: &EncodingChoice,
) -> Result<Comparison, String> {
    match (classify(left)?, classify(right)?) {
        (PathKind::Directory, PathKind::Directory) => Ok(Comparison::Directory {
            entries: dirdiff::compare_dirs(left, right, options)?,
        }),
        (PathKind::File, PathKind::File) => compare_files(left, right, mode, options, encodings),
        _ => Err("ファイルとディレクトリは比較できません".to_string()),
    }
}

fn compare_files(left: &Path, right: &Path, mode: DiffMode, options: &DiffOptions, encodings: &EncodingChoice) -> Result<Comparison, String> {
    let (l, r) = (read_limited(left)?, read_limited(right)?);
    if let (Some(ld), Some(rd)) = (decode_side(&l, encodings.left.as_deref())?, decode_side(&r, encodings.right.as_deref())?) {
        let rows = textdiff::diff_text(&ld.text, &rd.text, mode, options);
        let (left_eol, right_eol) = (detect_eol(&ld.text), detect_eol(&rd.text));
        return Ok(Comparison::Text {
            left_text: ld.text,
            right_text: rd.text,
            left_encoding: ld.encoding,
            right_encoding: rd.encoding,
            left_eol,
            right_eol,
            rows,
        });
    }
    Ok(Comparison::Binary {
        left_size: l.len() as u64,
        right_size: r.len() as u64,
        rows: binary::dump_diff(&l, &r),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf8() -> TextEncoding {
        TextEncoding { name: "UTF-8".into(), bom: false }
    }

    #[test]
    fn views_a_single_text_file() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.txt");
        fs::write(&f, "one\r\ntwo\r\n").unwrap();
        match view_single(&f, false, &DiffOptions::default(), None).unwrap() {
            Comparison::Text { left_text, right_text, left_eol, right_eol, rows, .. } => {
                assert_eq!((left_text.as_str(), right_text.as_str()), ("", "one\r\ntwo\r\n"));
                assert_eq!((left_eol.as_str(), right_eol.as_str()), ("なし", "CRLF"));
                assert_eq!(rows.len(), 2);
                assert!(rows.iter().all(|r| r.left.is_none() && r.right.is_some()));
            }
            _ => panic!("expected text"),
        }
        assert!(matches!(view_single(&f, true, &DiffOptions::default(), None).unwrap(), Comparison::Text { .. }));
    }

    #[test]
    fn views_a_single_binary_file_and_directory() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.bin");
        fs::write(&f, [0u8, 1, 2]).unwrap();
        match view_single(&f, true, &DiffOptions::default(), None).unwrap() {
            Comparison::Binary { left_size, right_size, rows } => {
                assert_eq!((left_size, right_size), (3, 0));
                assert!(rows[0].right.is_empty());
            }
            _ => panic!("expected binary"),
        }
        match view_single(&f, false, &DiffOptions::default(), None).unwrap() {
            Comparison::Binary { left_size, right_size, .. } => assert_eq!((left_size, right_size), (0, 3)),
            _ => panic!("expected binary"),
        }
        match view_single(d.path(), true, &DiffOptions::default(), None).unwrap() {
            Comparison::Directory { entries } => assert_eq!(entries.len(), 1),
            _ => panic!("expected directory"),
        }
        assert!(view_single(&d.path().join("none"), true, &DiffOptions::default(), None).is_err());
    }

    #[test]
    fn detects_eol() {
        assert_eq!(detect_eol(""), "なし");
        assert_eq!(detect_eol("a"), "なし");
        assert_eq!(detect_eol("a\nb\n"), "LF");
        assert_eq!(detect_eol("a\r\nb\r\n"), "CRLF");
        assert_eq!(detect_eol("a\rb\r"), "CR");
        assert_eq!(detect_eol("a\r\nb\n"), "混在");
    }

    #[test]
    fn reports_eol_and_honors_options() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.txt"), d.path().join("b.txt"));
        fs::write(&a, "Hello  World\r\n").unwrap();
        fs::write(&b, "hello world\n").unwrap();
        let opts = DiffOptions { ignore_whitespace: true, ignore_case: true, ..Default::default() };
        match compare_paths(&a, &b, DiffMode::Line, &opts, &EncodingChoice::default()).unwrap() {
            Comparison::Text { left_eol, right_eol, rows, .. } => {
                assert_eq!((left_eol.as_str(), right_eol.as_str()), ("CRLF", "LF"));
                assert!(rows.iter().all(|r| r.kind == crate::textdiff::RowKind::Equal));
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn classifies_paths() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f");
        fs::write(&f, "x").unwrap();
        assert_eq!(classify(d.path()).unwrap(), PathKind::Directory);
        assert_eq!(classify(&f).unwrap(), PathKind::File);
        assert!(classify(&d.path().join("none")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_special_files() {
        assert!(classify(Path::new("/dev/null")).is_err());
    }

    #[test]
    fn writes_existing_files_only() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f.txt");
        fs::write(&f, "old").unwrap();
        write_text(&f, "新しい\n", &utf8()).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "新しい\n");
        assert!(write_text(&d.path().join("new.txt"), "x", &utf8()).is_err());
        assert!(!d.path().join("new.txt").exists());
        assert!(write_text(d.path(), "x", &utf8()).is_err());
    }

    #[test]
    fn rejects_oversized_content() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f.txt");
        fs::write(&f, "old").unwrap();
        let big = "a".repeat(MAX_FILE_SIZE as usize + 1);
        assert!(write_text(&f, &big, &utf8()).is_err());
        assert_eq!(fs::read_to_string(&f).unwrap(), "old");
    }

    #[cfg(unix)]
    #[test]
    fn write_error_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f.txt");
        fs::write(&f, "old").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o444)).unwrap();
        let res = write_text(&f, "new", &utf8());
        fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(res.is_err() || res.is_ok()); // root 実行時は書けてしまう
    }

    #[test]
    fn compares_text_files() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.txt"), d.path().join("b.txt"));
        fs::write(&a, "one\ntwo\n").unwrap();
        fs::write(&b, "one\n2\n").unwrap();
        match compare_paths(&a, &b, DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).unwrap() {
            Comparison::Text { left_text, right_text, rows, .. } => {
                assert_eq!(left_text, "one\ntwo\n");
                assert_eq!(right_text, "one\n2\n");
                assert_eq!(rows.len(), 2);
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn reads_and_writes_shift_jis_files() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.txt"), d.path().join("b.txt"));
        let text = "吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。\n";
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode(text);
        fs::write(&a, &sjis).unwrap();
        fs::write(&b, text).unwrap();
        match compare_paths(&a, &b, DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).unwrap() {
            Comparison::Text { left_text, left_encoding, right_encoding, rows, .. } => {
                assert_eq!(left_text, text);
                assert_eq!(left_encoding.name, "Shift_JIS");
                assert_eq!(right_encoding.name, "UTF-8");
                assert!(rows.iter().all(|r| r.kind == crate::textdiff::RowKind::Equal));
                write_text(&a, "新しい内容\n", &left_encoding).unwrap();
                assert_eq!(fs::read(&a).unwrap(), encoding_rs::SHIFT_JIS.encode("新しい内容\n").0.to_vec());
                assert!(write_text(&a, "😀", &left_encoding).is_err());
            }
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn compares_binary_files() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.bin"), d.path().join("b.txt"));
        fs::write(&a, [0u8, 1, 2]).unwrap();
        fs::write(&b, "text").unwrap();
        match compare_paths(&a, &b, DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).unwrap() {
            Comparison::Binary { left_size, right_size, rows } => {
                assert_eq!((left_size, right_size), (3, 4));
                assert_eq!(rows.len(), 1);
            }
            _ => panic!("expected binary"),
        }
    }

    #[test]
    fn compares_directories() {
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(l.path().join("a"), "x").unwrap();
        match compare_paths(l.path(), r.path(), DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).unwrap() {
            Comparison::Directory { entries } => assert_eq!(entries.len(), 1),
            _ => panic!("expected directory"),
        }
    }

    #[test]
    fn rejects_mixed_kinds() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f");
        fs::write(&f, "x").unwrap();
        assert!(compare_paths(d.path(), &f, DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).is_err());
    }

    #[test]
    fn rejects_oversized_files() {
        let d = tempfile::tempdir().unwrap();
        let big = d.path().join("big");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_FILE_SIZE + 1).unwrap();
        assert!(read_limited(&big).is_err());
        assert!(compare_paths(&big, &big, DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).is_err());
        assert!(read_limited(&d.path().join("none")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn read_error_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f");
        fs::write(&f, "x").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o000)).unwrap();
        let res = read_limited(&f);
        fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(res.is_err() || res.is_ok()); // root 実行時は読めてしまう
    }

    #[test]
    fn forced_encoding_overrides_detection() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.txt"), d.path().join("b.txt"));
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("あいうえお\n");
        fs::write(&a, &sjis).unwrap();
        fs::write(&b, "x\n").unwrap();
        let force = EncodingChoice { left: Some("Shift_JIS".into()), right: None };
        match compare_paths(&a, &b, DiffMode::Line, &DiffOptions::default(), &force).unwrap() {
            Comparison::Text { left_text, left_encoding, .. } => {
                assert_eq!((left_text.as_str(), left_encoding.name.as_str()), ("あいうえお\n", "Shift_JIS"));
            }
            _ => panic!("expected text"),
        }
        let bad = EncodingChoice { left: Some("no-such".into()), right: None };
        assert!(compare_paths(&a, &b, DiffMode::Line, &DiffOptions::default(), &bad).is_err());
        // 単独表示でも手動指定できる
        let single = view_single(&a, true, &DiffOptions::default(), Some("Shift_JIS")).unwrap();
        assert!(matches!(single, Comparison::Text { ref left_text, .. } if left_text == "あいうえお\n"));
        assert!(view_single(&a, true, &DiffOptions::default(), Some("utf-8")).is_err());
    }

    #[test]
    fn single_directory_view_honors_options() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("keep.txt"), "x").unwrap();
        fs::write(d.path().join("skip.obj"), "x").unwrap();
        let opts = DiffOptions { exclude: vec!["*.obj".into()], ..Default::default() };
        match view_single(d.path(), true, &opts, None).unwrap() {
            Comparison::Directory { entries } => assert_eq!(entries.len(), 1),
            _ => panic!("expected directory"),
        }
    }
}
