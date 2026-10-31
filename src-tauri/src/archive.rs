//! zip 系アーカイブ（zip / jar / docx / xlsx など）の中身の一覧・比較・読み出し。
//! 展開はしない（ディスクへ書かない）ので、エントリ名がパスとして使われることはない。
//! 一覧は中央ディレクトリの情報（サイズ・CRC32・更新日時）だけを使い、内容は読まずに高速に比較する。

use crate::compare::MAX_FILE_SIZE;
use crate::dirdiff::{DirEntry, DirStatus, NodeKind, MAX_ENTRIES};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

const ARCHIVE_EXTENSIONS: &[&str] = &["zip", "jar", "war", "ear", "apk", "docx", "xlsx", "pptx", "odt", "ods", "odp"];

pub fn is_archive(path: &Path) -> bool {
    path.extension().is_some_and(|e| ARCHIVE_EXTENSIONS.contains(&e.to_string_lossy().to_lowercase().as_str()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Item {
    kind: NodeKind,
    size: u64,
    crc: u32,
    modified: Option<i64>,
}

/// 1970-01-01 からの経過日数（グレゴリオ暦）。
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// エントリ名を、`/` 区切りの相対パスに正規化する。空・絶対パス・`..` を含むものは None（表示しない）。
fn normalize(name: &str) -> Option<String> {
    let name = name.replace('\\', "/");
    let mut parts = Vec::new();
    for part in name.split('/') {
        match part {
            "" | "." => continue,
            ".." => return None,
            p => parts.push(p),
        }
    }
    if parts.is_empty() || name.starts_with('/') || parts[0].ends_with(':') {
        return None;
    }
    Some(parts.join("/"))
}

fn list(path: &Path) -> Result<BTreeMap<String, Item>, String> {
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("{}: zip として読み込めません ({e})", path.display()))?;
    if archive.len() > MAX_ENTRIES {
        return Err(format!("エントリ数が上限 ({MAX_ENTRIES}) を超えました"));
    }
    let mut items = BTreeMap::new();
    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i).map_err(|e| e.to_string())?;
        if entry.is_symlink() {
            continue;
        }
        let Some(rel) = entry.name().ok().and_then(|n| normalize(&n)) else { continue };
        let modified = entry.last_modified().map(|d| {
            days_from_civil(d.year().into(), d.month().into(), d.day().into()) * 86_400
                + i64::from(d.hour()) * 3600
                + i64::from(d.minute()) * 60
                + i64::from(d.second())
        });
        let kind = if entry.is_dir() { NodeKind::Directory } else { NodeKind::File };
        // 途中のフォルダが明示されていなくても、ツリーとして表示できるように補う
        let mut at = 0;
        while let Some(pos) = rel[at..].find('/') {
            items
                .entry(rel[..at + pos].to_string())
                .or_insert(Item { kind: NodeKind::Directory, size: 0, crc: 0, modified: None });
            at += pos + 1;
        }
        items.insert(rel, Item { kind, size: entry.size(), crc: entry.crc32(), modified });
    }
    Ok(items)
}

fn entry_of(path: &str, left: Option<&Item>, right: Option<&Item>, status: DirStatus) -> DirEntry {
    let size = |i: Option<&Item>| i.filter(|i| i.kind == NodeKind::File).map(|i| i.size);
    DirEntry {
        path: path.to_string(),
        left: left.map(|i| i.kind),
        right: right.map(|i| i.kind),
        status,
        left_size: size(left),
        right_size: size(right),
        left_modified: left.and_then(|i| i.modified),
        right_modified: right.and_then(|i| i.modified),
    }
}

/// 2つのアーカイブの中身を比較する（サイズと CRC32 が同じなら同一）。
pub fn compare_archives(left: &Path, right: &Path) -> Result<Vec<DirEntry>, String> {
    let (lt, rt) = (list(left)?, list(right)?);
    let mut keys: Vec<&String> = lt.keys().chain(rt.keys()).collect();
    keys.sort();
    keys.dedup();
    Ok(keys
        .into_iter()
        .map(|key| {
            let (l, r) = (lt.get(key), rt.get(key));
            let status = match (l, r) {
                (Some(_), None) => DirStatus::Removed,
                (None, Some(_)) => DirStatus::Added,
                (Some(a), Some(b)) if a.kind != b.kind => DirStatus::Modified,
                (Some(a), Some(b)) if a.kind == NodeKind::File && (a.size != b.size || a.crc != b.crc) => DirStatus::Modified,
                _ => DirStatus::Same,
            };
            entry_of(key, l, r, status)
        })
        .collect())
}

