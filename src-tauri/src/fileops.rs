//! フォルダ比較画面からのコピー・削除と、パッチの書き出し。
//! 操作対象は、比較中のルート配下の相対パスに限定し、シンボリックリンクは辿らない。

use crate::compare::{classify, PathKind, MAX_FILE_SIZE};
use crate::dirdiff::{MAX_ENTRIES};
use std::fs;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

/// ルート配下の相対パスを実パスへ解決する。`..`・絶対パス・途中のシンボリックリンクは拒否する。
pub fn resolve_under(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if classify(root)? != PathKind::Directory {
        return Err(format!("{}: フォルダではありません", root.display()));
    }
    let rel_path = Path::new(rel);
    let mut parts = rel_path.components().peekable();
    if parts.peek().is_none() {
        return Err("パスが空です".to_string());
    }
    let mut current = root.to_path_buf();
    for part in parts {
        match part {
            Component::Normal(name) => current.push(name),
            _ => return Err(format!("不正なパスです: {rel}")),
        }
        if fs::symlink_metadata(&current).map(|m| m.file_type().is_symlink()).unwrap_or(false) {
            return Err(format!("シンボリックリンクは操作できません: {rel}"));
        }
    }
    Ok(current)
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("{}: {e}", dst.display()))?;
    let mut count = 0usize;
    for entry in WalkDir::new(src).min_depth(1).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_symlink() {
            continue;
        }
        count += 1;
        if count > MAX_ENTRIES {
            return Err(format!("エントリ数が上限 ({MAX_ENTRIES}) を超えました"));
        }
        let rel = entry.path().strip_prefix(src).map_err(|e| e.to_string())?;
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        } else {
            fs::copy(entry.path(), &target).map_err(|e| format!("{}: {e}", target.display()))?;
        }
    }
    Ok(())
}

/// 存在しない末尾部分があっても、実在する祖先を正規化して絶対パスを返す。
fn canonical_lenient(path: &Path) -> PathBuf {
    let mut tail = Vec::new();
    let mut cur = path;
    loop {
        if let Ok(c) = fs::canonicalize(cur) {
            return tail.iter().rev().fold(c, |acc, name| acc.join(name));
        }
        match (cur.file_name(), cur.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name.to_owned());
                cur = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// `src_root/rel` を `dst_root/rel` へコピーする（既存のファイルは上書き）。
/// コピー元とコピー先が同一、またはコピー先がコピー元の内側になる場合は拒否する。
pub fn copy_entry(src_root: &Path, dst_root: &Path, rel: &str) -> Result<(), String> {
    let src = resolve_under(src_root, rel)?;
    let dst = resolve_under(dst_root, rel)?;
    let (src_real, dst_real) = (canonical_lenient(&src), canonical_lenient(&dst));
    if dst_real.starts_with(&src_real) {
        return Err(format!("{rel}: コピー元とコピー先が同じ（または入れ子の）場所です"));
    }
    let src_meta = fs::symlink_metadata(&src).map_err(|e| format!("{}: {e}", src.display()))?;
    let dst_meta = fs::symlink_metadata(&dst).ok();
    if src_meta.is_dir() {
        if dst_meta.is_some_and(|m| !m.is_dir()) {
            return Err(format!("{rel}: コピー先に同名のファイルがあります"));
        }
        copy_dir(&src, &dst)
    } else if src_meta.is_file() {
        if dst_meta.is_some_and(|m| m.is_dir()) {
            return Err(format!("{rel}: コピー先に同名のフォルダがあります"));
        }
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        fs::copy(&src, &dst).map(|_| ()).map_err(|e| format!("{}: {e}", dst.display()))
    } else {
        Err(format!("{rel}: 通常のファイルまたはフォルダではありません"))
    }
}

/// `root/rel` を完全に削除する（ゴミ箱には送らない）。
pub fn delete_entry(root: &Path, rel: &str) -> Result<(), String> {
    let target = resolve_under(root, rel)?;
    let meta = fs::symlink_metadata(&target).map_err(|e| format!("{}: {e}", target.display()))?;
    let result = if meta.is_dir() {
        fs::remove_dir_all(&target)
    } else if meta.is_file() {
        fs::remove_file(&target)
    } else {
        return Err(format!("{rel}: 通常のファイルまたはフォルダではありません"));
    };
    result.map_err(|e| format!("{}: {e}", target.display()))
}

/// 書き出し用の共通処理。拡張子を限定し、既存の通常ファイルへの上書きまたは新規作成のみ許可する。
fn write_export(path: &Path, content: &str, allowed: &[&str], what: &str) -> Result<(), String> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !allowed.contains(&ext.as_str()) {
        let list = allowed.iter().map(|e| format!(".{e}")).collect::<Vec<_>>().join(" / ");
        return Err(format!("{what}の拡張子は {list} のいずれかにしてください"));
    }
    if content.len() as u64 > MAX_FILE_SIZE {
        return Err(format!("{what}が大きすぎます"));
    }
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    if classify(parent)? != PathKind::Directory {
        return Err(format!("{}: 保存先のフォルダがありません", parent.display()));
    }
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_file() {
            return Err(format!("{}: 通常のファイルではないため上書きできません", path.display()));
        }
    }
    fs::write(path, content).map_err(|e| format!("{}: {e}", path.display()))
}

