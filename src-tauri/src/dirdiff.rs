//! ディレクトリ構成の比較。シンボリックリンクは辿らず、無視する。

use crate::textdiff::DiffOptions;

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;
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
    /// ファイルのサイズ（バイト）。フォルダ・存在しない側は None
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
    /// ファイルの更新日時（UNIX 秒）。取得できない場合は None
    pub left_modified: Option<i64>,
    pub right_modified: Option<i64>,
}

/// ファイルのサイズと更新日時（UNIX 秒）。フォルダや、読み取れない場合は None。
fn file_meta(node: Option<&(NodeKind, PathBuf)>) -> (Option<u64>, Option<i64>) {
    let Some((NodeKind::File, path)) = node else { return (None, None) };
    let Ok(meta) = std::fs::metadata(path) else { return (None, None) };
    let modified = meta.modified().ok().and_then(|t| match t.duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => i64::try_from(d.as_secs()).ok(),
        Err(e) => i64::try_from(e.duration().as_secs()).ok().map(|s| -s),
    });
    (Some(meta.len()), modified)
}

type Tree = BTreeMap<String, (NodeKind, PathBuf)>;

/// `*`（0文字以上）と `?`（1文字）が使える、大文字小文字を区別しないパターン照合。
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let t: Vec<char> = text.to_lowercase().chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

fn is_excluded(patterns: &[String], name: &str, rel: &str) -> bool {
    patterns
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .any(|p| glob_match(p, if p.contains('/') { rel } else { name }))
}

fn rel_key(root: &Path, path: &Path) -> Result<String, String> {
    let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
    Ok(rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"))
}

fn collect(root: &Path, options: &DiffOptions) -> Result<Tree, String> {
    let mut tree = Tree::new();
    let depth = if options.recursive { MAX_DEPTH } else { 1 };
    let walker = WalkDir::new(root)
        .min_depth(1)
        .max_depth(depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || !is_excluded(
                    &options.exclude,
                    &e.file_name().to_string_lossy(),
                    &rel_key(root, e.path()).unwrap_or_default(),
                )
        });
    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            // 読めないサブフォルダなどは飛ばす（1つの失敗で比較全体を止めない）。ルート自体が読めないときはエラー
            Err(e) if e.depth() == 0 => return Err(e.to_string()),
            Err(_) => continue,
        };
        let file_type = entry.file_type();
        if file_type.is_symlink() {
            continue;
        }
        if tree.len() >= MAX_ENTRIES {
            return Err(format!("エントリ数が上限 ({MAX_ENTRIES}) を超えました"));
        }
        let kind = if file_type.is_dir() { NodeKind::Directory } else { NodeKind::File };
        tree.insert(rel_key(root, entry.path())?, (kind, entry.path().to_path_buf()));
    }
    Ok(tree)
}