/// 片方だけ開いているとき用の一覧（比較対象がないので状態は Same）。
pub fn list_archive(path: &Path, left_side: bool) -> Result<Vec<DirEntry>, String> {
    Ok(list(path)?
        .iter()
        .map(|(key, item)| {
            let (l, r) = if left_side { (Some(item), None) } else { (None, Some(item)) };
            entry_of(key, l, r, DirStatus::Same)
        })
        .collect())
}

/// アーカイブ内の1ファイルの内容を読む（サイズ上限つき。暗号化・シンボリックリンクは拒否）。
pub fn read_entry(archive_path: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let file = File::open(archive_path).map_err(|e| format!("{}: {e}", archive_path.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("{}: zip として読み込めません ({e})", archive_path.display()))?;
    let index = (0..archive.len())
        .find(|&i| {
            archive
                .by_index_raw(i)
                .ok()
                .and_then(|e| e.name().ok().and_then(|n| normalize(&n)))
                .is_some_and(|n| n == rel)
        })
        .ok_or_else(|| format!("{rel}: アーカイブ内に見つかりません"))?;
    let entry = archive.by_index(index).map_err(|e| format!("{rel}: {e}"))?;
    if entry.is_dir() || entry.is_symlink() {
        return Err(format!("{rel}: 通常のファイルではありません"));
    }
    if entry.size() > MAX_FILE_SIZE {
        return Err(format!("{rel}: ファイルサイズが上限 ({} MB) を超えています", MAX_FILE_SIZE / 1024 / 1024));
    }
    // 宣言されたサイズを信用せず、読み込む量そのものに上限をかける（zip 爆弾対策）
    let mut data = Vec::new();
    entry.take(MAX_FILE_SIZE + 1).read_to_end(&mut data).map_err(|e| format!("{rel}: {e}"))?;
    if data.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("{rel}: 展開後のサイズが上限 ({} MB) を超えています", MAX_FILE_SIZE / 1024 / 1024));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn make_zip(dir: &Path, name: &str, files: &[(&str, &[u8])]) -> std::path::PathBuf {
        let path = dir.join(name);
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (n, data) in files {
            if n.ends_with('/') {
                zip.add_directory(*n, opts).unwrap();
            } else {
                zip.start_file(*n, opts).unwrap();
                zip.write_all(data).unwrap();
            }
        }
        zip.finish().unwrap();
        path
    }

    fn status_of(e: &[DirEntry], p: &str) -> DirStatus {
        e.iter().find(|x| x.path == p).unwrap().status
    }

    #[test]
    fn detects_archive_extensions_case_insensitively() {
        for ok in ["a.zip", "A.ZIP", "x.jar", "doc.docx", "s.xlsx", "p.pptx", "o.odt"] {
            assert!(is_archive(Path::new(ok)), "{ok}");
        }
        for ng in ["a.txt", "zip", "a.zip.bak", "a.tar.gz"] {
            assert!(!is_archive(Path::new(ng)), "{ng}");
        }
    }

    #[test]
    fn normalizes_names_and_rejects_unsafe_ones() {
        assert_eq!(normalize("a/b.txt").as_deref(), Some("a/b.txt"));
        assert_eq!(normalize("a\\b\\c.txt").as_deref(), Some("a/b/c.txt"));
        assert_eq!(normalize("./a//b/").as_deref(), Some("a/b"));
        for bad in ["", "/", "../x", "a/../../x", "/etc/passwd", "C:/x"] {
            assert_eq!(normalize(bad), None, "{bad}");
        }
    }

    #[test]
    fn converts_dos_dates_to_unix_seconds() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2024, 2, 29), 19_782);
        assert_eq!(days_from_civil(1969, 12, 31), -1);
    }

    #[test]
    fn compares_entries_by_size_and_crc_without_reading_content() {
        let d = tempfile::tempdir().unwrap();
        let l = make_zip(d.path(), "l.zip", &[("same.txt", b"same"), ("mod.txt", b"aaa"), ("crc.txt", b"abc"), ("gone.txt", b"x"), ("dir/", b""), ("dir/in.txt", b"1")]);
        let r = make_zip(d.path(), "r.zip", &[("same.txt", b"same"), ("mod.txt", b"aaaa"), ("crc.txt", b"abd"), ("new.txt", b"y"), ("dir/", b""), ("dir/in.txt", b"1")]);
        let e = compare_archives(&l, &r).unwrap();
        assert_eq!(status_of(&e, "same.txt"), DirStatus::Same);
        assert_eq!(status_of(&e, "mod.txt"), DirStatus::Modified); // サイズが違う
        assert_eq!(status_of(&e, "crc.txt"), DirStatus::Modified); // サイズは同じで内容が違う（CRC32）
        assert_eq!(status_of(&e, "gone.txt"), DirStatus::Removed);
        assert_eq!(status_of(&e, "new.txt"), DirStatus::Added);
        assert_eq!(status_of(&e, "dir"), DirStatus::Same);
        assert_eq!(status_of(&e, "dir/in.txt"), DirStatus::Same);
        let m = e.iter().find(|x| x.path == "mod.txt").unwrap();
        assert_eq!((m.left_size, m.right_size), (Some(3), Some(4)));
        // テストで作る zip には、日時の指定がない場合の既定値 (1980-01-01 00:00:00) が入る
        assert_eq!(m.left_modified, Some(315_532_800));
        assert_eq!(e.iter().find(|x| x.path == "dir").unwrap().left_size, None);
    }

    #[test]
    fn supplies_missing_parent_folders_and_flags_kind_mismatches() {
        let d = tempfile::tempdir().unwrap();
        let l = make_zip(d.path(), "l.zip", &[("a/b/c.txt", b"1"), ("x", b"file")]);
        let r = make_zip(d.path(), "r.zip", &[("a/b/c.txt", b"1"), ("x/y.txt", b"in dir")]);
        let e = compare_archives(&l, &r).unwrap();
        let paths: Vec<_> = e.iter().map(|x| x.path.as_str()).collect();
        assert_eq!(paths, vec!["a", "a/b", "a/b/c.txt", "x", "x/y.txt"]);
        assert_eq!(status_of(&e, "a"), DirStatus::Same);
        assert_eq!(status_of(&e, "x"), DirStatus::Modified); // 左はファイル、右はフォルダ
        assert_eq!(status_of(&e, "x/y.txt"), DirStatus::Added);
    }

    #[test]
    fn lists_a_single_archive() {
        let d = tempfile::tempdir().unwrap();
        let z = make_zip(d.path(), "a.zip", &[("d/f.txt", b"12345")]);
        let left = list_archive(&z, true).unwrap();
        assert_eq!(left.len(), 2);
        assert!(left.iter().all(|e| e.left.is_some() && e.right.is_none() && e.status == DirStatus::Same));
        assert_eq!(left[1].left_size, Some(5));
        let right = list_archive(&z, false).unwrap();
        assert!(right.iter().all(|e| e.left.is_none() && e.right.is_some()));
        assert_eq!(right[1].right_size, Some(5));
    }

    #[test]
    fn skips_unsafe_entry_names() {
        let d = tempfile::tempdir().unwrap();
        let z = make_zip(d.path(), "evil.zip", &[("../escape.txt", b"x"), ("/abs.txt", b"x"), ("ok.txt", b"x")]);
        let e = list_archive(&z, true).unwrap();
        assert_eq!(e.iter().map(|x| x.path.as_str()).collect::<Vec<_>>(), vec!["ok.txt"]);
    }

    #[test]
    fn reads_an_entry_and_refuses_bad_requests() {
        let d = tempfile::tempdir().unwrap();
        let z = make_zip(d.path(), "a.zip", &[("dir/", b""), ("dir/t.txt", "日本語\n".as_bytes())]);
        assert_eq!(read_entry(&z, "dir/t.txt").unwrap(), "日本語\n".as_bytes());
        assert!(read_entry(&z, "missing.txt").unwrap_err().contains("見つかりません"));
        assert!(read_entry(&z, "dir").unwrap_err().contains("通常のファイル"));
        assert!(read_entry(&d.path().join("nope.zip"), "x").is_err());
    }

    #[test]
    fn rejects_files_that_are_not_zip_archives() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("fake.zip");
        std::fs::write(&f, "not a zip").unwrap();
        assert!(compare_archives(&f, &f).unwrap_err().contains("zip として読み込めません"));
        assert!(read_entry(&f, "x").is_err());
        assert!(list_archive(&d.path().join("missing.zip"), true).is_err());
    }

    #[test]
    fn caps_the_size_of_an_entry_that_would_be_read() {
        let d = tempfile::tempdir().unwrap();
        let big = vec![b'a'; MAX_FILE_SIZE as usize + 10];
        let z = make_zip(d.path(), "big.zip", &[("big.txt", &big), ("small.txt", b"ok")]);
        assert!(read_entry(&z, "big.txt").unwrap_err().contains("上限"));
        assert_eq!(read_entry(&z, "small.txt").unwrap(), b"ok");
    }
}
