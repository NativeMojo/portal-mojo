// Data demos: the server-driven Groups table (ModelTable at full feature
// set against /api/group) + the filters explainer. Runs identically on the
// mock and a live django-mojo — the transport badge in the sidebar footer
// says which one is answering.
import { type Group } from 'portal-mojo/client';
import { Badge, fmt, groupByField, ModelTable, type Column, type FilterDef } from 'portal-mojo/ui';
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

export function FiltersNote() {
    return (
        <div className="panel panel-pad">
            <p>
                Filters are exercised live on the <b>ModelTable</b> demo (and the Users page):
                the Add-Filter menu opens a type-appropriate dialog — text (<code>__icontains</code>),
                select, <b>multiselect</b> (collapses to <code>field__in=a,b</code>, single value
                to <code>field</code>), boolean, number (<code>__gte</code>), and daterange
                (the <code>dr_field/dr_start/dr_end</code> triple — one active range by construction).
            </p>
            <p className="dim">
                Applied filters become editable pills, deep-link in the URL, and are <b>server-side
                always</b>: the params store writes wire params; django-mojo answers. No table in a
                portal-mojo app filters rows client-side.
            </p>
        </div>
    );
}
