import { useEffect, useRef, useState } from "react";
import { checkRegex } from "../api";
import { parseExclude, parseLines, type Settings } from "../lib/settings";
import type { DiffMode, DiffOptions } from "../types";

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
}

const MODES: { value: DiffMode; label: string }[] = [
  { value: "line", label: "行単位" },
  { value: "word", label: "単語単位" },
];

/** 設定ダイアログ。変更はその場で反映される。Esc または背景クリックで閉じる。 */
export function SettingsDialog({ settings, onChange, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [prefixText, setPrefixText] = useState(settings.options.comment_prefixes.join(", "));
  const [regexText, setRegexText] = useState(settings.options.ignore_line_patterns.join("\n"));
  const [regexErrors, setRegexErrors] = useState<string[]>([]);
  const regexRun = useRef(0);
  // 正規表現が有効か、入力のたびにバックエンド（実際に使うエンジン）で確認する
  const validateRegexes = (patterns: string[]) => {
    const run = ++regexRun.current;
    void Promise.all(patterns.map((p) => checkRegex(p).then(() => null, (e) => `${p}: ${e}`))).then((results) => {
      if (run === regexRun.current) setRegexErrors(results.filter((r): r is string => r !== null));
    });
  };
  const [excludeText, setExcludeText] = useState(settings.options.exclude.join("\n"));
  const update = (patch: Partial<DiffOptions>) => onChange({ ...settings, options: { ...settings.options, ...patch } });

  const toggle = (key: "ignore_whitespace" | "ignore_case" | "ignore_blank_lines" | "ignore_comments" | "detect_moves") =>
    onChange({ ...settings, options: { ...settings.options, [key]: !settings.options[key] } });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">設定</h2>
        <fieldset>
          <legend>差分のハイライト</legend>
          {MODES.map((m) => (
            <label key={m.value}>
              <input type="radio" name="mode" checked={settings.mode === m.value} onChange={() => onChange({ ...settings, mode: m.value })} />
              {m.label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>比較時に無視するもの</legend>
          <label>
            <input type="checkbox" checked={settings.options.ignore_whitespace} onChange={() => toggle("ignore_whitespace")} />
            空白の違い
          </label>
          <label>
            <input type="checkbox" checked={settings.options.ignore_case} onChange={() => toggle("ignore_case")} />
            大文字小文字の違い
          </label>
          <label>
            <input type="checkbox" checked={settings.options.ignore_blank_lines} onChange={() => toggle("ignore_blank_lines")} />
            空行の追加・削除
          </label>
          <label>
            <input type="checkbox" checked={settings.options.ignore_comments} onChange={() => toggle("ignore_comments")} />
            コメントの違い
          </label>
          <label className="indent">
            コメントの開始文字列
            <input
              type="text"
              aria-label="コメントの開始文字列"
              placeholder="//, #"
              value={prefixText}
              disabled={!settings.options.ignore_comments}
              onChange={(e) => {
                setPrefixText(e.target.value);
                update({ comment_prefixes: parseExclude(e.target.value) });
              }}
            />
          </label>
          <label className="stack">
            無視する行のパターン（正規表現）
            <textarea
              aria-label="無視する行のパターン"
              rows={2}
              placeholder={"^\\s*Last updated:\n\\$Id.*\\$"}
              value={regexText}
              onChange={(e) => {
                setRegexText(e.target.value);
                const patterns = parseLines(e.target.value);
                update({ ignore_line_patterns: patterns });
                validateRegexes(patterns);
              }}
            />
            <small>1行に1パターン。一致した行は、差分として扱いません</small>
          </label>
          {regexErrors.length > 0 && (
            <ul role="alert" className="error regex-errors">
              {regexErrors.map((m) => (
                <li key={m}>無効な正規表現 — {m}</li>
              ))}
            </ul>
          )}
        </fieldset>
        <fieldset>
          <legend>表示</legend>
          <label>
            <input type="checkbox" checked={settings.options.detect_moves} onChange={() => toggle("detect_moves")} />
            移動した行を検出して印を付ける
          </label>
        </fieldset>
        <fieldset>
          <legend>フォルダの比較</legend>
          <label className="stack">
            除外するパターン
            <textarea
              aria-label="除外パターン"
              rows={3}
              placeholder={".git\n*.obj\nnode_modules"}
              value={excludeText}
              onChange={(e) => {
                setExcludeText(e.target.value);
                update({ exclude: parseExclude(e.target.value) });
              }}
            />
            <small>改行またはカンマ区切り。* と ? が使えます（例: *.obj）</small>
          </label>
          <label>
            <input type="checkbox" checked={settings.options.recursive} onChange={() => update({ recursive: !settings.options.recursive })} />
            サブフォルダを含める
          </label>
          <label>
            比較方法
            <select aria-label="フォルダの比較方法" value={settings.options.quick ? "quick" : "content"} onChange={(e) => update({ quick: e.target.value === "quick" })}>
              <option value="content">内容（正確）</option>
              <option value="quick">サイズと更新日時（高速）</option>
            </select>
          </label>
        </fieldset>
        <div className="dialog-actions">
          <button autoFocus onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
