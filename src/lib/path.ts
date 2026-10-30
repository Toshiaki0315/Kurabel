/** ルートと `/` 区切りの相対パスを結合する（Windows の区切り文字にも対応）。 */
export function joinPath(root: string, rel: string): string {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const base = root.endsWith(sep) ? root.slice(0, -1) : root;
  return `${base}${sep}${sep === "\\" ? rel.replace(/\//g, "\\") : rel}`;
}
