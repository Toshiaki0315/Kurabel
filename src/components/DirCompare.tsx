import { useMemo, useState } from "react";
import { formatDate, formatSize } from "../lib/format";
import { baseName } from "../lib/recent";
import { buildDirReport, nowLabel } from "../lib/report";
import { saveReport } from "../lib/saveReport";
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
  selected: string | null;
  onSelect: (path: string) => void;
}

function Node(props: NodeProps) {
  const { node, depth, filter, query, collapsed, onToggle, onOpen, selected, onSelect } = props;
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
  // 変更されたファイルは、更新日時が新しい側を強調する
  const newer = (mine: number | null, other: number | null) =>
    node.status === "modified" && mine !== null && other !== null && mine > other ? " newer" : "";
  const side = (present: boolean, size: number | null, modified: number | null, other: number | null, toggle: boolean) => (
    <div className="dir-cell">
      <span className="dir-name" style={pad}>
        {toggle && expandable && (
          <button className="toggle" aria-label={`${node.path}を${open ? "閉じる" : "開く"}`} onClick={() => onToggle(node.path)}>
            {open ? "▼" : "▶"}
          </button>
        )}
        {label(present)}
      </span>
      <span className="dir-size">{formatSize(size)}</span>
      <span className={`dir-date${newer(modified, other)}`}>{formatDate(modified)}</span>
    </div>
  );
  return (
    <>
      <div className={`dir-row st-${node.status}${selected === node.path ? " selected" : ""}`} onClick={() => onSelect(node.path)} role="treeitem" aria-label={node.path} aria-expanded={expandable ? open : undefined}>
        {side(node.left !== null, node.leftSize, node.leftModified, node.rightModified, true)}
        <div className="dir-status mid">{node.status === "same" && (dir || node.left === null || node.right === null) ? "" : LABEL[node.status]}</div>
        {side(node.right !== null, node.rightSize, node.rightModified, node.leftModified, false)}
      </div>
      {open &&
        node.children.map((c) => <Node key={c.path} {...props} node={c} depth={depth + 1} />)}
    </>
  );
}

/** single: 1つだけ開いている（比較しないので差分件数は出さない） */
interface DirCompareProps {
  entries: DirEntry[];
  onOpen: (relPath: string) => void;
  single?: boolean;
  /** zip などのアーカイブの中身（読み取り専用: コピー・削除はできない） */
  archive?: boolean;
  /** 選択した項目を反対側へコピー（overwrite: コピー先に同名の項目がある） */
  onCopy?: (relPath: string, from: "left" | "right", overwrite: boolean) => void;
  onDelete?: (relPath: string, side: "left" | "right") => void;
  /** レポートの見出しに使う、左右のフォルダのパス */
  leftRoot?: string | null;
  rightRoot?: string | null;
}

export function DirCompare(props: DirCompareProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const sel = props.entries.find((e) => e.path === selected);
  const [report, setReport] = useState<{ message: string; error: boolean } | null>(null);
  const exportReport = async () => {
    try {
      const html = buildDirReport(props.leftRoot ?? "", props.rightRoot ?? "", props.entries, nowLabel());
      const saved = await saveReport(html, `${baseName(props.leftRoot ?? "folder")}-compare.html`);
      setReport(saved ? { message: "レポートを保存しました", error: false } : null);
    } catch (e) {
      setReport({ message: String(e), error: true });
    }
  };
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
        {!props.single && !props.archive && (
          <>
            <button disabled={!sel?.left} onClick={() => sel && props.onCopy?.(sel.path, "left", sel.right !== null)}>
              → 右へコピー
            </button>
            <button disabled={!sel?.right} onClick={() => sel && props.onCopy?.(sel.path, "right", sel.left !== null)}>
              ← 左へコピー
            </button>
            <button disabled={!sel?.left} onClick={() => sel && props.onDelete?.(sel.path, "left")}>
              左を削除
            </button>
            <button disabled={!sel?.right} onClick={() => sel && props.onDelete?.(sel.path, "right")}>
              右を削除
            </button>
          </>
        )}
        {!props.single && <button onClick={() => void exportReport()}>レポートを保存…</button>}
        {report && (report.error ? <span role="alert" className="error">{report.message}</span> : <span className="summary">{report.message}</span>)}
        {!props.single && <span className="summary">{props.entries.filter((e) => e.status !== "same").length} 件の差分</span>}
      </ToolbarPortal>
      <div role="tree" className="dir-tree">
        {tree.map((n) => (
          <Node key={n.path} node={n} depth={0} filter={filter} query={query} collapsed={collapsed} onToggle={toggle} onOpen={props.onOpen} selected={selected} onSelect={setSelected} />
        ))}
      </div>
    </section>
  );
}
