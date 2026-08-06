// IP Sets — kernel-level firewall sets synced fleet-wide via ipset + iptables.
// Port of web-mojo `admin/security/IPSetTablePage.js`.
//
// Deliberately ABSENT: batch delete. The source offered it. Multi-selecting
// kernel firewall sets and deleting them in one action is precisely the "one
// careless action changes the fleet" shape #1097 warned about, and the
// operation is irreversible. Delete stays single-record and armed, from the
// detail modal.
import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, ModelTable, fmt, toast,
    type BatchAction, type Column, type FilterDef,
} from '../../ui';
import { useCan } from '../../client';
import {
    IPSET_CACHE_ONLY_HELP, IPSET_KIND_BADGE_OPTIONS, IPSET_MANAGE_PERMS,
    IPSET_SOURCE_OPTIONS, IPSetModel, isCacheOnlyIPSet, type IPSetRow,
} from './models';
import { ipSetSourceLabel, showIPSetDetail } from './IPSetDetail';
import { promptCreateIPSet } from './IPSetEditor';

const COLUMNS: Column<IPSetRow>[] = [
    {
        key: 'is_enabled', label: 'Active', align: 'center', sortable: true, hideable: false,
        render: (row) => row.is_enabled
            ? <Badge tone="success"><i className="bi bi-check-lg" /> Enabled</Badge>
            : <Badge tone="muted">Disabled</Badge>,
    },
    {
        key: 'name', label: 'Name', sortable: true, hideable: false,
        render: (row) => (
            <>
                <code>{row.name}</code>
                {isCacheOnlyIPSet(row) && (
                    <span className="chip chip-warning netsec-cache-chip" title={IPSET_CACHE_ONLY_HELP}>
                        <i className="bi bi-database-lock" /> CACHE-ONLY
                    </span>
                )}
            </>
        ),
    },
    {
        key: 'kind', label: 'Kind', sortable: true,
        render: (row) => <Badge tone="info">{IPSET_KIND_BADGE_OPTIONS.find((o) => o.value === row.kind)?.label ?? row.kind}</Badge>,
    },
    {
        key: 'description', label: 'Description',
        render: (row) => row.description
            ? <span title={row.description}>{fmt.truncate(row.description, 40)}</span>
            : <span className="dim">—</span>,
    },
    {
        // Labelled honestly: the column is only recomputed when the list is
        // WRITTEN (a source refresh, or saving the list from the editor).
        key: 'cidr_count', label: 'CIDRs', sortable: true, align: 'end',
        render: (row) => <span title="Recorded when the CIDR list was last written">{row.cidr_count.toLocaleString()}</span>,
    },
    {
        key: 'source', label: 'Source', sortable: true,
        render: (row) => ipSetSourceLabel(row.source),
    },
    {
        key: 'last_synced', label: 'Last synced', sortable: true,
        render: (row) => row.last_synced == null
            ? <span className="dim">Never</span>
            : <span title={fmt.datetime(row.last_synced)}>{fmt.relative(row.last_synced)}</span>,
    },
    {
        key: 'sync_error', label: 'Status', align: 'center',
        render: (row) => row.sync_error
            ? <span className="text-bad" title={row.sync_error}><i className="bi bi-exclamation-triangle" /> Error</span>
            : <span className="text-ok"><i className="bi bi-check-circle" /></span>,
    },
];

const FILTERS: FilterDef[] = [
    { key: 'kind', label: 'Kind', type: 'select', options: IPSET_KIND_BADGE_OPTIONS },
    { key: 'is_enabled', label: 'Enabled', type: 'boolean', trueLabel: 'Enabled', falseLabel: 'Disabled' },
    { key: 'source', label: 'Source', type: 'select', options: IPSET_SOURCE_OPTIONS },
    { key: 'name', label: 'Name contains', type: 'text' },
    { key: 'description', label: 'Description contains', type: 'text' },
    { key: 'sync_error__isnull', label: 'Sync health', type: 'boolean', trueLabel: 'No error', falseLabel: 'Has an error' },
    { key: 'last_synced', label: 'Last synced', type: 'daterange' },
];

export function IPSetsPage() {
    const qc = useQueryClient();
    const canManage = useCan(IPSET_MANAGE_PERMS).can;
    const save = IPSetModel.useSave();
    const enable = IPSetModel.useAction('enable');
    const disable = IPSetModel.useAction('disable');
    const sync = IPSetModel.useAction('sync');
    const refresh = IPSetModel.useAction('refresh_source');

    const onAdd = async () => {
        const payload = await promptCreateIPSet();
        if (!payload) return;
        try {
            // No `is_enabled` in the body — a set is created disabled and
            // enabling runs through the `enable` action, the only path that
            // performs the backend's cache-only check.
            await save.mutateAsync({ id: null, changes: payload as unknown as Record<string, unknown> });
            await IPSetModel.invalidate(qc);
            toast.success(`${payload.name} created — disabled. Enable it when you are ready to push it to the fleet.`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not create the IP set');
        }
    };

    const batchActions: BatchAction<IPSetRow>[] = [
        {
            key: 'enable',
            label: 'Enable',
            icon: 'bi-toggle-on',
            // The backend refuses cache-only sets outright; excluding them here
            // means a mixed selection still succeeds for the rest.
            eligible: (row) => !row.is_enabled && !isCacheOnlyIPSet(row),
            confirm: 'Enable the selected sets? Their CIDRs are loaded into iptables on every fleet instance immediately.',
            run: (row) => enable.mutateAsync({ id: row.id }),
        },
        {
            key: 'disable',
            label: 'Disable',
            icon: 'bi-toggle-off',
            eligible: (row) => row.is_enabled,
            confirm: 'Disable the selected sets? Every fleet instance drops them from iptables.',
            run: (row) => disable.mutateAsync({ id: row.id }),
        },
        {
            key: 'sync',
            label: 'Sync to fleet',
            icon: 'bi-broadcast',
            // `sync()` is a silent no-op for a disabled or cache-only set — it
            // does not raise, so a "success" toast would be a lie.
            eligible: (row) => row.is_enabled && !isCacheOnlyIPSet(row),
            confirm: 'Push the selected sets to every fleet instance now?',
            run: (row) => sync.mutateAsync({ id: row.id }),
        },
        {
            key: 'refresh',
            label: 'Refresh source',
            icon: 'bi-arrow-clockwise',
            // `refresh_from_source()` returns False immediately for
            // source=manual — nothing is fetched and nothing changes.
            eligible: (row) => row.source !== 'manual',
            confirm: 'Refetch the provider list for the selected sets and replace their stored CIDRs?',
            run: (row) => refresh.mutateAsync({ id: row.id }),
        },
    ];

    return (
        <ModelTable<IPSetRow>
            model={IPSetModel}
            eyebrow="Security · Network"
            title="IP Sets"
            searchPlaceholder="Search name or description"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'enabled', label: 'Enforcing', params: { is_enabled: 'true' } },
                { key: 'staged', label: 'Staged', params: { is_enabled: 'false' } },
                { key: 'errors', label: 'Sync errors', params: { sync_error__isnull: 'false' } },
            ]}
            defaultSort="name"
            selectable={canManage}
            batchActions={canManage ? batchActions : []}
            columnChooser
            persistState
            persistKey="admin:network:ip-sets"
            exportFormats={['csv', 'json']}
            rowTone={(row) => row.sync_error ? 'danger' : isCacheOnlyIPSet(row) ? 'warning' : null}
            onRowClick={(row) => showIPSetDetail(row.id)}
            {...(canManage ? { addLabel: 'Create IP set', onAdd: () => void onAdd() } : {})}
        />
    );
}
