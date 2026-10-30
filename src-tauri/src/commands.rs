//! Tauri コマンド。ロジックは各モジュールに置き、ここは薄いラッパーに留める。

use crate::compare::{self, Comparison, PathKind};
use crate::textcodec::TextEncoding;
use crate::textdiff::{self, DiffMode, DiffOptions, DiffRow};

#[tauri::command]
pub fn compare_paths(
    left: Option<String>,
    right: Option<String>,
    mode: DiffMode,
    options: DiffOptions,
) -> Result<Comparison, String> {
    match (left, right) {
        (Some(l), Some(r)) => compare::compare_paths(l.as_ref(), r.as_ref(), mode, &options),
        (Some(l), None) => compare::view_single(l.as_ref(), true),
        (None, Some(r)) => compare::view_single(r.as_ref(), false),
        (None, None) => Err("ファイルまたはフォルダが指定されていません".to_string()),
    }
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
        let one = |l: Option<String>, r: Option<String>| compare_paths(l, r, DiffMode::Line, DiffOptions::default());
        assert!(matches!(one(Some(dir.clone()), None), Ok(Comparison::Directory { .. })));
        assert!(matches!(one(None, Some(dir)), Ok(Comparison::Directory { .. })));
        assert!(one(None, None).is_err());
    }

    #[test]
    fn compare_paths_reports_missing() {
        assert!(compare_paths(Some("/nonexistent/x".into()), Some("/nonexistent/y".into()), DiffMode::Line, DiffOptions::default()).is_err());
    }
}