/// パッチを書き出す（`.patch` / `.diff` / `.txt` のみ）。
pub fn write_patch(path: &Path, content: &str) -> Result<(), String> {
    write_export(path, content, &["patch", "diff", "txt"], "パッチ")
}

/// 比較レポートを書き出す（`.html` / `.htm` のみ）。
pub fn write_report(path: &Path, content: &str) -> Result<(), String> {
    write_export(path, content, &["html", "htm"], "レポート")
}

/// コマンドライン引数から比較対象のパス（最大2つ）を取り出す。相対パスは `cwd` 基準で絶対パスにする。
pub fn parse_paths<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1) // 実行ファイル自身
        .filter(|a| !a.starts_with('-'))
        .take(2)
        .map(|a| {
            let p = Path::new(&a);
            if p.is_absolute() { a } else { cwd.join(p).to_string_lossy().into_owned() }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("sub/inner")).unwrap();
        fs::write(d.path().join("a.txt"), "A").unwrap();
        fs::write(d.path().join("sub/b.txt"), "B").unwrap();
        fs::write(d.path().join("sub/inner/c.txt"), "C").unwrap();
        d
    }

    #[test]
    fn resolves_only_safe_relative_paths() {
        let d = tree();
        assert_eq!(resolve_under(d.path(), "sub/b.txt").unwrap(), d.path().join("sub").join("b.txt"));
        for bad in ["", "../x", "sub/../../x", "/etc/passwd", "./a.txt"] {
            assert!(resolve_under(d.path(), bad).is_err(), "{bad}");
        }
        assert!(resolve_under(&d.path().join("a.txt"), "x").is_err());
        assert!(resolve_under(&d.path().join("missing"), "x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_on_the_path() {
        let d = tree();
        std::os::unix::fs::symlink("/etc", d.path().join("link")).unwrap();
        assert!(resolve_under(d.path(), "link/passwd").unwrap_err().contains("シンボリックリンク"));
        assert!(delete_entry(d.path(), "link").is_err());
        assert!(d.path().join("link").exists());
    }

    #[test]
    fn copies_files_directories_and_creates_parents() {
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        copy_entry(src.path(), dst.path(), "sub/b.txt").unwrap();
        assert_eq!(fs::read_to_string(dst.path().join("sub/b.txt")).unwrap(), "B");
        copy_entry(src.path(), dst.path(), "sub").unwrap();
        assert_eq!(fs::read_to_string(dst.path().join("sub/inner/c.txt")).unwrap(), "C");
        // 上書き
        fs::write(src.path().join("a.txt"), "A2").unwrap();
        fs::write(dst.path().join("a.txt"), "old").unwrap();
        copy_entry(src.path(), dst.path(), "a.txt").unwrap();
        assert_eq!(fs::read_to_string(dst.path().join("a.txt")).unwrap(), "A2");
    }

    #[cfg(unix)]
    #[test]
    fn copying_a_directory_skips_symlinks() {
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        std::os::unix::fs::symlink("/etc/hosts", src.path().join("sub/link")).unwrap();
        copy_entry(src.path(), dst.path(), "sub").unwrap();
        assert!(!dst.path().join("sub/link").exists());
    }

    #[test]
    fn refuses_kind_mismatch_and_missing_sources() {
        let (src, dst) = (tree(), tempfile::tempdir().unwrap());
        fs::write(dst.path().join("sub"), "file").unwrap();
        assert!(copy_entry(src.path(), dst.path(), "sub").unwrap_err().contains("同名のファイル"));
        fs::create_dir(dst.path().join("a.txt")).unwrap();
        assert!(copy_entry(src.path(), dst.path(), "a.txt").unwrap_err().contains("同名のフォルダ"));
        assert!(copy_entry(src.path(), dst.path(), "nope").is_err());
        assert!(copy_entry(src.path(), dst.path(), "../a.txt").is_err());
    }

    #[test]
    fn refuses_self_and_nested_copies_without_touching_data() {
        let d = tree();
        // 同じフォルダ同士: ファイルもフォルダも内容が保たれる
        assert!(copy_entry(d.path(), d.path(), "a.txt").unwrap_err().contains("同じ"));
        assert!(copy_entry(d.path(), d.path(), "sub").is_err());
        assert_eq!(fs::read_to_string(d.path().join("a.txt")).unwrap(), "A");
        assert_eq!(fs::read_to_string(d.path().join("sub/b.txt")).unwrap(), "B");
        // コピー先がコピー元の内側（存在しないパスを含む）
        let inner = d.path().join("sub/inner");
        assert!(copy_entry(d.path(), &inner, "sub").is_err());
        assert!(!inner.join("sub").exists());
        // 相対表記の違う同一フォルダ
        let alias = d.path().join("sub/..");
        assert!(copy_entry(d.path(), &alias, "a.txt").is_err());
        assert_eq!(fs::read_to_string(d.path().join("a.txt")).unwrap(), "A");
    }

    #[test]
    fn canonical_lenient_handles_missing_tails() {
        let d = tempfile::tempdir().unwrap();
        let real = fs::canonicalize(d.path()).unwrap();
        assert_eq!(canonical_lenient(&d.path().join("x/y/z")), real.join("x/y/z"));
        assert_eq!(canonical_lenient(Path::new("")), PathBuf::new());
    }

    #[test]
    fn deletes_files_and_directories_inside_the_root_only() {
        let d = tree();
        delete_entry(d.path(), "a.txt").unwrap();
        assert!(!d.path().join("a.txt").exists());
        delete_entry(d.path(), "sub").unwrap();
        assert!(!d.path().join("sub").exists());
        assert!(d.path().exists());
        assert!(delete_entry(d.path(), "nope").is_err());
        assert!(delete_entry(d.path(), "").is_err());
        assert!(delete_entry(d.path(), "..").is_err());
    }

    #[test]
    fn writes_patches_with_safe_extensions_only() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("out.patch");
        write_patch(&p, "--- a\n").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "--- a\n");
        write_patch(&p, "second").unwrap(); // 上書き
        assert_eq!(fs::read_to_string(&p).unwrap(), "second");
        for bad in ["evil.sh", "noext", "x.PATCHX"] {
            assert!(write_patch(&d.path().join(bad), "x").is_err(), "{bad}");
        }
        assert!(write_patch(&d.path().join("UP.DIFF"), "x").is_ok());
        assert!(write_patch(&d.path().join("missing/out.patch"), "x").is_err());
        fs::create_dir(d.path().join("dir.patch")).unwrap();
        assert!(write_patch(&d.path().join("dir.patch"), "x").is_err());
        let big = "a".repeat(MAX_FILE_SIZE as usize + 1);
        assert!(write_patch(&p, &big).is_err());
        assert!(write_patch(Path::new("relative-in-cwd-missing-dir/x.patch"), "x").is_err());
    }

    #[test]
    fn writes_reports_with_html_extensions_only() {
        let d = tempfile::tempdir().unwrap();
        write_report(&d.path().join("r.html"), "<p>x</p>").unwrap();
        write_report(&d.path().join("R.HTM"), "<p>x</p>").unwrap();
        assert_eq!(fs::read_to_string(d.path().join("r.html")).unwrap(), "<p>x</p>");
        for bad in ["r.patch", "r.sh", "noext", "r.html.exe"] {
            assert!(write_report(&d.path().join(bad), "x").unwrap_err().contains(".html"), "{bad}");
        }
        assert!(write_report(&d.path().join("missing/r.html"), "x").is_err());
        // パッチ用の拡張子はレポートでは使えず、逆も同じ
        assert!(write_patch(&d.path().join("r.html"), "x").is_err());
    }

    #[test]
    fn parses_cli_paths() {
        let cwd = Path::new("/work");
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(parse_paths(args(&["kurabel"]), cwd), Vec::<String>::new());
        assert_eq!(parse_paths(args(&["kurabel", "/a", "b/c"]), cwd), vec!["/a".to_string(), "/work/b/c".to_string()]);
        assert_eq!(parse_paths(args(&["kurabel", "-psn_0_1", "/a", "--x", "/b", "/c"]), cwd), vec!["/a".to_string(), "/b".to_string()]);
    }
}
