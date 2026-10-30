import type { DirEntry, DirStatus, NodeKind } from "../types";

export interface TreeNode {
  name: string;
  path: string;
  left: NodeKind | null;
  right: NodeKind | null;
  status: DirStatus;
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
