import { ENCODINGS } from "../types";

/** テキストファイルの文字コード（自動判定の結果と、手動指定） */
export interface EncodingControl {
  detected: string;
  value: string | null;
  onChange: (value: string | null) => void;
}

interface Props {
  side: "left" | "right";
  value: string | null;
  info?: string;
  encoding?: EncodingControl;
  choosing: boolean;
  onPick: () => void;
  /** 開いているファイル/フォルダを閉じる */
  onClose: () => void;
  onChoose: (directory: boolean) => void;
}

const NAME = { left: "左", right: "右" } as const;

/** ペイン上部のパス表示欄。右端にフォルダアイコンの選択ボタンと、閉じる(✕)ボタンを置く。 */
export function PathPicker({ side, value, info, encoding, choosing, onPick, onChoose, onClose }: Props) {
  return (
    <div className={`picker ${side}`}>
      <div className="path-box">
        <span className="path" title={value ?? ""}>
          {value ?? "未選択（ドラッグ＆ドロップも可）"}
        </span>
        {encoding && (
          <select aria-label={`${NAME[side]}の文字コード`} value={encoding.value ?? ""} onChange={(e) => encoding.onChange(e.target.value || null)}>
            <option value="">自動 ({encoding.detected})</option>
            {ENCODINGS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        {info && <span className="info">{info}</span>}
        {choosing && (
          <span className="choice">
            <button onClick={() => onChoose(false)}>ファイル</button>
            <button onClick={() => onChoose(true)}>フォルダ</button>
          </span>
        )}
        <button className="icon" aria-label={`${NAME[side]}を選択`} title="ファイルまたはフォルダを選択" onClick={onPick}>
          📁
        </button>
        <button className="icon" aria-label={`${NAME[side]}を閉じる`} title="閉じる" disabled={!value} onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}
