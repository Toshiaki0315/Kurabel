import type { DirEntry, DirStatus, NodeKind } from "../types";

export interface TreeNode {
  name: string;
  path: string;
  left: NodeKind | null;
  right: NodeKind | null;
  status: DirStatus;
  leftSize: number | null;
  rightSize: number | null;
  leftModified: number | null;
  rightModified: number | null;
  children: TreeNode[];
}

export function isDirNode(n: { left: NodeKind | null; right: NodeKind | null }): boolean {
  return (n.right ?? n.left) === "directory" && (n.left ?? n.right) === "directory";
}

/** フラットな相対パス一覧からツリーを構築する（入力はパス昇順）。 */
export function buildTree(entries: DirEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const byPath = new Map<string, TreeNode>();
  for (const e of entries) {
    const idx = e.path.lastIndexOf("/");
    const node: TreeNode = {
      name: e.path.slice(idx + 1),
      path: e.path,
      left: e.left,
      right: e.right,
      status: e.status,
      leftSize: e.left_size ?? null,
      rightSize: e.right_size ?? null,
      leftModified: e.left_modified ?? null,
      rightModified: e.right_modified ?? null,
      children: [],
    };
    byPath.set(e.path, node);
    const parent = idx >= 0 ? byPath.get(e.path.slice(0, idx)) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** ディレクトリは配下に差分があれば modified として扱う。 */
export function hasDiff(node: TreeNode): boolean {
  return node.status !== "same" || node.children.some(hasDiff);
}

export type StatusFilter = "all" | "diff" | "added" | "removed" | "modified";

/** 自身が条件（状態・名前）に合うか、配下に合うものがあれば表示する。 */
export function isVisible(node: TreeNode, filter: StatusFilter, query: string): boolean {
  const q = query.trim().toLowerCase();
  const statusOk = filter === "all" || (filter === "diff" ? node.status !== "same" : node.status === filter);
  const nameOk = q === "" || node.name.toLowerCase().includes(q);
  return (statusOk && nameOk) || node.children.some((c) => isVisible(c, filter, query));
}

/** 子を持つディレクトリのパス一覧（「すべて閉じる」用）。 */
export function collapsibleDirs(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [...(n.children.length > 0 ? [n.path] : []), ...collapsibleDirs(n.children)]);
}
