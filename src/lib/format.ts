/** バイト数を、人が読みやすい単位で表す（例: 1536 → "1.5 KB"）。 */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UNIX 秒を、ローカル時刻の "YYYY-MM-DD HH:mm" で表す。 */
export function formatDate(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
