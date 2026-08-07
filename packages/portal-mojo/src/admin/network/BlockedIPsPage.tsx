// Blocked IPs — the `is_blocked=true` projection over the SHIPPED
// `GeoLocatedIPModel` (#1291 owns `/api/system/geoip`; this page defines no
// model of its own). Port of web-mojo `admin/security/BlockedIPsTablePage.js`.
//
// Corrections carried over the source, each verified against
// `mojo/apps/account/models/geolocated_ip.py`:
//   · the threat-level filter offered a literal `none` value that matched no
//     row on any deployment (the column is NULL, not 'none'). It is now a
//     multiselect over the four real values plus an explicit isnull filter.
//   · the search placeholder promised "IP, country, or rule". The model's real
//     SEARCH_FIELDS are ip_address, city, country_name, asn_org, isp — there
//     is no rule text on this model at all.
//   · `blocked_until = null` means PERMANENT. The source rendered it through a
//     datetime formatter, i.e. blank, which reads as "unknown".
//   · Enforcement is COMPUTED (`block_active` / `whitelist_active` are
//     properties serialized only on the `basic` graph): a whitelist beats a
//     block and an expired block stops enforcing, while `is_blocked` stays set.
import {
    Badge, ModelTable, fmt, formModal,
    type BatchAction, type Column, type FilterDef, type Tone,
} from '../../ui';
import { useCan } from '../../client/runtime';
import { COUNTRY_OPTIONS } from '../../charts/worldmap/countryCentroids';
import {
    GEOIP_MANAGE_PERMS, GEOIP_UNBLOCK_FIELDS, GeoLocatedIPModel, blockActive, blockExpired,
    countryFlag, geoIpSafeExporter, threatTone, whitelistActive, whitelistExpired,
    type GeoLocatedIPRow,
} from '../security/geoip';
import { NETWORK_WHITELIST_FIELDS, showBlockedIpDetail } from './BlockedIpDetail';

/** THREAT_LEVEL_ORDER minus the null slot — the four values the column holds. */
const REAL_THREAT_LEVELS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' },
];

const COLUMNS: Column<GeoLocatedIPRow>[] = [
    {
        key: 'ip_address', label: 'IP address', sortable: true, hideable: false,
        render: (row) => <code>{row.ip_address}</code>,
    },
    {
        // The honest state, not the raw flag.
        key: 'is_blocked', label: 'State', sortable: true,
        render: (row) => {
            if (blockActive(row)) return <Badge tone="danger"><i className="bi bi-slash-circle" /> Blocked</Badge>;
            if (whitelistActive(row)) return <Badge tone="info"><i className="bi bi-shield-check" /> Whitelisted</Badge>;
            if (blockExpired(row)) return <Badge tone="warning">Block expired</Badge>;
            if (whitelistExpired(row)) return <Badge tone="warning">Whitelist expired</Badge>;
            return <span className="dim">—</span>;
        },
    },
    {
        key: 'threat_level', label: 'Threat', sortable: true,
        render: (row) => <Badge tone={threatTone(row.threat_level) as Tone}>{row.threat_level || 'none'}</Badge>,
    },
    {
        key: 'country_code', label: 'Country', sortable: true,
        render: (row) => {
            if (!row.country_code) return <span className="dim">—</span>;
            const flag = countryFlag(row.country_code);
            return <>{flag && <span className="geoip-flag">{flag}</span>}{row.country_code}</>;
        },
    },
    { key: 'city', label: 'City', sortable: true, render: (row) => row.city || <span className="dim">—</span> },
    {
        key: 'blocked_reason', label: 'Reason',
        render: (row) => row.blocked_reason
            ? <span title={row.blocked_reason}>{fmt.truncate(row.blocked_reason, 44)}</span>
            : <span className="dim">—</span>,
    },
    {
        key: 'blocked_at', label: 'Blocked at', sortable: true,
        render: (row) => row.blocked_at == null
            ? <span className="dim">—</span>
            : <span title={fmt.datetime(row.blocked_at)}>{fmt.relative(row.blocked_at)}</span>,
    },
    {
        // null = permanent. Rendering it as "" (a datetime formatter over
        // null) was the source's most misleading cell.
        key: 'blocked_until', label: 'Expires', sortable: true,
        render: (row) => row.blocked_until == null
            ? <b>Never</b>
            : <span title={fmt.datetime(row.blocked_until)}>{fmt.relative(row.blocked_until)}</span>,
    },
    { key: 'block_count', label: 'Blocks', sortable: true, align: 'end', render: (row) => row.block_count },
    {
        key: 'is_whitelisted', label: 'Whitelisted', align: 'center',
        render: (row) => <Badge tone={whitelistActive(row) ? 'info' : 'muted'}>{whitelistActive(row) ? 'Yes' : row.is_whitelisted ? 'Expired' : 'No'}</Badge>,
    },
];

