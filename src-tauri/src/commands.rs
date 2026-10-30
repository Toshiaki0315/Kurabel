//! Tauri コマンド。ロジックは各モジュールに置き、ここは薄いラッパーに留める。

use crate::compare::{self, Comparison, PathKind};
use crate::fileops;
use crate::textcodec::{EncodingChoice, TextEncoding};
use crate::textdiff::{self, DiffMode, DiffOptions, DiffRow};

#[tauri::command]
pub fn compare_paths(
    left: Option<String>,
    right: Option<String>,
    mode: DiffMode,
    options: DiffOptions,
    encodings: EncodingChoice,
) -> Result<Comparison, String> {
    match (left, right) {
        (Some(l), Some(r)) => compare::compare_paths(l.as_ref(), r.as_ref(), mode, &options, &encodings),
        (Some(l), None) => compare::view_single(l.as_ref(), true, &options, encodings.left.as_deref()),
        (None, Some(r)) => compare::view_single(r.as_ref(), false, &options, encodings.right.as_deref()),
        (None, None) => Err("ファイルまたはフォルダが指定されていません".to_string()),
    }
}

#[tauri::command]
pub fn copy_entry(src_root: String, dst_root: String, rel: String) -> Result<(), String> {
    fileops::copy_entry(src_root.as_ref(), dst_root.as_ref(), &rel)
}

#[tauri::command]
pub fn delete_entry(root: String, rel: String) -> Result<(), String> {
    fileops::delete_entry(root.as_ref(), &rel)
}

#[tauri::command]
pub fn make_patch(left_text: String, right_text: String, left_label: String, right_label: String) -> String {
    textdiff::unified_patch(&left_text, &right_text, &left_label, &right_label)
}

#[tauri::command]
pub fn write_patch(path: String, content: String) -> Result<(), String> {
    fileops::write_patch(path.as_ref(), &content)
}

/// 起動時のコマンドライン引数で指定された比較対象（最大2つ）。
#[tauri::command]
pub fn initial_paths() -> Vec<String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    fileops::parse_paths(std::env::args(), &cwd)
}

#[tauri::command]
pub fn merge3(base: String, left: String, right: String) -> Result<compare::Merge3, String> {
    compare::merge3_files(base.as_ref(), left.as_ref(), right.as_ref())
}

#[tauri::command]
pub fn create_text(path: String, content: String, encoding: TextEncoding) -> Result<(), String> {
    compare::create_text(path.as_ref(), &content, &encoding)
}

#[tauri::command]
pub fn path_kind(path: String) -> Result<PathKind, String> {
    compare::classify(path.as_ref())
}

#[tauri::command]
pub fn save_text(path: String, content: String, encoding: TextEncoding) -> Result<(), String> {
    compare::write_text(path.as_ref(), &content, &encoding)
}

#[tauri::command]
pub fn diff_text(left: String, right: String, mode: DiffMode, options: DiffOptions) -> Vec<DiffRow> {
    textdiff::diff_text(&left, &right, mode, &options)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_text_wraps_core() {
        let rows = diff_text("a".into(), "b".into(), DiffMode::Line, DiffOptions::default());
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn save_text_rejects_missing_file() {
        let enc = TextEncoding { name: "UTF-8".into(), bom: false };
        assert!(save_text("/nonexistent/x".into(), "a".into(), enc).is_err());
    }

    #[test]
    fn path_kind_classifies() {
        assert_eq!(path_kind(std::env::temp_dir().to_string_lossy().into_owned()).unwrap(), PathKind::Directory);
        assert!(path_kind("/nonexistent/x".into()).is_err());
    }

    #[test]
    fn compare_paths_handles_a_single_side() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_string_lossy().into_owned();
        let one = |l: Option<String>, r: Option<String>| compare_paths(l, r, DiffMode::Line, DiffOptions::default(), EncodingChoice::default());
        assert!(matches!(one(Some(dir.clone()), None), Ok(Comparison::Directory { .. })));
        assert!(matches!(one(None, Some(dir)), Ok(Comparison::Directory { .. })));
        assert!(one(None, None).is_err());
    }

    #[test]
    fn file_command_wrappers_delegate() {
        let d = tempfile::tempdir().unwrap();
        let (src, dst) = (d.path().join("s"), d.path().join("d"));
        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("a.txt"), "A").unwrap();
        let (s, t) = (src.to_string_lossy().into_owned(), dst.to_string_lossy().into_owned());
        copy_entry(s.clone(), t.clone(), "a.txt".into()).unwrap();
        assert!(dst.join("a.txt").exists());
        delete_entry(t, "a.txt".into()).unwrap();
        assert!(!dst.join("a.txt").exists());
        assert!(delete_entry(s, "../x".into()).is_err());
        let patch = make_patch("a\n".into(), "b\n".into(), "l".into(), "r".into());
        assert!(patch.contains("-a\n+b"));
        let out = d.path().join("x.patch").to_string_lossy().into_owned();
        write_patch(out, patch).unwrap();
        assert!(write_patch("/nonexistent/x.patch".into(), "x".into()).is_err());
    }

    #[test]
    fn initial_paths_reads_the_process_arguments() {
        // テスト実行時の引数にはパスが含まれないか、含まれても絶対パスになる
        assert!(initial_paths().len() <= 2);
    }

    #[test]
    fn compare_paths_reports_missing() {
        assert!(compare_paths(Some("/nonexistent/x".into()), Some("/nonexistent/y".into()), DiffMode::Line, DiffOptions::default(), EncodingChoice::default()).is_err());
    }

    #[test]
    fn merge3_and_create_text_wrappers() {
        let d = tempfile::tempdir().unwrap();
        let p = |n: &str, c: &str| {
            let f = d.path().join(n);
            std::fs::write(&f, c).unwrap();
            f.to_string_lossy().into_owned()
        };
        let (b, l, r) = (p("b", "a\n"), p("l", "a\nL\n"), p("r", "a\n"));
        assert_eq!(merge3(b.clone(), l, r).unwrap().chunks.len(), 2);
        assert!(merge3(b, "/nonexistent".into(), "/nonexistent".into()).is_err());
        let out = d.path().join("out.txt").to_string_lossy().into_owned();
        let enc = TextEncoding { name: "UTF-8".into(), bom: false };
        create_text(out.clone(), "x".into(), enc.clone()).unwrap();
        assert!(create_text(out, "y".into(), enc).is_err());
    }
}