/// 片方だけ開いているとき用の一覧（比較対象がないので状態は Same）。
pub fn list_dir(root: &Path, left_side: bool, options: &DiffOptions) -> Result<Vec<DirEntry>, String> {
    Ok(collect(root, options)?
        .into_iter()
        .map(|(path, (kind, full))| {
            let (size, modified) = file_meta(Some(&(kind, full)));
            DirEntry {
                path,
                left: left_side.then_some(kind),
                right: (!left_side).then_some(kind),
                status: DirStatus::Same,
                left_size: if left_side { size } else { None },
                right_size: if left_side { None } else { size },
                left_modified: if left_side { modified } else { None },
                right_modified: if left_side { None } else { modified },
            }
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
        match fb.read_exact(&mut bb[..n]) {
            Ok(()) => {}
            // 比較の途中でもう一方が短くなった（サイズが変わった）ので、同一ではない
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(false),
            Err(e) => return Err(e),
        }
        if ba[..n] != bb[..n] {
            return Ok(false);
        }
    }
}

/// サイズと更新日時（2秒の誤差まで許容。FAT など粒度の粗いファイルシステム対策）で同一とみなす。
pub fn quick_equal(a: &Path, b: &Path) -> io::Result<bool> {
    let (ma, mb) = (std::fs::metadata(a)?, std::fs::metadata(b)?);
    if ma.len() != mb.len() {
        return Ok(false);
    }
    let (ta, tb) = (ma.modified()?, mb.modified()?);
    let gap = ta.duration_since(tb).unwrap_or_else(|e| e.duration());
    Ok(gap <= Duration::from_secs(2))
}

type Node = (NodeKind, PathBuf);

/// フォルダが、大文字小文字を区別しないファイルシステム上にあるかを、実際に調べて判定する
/// （名前の大文字小文字を入れ替えたパスが同じように存在するか）。判断できなければ false。
fn case_insensitive(root: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(root) else { return false };
    for entry in entries.flatten().take(32) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let toggled: String = name
            .chars()
            .map(|c| if c.is_lowercase() { c.to_uppercase().next().unwrap_or(c) } else { c.to_lowercase().next().unwrap_or(c) })
            .collect();
        if toggled != name {
            return std::fs::symlink_metadata(root.join(&toggled)).is_ok();
        }
    }
    false
}

/// 左右のツリーを、同じ項目どうしで組にする。`fold` のときは大文字小文字を区別せずに対応づける
/// （表示するパスは、左にあれば左の綴り、なければ右の綴り。親フォルダの綴りもそろえる）。
fn pair_up<'a>(lt: &'a Tree, rt: &'a Tree, fold: bool) -> Vec<(String, Option<&'a Node>, Option<&'a Node>)> {
    let norm = |k: &str| if fold { k.to_lowercase() } else { k.to_string() };
    let index = |t: &'a Tree| -> BTreeMap<String, (&'a String, &'a Node)> { t.iter().map(|(k, v)| (norm(k), (k, v))).collect() };
    let (lm, rm) = (index(lt), index(rt));
    let mut keys: Vec<&String> = lm.keys().chain(rm.keys()).collect();
    keys.sort();
    keys.dedup();
    let mut shown: std::collections::HashMap<&str, String> = std::collections::HashMap::new();
    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
        let (l, r) = (lm.get(key), rm.get(key));
        let original = l.or(r).map(|(k, _)| k.as_str()).unwrap_or_default();
        let name = original.rsplit('/').next().unwrap_or(original);
        let display = match key.rsplit_once('/').and_then(|(parent, _)| shown.get(parent)) {
            Some(parent) => format!("{parent}/{name}"),
            None => original.to_string(),
        };
        shown.insert(key.as_str(), display.clone());
        out.push((display, l.map(|(_, n)| *n), r.map(|(_, n)| *n)));
    }
    out
}

