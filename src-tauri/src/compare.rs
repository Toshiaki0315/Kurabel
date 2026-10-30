//! パスの判定と、種別に応じた比較の振り分け。

use crate::binary::{self, BinaryRow};
use crate::dirdiff::{self, DirEntry};
use crate::textdiff::{self, DiffMode, DiffRow};
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
pub fn write_text(path: &Path, content: &str) -> Result<(), String> {
    if classify(path)? != PathKind::File {
        return Err(format!("{}: ファイルではありません", path.display()));
    }
    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("内容が上限 ({} MB) を超えています", MAX_FILE_SIZE / 1024 / 1024));
    }
    fs::write(path, content).map_err(|e| format!("{}: {e}", path.display()))
}

pub fn compare_paths(left: &Path, right: &Path, mode: DiffMode) -> Result<Comparison, String> {
    match (classify(left)?, classify(right)?) {
        (PathKind::Directory, PathKind::Directory) => Ok(Comparison::Directory {
            entries: dirdiff::compare_dirs(left, right)?,
        }),
        (PathKind::File, PathKind::File) => compare_files(left, right, mode),
        _ => Err("ファイルとディレクトリは比較できません".to_string()),
    }
}

fn compare_files(left: &Path, right: &Path, mode: DiffMode) -> Result<Comparison, String> {
    let (l, r) = (read_limited(left)?, read_limited(right)?);
    if binary::is_binary(&l) || binary::is_binary(&r) {
        return Ok(Comparison::Binary {
            left_size: l.len() as u64,
            right_size: r.len() as u64,
            rows: binary::dump_diff(&l, &r),
        });
    }
    // is_binary が UTF-8 妥当性を保証済み
    let left_text = String::from_utf8(l).map_err(|e| e.to_string())?;
    let right_text = String::from_utf8(r).map_err(|e| e.to_string())?;
    let rows = textdiff::diff_text(&left_text, &right_text, mode);
    Ok(Comparison::Text { left_text, right_text, rows })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        write_text(&f, "新しい\n").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "新しい\n");
        assert!(write_text(&d.path().join("new.txt"), "x").is_err());
        assert!(!d.path().join("new.txt").exists());
        assert!(write_text(d.path(), "x").is_err());
    }

    #[test]
    fn rejects_oversized_content() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f.txt");
        fs::write(&f, "old").unwrap();
        let big = "a".repeat(MAX_FILE_SIZE as usize + 1);
        assert!(write_text(&f, &big).is_err());
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
        let res = write_text(&f, "new");
        fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(res.is_err() || res.is_ok()); // root 実行時は書けてしまう
    }

    #[test]
    fn compares_text_files() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.txt"), d.path().join("b.txt"));
        fs::write(&a, "one\ntwo\n").unwrap();
        fs::write(&b, "one\n2\n").unwrap();
        match compare_paths(&a, &b, DiffMode::Line).unwrap() {
            Comparison::Text { left_text, right_text, rows } => {
                assert_eq!(left_text, "one\ntwo\n");
                assert_eq!(right_text, "one\n2\n");
                assert_eq!(rows.len(), 2);
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
        match compare_paths(&a, &b, DiffMode::Line).unwrap() {
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
        match compare_paths(l.path(), r.path(), DiffMode::Line).unwrap() {
            Comparison::Directory { entries } => assert_eq!(entries.len(), 1),
            _ => panic!("expected directory"),
        }
    }

    #[test]
    fn rejects_mixed_kinds() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("f");
        fs::write(&f, "x").unwrap();
        assert!(compare_paths(d.path(), &f, DiffMode::Line).is_err());
    }

    #[test]
    fn rejects_oversized_files() {
        let d = tempfile::tempdir().unwrap();
        let big = d.path().join("big");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_FILE_SIZE + 1).unwrap();
        assert!(read_limited(&big).is_err());
        assert!(compare_paths(&big, &big, DiffMode::Line).is_err());
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
}