const FILTERS: FilterDef[] = [
    { key: 'threat_level', label: 'Threat level', type: 'multiselect', options: REAL_THREAT_LEVELS },
    { key: 'threat_level__isnull', label: 'Threat level unset', type: 'boolean', trueLabel: 'No threat level', falseLabel: 'Has a threat level' },
    { key: 'country_code', label: 'Country', type: 'select', options: [...COUNTRY_OPTIONS] },
    { key: 'city', label: 'City contains', type: 'text' },
    { key: 'asn_org', label: 'ASN org contains', type: 'text' },
    { key: 'isp', label: 'ISP contains', type: 'text' },
    { key: 'is_whitelisted', label: 'Whitelisted', type: 'boolean' },
    { key: 'blocked_until__isnull', label: 'Permanent', type: 'boolean', trueLabel: 'Never expires', falseLabel: 'Has an expiry' },
    { key: 'blocked_at', label: 'Blocked at', type: 'daterange' },
    { key: 'blocked_until', label: 'Expires', type: 'daterange' },
];

export function BlockedIPsPage() {
    const canManage = useCan(GEOIP_MANAGE_PERMS).can;
    const unblock = GeoLocatedIPModel.useAction('unblock');
    const whitelist = GeoLocatedIPModel.useAction('whitelist');

    /**
     * Both batch actions are RELAXING. `prepare` collects the reason ONCE per
     * batch so the audit trail carries a real sentence rather than a
     * hard-coded "Bulk … from admin" on every row (the source's behaviour).
     */
    const batchActions: BatchAction<GeoLocatedIPRow>[] = [
        {
            key: 'unblock',
            label: 'Unblock',
            icon: 'bi-unlock',
            eligible: (row) => row.is_blocked,
            confirm: 'Unblock the selected addresses? Traffic from them is allowed fleet-wide again.',
            prepare: async (rows) => {
                const data = await formModal({
                    title: `Unblock ${rows.length} address${rows.length === 1 ? '' : 'es'}`,
                    fields: GEOIP_UNBLOCK_FIELDS,
                    submitText: 'Unblock',
                    initial: { reason: 'Bulk unblock from admin' },
                });
                return data ? String(data.reason) : null;
            },
            // `on_action_unblock` takes a STRING reason (a non-string falls
            // back to "manual unblock: by <user>").
            run: (row, prepared) => unblock.mutateAsync({ id: row.id, payload: String(prepared) }),
        },
        {
            key: 'whitelist',
            label: 'Whitelist',
            icon: 'bi-shield-check',
            // A whitelist clears an active block, so an already-whitelisted
            // row has nothing to gain and would only reset its expiry.
            eligible: (row) => !whitelistActive(row),
            confirm: 'Whitelist the selected addresses? They will pass every rule, including the VPN and Tor checks.',
            prepare: async (rows) => {
                const data = await formModal({
                    title: `Whitelist ${rows.length} address${rows.length === 1 ? '' : 'es'}`,
                    fields: NETWORK_WHITELIST_FIELDS,
                    submitText: 'Whitelist',
                    intro: 'One reason and expiry are recorded against every selected address.',
                });
                if (!data) return null;
                const until = typeof data.until === 'string' && data.until ? data.until : null;
                // The DICT form — the source sent a bare string, so the audit
                // trail got a reason but `whitelisted_until` was never set.
                return until ? { reason: String(data.reason), until } : { reason: String(data.reason) };
            },
            run: (row, prepared) => whitelist.mutateAsync({ id: row.id, payload: prepared }),
        },
    ];

    return (
        <ModelTable<GeoLocatedIPRow>
            model={GeoLocatedIPModel}
            eyebrow="Security · Network"
            title="Blocked IPs"
            searchPlaceholder="Search IP, city, country, ASN org, or ISP"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All blocks', params: {} },
                { key: 'permanent', label: 'Permanent', params: { blocked_until__isnull: 'true' } },
                { key: 'whitelisted', label: 'Whitelisted', params: { is_whitelisted: 'true' } },
            ]}
            // `is_blocked` is the projection; `dr_field` names the column a
            // daterange lands on so a picked window filters the BLOCK, not
            // last_seen. No window is preset: a Blocked IPs page whose default
            // view hides every permanent block older than a week answers the
            // wrong question (the source defaulted to 7d).
            defaultParams={{ is_blocked: 'true', dr_field: 'blocked_at' }}
            defaultSort="-modified"
            selectable={canManage}
            batchActions={canManage ? batchActions : []}
            columnChooser
            persistState
            persistKey="admin:network:blocked-ips"
            exporter={geoIpSafeExporter}
            exportFormats={['csv', 'json']}
            rowTone={(row) => blockActive(row) ? 'danger' : blockExpired(row) ? 'warning' : null}
            onRowClick={(row) => showBlockedIpDetail(row.id)}
        />
    );
}
