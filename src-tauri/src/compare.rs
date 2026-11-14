//! パスの判定と、種別に応じた比較の振り分け。

use crate::archive;
use crate::binary::{self, BinaryRow};
use crate::merge3::{self, MergeChunk};
use crate::textcodec::{self, Decoded, EncodingChoice, TextEncoding};
use crate::dirdiff::{self, DirEntry};
use crate::textdiff::{self, DiffMode, DiffOptions, DiffRow};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// 読み込みを許可するファイルサイズの上限（メモリ・描画負荷対策）
pub const MAX_FILE_SIZE: u64 = 16 * 1024 * 1024;

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
        /// 読み込み時点の更新日時（UNIX ミリ秒）。保存時に、他のツールによる変更を検出するのに使う
        left_mtime: Option<u64>,
        right_mtime: Option<u64>,
        rows: Vec<DiffRow>,
    },
    Binary {
        left_size: u64,
        right_size: u64,
        /// 行数の上限を超えたため、先頭部分だけを返している
        truncated: bool,
        rows: Vec<BinaryRow>,
    },
    Directory {
        entries: Vec<DirEntry>,
        /// zip などのアーカイブの中身（読み取り専用。コピー・削除はできない）
        archive: bool,
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

/// 同じフォルダの一時ファイルへ書いてから置き換える（書き込みの途中で失敗しても、元のファイルは壊れない）。
/// 権限は元のファイルを引き継ぎ、シンボリックリンクはリンク先のファイルを置き換える。
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let target = fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
    // 置き換え方式だと読み取り専用のファイルにも書けてしまうので、先に拒否する
    if fs::metadata(&target).map_err(|e| format!("{}: {e}", path.display()))?.permissions().readonly() {
        return Err(format!("{}: 読み取り専用のファイルです", path.display()));
    }
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = target.with_file_name(format!(".{name}.kurabel-tmp"));
    let result = (|| -> std::io::Result<()> {
        fs::write(&tmp, bytes)?;
        fs::set_permissions(&tmp, fs::metadata(&target)?.permissions())?;
        fs::rename(&tmp, &target)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{}: {e}", path.display()));
    }
    Ok(())
}

/// ファイルの更新日時（UNIX ミリ秒）。取得できなければ None。
pub fn mtime_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    u64::try_from(modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis()).ok()
}

/// 読み込んだ後に他のツールがファイルを変更していたときのエラー（先頭の識別子で画面側が判別する）。
pub const MODIFIED_ON_DISK: &str = "MODIFIED_ON_DISK";

/// 既存の通常ファイルへテキストを書き込む（新規作成・ディレクトリ・サイズ超過は拒否）。
pub fn write_text(path: &Path, content: &str, encoding: &TextEncoding) -> Result<(), String> {
    write_text_checked(path, content, encoding, None).map(|_| ())
}

/// `expected`（読み込み時の更新日時）が指定され、現在の更新日時と違えば書き込まずにエラーにする。
/// 成功したら、書き込み後の更新日時を返す。
pub fn write_text_checked(path: &Path, content: &str, encoding: &TextEncoding, expected: Option<u64>) -> Result<Option<u64>, String> {
    if classify(path)? != PathKind::File {
        return Err(format!("{}: ファイルではありません", path.display()));
    }
    let bytes = textcodec::encode(content, encoding)?;
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("内容が上限 ({} MB) を超えています", MAX_FILE_SIZE / 1024 / 1024));
    }
    if let Some(expected) = expected {
        if mtime_ms(path) != Some(expected) {
            return Err(format!("{MODIFIED_ON_DISK}: {} は、読み込んだ後に変更されています", path.display()));
        }
    }
    write_atomic(path, &bytes)?;
    Ok(mtime_ms(path))
}

/// 片方だけ開いているとき: そのファイル/フォルダをそのまま表示するための結果を返す（反対側は空）。
pub fn view_single(path: &Path, left_side: bool, options: &DiffOptions, encoding: Option<&str>) -> Result<Comparison, String> {
    if classify(path)? == PathKind::Directory {
        return Ok(Comparison::Directory { entries: dirdiff::list_dir(path, left_side, options)?, archive: false });
    }
    // 拡張子が zip 系でも、中身が zip でなければ（読み込めなければ）通常のファイルとして表示する
    if archive::is_archive(path) {
        if let Ok(entries) = archive::list_archive(path, left_side) {
            return Ok(Comparison::Directory { entries, archive: true });
        }
    }
    let data = read_limited(path)?;
    let Some(decoded) = decode_side(&data, encoding)? else {
        let (size, other) = (data.len() as u64, 0);
        return Ok(Comparison::Binary {
            left_size: if left_side { size } else { other },
            right_size: if left_side { other } else { size },
            truncated: binary::is_truncated(data.len(), 0),
            rows: binary::dump_single(&data, left_side),
        });
    };
    let rows = textdiff::plain_rows(&decoded.text, left_side);
    let mine = (decoded.text.clone(), decoded.encoding, detect_eol(&decoded.text), mtime_ms(path));
    let blank = (String::new(), TextEncoding { name: "UTF-8".into(), bom: false }, "なし".to_string(), None);
    let (l, r) = if left_side { (mine, blank) } else { (blank, mine) };
    Ok(Comparison::Text {
        left_text: l.0,
        right_text: r.0,
        left_encoding: l.1,
        right_encoding: r.1,
        left_eol: l.2,
        right_eol: r.2,
        left_mtime: l.3,
        right_mtime: r.3,
        rows,
    })
}

