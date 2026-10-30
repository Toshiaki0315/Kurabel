import { useEffect } from "react";
import type { Settings } from "../lib/settings";
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

  const toggle = (key: keyof DiffOptions) =>
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
