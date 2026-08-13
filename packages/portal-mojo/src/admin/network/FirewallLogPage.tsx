// Firewall Log — `logit.Log` filtered to `kind__startswith=firewall:`.
// Port of web-mojo `admin/security/FirewallLogTablePage.js`.
//
// COLUMN HONESTY (the one substantive correction). `GeoLocatedIP` writes these
// rows through `MojoModel.log`, which fills `path`, `ip`, `username` and `uid`
// from the AMBIENT REQUEST — i.e. the ADMIN's endpoint and the ADMIN's IP. The
// address that was blocked lives only in the JSON `payload`. The source
// labelled `path` as "IP / Path", which was never either of those things; here
// Request path, Admin, Admin IP and Target IP are four separate columns.
//
// Everything else is the shipped monitoring surface: LOG_COLUMNS' renderers,
// LOG_FILTERS minus the `kind` text box (replaced by the preset segment over
// the four exact kinds), LogQuickLook and the full LogInspector.
import {
    Badge, ModelTable, fmt, groupByDay,
    type Column, type FilterDef, type Tone,
} from '../../ui';
import {
    LOGS_ADMIN_PERMISSIONS, LOG_COLUMNS, LOG_FILTERS, LogModel, LogQuickLook,
    openLogInspector, type LogRow,
} from '../monitoring';
import { FIREWALL_LOG_KINDS, firewallPayloadOf } from './models';

/** `logit.Log.RestMeta.VIEW_PERMS` — the same gate the Logs page uses. */
export const FIREWALL_LOG_PERMS = LOGS_ADMIN_PERMISSIONS;

const ACTION_TONE: Record<string, Tone> = {
    [FIREWALL_LOG_KINDS.block]: 'danger',
    [FIREWALL_LOG_KINDS.unblock]: 'success',
    [FIREWALL_LOG_KINDS.whitelist]: 'info',
    [FIREWALL_LOG_KINDS.unwhitelist]: 'warning',
};

const ACTION_LABEL: Record<string, string> = {
    [FIREWALL_LOG_KINDS.block]: 'Block',
    [FIREWALL_LOG_KINDS.unblock]: 'Unblock',
    [FIREWALL_LOG_KINDS.whitelist]: 'Whitelist',
    [FIREWALL_LOG_KINDS.unwhitelist]: 'Unwhitelist',
};

/** Rename a shipped monitoring column without re-deriving its renderer. */
function relabelled(key: string, label: string): Column<LogRow> {
    const base = LOG_COLUMNS.find((column) => column.key === key);
    if (!base) {
        // Loud, never silent: the monitoring column set changed under us.
        console.warn(`FirewallLogPage: monitoring LOG_COLUMNS no longer exports "${key}" — rendering a plain cell.`);
        return { key, label };
    }
    return { ...base, label };
}

const COLUMNS: Column<LogRow>[] = [
    relabelled('created', 'When'),
    {
        key: 'kind', label: 'Action', sortable: true, hideable: false,
        render: (log) => {
            const kind = log.kind ?? '';
            return <Badge tone={ACTION_TONE[kind] ?? 'muted'}>{ACTION_LABEL[kind] ?? (kind || '—')}</Badge>;
        },
    },
    {
        // The blocked address. It exists ONLY here — never in `Log.ip`.
        key: 'payload', label: 'Target IP',
        render: (log) => {
            const payload = firewallPayloadOf(log.payload);
            return payload?.ip ? <code>{payload.ip}</code> : <span className="dim">—</span>;
        },
    },
    {
        key: 'log', label: 'Details',
        render: (log) => log.log
            ? <span title={log.log}>{fmt.truncate(log.log, 70)}</span>
            : <span className="dim">—</span>,
    },
    relabelled('username', 'Admin'),
    relabelled('ip', 'Admin IP'),
    relabelled('path', 'Request path'),
    relabelled('level', 'Level'),
];

/**
 * The shipped log filters minus `kind` — the preset segment owns it here, and
 * a free-text `kind` box beside four exact presets invites `firewall:blocked`
 * (a value the backend never writes) and an empty table with no explanation.
 */
const FILTERS: FilterDef[] = LOG_FILTERS.filter((filter) => filter.key !== 'kind');

export function FirewallLogPage() {
    return (
        <ModelTable<LogRow>
            model={LogModel}
            eyebrow="Security · Network"
            title="Firewall Log"
            searchPlaceholder="Search path, message, user…"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'blocks', label: 'Blocks', params: { kind: FIREWALL_LOG_KINDS.block } },
                { key: 'unblocks', label: 'Unblocks', params: { kind: FIREWALL_LOG_KINDS.unblock } },
                { key: 'whitelists', label: 'Whitelists', params: { kind: FIREWALL_LOG_KINDS.whitelist } },
                { key: 'unwhitelists', label: 'Unwhitelists', params: { kind: FIREWALL_LOG_KINDS.unwhitelist } },
            ]}
            // Locked scope: this page IS the firewall log. As a defaultParams
            // pill this was one click from "every log row in the system".
            fixedParams={{ kind__startswith: 'firewall:' }}
            defaultSort="-created"
            columnChooser
            persistState
            persistKey="admin:network:firewall-log"
            exportFormats={['csv', 'json']}
            onRowClick={openLogInspector}
            rowExpand={(log) => <LogQuickLook log={log} />}
            {...groupByDay<LogRow>('created')}
        />
    );
}