pub fn compare_dirs(left: &Path, right: &Path, options: &DiffOptions) -> Result<Vec<DirEntry>, String> {
    let (lt, rt) = (collect(left, options)?, collect(right, options)?);
    let fold = case_insensitive(left) && case_insensitive(right);
    let mut entries = Vec::new();
    for (key, l, r) in pair_up(&lt, &rt, fold) {
        let status = match (l, r) {
            (Some(_), None) => DirStatus::Removed,
            (None, Some(_)) => DirStatus::Added,
            (Some((lk, _)), Some((rk, _))) if lk != rk => DirStatus::Modified,
            (Some((NodeKind::File, lp)), Some((_, rp))) => {
                let equal = if options.quick { quick_equal(lp, rp) } else { files_equal(lp, rp) };
                if equal.map_err(|e| format!("{key}: {e}"))? {
                    DirStatus::Same
                } else {
                    DirStatus::Modified
                }
            }
            _ => DirStatus::Same,
        };
        let ((left_size, left_modified), (right_size, right_modified)) = (file_meta(l), file_meta(r));
        entries.push(DirEntry {
            path: key,
            left: l.map(|v| v.0),
            right: r.map(|v| v.0),
            status,
            left_size,
            right_size,
            left_modified,
            right_modified,
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

        let e = compare_dirs(l.path(), r.path(), &DiffOptions::default()).unwrap();
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
        let left = list_dir(d.path(), true, &DiffOptions::default()).unwrap();
        assert_eq!(left.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["sub", "sub/a.txt"]);
        assert!(left.iter().all(|e| e.left.is_some() && e.right.is_none() && e.status == DirStatus::Same));
        let right = list_dir(d.path(), false, &DiffOptions::default()).unwrap();
        assert!(right.iter().all(|e| e.left.is_none() && e.right.is_some()));
        assert!(list_dir(&d.path().join("nope"), true, &DiffOptions::default()).is_err());
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
        let e = compare_dirs(l.path(), r.path(), &DiffOptions::default()).unwrap();
        assert!(e.is_empty());
    }

    #[test]
    fn missing_directory_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(compare_dirs(d.path(), &d.path().join("nope"), &DiffOptions::default()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_file_reports_error() {
        use std::os::unix::fs::PermissionsExt;
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(l.path().join("f"), "x").unwrap();
        fs::write(r.path().join("f"), "x").unwrap();
        fs::set_permissions(l.path().join("f"), fs::Permissions::from_mode(0o000)).unwrap();
        let res = compare_dirs(l.path(), r.path(), &DiffOptions::default());
        fs::set_permissions(l.path().join("f"), fs::Permissions::from_mode(0o644)).unwrap();
        // root では読めてしまうため、エラーまたは Same のどちらかを許容
        assert!(res.is_err() || res.unwrap()[0].status == DirStatus::Same);
    }

    fn node(kind: NodeKind) -> Node {
        (kind, PathBuf::from("/x"))
    }

    #[test]
    fn pairs_names_ignoring_case_only_when_asked_and_aligns_parent_spelling() {
        let mut lt = Tree::new();
        lt.insert("Docs".into(), node(NodeKind::Directory));
        lt.insert("Docs/A.txt".into(), node(NodeKind::File));
        let mut rt = Tree::new();
        rt.insert("docs".into(), node(NodeKind::Directory));
        rt.insert("docs/a.TXT".into(), node(NodeKind::File));
        rt.insert("docs/new.txt".into(), node(NodeKind::File));
        let folded = pair_up(&lt, &rt, true);
        let names: Vec<&str> = folded.iter().map(|(k, _, _)| k.as_str()).collect();
        assert_eq!(names, vec!["Docs", "Docs/A.txt", "Docs/new.txt"]); // 左の綴りを使い、右だけの項目も親の綴りにそろう
        assert!(folded[1].1.is_some() && folded[1].2.is_some());
        assert!(folded[2].1.is_none() && folded[2].2.is_some());
        let strict = pair_up(&lt, &rt, false);
        assert_eq!(strict.len(), 5); // 区別するなら、すべて別の項目
    }

    #[test]
    fn detects_a_case_insensitive_folder_by_probing_the_filesystem() {
        let d = tempfile::tempdir().unwrap();
        assert!(!case_insensitive(&d.path().join("missing")));
        assert!(!case_insensitive(d.path())); // 空: 判断できない
        fs::write(d.path().join("123"), "x").unwrap();
        assert!(!case_insensitive(d.path())); // 大文字小文字のない名前だけ: 判断できない
        fs::write(d.path().join("Probe.txt"), "x").unwrap();
        // 実際のファイルシステムの性質に従う（macOS・Windows は true、Linux は通常 false）
        let expected = d.path().join("pROBE.TXT").exists();
        assert_eq!(case_insensitive(d.path()), expected);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_subfolder_does_not_stop_the_comparison() {
        use std::os::unix::fs::PermissionsExt;
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(l.path().join("ok.txt"), "x").unwrap();
        fs::write(r.path().join("ok.txt"), "x").unwrap();
        fs::create_dir(l.path().join("locked")).unwrap();
        fs::write(l.path().join("locked/f"), "x").unwrap();
        fs::set_permissions(l.path().join("locked"), fs::Permissions::from_mode(0o000)).unwrap();
        let res = compare_dirs(l.path(), r.path(), &DiffOptions::default());
        fs::set_permissions(l.path().join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
        let entries = res.unwrap();
        assert!(entries.iter().any(|e| e.path == "ok.txt" && e.status == DirStatus::Same));
    }

    #[test]
    fn glob_matching() {
        assert!(glob_match("*.obj", "Main.OBJ"));
        assert!(glob_match("a?c", "abc"));
        assert!(glob_match("*", ""));
        assert!(glob_match("a*b*c", "aXXbYYc"));
        assert!(glob_match("node_modules", "node_modules"));
        assert!(!glob_match("*.obj", "main.o"));
        assert!(!glob_match("a?c", "ac"));
        assert!(!glob_match("abc", "abcd"));
    }

    #[test]
    fn excludes_by_name_or_relative_path_and_prunes_subtrees() {
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        for root in [l.path(), r.path()] {
            fs::create_dir_all(root.join(".git/objects")).unwrap();
            fs::create_dir_all(root.join("src/gen")).unwrap();
            fs::write(root.join(".git/objects/x"), "1").unwrap();
            fs::write(root.join("src/a.obj"), "1").unwrap();
            fs::write(root.join("src/b.rs"), "1").unwrap();
            fs::write(root.join("src/gen/c.rs"), "1").unwrap();
        }
        let opts = DiffOptions { exclude: vec![" .git ".into(), "*.obj".into(), "src/gen".into(), "".into()], ..Default::default() };
        let paths: Vec<_> = compare_dirs(l.path(), r.path(), &opts).unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec!["src", "src/b.rs"]);
        // 除外対象の名前がルート自身と同じでもルートは除外されない
        let root_named = DiffOptions { exclude: vec![l.path().file_name().unwrap().to_string_lossy().into_owned()], ..Default::default() };
        assert!(!compare_dirs(l.path(), r.path(), &root_named).unwrap().is_empty());
    }

    #[test]
    fn non_recursive_lists_only_the_top_level() {
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::create_dir(l.path().join("sub")).unwrap();
        fs::write(l.path().join("sub/deep.txt"), "x").unwrap();
        fs::write(l.path().join("top.txt"), "x").unwrap();
        let opts = DiffOptions { recursive: false, ..Default::default() };
        let paths: Vec<_> = compare_dirs(l.path(), r.path(), &opts).unwrap().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, vec!["sub", "top.txt"]);
    }

    #[test]
    fn quick_mode_uses_size_and_mtime() {
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::write(l.path().join("same_size.txt"), "aaa").unwrap();
        fs::write(r.path().join("same_size.txt"), "bbb").unwrap(); // 内容は違うがサイズと(ほぼ)時刻が同じ
        fs::write(l.path().join("len.txt"), "a").unwrap();
        fs::write(r.path().join("len.txt"), "ab").unwrap();
        let quick = DiffOptions { quick: true, ..Default::default() };
        let e = compare_dirs(l.path(), r.path(), &quick).unwrap();
        assert_eq!(status_of(&e, "same_size.txt"), DirStatus::Same);
        assert_eq!(status_of(&e, "len.txt"), DirStatus::Modified);
        // 更新日時が離れていれば変更扱い
        let f = fs::File::options().write(true).open(r.path().join("same_size.txt")).unwrap();
        f.set_modified(std::time::SystemTime::now() - Duration::from_secs(3600)).unwrap();
        let e = compare_dirs(l.path(), r.path(), &quick).unwrap();
        assert_eq!(status_of(&e, "same_size.txt"), DirStatus::Modified);
        // 通常モードは内容で判定
        let e = compare_dirs(l.path(), r.path(), &DiffOptions::default()).unwrap();
        assert_eq!(status_of(&e, "same_size.txt"), DirStatus::Modified);
        assert!(quick_equal(&l.path().join("len.txt"), &l.path().join("missing")).is_err());
    }

    #[test]
    fn reports_size_and_modified_time_for_files_only() {
        let (l, r) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        fs::create_dir(l.path().join("sub")).unwrap();
        fs::create_dir(r.path().join("sub")).unwrap();
        fs::write(l.path().join("both.txt"), "12345").unwrap();
        fs::write(r.path().join("both.txt"), "123").unwrap();
        fs::write(l.path().join("left-only.txt"), "x").unwrap();
        let old = std::time::UNIX_EPOCH + Duration::from_secs(1_000_000_000);
        fs::File::options().write(true).open(r.path().join("both.txt")).unwrap().set_modified(old).unwrap();
        let e = compare_dirs(l.path(), r.path(), &DiffOptions::default()).unwrap();
        let find = |p: &str| e.iter().find(|x| x.path == p).unwrap();
        let both = find("both.txt");
        assert_eq!((both.left_size, both.right_size), (Some(5), Some(3)));
        assert_eq!(both.right_modified, Some(1_000_000_000));
        assert!(both.left_modified.unwrap() > 1_000_000_000);
        let lo = find("left-only.txt");
        assert_eq!((lo.left_size, lo.right_size, lo.right_modified), (Some(1), None, None));
        let sub = find("sub");
        assert_eq!((sub.left_size, sub.right_size, sub.left_modified), (None, None, None));
        // 片側だけの一覧にも付く
        let single = list_dir(l.path(), false, &DiffOptions::default()).unwrap();
        let b = single.iter().find(|x| x.path == "both.txt").unwrap();
        assert_eq!((b.left_size, b.right_size), (None, Some(5)));
        assert!(b.right_modified.is_some() && b.left_modified.is_none());
        let a = list_dir(l.path(), true, &DiffOptions::default()).unwrap();
        assert!(a.iter().find(|x| x.path == "both.txt").unwrap().left_size == Some(5));
    }

    #[test]
    fn file_meta_tolerates_missing_files() {
        assert_eq!(file_meta(None), (None, None));
        assert_eq!(file_meta(Some(&(NodeKind::File, PathBuf::from("/nonexistent/x")))), (None, None));
    }
}
