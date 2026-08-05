// Logs — the /api/logs (logit.Log) screen, columns and filters per the LIVE
// backend's REST surface (measured 2026-08-05): default-graph rows {id,
// created, level, kind, method, path, payload, ip, duid, uid, gid, username,
// user_agent, log, model_name, model_id}; level__in / kind / uid / gid /
// model_name lookups, search across the text columns, the dr_* daterange
// triple, default sort -id. VIEW_PERMS: manage_logs|view_logs|security|admin
// (the route itself stays reachable — the server 401/403 is authoritative;
// the sidebar entry is what carries the permission gate).
//
// Read surface only: log rows are records, not things a portal edits. The
// day-grouped feed + expandable payload row is the operator ergonomics
// UserView's audit tabs had, at table scale.
import {
    Badge, fmt, groupByDay, JsonBlock, ModelTable,
    type Column, type FilterDef, type Tone,
} from 'portal-mojo/ui';
import { LogModel, LOG_LEVEL_OPTIONS, type LogRow } from '../models';

const LEVEL_TONE: Record<string, Tone> = {
    error: 'danger',
    critical: 'danger',
    warning: 'warning',
    info: 'info',
};

const COLUMNS: Column<LogRow>[] = [
    {
        key: 'created', label: 'Time', sortable: true, hideable: false, render: (l) => (
            <span title={fmt.datetime(l.created)}>{fmt.relative(l.created)}</span>
        ),
    },
    {
        key: 'level', label: 'Level', sortable: true, render: (l) => (
            <Badge tone={LEVEL_TONE[l.level] ?? 'muted'}>{l.level}</Badge>
        ),
    },
    { key: 'kind', label: 'Kind', sortable: true, render: (l) => l.kind ?? <span className="dim">—</span> },
    {
        key: 'method', label: 'Method', align: 'center', render: (l) =>
            l.method ? <code className="dim">{l.method}</code> : <span className="dim">—</span>,
    },
    {
        key: 'path', label: 'Path', render: (l) =>
            l.path ? <code>{fmt.truncate(l.path, 42)}</code> : <span className="dim">—</span>,
    },
    {
        key: 'username', label: 'User', render: (l) =>
            l.username ? l.username : l.uid ? <span className="dim">#{l.uid}</span> : <span className="dim">—</span>,
    },
    { key: 'ip', label: 'IP', render: (l) => l.ip ? <code className="dim">{l.ip}</code> : <span className="dim">—</span> },
    {
        key: 'log', label: 'Message', render: (l) =>
            l.log ? <span className="dim">{fmt.truncate(l.log, 70)}</span> : <span className="dim">—</span>,
    },
];

const FILTERS: FilterDef[] = [
    { key: 'level', label: 'Level', type: 'multiselect', options: LOG_LEVEL_OPTIONS },
    { key: 'kind', label: 'Kind', type: 'text', placeholder: 'request, login, error…' },
    {
        key: 'method', label: 'Method', type: 'select', options: [
            { value: 'GET', label: 'GET' },
            { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' },
            { value: 'DELETE', label: 'DELETE' },
        ],
    },
    { key: 'path', label: 'Path', type: 'text', placeholder: 'Contains…' },
    { key: 'username', label: 'Username', type: 'text', placeholder: 'Contains…' },
    { key: 'ip', label: 'IP', type: 'text', placeholder: 'Contains…' },
    { key: 'uid', label: 'User ID', type: 'number', lookup: 'exact' },
    { key: 'gid', label: 'Group ID', type: 'number', lookup: 'exact' },
    { key: 'model_name', label: 'Model', type: 'text', placeholder: 'account.User…' },
    { key: 'created', label: 'Created', type: 'daterange' },
];

/** Expanded row — the full record: message, payload JSON, request context. */
function LogExpand({ l }: { l: LogRow }) {
    let payload: unknown = null;
    if (l.payload) {
        try { payload = JSON.parse(l.payload); } catch { payload = l.payload; }
    }
    return (
        <div className="expand-grid">
            <div>
                <div className="eyebrow">Message</div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.log ?? <span className="dim">—</span>}</div>
                {l.model_name && (
                    <>
                        <div className="eyebrow" style={{ marginTop: 10 }}>Record</div>
                        <div><code>{l.model_name}#{l.model_id}</code></div>
                    </>
                )}
            </div>
            <div>
                <div className="eyebrow">Request</div>
                <div>{l.method ?? '—'} <code>{l.path ?? '—'}</code></div>
                <div className="dim">IP {l.ip ?? '—'}{l.duid && <> · DUID <code>{l.duid}</code></>}</div>
                <div className="dim" style={{ wordBreak: 'break-word' }}>{l.user_agent ?? ''}</div>
                <div className="dim">uid {l.uid || '—'} · gid {l.gid || '—'} · <code>#{l.id}</code> · {fmt.datetime(l.created)}</div>
            </div>
            <div>
                <div className="eyebrow">Payload</div>
                {payload != null
                    ? <JsonBlock value={payload} defaultOpen />
                    : <span className="dim">No payload</span>}
            </div>
        </div>
    );
}

export function LogsPage() {
    return (
        <ModelTable<LogRow>
            model={LogModel}
            eyebrow="System"
            title="Logs"
            searchPlaceholder="Search path, message, user…"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'errors', label: 'Errors', params: { level__in: 'error,critical' } },
                { key: 'warnings', label: 'Warnings', params: { level: 'warning' } },
                { key: 'requests', label: 'Requests', params: { kind: 'request' } },
                { key: 'logins', label: 'Logins', params: { kind: 'login' } },
            ]}
            defaultSort="-created"
            columnChooser
            persistState
            exportFormats={['csv', 'json']}
            autoRefresh={15}
            rowExpand={(l) => <LogExpand l={l} />}
            {...groupByDay<LogRow>('created')}
        />
    );
}
