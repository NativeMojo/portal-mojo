// Filters demo — a LIVE filtering surface, not an explainer. Every filter
// type the FilterBar supports is exercised against the mock /api/user (the
// same wire path the real Users page uses), the effect shows up in a real
// ModelTable below, and the panel on top prints the exact params the store is
// sending. That read-out is the teaching payload: "server-side always" is
// PROVEN here, not asserted — there is no client-side row work anywhere on
// this page.
//
// Users because this dataset proves the easy-to-get-wrong DateField boundary:
// dob is YYYY-MM-DD while last_activity is epoch seconds. It also carries the
// other filter shapes: email (text), org (FK), verification (multiselect),
// is_active (boolean), id (number), and two datetime dateranges.
import { useMemo } from 'react';
import { useModelList, useTableParams, type Params } from 'portal-mojo/client';
import {
    Badge, fmt, ModelTable, paramKeyFor, type Column, type FilterDef,
} from 'portal-mojo/ui';
import { UserModel, type GroupRow, type UserRow } from '../../models';
import { WireParams } from './demo-wire';

// Stable module constants — a fresh object literal per render would mint a new
// TanStack query key every time.
const ORG_PARAMS: Params = { start: 0, size: 25, kind: 'org', sort: 'name' };
const TOTAL_PARAMS: Params = { start: 0, size: 1 };
const DAY = 86400_000;
const isoDaysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

