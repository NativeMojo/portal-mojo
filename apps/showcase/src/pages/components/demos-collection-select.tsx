// CollectionSelect demos — the single-record server picker against the mock
// /api/user AND /api/group models. Four panels exercise every feature the
// port carries: id→label hydration + search-clears-selection + clear ✕ +
// keyboard (panel 1), model binding with an OBJECT initial value,
// defaultParams and the emptyFetch=false "start typing" mode (panel 2),
// the field states — disabled / readOnly / required+error (panel 3), and
// requiresActiveGroup's held fetch (panel 4).
import { useState } from 'react';
import { type Group, type User } from 'portal-mojo/client';
import { GroupModel } from '../../models';
import { CollectionSelect, type CollectionSelectValue } from 'portal-mojo/ui';

type GroupRow = Group & { id: number };

export function CollectionSelectDemo() {
    // Panel 1 — starts as a BARE id: the picker shows "#42" for a beat, then
    // hydrates the label through the one-record cache key.
    const [userId, setUserId] = useState<string | number | null>(42);
    const [userEvent, setUserEvent] = useState('—');

    // Panel 2 — starts as an OBJECT value (a row with the relation expanded):
    // id + label extract via the dot paths, no fetch needed.
    const [teamId, setTeamId] = useState<CollectionSelectValue>({ id: 2, name: 'Engineering' });
    const [anyGroupId, setAnyGroupId] = useState<string | number | null>(null);

    // Panel 4 — group-scoped fetch.
    const [memberId, setMemberId] = useState<string | number | null>(null);

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">id → label hydration · search clears selection · clear ✕ · keyboard</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 640 }}>
                    The value starts as the bare id <code>42</code> — the picker shows <code>#42</code>, finds
                    the row in any cached list, else fetches it through the shared one-record key
                    (<code>['/api/user','one',42]</code> — the same cache DetailView reads). Focus opens the
                    initial page (<code>emptyFetch</code>); typing searches server-side after 400ms. Type over
                    a committed label and the selection clears — watch <code>value</code> flip to{' '}
                    <code>null</code> below. <b>ArrowDown/Up</b> walk, <b>Enter</b> commits, <b>Escape</b>{' '}
                    restores the committed label; ✕ clears and refocuses.
                </p>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <CollectionSelect<User>
                        endpoint="/api/user"
                        labelField="display_name"
                        value={userId}
                        onChange={(id, row) => {
                            setUserId(id);
                            setUserEvent(`onChange(${JSON.stringify(id)}${row ? `, row: ${String(row.display_name)}` : ''})`);
                        }}
                        label="User"
                        placeholder="Search users…"
                        help="Bound to /api/user with labelField='display_name'."
                    />
                    <div style={{ minWidth: 260 }}>
                        <div className="eyebrow">value (controlled)</div>
                        <pre className="demo-pre" style={{ marginTop: 6 }}>{JSON.stringify(userId)}</pre>
                        <div className="eyebrow" style={{ marginTop: 10 }}>last commit</div>
                        <pre className="demo-pre" style={{ marginTop: 6 }}>{userEvent}</pre>
                        <div className="demo-row" style={{ marginTop: 10 }}>
                            <button className="btn btn-compact" onClick={() => setUserId(7)}>value = 7</button>
                            <button className="btn btn-compact" onClick={() => setUserId('13')}>value = '13'</button>
                            <button className="btn btn-compact" onClick={() => setUserId(null)}>value = null</button>
                        </div>
                        <p className="dim" style={{ margin: '8px 0 0', fontSize: 12 }}>
                            <code>'13'</code> (a string id) hydrates under the NUMERIC one-record key —
                            normalized comparisons, one shared cache.
                        </p>
                    </div>
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Model binding · object value in · defaultParams · emptyFetch=false</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 640 }}>
                    Left: bound to <code>GroupModel</code>, the initial value is an <b>object</b>{' '}
                    (<code>{'{ id: 2, name: "Engineering" }'}</code>) — label and id extract via the dot
                    paths, no fetch. <code>defaultParams={'{{ kind: "team" }}'}</code> rides every wire call
                    and <code>maxItems=5</code> is the <code>size</code> param. Right:{' '}
                    <code>emptyFetch=false</code> — nothing is fetched until you type
                    ("Start typing to search…"), with a snappier <code>debounceMs=200</code>.
                </p>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <CollectionSelect<GroupRow>
                        model={GroupModel}
                        value={teamId}
                        onChange={(id) => setTeamId(id)}
                        defaultParams={{ kind: 'team' }}
                        maxItems={5}
                        label="Team"
                        placeholder="Search teams…"
                        help="Teams only (defaultParams), 5 per page (maxItems → size)."
                    />
                    <CollectionSelect<GroupRow>
                        model={GroupModel}
                        value={anyGroupId}
                        onChange={(id) => setAnyGroupId(id)}
                        emptyFetch={false}
                        debounceMs={200}
                        label="Any group"
                        placeholder="Type to search groups…"
                        help="emptyFetch=false — the dropdown waits for a term."
                    />
                    <div style={{ minWidth: 200 }}>
                        <div className="eyebrow">values</div>
                        <pre className="demo-pre" style={{ marginTop: 6 }}>
                            {`team: ${JSON.stringify(teamId)}\nany:  ${JSON.stringify(anyGroupId)}`}
                        </pre>
                    </div>
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Field states — disabled · readOnly · required + error</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 640 }}>
                    Disabled and readOnly both freeze the pipeline (no open, no typing, no ✕);
                    readOnly still renders its committed label at full contrast. <code>error</code>{' '}
                    replaces <code>help</code> and paints the input invalid.
                </p>
                <div className="demo-row" style={{ alignItems: 'flex-start' }}>
                    <CollectionSelect<GroupRow>
                        model={GroupModel}
                        value={{ id: 1, name: 'Acme Corp' }}
                        onChange={() => undefined}
                        disabled
                        label="Disabled"
                    />
                    <CollectionSelect<GroupRow>
                        model={GroupModel}
                        value={{ id: 4, name: 'Globex' }}
                        onChange={() => undefined}
                        readOnly
                        label="Read-only"
                        help="Display-only committed label."
                    />
                    <CollectionSelect<User>
                        endpoint="/api/user"
                        labelField="display_name"
                        value={null}
                        onChange={() => undefined}
                        required
                        error="Pick a user to continue"
                        label="Owner"
                    />
                </div>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">requiresActiveGroup — the held fetch</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 640 }}>
                    With no active group the fetch is <b>held</b> — never an unscoped list where a scoped
                    one was demanded — and the dropdown says so. Pick a group in the sidebar switcher and
                    the fetch runs with <code>group=&lt;id&gt;</code> on the wire. (The mock's user rows
                    carry no <code>group</code> field, so a scoped mock search comes back empty — a live
                    django-mojo answers with the group's members.)
                </p>
                <CollectionSelect<User>
                    endpoint="/api/user"
                    labelField="display_name"
                    requiresActiveGroup
                    value={memberId}
                    onChange={(id) => setMemberId(id)}
                    label="Member (group-scoped)"
                    placeholder="Search members…"
                />
            </div>
        </>
    );
}