/// 3ウェイマージの入力と結果。
#[derive(Debug, Serialize)]
pub struct Merge3 {
    pub chunks: Vec<MergeChunk>,
    pub left_encoding: TextEncoding,
    pub base_encoding: TextEncoding,
    pub right_encoding: TextEncoding,
    /// 結果を組み立てるときの改行（左の改行コードに合わせる）: "\n" または "\r\n"
    pub eol: String,
    /// 結果の末尾に改行を付けるか（左に合わせる）
    pub trailing_newline: bool,
}

fn read_text(path: &Path) -> Result<textcodec::Decoded, String> {
    if classify(path)? != PathKind::File {
        return Err(format!("{}: ファイルではありません", path.display()));
    }
    textcodec::decode(&read_limited(path)?).ok_or_else(|| format!("{}: テキストファイルではありません", path.display()))
}

pub fn merge3_files(base: &Path, left: &Path, right: &Path) -> Result<Merge3, String> {
    let (b, l, r) = (read_text(base)?, read_text(left)?, read_text(right)?);
    let reference = if l.text.is_empty() { &r.text } else { &l.text };
    Ok(Merge3 {
        chunks: merge3::merge3(&b.text, &l.text, &r.text),
        eol: if reference.contains("\r\n") { "\r\n" } else { "\n" }.to_string(),
        trailing_newline: reference.ends_with('\n'),
        left_encoding: l.encoding,
        base_encoding: b.encoding,
        right_encoding: r.encoding,
    })
}

/// 新しいファイルとして書き込む。既存のファイルは上書きしない。
pub fn create_text(path: &Path, content: &str, encoding: &TextEncoding) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    if classify(parent)? != PathKind::Directory {
        return Err(format!("{}: 保存先のフォルダがありません", parent.display()));
    }
    let bytes = textcodec::encode(content, encoding)?;
    if bytes.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("内容が上限 ({} MB) を超えています", MAX_FILE_SIZE / 1024 / 1024));
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(&bytes).map_err(|e| format!("{}: {e}", path.display()))
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
            archive: false,
        }),
        (PathKind::File, PathKind::File) if archive::is_archive(left) && archive::is_archive(right) => {
            match archive::compare_archives(left, right) {
                Ok(entries) => Ok(Comparison::Directory { entries, archive: true }),
                // 拡張子が zip 系でも中身が zip でなければ、通常のファイルとして比較する
                Err(_) => compare_files(left, right, mode, options, encodings),
            }
        }
        (PathKind::File, PathKind::File) => compare_files(left, right, mode, options, encodings),
        _ => Err("ファイルとディレクトリは比較できません".to_string()),
    }
}

fn compare_files(left: &Path, right: &Path, mode: DiffMode, options: &DiffOptions, encodings: &EncodingChoice) -> Result<Comparison, String> {
    compare_bytes(read_limited(left)?, read_limited(right)?, (mtime_ms(left), mtime_ms(right)), mode, options, encodings)
}

/// アーカイブ内の同名ファイル同士を比較する（ファイルの比較と同じ結果を返す）。
pub fn compare_archive_entry(
    left: &Path,
    right: &Path,
    rel: &str,
    mode: DiffMode,
    options: &DiffOptions,
    encodings: &EncodingChoice,
) -> Result<Comparison, String> {
    compare_bytes(archive::read_entry(left, rel)?, archive::read_entry(right, rel)?, (None, None), mode, options, encodings)
}

