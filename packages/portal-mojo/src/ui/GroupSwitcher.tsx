// GroupSwitcher — the searchable, hierarchical group selector. Ported from
// web-mojo GroupSearchView (tree build from flat rows incl. embedded parent
// objects, name-sorted levels, └/├/│ line segments, kind chips) on
// SimpleSearchView's mechanics (300ms debounced server-side search).
// Selection drives the A3 GroupProvider: storage + `?group=` URL param +
// member fetch all follow from setActiveGroup.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveGroup } from '../client/group';
import type { Group } from '../client/group-context';
import { useModelList } from '../client/hooks';

interface FlatNode {
    group: Group;
    level: number;
    isLastChild: boolean;
    /** For each ancestor level: does its vertical line continue past this row? */
    verticals: boolean[];
    hasChildren: boolean;
}

/** GroupSearchView.buildTreeHierarchy + flattenTree + computeVerticalLines. */
export function buildGroupTree(items: Group[]): FlatNode[] {
    if (items.length === 0) return [];
    interface Node { group: Group; children: Node[] }
    const byId = new Map<number, Node>();
    // First pass: every row, plus parents embedded on rows (a matched child
    // whose parent didn't match the search still renders under it).
    for (const item of items) {
        if (!byId.has(item.id)) byId.set(item.id, { group: item, children: [] });
    }
    for (const item of items) {
        const parent = item.parent;
        if (parent && parent.id && !byId.has(parent.id)) {
            byId.set(parent.id, { group: { kind: 'group', ...parent } as Group, children: [] });
        }
    }
    const roots: Node[] = [];
    for (const node of byId.values()) {
        const parentId = node.group.parent?.id;
        if (parentId != null && byId.has(parentId) && parentId !== node.group.id) {
            byId.get(parentId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }
    const byName = (a: Node, b: Node) => (a.group.name || '').localeCompare(b.group.name || '');
    roots.sort(byName);

    const flat: FlatNode[] = [];
    const walk = (nodes: Node[], level: number, ancestorsLast: boolean[]) => {
        nodes.sort(byName);
        nodes.forEach((node, i) => {
            const isLastChild = i === nodes.length - 1;
            flat.push({ group: node.group, level, isLastChild, verticals: [], hasChildren: node.children.length > 0 });
            if (node.children.length > 0) walk(node.children, level + 1, [...ancestorsLast, isLastChild]);
        });
    };
    walk(roots, 0, []);

    // Second pass: a vertical line continues at segment s when a later row at
    // level s+1 appears before the walk returns to level ≤ s.
    for (let i = 0; i < flat.length; i++) {
        const node = flat[i]!;
        for (let s = 0; s < node.level; s++) {
            let found = false;
            for (let j = i + 1; j < flat.length; j++) {
                const later = flat[j]!;
                if (later.level === s + 1) { found = true; break; }
                if (later.level <= s) break;
            }
            node.verticals[s] = found;
        }
    }
    return flat;
}

function TreeLines({ node }: { node: FlatNode }) {
    if (node.level === 0) return null;
    return (
        <span className="tree-lines">
            {Array.from({ length: node.level }, (_, s) => {
                const last = s === node.level - 1;
                const cls = last
                    ? (node.isLastChild ? 'tree-seg tree-seg-last' : 'tree-seg tree-seg-mid')
                    : (node.verticals[s] ? 'tree-seg tree-seg-vert' : 'tree-seg');
                return <span key={s} className={cls} />;
            })}
        </span>
    );
}

export function GroupSwitcher({ onSelected, onCleared }: {
    /** After a group activates — e.g. navigate into the group menu's home. */
    onSelected?: (group: Group) => void;
    /** After the active group clears — e.g. navigate back to the main menu. */
    onCleared?: () => void;
} = {}) {
    const { group, loading, setActiveGroup, clearActiveGroup } = useActiveGroup();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [term, setTerm] = useState('');
    const wrapRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // SimpleSearchView parity: 300ms debounce into the server-side search.
    useEffect(() => {
        const t = setTimeout(() => setTerm(input.trim()), 300);
        return () => clearTimeout(t);
    }, [input]);

    useEffect(() => {
        if (!open) return;
        searchRef.current?.focus();
        // 'click', not 'mousedown': a listener attached while the opening
        // click is still dispatching never sees that same event, so the
        // opener can't self-close (mousedown-arming raced automation/fast
        // double-events into instant closes).
        const onDocClick = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const list = useModelList<Group>('/api/group', { search: term || undefined, sort: 'name', size: 50 });
    const tree = useMemo(() => buildGroupTree(list.data?.rows ?? []), [list.data]);

    const pick = (g: Group) => {
        setActiveGroup(g);
        setOpen(false);
        setInput('');
        onSelected?.(g);
    };

    return (
        <div className="group-switch-wrap" ref={wrapRef}>
            <button
                className={`group-btn${group ? ' group-btn-active' : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={open}
                title={group ? `Active group: ${group.name}` : 'Select active group'}
            >
                <i className={`bi ${group ? 'bi-diagram-3-fill' : 'bi-diagram-3'}`} />
                <span className="group-btn-label">
                    {loading ? 'Loading…' : group ? group.name : 'All groups'}
                </span>
                {group && <span className="chip chip-primary group-kind">{group.kind}</span>}
                <i className="bi bi-chevron-expand group-caret" />
            </button>
            {open && (
                <div className="group-menu" role="listbox">
                    <div className="search-box group-menu-search">
                        <i className="bi bi-search" />
                        <input
                            ref={searchRef}
                            value={input}
                            placeholder="Search groups…"
                            onChange={(e) => setInput(e.target.value)}
                        />
                    </div>
                    <div className="group-menu-list">
                        {group && (
                            <button className="group-row group-row-clear" onClick={() => { clearActiveGroup(); setOpen(false); onCleared?.(); }}>
                                <i className="bi bi-x-circle" /> Clear active group
                            </button>
                        )}
                        {list.isLoading && (
                            <div className="group-menu-loading">
                                <span className="skel" /><span className="skel" /><span className="skel" />
                            </div>
                        )}
                        {!list.isLoading && tree.length === 0 && (
                            <div className="group-menu-empty">No groups match “{term}”</div>
                        )}
                        {tree.map((node) => (
                            <button
                                key={node.group.id}
                                className={`group-row${group?.id === node.group.id ? ' group-row-active' : ''}`}
                                onClick={() => pick(node.group)}
                                role="option"
                                aria-selected={group?.id === node.group.id}
                            >
                                <TreeLines node={node} />
                                <span className="group-row-name">{node.group.name}</span>
                                <span className="group-row-kind">{node.group.kind}</span>
                                {group?.id === node.group.id && <i className="bi bi-check-lg" />}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
