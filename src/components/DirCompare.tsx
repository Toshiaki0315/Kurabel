import { useMemo, useState } from "react";
import { buildTree, hasDiff, isDirNode, type TreeNode } from "../lib/tree";
import { ToolbarPortal } from "./ToolbarSlot";
import type { DirEntry } from "../types";

const LABEL = { same: "同一", added: "追加", removed: "削除", modified: "変更" } as const;

function Node(props: { node: TreeNode; depth: number; onlyDiff: boolean; onOpen: (path: string) => void }) {
  const { node, depth, onlyDiff, onOpen } = props;
  if (onlyDiff && !hasDiff(node)) return null;
  const dir = isDirNode(node);
  const openable = node.left === "file" && node.right === "file";
  const pad = { paddingLeft: depth * 16 };
  const name = `${dir ? "📁 " : ""}${node.name}`;
  return (
    <>
      <div className={`dir-row st-${node.status}`} role="treeitem" aria-label={node.path}>
        <div className="dir-cell" style={pad}>
          {node.left && (openable ? <button className="link" onClick={() => onOpen(node.path)}>{name}</button> : name)}
        </div>
        <div className="dir-status mid">{dir && node.status === "same" ? "" : LABEL[node.status]}</div>
        <div className="dir-cell" style={pad}>
          {node.right && (openable ? <button className="link" onClick={() => onOpen(node.path)}>{name}</button> : name)}
        </div>
      </div>
      {node.children.map((c) => (
        <Node key={c.path} node={c} depth={depth + 1} onlyDiff={onlyDiff} onOpen={onOpen} />
      ))}
    </>
  );
}

export function DirCompare(props: { entries: DirEntry[]; onOpen: (relPath: string) => void }) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const tree = useMemo(() => buildTree(props.entries), [props.entries]);
  return (
    <section className="dir-compare">
      <ToolbarPortal>
        <label>
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          差分のみ表示
        </label>
        <span className="summary">{props.entries.filter((e) => e.status !== "same").length} 件の差分</span>
      </ToolbarPortal>
      <div role="tree" className="dir-tree">
        {tree.map((n) => (
          <Node key={n.path} node={n} depth={0} onlyDiff={onlyDiff} onOpen={props.onOpen} />
        ))}
      </div>
    </section>
  );
}