const COLUMNS: Column<UserRow>[] = [
    {
        key: 'display_name', label: 'User', hideable: false, render: (u) => (
            <div className="cell-user">
                <span className="cell-avatar"><i className="bi bi-person" /></span>
                <span>
                    <span className="cell-name">{u.display_name || u.username}</span>
                    <span className="cell-sub">{u.email}</span>
                </span>
            </div>
        ),
    },
    {
        key: 'org', label: 'Org', render: (u) => u.org && typeof u.org === 'object'
            ? <Badge tone="primary">{u.org.name}</Badge>
            : <span className="dim">—</span>,
    },
    {
        key: 'is_active', label: 'Status', align: 'center', render: (u) => (
            <Badge tone={u.is_active ? 'success' : 'danger'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
        ),
    },
    { key: 'id', label: 'ID', align: 'end', render: (u) => fmt.number(u.id) },
    { key: 'dob', label: 'DOB (DateField)', render: (u) => fmt.date(u.dob) },
    { key: 'last_activity', label: 'Last activity', render: (u) => fmt.relative(u.last_activity) },
];

/** What each type writes on the wire — derived from the defs, not retyped. */
function wireKeyOf(def: FilterDef): string {
    if (def.type === 'daterange') return 'dr_field / dr_start / dr_end';
    if (def.type === 'multiselect') return `${def.key}__in  (one value collapses to ${def.key})`;
    return paramKeyFor(def);
}

const TYPE_NOTE: Record<FilterDef['type'], string> = {
    text: 'Free text; the lookup defaults to icontains and is overridable per def (lookup: "startswith").',
    select: 'One value from server-fetched orgs. The wire carries the FK id — Django compares the embedded relation by pk.',
    multiselect: 'Checkbox dialog. Two or more values collapse to field__in=a,b; exactly one collapses back to the bare field — a field never carries both forms.',
    boolean: 'trueLabel / falseLabel in the dialog; the wire is the string "true" / "false".',
    number: 'Numeric entry, lookup defaults to gte ("id at least N"). Fully numeric operands compare numerically, so 10 sorts after 2.',
    date: 'A real User.dob DateField: both row and bound stay canonical YYYY-MM-DD. It is never coerced through the epoch-seconds datetime path.',
    daterange: 'Writes the dr_field/dr_start/dr_end TRIPLE, so only ONE range can ever be active. Two ranges are defined here (created and last activity) — pick the second and it replaces the first.',
};

export function FiltersDemo() {
    // A sibling read of the SAME store ModelTable uses below. Both derive from
    // the URL, so what this panel prints is byte-for-byte what the table sends
    // — the defaults have to match the table's (defaultSort="name").
    const p = useTableParams({ sort: 'name' });

    // The select's options are server data, not a hardcoded list.
    const orgs = useModelList<GroupRow>('/api/group', ORG_PARAMS);
    const orgOptions = useMemo(
        () => (orgs.data?.rows ?? []).map((g) => ({ value: String(g.id), label: g.name })),
        [orgs.data],
    );

    const defs = useMemo<FilterDef[]>(() => [
        { key: 'email', label: 'Email', type: 'text', placeholder: 'Contains…' },
        { key: 'org', label: 'Org', type: 'select', options: orgOptions },
        {
            key: 'is_email_verified', label: 'Email verification', type: 'multiselect', options: [
                { value: 'true', label: 'Verified' },
                { value: 'false', label: 'Unverified' },
            ],
        },
        { key: 'is_active', label: 'Status', type: 'boolean', trueLabel: 'Active', falseLabel: 'Inactive' },
        { key: 'id', label: 'ID', type: 'number' },
        { key: 'dob', label: 'Date of birth', type: 'date' },
        { key: 'last_login', label: 'Last login', type: 'daterange' },
        { key: 'last_activity', label: 'Last activity', type: 'daterange' },
    ], [orgOptions]);

    // Identical endpoint + params to ModelTable's own query, so TanStack hands
    // both callers ONE cached result — the read-out costs no extra request.
    const filtered = useModelList<UserRow>('/api/user', p.wire);
    const total = useModelList<UserRow>('/api/user', TOTAL_PARAMS);

    // One row per TYPE for the legend (two dateranges are defined, but the
    // shape is the same).
    const legend = useMemo(() => {
        const byType = new Map<FilterDef['type'], FilterDef>();
        for (const def of defs) if (!byType.has(def.type)) byType.set(def.type, def);
        return [...byType.values()];
    }, [defs]);

    const firstOrg = orgOptions[0];
    const has = (key: string, value: string) => p.filterValue(key) === value;
    const range = p.dateRange();

    const samples: { label: string; wire: string; on: boolean; disabled?: boolean; run: () => void }[] = [
        {
            label: 'Text', wire: 'email__icontains=native', on: has('email__icontains', 'native'),
            run: () => p.setFilter('email__icontains', 'native'),
        },
        {
            label: 'Select', wire: `org=${firstOrg?.value ?? '…'}`,
            on: !!firstOrg && has('org', firstOrg.value), disabled: !firstOrg,
            run: () => firstOrg && p.setFilter('org', firstOrg.value),
        },
        {
            label: 'Multiselect ×2', wire: 'is_email_verified__in=true,false', on: has('is_email_verified__in', 'true,false'),
            run: () => p.setFilter('is_email_verified__in', ['true', 'false']),
        },
        {
            label: 'Multiselect ×1', wire: 'is_email_verified=true', on: has('is_email_verified', 'true'),
            run: () => p.setFilter('is_email_verified__in', ['true']),
        },
        {
            label: 'Boolean', wire: 'is_active=false', on: has('is_active', 'false'),
            run: () => p.setFilter('is_active', 'false'),
        },
        {
            label: 'Number', wire: 'id__gte=10', on: has('id__gte', '10'),
            run: () => p.setFilter('id__gte', '10'),
        },
        {
            label: 'DateField', wire: 'dob__gte=1980-01-01', on: has('dob__gte', '1980-01-01'),
            run: () => p.setFilter('dob__gte', '1980-01-01'),
        },
        {
            label: 'Daterange', wire: 'dr_field=last_login', on: range?.field === 'last_login',
            run: () => p.setDateRange('last_login', isoDaysAgo(365), isoDaysAgo(0)),
        },
        {
            label: 'Daterange (2nd)', wire: 'dr_field=last_activity', on: range?.field === 'last_activity',
            run: () => p.setDateRange('last_activity', isoDaysAgo(14), isoDaysAgo(0)),
        },
    ];

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">Outgoing wire params · live</div>
                <p className="dim" style={{ margin: '4px 0 14px', maxWidth: 700 }}>
                    This is what <code>params.wire</code> holds right now — the object handed to{' '}
                    <code>mojoList</code> and, below, the request the table is making. Add, edit or
                    remove a filter and watch it change. Nothing on this page filters rows in the
                    browser.
                </p>
                <WireParams
                    endpoint="/api/user"
                    params={p.wire}
                    defs={defs}
                    matched={filtered.data?.count}
                    total={total.data?.count}
                    loading={filtered.isPending}
                    note="URL-synced — copy the address bar and the filtered view travels with it."
                />
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">One click per filter type</div>
                <p className="dim" style={{ margin: '4px 0 12px', maxWidth: 700 }}>
                    The real path is the <b>Filter</b> button in the table toolbar — it opens the
                    Add-Filter menu (per-type icon, check on the active ones) and a type-appropriate
                    dialog. These buttons call the same store methods directly so every type is one
                    click away, and re-clicking one shows the pill round-trip. Applied filters are
                    editable pills under the toolbar; ✕ removes, <b>Clear all</b> resets.
                </p>
                <div className="fdemo-try">
                    {samples.map((s) => (
                        <button
                            key={s.label}
                            className={`btn btn-compact${s.on ? ' is-on' : ''}`}
                            onClick={s.run}
                            disabled={s.disabled}
                        >
                            {s.label} <code>{s.wire}</code>
                        </button>
                    ))}
                    <button className="btn btn-compact" onClick={() => p.clearFilters()}>
                        <i className="bi bi-x-circle" /> Clear all
                    </button>
                </div>

                <table className="demo-table fdemo-legend">
                    <tbody>
                        {legend.map((def) => (
                            <tr key={def.type}>
                                <td><code>{def.type}</code></td>
                                <td><code>{wireKeyOf(def)}</code></td>
                                <td className="dim">{TYPE_NOTE[def.type]}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="dim" style={{ marginTop: 12, maxWidth: 700 }}>
                    That is every member of <code>FilterType</code>. Applied filters deep-link: the
                    params store writes each one into the URL, so this page&apos;s filters survive a
                    reload and travel in a shared link — and <code>?demo=filters</code> itself rides
                    along without ever becoming a lookup (<code>registerNonFilterParams</code>).
                </p>
            </div>

            <ModelTable<UserRow>
                model={UserModel}
                eyebrow="Playground · filters"
                title="Users"
                searchPlaceholder="Search users…"
                defaultSort="name"
                columns={COLUMNS}
                filters={defs}
            />
        </>
    );
}
