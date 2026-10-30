import { useMemo, useState } from "react";
import { buildTree, collapsibleDirs, isDirNode, isVisible, type StatusFilter, type TreeNode } from "../lib/tree";
import { ToolbarPortal } from "./ToolbarSlot";
import type { DirEntry } from "../types";

const LABEL = { same: "同一", added: "追加", removed: "削除", modified: "変更" } as const;

interface NodeProps {
  node: TreeNode;
  depth: number;
  filter: StatusFilter;
  query: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}

function Node(props: NodeProps) {
  const { node, depth, filter, query, collapsed, onToggle, onOpen } = props;
  if (!isVisible(node, filter, query)) return null;
  const dir = isDirNode(node);
  const expandable = dir && node.children.length > 0;
  // 検索中は一致箇所を見逃さないよう、閉じていても開いて表示する
  const open = query.trim() !== "" || !collapsed.has(node.path);
  const openable = node.left === "file" && node.right === "file";
  const pad = { paddingLeft: depth * 16 };
  const name = `${dir ? "📁 " : ""}${node.name}`;
  const label = (present: boolean) =>
    present && (openable ? <button className="link" onClick={() => onOpen(node.path)}>{name}</button> : name);
  return (
    <>
      <div className={`dir-row st-${node.status}`} role="treeitem" aria-label={node.path} aria-expanded={expandable ? open : undefined}>
        <div className="dir-cell" style={pad}>
          {expandable && (
            <button className="toggle" aria-label={`${node.path}を${open ? "閉じる" : "開く"}`} onClick={() => onToggle(node.path)}>
              {open ? "▼" : "▶"}
            </button>
          )}
          {label(node.left !== null)}
        </div>
        <div className="dir-status mid">{node.status === "same" && (dir || node.left === null || node.right === null) ? "" : LABEL[node.status]}</div>
        <div className="dir-cell" style={pad}>
          {label(node.right !== null)}
        </div>
      </div>
      {open &&
        node.children.map((c) => <Node key={c.path} {...props} node={c} depth={depth + 1} />)}
    </>
  );
}

/** single: 1つだけ開いている（比較しないので差分件数は出さない） */
export function DirCompare(props: { entries: DirEntry[]; onOpen: (relPath: string) => void; single?: boolean }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(props.entries), [props.entries]);
  const toggle = (path: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  return (
    <section className="dir-compare">
      <ToolbarPortal>
        <label>
          表示
          <select aria-label="表示する差分" value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)}>
            <option value="all">すべて</option>
            <option value="diff">差分のみ</option>
            <option value="added">追加のみ</option>
            <option value="removed">削除のみ</option>
            <option value="modified">変更のみ</option>
          </select>
        </label>
        <input type="search" aria-label="名前で絞り込み" placeholder="名前で絞り込み" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button onClick={() => setCollapsed(new Set())}>すべて開く</button>
        <button onClick={() => setCollapsed(new Set(collapsibleDirs(tree)))}>すべて閉じる</button>
        {!props.single && <span className="summary">{props.entries.filter((e) => e.status !== "same").length} 件の差分</span>}
      </ToolbarPortal>
      <div role="tree" className="dir-tree">
        {tree.map((n) => (
          <Node key={n.path} node={n} depth={0} filter={filter} query={query} collapsed={collapsed} onToggle={toggle} onOpen={props.onOpen} />
        ))}
      </div>
    </section>
  );
}
