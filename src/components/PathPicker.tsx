interface Props {
  side: "left" | "right";
  value: string | null;
  info?: string;
  choosing: boolean;
  onPick: () => void;
  onChoose: (directory: boolean) => void;
}

const NAME = { left: "左", right: "右" } as const;

/** ペイン上部のパス表示欄。右端にフォルダアイコンの選択ボタンを置く。 */
export function PathPicker({ side, value, info, choosing, onPick, onChoose }: Props) {
  return (
    <div className={`picker ${side}`}>
      <div className="path-box">
        <span className="path" title={value ?? ""}>
          {value ?? "未選択（ドラッグ＆ドロップも可）"}
        </span>
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
      </div>
    </div>
  );
}
