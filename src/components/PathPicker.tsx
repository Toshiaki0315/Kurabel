interface Props {
  label: string;
  value: string | null;
  onPick: (directory: boolean) => void;
}

export function PathPicker({ label, value, onPick }: Props) {
  return (
    <div className="picker">
      <strong>{label}</strong>
      <span className="path" title={value ?? ""}>
        {value ?? "未選択（ドラッグ＆ドロップも可）"}
      </span>
      <button onClick={() => onPick(false)}>{label}のファイル…</button>
      <button onClick={() => onPick(true)}>{label}のフォルダ…</button>
    </div>
  );
}