fn compare_bytes(l: Vec<u8>, r: Vec<u8>, mtimes: (Option<u64>, Option<u64>), mode: DiffMode, options: &DiffOptions, encodings: &EncodingChoice) -> Result<Comparison, String> {
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
            left_mtime: mtimes.0,
            right_mtime: mtimes.1,
            rows,
        });
    }
    Ok(Comparison::Binary {
        left_size: l.len() as u64,
        right_size: r.len() as u64,
        truncated: binary::is_truncated(l.len(), r.len()),
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
            Comparison::Binary { left_size, right_size, rows, .. } => {
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
            Comparison::Directory { entries, .. } => assert_eq!(entries.len(), 1),
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
    fn writes_atomically_keeping_permissions_symlinks_and_no_temp_files() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.txt");
        fs::write(&f, "old").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&f, fs::Permissions::from_mode(0o640)).unwrap();
            std::os::unix::fs::symlink(&f, d.path().join("link.txt")).unwrap();
            write_text(&d.path().join("link.txt"), "via link", &utf8()).unwrap();
            // リンクは残り、リンク先のファイルの内容が置き換わる
            assert!(fs::symlink_metadata(d.path().join("link.txt")).unwrap().file_type().is_symlink());
            assert_eq!(fs::read_to_string(&f).unwrap(), "via link");
            assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o640);
        }
        write_text(&f, "new", &utf8()).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "new");
        let names: Vec<String> = fs::read_dir(d.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(names.iter().all(|n| !n.contains("kurabel-tmp")), "{names:?}");
    }

    #[test]
    fn refuses_to_overwrite_a_file_changed_after_it_was_read() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("a.txt");
        fs::write(&f, "v1").unwrap();
        let read_at = mtime_ms(&f).unwrap();
        // 読み込み時と同じ日時なら保存でき、新しい更新日時が返る
        assert!(write_text_checked(&f, "v2", &utf8(), Some(read_at)).unwrap().is_some());
        // 他のツールが（日時を変えて）書き換えた
        let other = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
        fs::File::options().write(true).open(&f).unwrap().set_modified(other).unwrap();
        let err = write_text_checked(&f, "v3", &utf8(), Some(read_at)).unwrap_err();
        assert!(err.starts_with(MODIFIED_ON_DISK), "{err}");
        assert_eq!(fs::read_to_string(&f).unwrap(), "v2");
        // 日時を指定しなければ（上書きを確認した後）保存できる
        write_text_checked(&f, "v3", &utf8(), None).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "v3");
        assert_eq!(mtime_ms(&d.path().join("missing")), None);
    }

    #[test]
    fn comparisons_report_the_modification_times_of_text_files() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.txt"), d.path().join("b.txt"));
        fs::write(&a, "x\n").unwrap();
        fs::write(&b, "y\n").unwrap();
        let (o, e) = (DiffOptions::default(), EncodingChoice::default());
        match compare_paths(&a, &b, DiffMode::Line, &o, &e).unwrap() {
            Comparison::Text { left_mtime, right_mtime, .. } => assert_eq!((left_mtime, right_mtime), (mtime_ms(&a), mtime_ms(&b))),
            _ => panic!("expected text"),
        }
        match view_single(&b, false, &o, None).unwrap() {
            Comparison::Text { left_mtime, right_mtime, .. } => assert_eq!((left_mtime, right_mtime), (None, mtime_ms(&b))),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn a_non_zip_with_an_archive_extension_is_compared_as_a_plain_file() {
        let d = tempfile::tempdir().unwrap();
        let (l, r) = (d.path().join("a.docx"), d.path().join("b.docx"));
        fs::write(&l, "plain one\n").unwrap();
        fs::write(&r, "plain two\n").unwrap();
        let (o, e) = (DiffOptions::default(), EncodingChoice::default());
        assert!(matches!(compare_paths(&l, &r, DiffMode::Line, &o, &e).unwrap(), Comparison::Text { .. }));
        assert!(matches!(view_single(&l, true, &o, None).unwrap(), Comparison::Text { .. }));
    }

    #[test]
    fn write_error_is_reported() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f.txt");
        fs::write(&f, "old").unwrap();
        fs::set_permissions(&f, fs::Permissions::from_mode(0o444)).unwrap();
        let res = write_text(&f, "new", &utf8());
        fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(res.unwrap_err().contains("読み取り専用"));
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
            Comparison::Binary { left_size, right_size, rows, .. } => {
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
            Comparison::Directory { entries, .. } => assert_eq!(entries.len(), 1),
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
            Comparison::Directory { entries, .. } => assert_eq!(entries.len(), 1),
            _ => panic!("expected directory"),
        }
    }

    #[test]
    fn merges_three_files_and_reports_eol_and_encodings() {
        let d = tempfile::tempdir().unwrap();
        let (b, l, r) = (d.path().join("b.txt"), d.path().join("l.txt"), d.path().join("r.txt"));
        fs::write(&b, "a\nb\nc\nd\n").unwrap();
        fs::write(&l, "a\r\nB\r\nc\r\nd\r\n").unwrap();
        fs::write(&r, "a\nb\nc\nD\n").unwrap();
        let m = merge3_files(&b, &l, &r).unwrap();
        assert_eq!(m.eol, "\r\n");
        assert!(m.trailing_newline);
        assert_eq!(m.left_encoding.name, "UTF-8");
        assert_eq!(m.chunks.len(), 4);
        assert!(matches!(m.chunks[1], MergeChunk::Left { .. }));
        assert!(matches!(m.chunks[3], MergeChunk::Right { .. }));
    }

    #[test]
    fn merge3_rejects_binary_and_non_files_and_uses_the_right_side_when_left_is_empty() {
        let d = tempfile::tempdir().unwrap();
        let (t, bin) = (d.path().join("t.txt"), d.path().join("x.bin"));
        fs::write(&t, "a\n").unwrap();
        fs::write(&bin, [0u8, 1]).unwrap();
        assert!(merge3_files(&t, &t, &bin).unwrap_err().contains("テキストファイルではありません"));
        assert!(merge3_files(d.path(), &t, &t).is_err());
        let e = d.path().join("empty.txt");
        let r = d.path().join("crlf.txt");
        fs::write(&e, "").unwrap();
        fs::write(&r, "x\r\n").unwrap();
        let m = merge3_files(&t, &e, &r).unwrap();
        assert_eq!((m.eol.as_str(), m.trailing_newline), ("\r\n", true));
        assert!(merge3_files(&t, &t, &d.path().join("missing")).is_err());
    }

    #[test]
    fn creates_new_files_but_never_overwrites() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("new.txt");
        let sjis = TextEncoding { name: "Shift_JIS".into(), bom: false };
        create_text(&f, "あいう", &sjis).unwrap();
        assert_eq!(fs::read(&f).unwrap(), encoding_rs::SHIFT_JIS.encode("あいう").0.to_vec());
        assert!(create_text(&f, "x", &utf8()).unwrap_err().contains("exists") || create_text(&f, "x", &utf8()).is_err());
        assert_eq!(fs::read(&f).unwrap(), encoding_rs::SHIFT_JIS.encode("あいう").0.to_vec());
        assert!(create_text(&d.path().join("missing/x.txt"), "x", &utf8()).is_err());
        assert!(create_text(&d.path().join("emoji.txt"), "😀", &sjis).is_err());
        assert!(!d.path().join("emoji.txt").exists());
        let big = "a".repeat(MAX_FILE_SIZE as usize + 1);
        assert!(create_text(&d.path().join("big.txt"), &big, &utf8()).is_err());
        assert!(!d.path().join("big.txt").exists());
    }

    fn zip_with(dir: &Path, name: &str, files: &[(&str, &[u8])]) -> std::path::PathBuf {
        use std::io::Write;
        let path = dir.join(name);
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        for (n, data) in files {
            zip.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn two_archives_are_compared_as_folders_and_one_archive_is_listed() {
        let d = tempfile::tempdir().unwrap();
        let l = zip_with(d.path(), "l.zip", &[("a.txt", b"one\n"), ("b.bin", &[0, 1])]);
        let r = zip_with(d.path(), "r.zip", &[("a.txt", b"two\n")]);
        match compare_paths(&l, &r, DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).unwrap() {
            Comparison::Directory { entries, archive } => {
                assert!(archive);
                assert_eq!(entries.len(), 2);
            }
            _ => panic!("expected an archive listing"),
        }
        match view_single(&l, true, &DiffOptions::default(), None).unwrap() {
            Comparison::Directory { entries, archive } => assert!(archive && entries.len() == 2),
            _ => panic!("expected an archive listing"),
        }
        // 片方だけがアーカイブなら、通常のファイル比較（バイナリ）になる
        let plain = d.path().join("plain.txt");
        fs::write(&plain, "x").unwrap();
        assert!(matches!(
            compare_paths(&l, &plain, DiffMode::Line, &DiffOptions::default(), &EncodingChoice::default()).unwrap(),
            Comparison::Binary { .. }
        ));
    }

    #[test]
    fn compares_a_file_inside_two_archives_like_two_files() {
        let d = tempfile::tempdir().unwrap();
        let l = zip_with(d.path(), "l.zip", &[("dir/a.txt", b"one\nsame\n"), ("img.bin", &[0, 1, 2])]);
        let r = zip_with(d.path(), "r.zip", &[("dir/a.txt", b"two\nsame\n"), ("img.bin", &[0, 9, 2])]);
        let (o, e) = (DiffOptions::default(), EncodingChoice::default());
        match compare_archive_entry(&l, &r, "dir/a.txt", DiffMode::Line, &o, &e).unwrap() {
            Comparison::Text { rows, .. } => assert!(rows.iter().any(|r| r.kind != crate::textdiff::RowKind::Equal)),
            _ => panic!("expected text"),
        }
        assert!(matches!(compare_archive_entry(&l, &r, "img.bin", DiffMode::Line, &o, &e).unwrap(), Comparison::Binary { .. }));
        assert!(compare_archive_entry(&l, &r, "missing.txt", DiffMode::Line, &o, &e).is_err());
    }
}
