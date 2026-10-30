//! Tauri コマンド。ロジックは各モジュールに置き、ここは薄いラッパーに留める。

use crate::compare::{self, Comparison};
use crate::textdiff::{self, DiffMode, DiffRow};

#[tauri::command]
pub fn compare_paths(left: String, right: String, mode: DiffMode) -> Result<Comparison, String> {
    compare::compare_paths(left.as_ref(), right.as_ref(), mode)
}

#[tauri::command]
pub fn diff_text(left: String, right: String, mode: DiffMode) -> Vec<DiffRow> {
    textdiff::diff_text(&left, &right, mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_text_wraps_core() {
        let rows = diff_text("a".into(), "b".into(), DiffMode::Line);
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn compare_paths_reports_missing() {
        assert!(compare_paths("/nonexistent/x".into(), "/nonexistent/y".into(), DiffMode::Line).is_err());
    }
}
