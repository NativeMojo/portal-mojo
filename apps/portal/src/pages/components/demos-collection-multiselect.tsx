// CollectionMultiSelect demos — the server-backed multi-pick panel against
// the mock /api/group model. Three panels exercise every feature the port
// carries: server search + shift-click ranges + SELECT/DESELECT (panel 1),
// renderItem custom rows + per-row disabled + defaultParams-as-callback
// (panel 2), and ignoreIds fed from panel 1's live selection — deliberately
// as STRINGS against numeric row ids, proving normalized id comparison
// end-to-end (panel 3).
import { useState } from 'react';
import { type Group } from 'portal-mojo/client';
import { Badge } from 'portal-mojo/ui';
import { GroupModel } from '../../models';
import { CollectionMultiSelect } from 'portal-mojo/ui';

type GroupRow = Group & { id: number };

const KIND_SEGMENTS = [
    { key: 'all', label: 'All kinds' },
    { key: 'org', label: 'Orgs' },
    { key: 'team', label: 'Teams' },
    { key: 'project', label: 'Projects' },
] as const;

export function CollectionMultiSelectDemo() {
    const [picked, setPicked] = useState<Array<string | number>>([]);
    const [pickedCustom, setPickedCustom] = useState<Array<string | number>>([]);
    const [pickedRest, setPickedRest] = useState<Array<string | number>>([]);
    const [controlDisabled, setControlDisabled] = useState(false);
    const [kind, setKind] = useState<(typeof KIND_SEGMENTS)[number]['key']>('all');

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">Model-bound multi-pick — search, shift-click, select/deselect all</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 640 }}>
                    Bound to <code>GroupModel</code> — the fetch rides <code>useModelList</code>'s cache keys, so
                    this list, the Groups table and every model hook share ONE cache. Search is a server wire
                    param (400ms debounce). Click one row, then <b>shift-click</b> another: the clicked row's new
                    state applies across the whole range.
                </p>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <CollectionMultiSelect<GroupRow>
                        model={GroupModel}
                        value={picked}
                        onChange={setPicked}
                        enableSearch
                        searchPlaceholder="Search groups…"
                        label="Groups"
                        required
                        help="Selections survive searches — pick under one term, search another, pick more."
                        disabled={controlDisabled}
                    />
                    <div style={{ minWidth: 220 }}>
                        <div className="eyebrow">value (controlled)</div>
                        <pre className="demo-pre" style={{ marginTop: 6 }}>{JSON.stringify(picked)}</pre>
                        <label className="switch-row" style={{ maxWidth: 200 }}>
                            <span className="field-label">Disable control</span>
                            <input
                                type="checkbox"
                                role="switch"
                                className="switch"
                                checked={controlDisabled}
                                onChange={(e) => setControlDisabled(e.target.checked)}
                            />
                        </label>
                    </div>
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">renderItem custom rows · per-row disabled · defaultParams callback</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 640 }}>
                    <code>renderItem</code> replaces the label span (the checkbox stays);{' '}
                    <code>isRowDisabled</code> locks org rows — SELECT and shift-click ranges skip them.
                    The kind segment feeds <code>defaultParams</code> as a callback: its result merges into the
                    wire params, so switching it is a new query key and a fresh server fetch.
                </p>
                <div className="seg" style={{ marginBottom: 12 }}>
                    {KIND_SEGMENTS.map((s) => (
                        <button
                            key={s.key}
                            className={`seg-btn${kind === s.key ? ' seg-active' : ''}`}
                            onClick={() => setKind(s.key)}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
                <CollectionMultiSelect<GroupRow>
                    endpoint="/api/group"
                    value={pickedCustom}
                    onChange={setPickedCustom}
                    size={6}
                    defaultParams={() => (kind === 'all' ? { sort: 'name' } : { sort: 'name', kind })}
                    isRowDisabled={(g) => g.kind === 'org'}
                    renderItem={(g) => (
                        <>
                            <span className="collection-multiselect-item-label">
                                {g.name}
                                {g.parent && <span className="dim"> · in {g.parent.name}</span>}
                            </span>
                            <Badge tone={g.kind === 'org' ? 'muted' : 'primary'}>{g.kind}</Badge>
                        </>
                    )}
                    label="Teams & projects"
                    help="Org rows are disabled — select-all counts and picks only the enabled ones."
                />
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">ignoreIds — the "already added" pattern</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 640 }}>
                    This list hides whatever the first panel has selected — <code>ignoreIds</code> is the one
                    sanctioned client-side row filter. The ids are passed as <b>strings</b> against numeric row
                    ids on purpose: comparisons are normalized, so mixed id types work by construction (the
                    legacy loose-<code>==</code> bug class ends here). The legacy server-side{' '}
                    <code>excludeIds</code> option is not ported.
                </p>
                <CollectionMultiSelect<GroupRow>
                    endpoint="/api/group"
                    value={pickedRest}
                    onChange={setPickedRest}
                    ignoreIds={picked.map(String)}
                    label="Groups not picked above"
                    help={picked.length > 0
                        ? `Hiding ${picked.length} row(s) selected in the first panel.`
                        : 'Select rows in the first panel and they vanish from this one.'}
                />
            </div>
        </>
    );
}
