//! ディレクトリ構成の比較。シンボリックリンクは辿らず、無視する。

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const MAX_ENTRIES: usize = 50_000;
pub const MAX_DEPTH: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DirStatus {
    Same,
    /// 右側にのみ存在
    Added,
    /// 左側にのみ存在
    Removed,
    Modified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DirEntry {
    /// ルートからの相対パス（`/` 区切り）
    pub path: String,
    pub left: Option<NodeKind>,
    pub right: Option<NodeKind>,
    pub status: DirStatus,
}

type Tree = BTreeMap<String, (NodeKind, PathBuf)>;

fn collect(root: &Path) -> Result<Tree, String> {
    let mut tree = Tree::new();
    for entry in WalkDir::new(root).min_depth(1).max_depth(MAX_DEPTH).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            continue;
        }
        if tree.len() >= MAX_ENTRIES {
            return Err(format!("エントリ数が上限 ({MAX_ENTRIES}) を超えました"));
        }
        let rel = entry.path().strip_prefix(root).map_err(|e| e.to_string())?;
        let key = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let kind = if file_type.is_dir() { NodeKind::Directory } else { NodeKind::File };
        tree.insert(key, (kind, entry.path().to_path_buf()));
    }
    Ok(tree)
}

/// 片方だけ開いているとき用の一覧（比較対象がないので状態は Same）。
pub fn list_dir(root: &Path, left_side: bool) -> Result<Vec<DirEntry>, String> {
    Ok(collect(root)?
        .into_iter()
        .map(|(path, (kind, _))| DirEntry {
            path,
            left: left_side.then_some(kind),
            right: (!left_side).then_some(kind),
            status: DirStatus::Same,
        })
        .collect())
}

pub fn files_equal(a: &Path, b: &Path) -> io::Result<bool> {
    let (mut fa, mut fb) = (File::open(a)?, File::open(b)?);
    if fa.metadata()?.len() != fb.metadata()?.len() {
        return Ok(false);
    }
    let (mut ba, mut bb) = ([0u8; 65536], [0u8; 65536]);
    loop {
        let n = fa.read(&mut ba)?;
        if n == 0 {
            return Ok(true);
        }
        fb.read_exact(&mut bb[..n])?;
        if ba[..n] != bb[..n] {
            return Ok(false);
        }
    }
}

pub fn compare_dirs(left: &Path, right: &Path) -> Result<Vec<DirEntry>, String> {
    let (lt, rt) = (collect(left)?, collect(right)?);
    let mut keys: Vec<&String> = lt.keys().chain(rt.keys()).collect();
    keys.sort();
    keys.dedup();
    let mut entries = Vec::with_capacity(keys.len());
    for key in keys {
        let (l, r) = (lt.get(key), rt.get(key));
        let status = match (l, r) {
            (Some(_), None) => DirStatus::Removed,
            (None, Some(_)) => DirStatus::Added,
            (Some((lk, _)), Some((rk, _))) if lk != rk => DirStatus::Modified,
            (Some((NodeKind::File, lp)), Some((_, rp))) => {
                if files_equal(lp, rp).map_err(|e| format!("{key}: {e}"))? {
                    DirStatus::Same
                } else {
                    DirStatus::Modified
                }
            }
            _ => DirStatus::Same,
        };
        entries.push(DirEntry {
            path: key.clone(),
            left: l.map(|v| v.0),
            right: r.map(|v| v.0),
            status,
        });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn status_of(entries: &[DirEntry], path: &str) -> DirStatus {
        entries.iter().find(|e| e.path == path).unwrap().status
    }

    #[test]
    fn compares_trees() {
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::create_dir(l.path().join("sub")).unwrap();
        fs::create_dir(r.path().join("sub")).unwrap();
        fs::write(l.path().join("same.txt"), "x").unwrap();
        fs::write(r.path().join("same.txt"), "x").unwrap();
        fs::write(l.path().join("sub/mod.txt"), "aaa").unwrap();
        fs::write(r.path().join("sub/mod.txt"), "aab").unwrap();
        fs::write(l.path().join("size.txt"), "a").unwrap();
        fs::write(r.path().join("size.txt"), "ab").unwrap();
        fs::write(l.path().join("gone.txt"), "x").unwrap();
        fs::write(r.path().join("new.txt"), "x").unwrap();
        fs::create_dir(l.path().join("kind")).unwrap();
        fs::write(r.path().join("kind"), "x").unwrap();

        let e = compare_dirs(l.path(), r.path()).unwrap();
        assert_eq!(status_of(&e, "same.txt"), DirStatus::Same);
        assert_eq!(status_of(&e, "sub"), DirStatus::Same);
        assert_eq!(status_of(&e, "sub/mod.txt"), DirStatus::Modified);
        assert_eq!(status_of(&e, "size.txt"), DirStatus::Modified);
        assert_eq!(status_of(&e, "gone.txt"), DirStatus::Removed);
        assert_eq!(status_of(&e, "new.txt"), DirStatus::Added);
        assert_eq!(status_of(&e, "kind"), DirStatus::Modified);
        let paths: Vec<_> = e.iter().map(|x| x.path.as_str()).collect();
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted);
    }

    #[test]
    fn lists_a_single_directory() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir(d.path().join("sub")).unwrap();
        fs::write(d.path().join("sub/a.txt"), "x").unwrap();
        let left = list_dir(d.path(), true).unwrap();
        assert_eq!(left.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["sub", "sub/a.txt"]);
        assert!(left.iter().all(|e| e.left.is_some() && e.right.is_none() && e.status == DirStatus::Same));
        let right = list_dir(d.path(), false).unwrap();
        assert!(right.iter().all(|e| e.left.is_none() && e.right.is_some()));
        assert!(list_dir(&d.path().join("nope"), true).is_err());
    }

    #[test]
    fn files_equal_handles_large_files() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a"), d.path().join("b"));
        let mut data = vec![1u8; 70_000];
        fs::write(&a, &data).unwrap();
        fs::write(&b, &data).unwrap();
        assert!(files_equal(&a, &b).unwrap());
        data[69_999] = 2;
        fs::write(&b, &data).unwrap();
        assert!(!files_equal(&a, &b).unwrap());
        assert!(files_equal(&a, &d.path().join("missing")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_ignored() {
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::os::unix::fs::symlink("/etc", l.path().join("link")).unwrap();
        let e = compare_dirs(l.path(), r.path()).unwrap();
        assert!(e.is_empty());
    }

    #[test]
    fn missing_directory_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(compare_dirs(d.path(), &d.path().join("nope")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_file_reports_error() {
        use std::os::unix::fs::PermissionsExt;
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(l.path().join("f"), "x").unwrap();
        fs::write(r.path().join("f"), "x").unwrap();
        fs::set_permissions(l.path().join("f"), fs::Permissions::from_mode(0o000)).unwrap();
        let res = compare_dirs(l.path(), r.path());
        fs::set_permissions(l.path().join("f"), fs::Permissions::from_mode(0o644)).unwrap();
        // root では読めてしまうため、エラーまたは Same のどちらかを許容
        assert!(res.is_err() || res.unwrap()[0].status == DirStatus::Same);
    }
}
