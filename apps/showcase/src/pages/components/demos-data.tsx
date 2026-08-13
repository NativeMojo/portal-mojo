// Data demos: the server-driven Groups table (ModelTable at full feature set
// against /api/group). Runs identically on the mock and a live django-mojo —
// the transport badge in the sidebar footer says which one is answering.
// The filter system has its own test bed next door in demos-filters.tsx
// (it used to be two paragraphs of prose here, which is not a test bed).
import { type Group } from 'portal-mojo/client/runtime';
import { Badge, fmt, groupByField, ModelTable, type Column, type FilterDef } from 'portal-mojo/ui';
import { registerNonFilterParams } from 'portal-mojo/client/runtime';

// `?demo=` selects the playground section — it must never become a filter
// pill on the tables in this chunk. Module side effect: runs at chunk load,
// before any table's first render. (demo-wire.tsx does the same for the
// filters demo; ComponentsPage itself must stay free of portal-mojo/client
// imports — the eager chunk rides a byte ceiling.)
registerNonFilterParams('demo');
import { GroupModel, GROUP_KIND_OPTIONS } from '../../models';

type GroupRow = Group & { id: number };

const COLUMNS: Column<GroupRow>[] = [
    {
        key: 'name', label: 'Group', hideable: false, render: (g) => (
            <div className="cell-user">
                <span className="cell-avatar"><i className="bi bi-diagram-3" /></span>
                <span>
                    <span className="cell-name">{g.name}</span>
                    {g.parent && <span className="cell-sub">in {g.parent.name}</span>}
                </span>
            </div>
        ),
    },
    { key: 'kind', label: 'Kind', render: (g) => <Badge tone="primary">{g.kind}</Badge> },
    {
        key: 'is_active', label: 'Status', render: (g) => (
            <Badge>{(g as { is_active?: boolean }).is_active === false ? 'Inactive' : 'Active'}</Badge>
        ),
    },
    {
        key: 'created', label: 'Created', render: (g) =>
            fmt.date((g as { created?: number | string }).created ?? null),
    },
];

// Every filter here is a Django lookup the SERVER answers — including the
// multiselect (kind__in collapse) the Users page has no field for.
const FILTERS: FilterDef[] = [
    { key: 'name', label: 'Name', type: 'text', placeholder: 'Contains…' },
    { key: 'kind', label: 'Kind', type: 'multiselect', options: GROUP_KIND_OPTIONS },
    { key: 'created', label: 'Created', type: 'daterange' },
];

export function TableDemo() {
    return (
        <ModelTable<GroupRow>
            model={GroupModel}
            eyebrow="Playground · server-driven"
            title="Groups"
            searchPlaceholder="Search groups…"
            defaultSort="name"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'orgs', label: 'Orgs', params: { kind: 'org' } },
                { key: 'teams', label: 'Teams', params: { kind: 'team' } },
            ]}
            columnChooser
            persistState
            persistKey="playground-groups"
            exportFormats={['csv', 'json']}
            rowExpand={(g) => (
                <div className="expand-grid">
                    <div>
                        <div className="eyebrow">Identity</div>
                        <div>#{g.id} · {g.kind}</div>
                        {g.uuid && <div className="dim">{g.uuid}</div>}
                    </div>
                    <div>
                        <div className="eyebrow">Hierarchy</div>
                        <div>{g.parent ? <>Child of <b>{g.parent.name}</b></> : <span className="dim-italic">Top-level</span>}</div>
                    </div>
                </div>
            )}
            {...groupByField<GroupRow>('kind', { format: (k) => `${k.charAt(0).toUpperCase()}${k.slice(1)}s` })}
        />
    );
}

/**
 * fixedParams — locked scope (board #1634). The `kind: 'team'` scope is
 * table IDENTITY: no pill, Clear all keeps it, a bookmarked `?kind=org`
 * is scrubbed, and every wire request (incl. export) carries it. Scope in
 * `defaultParams` instead would render a removable pill — one click from
 * an un-scoped tenant table, which is the security gap the prop closes.
 */
export function ScopedTableDemo() {
    return (
        <ModelTable<GroupRow>
            model={GroupModel}
            title="Teams only"
            eyebrow="Playground · fixedParams"
            fixedParams={{ kind: 'team' }}
            searchPlaceholder="Search teams…"
            defaultSort="name"
            columns={COLUMNS.filter((c) => c.key !== 'kind')}
            filters={FILTERS.filter((f) => f.key !== 'kind')}
        />
    );
}
