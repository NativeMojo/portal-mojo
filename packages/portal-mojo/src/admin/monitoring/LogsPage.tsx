import {
    Badge, JsonBlock, ModelTable, fmt, groupByDay, modal,
    type Column, type FilterDef, type Tone,
} from '../../ui';
import { LogInspector, storedLogContentLabel, storedLogKind } from './LogInspector';
import { LOG_LEVEL_OPTIONS, LogModel, type LogRow } from './models';

const LEVEL_TONE: Record<string, Tone> = {
    error: 'danger',
    critical: 'danger',
    warning: 'warning',
    info: 'info',
};

export const LOG_COLUMNS: Column<LogRow>[] = [
    {
        key: 'created', label: 'Time', sortable: true, hideable: false, render: (log) => (
            <span title={fmt.datetime(log.created)}>{fmt.relative(log.created)}</span>
        ),
    },
    {
        key: 'level', label: 'Level', sortable: true, render: (log) => (
            <Badge tone={LEVEL_TONE[log.level.toLowerCase()] ?? 'muted'}>{log.level}</Badge>
        ),
    },
    { key: 'kind', label: 'Kind', sortable: true, render: (log) => log.kind ?? <span className="dim">—</span> },
    {
        key: 'method', label: 'Method', align: 'center', render: (log) =>
            log.method ? <code className="dim">{log.method}</code> : <span className="dim">—</span>,
    },
    {
        key: 'path', label: 'Path', render: (log) =>
            log.path ? <code>{fmt.truncate(log.path, 42)}</code> : <span className="dim">—</span>,
    },
    {
        key: 'username', label: 'User', render: (log) =>
            log.username ? log.username : log.uid ? <span className="dim">#{log.uid}</span> : <span className="dim">—</span>,
    },
    { key: 'ip', label: 'IP', render: (log) => log.ip ? <code className="dim">{log.ip}</code> : <span className="dim">—</span> },
    {
        key: 'log', label: 'Message', render: (log) =>
            log.log ? <span className="dim">{fmt.truncate(log.log, 70)}</span> : <span className="dim">—</span>,
    },
];

export const LOG_FILTERS: FilterDef[] = [
    { key: 'level', label: 'Level', type: 'multiselect', options: LOG_LEVEL_OPTIONS },
    { key: 'kind', label: 'Kind', type: 'text', placeholder: 'request, response, login…' },
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

/** Chevron quick-look. Row click opens the full inspector independently. */
export function LogQuickLook({ log }: { log: LogRow }) {
    const contentLabel = storedLogContentLabel(storedLogKind(log));
    let payload: unknown = null;
    if (log.payload) {
        try { payload = JSON.parse(log.payload) as unknown; } catch { payload = log.payload; }
    }
    return (
        <div className="expand-grid">
            <div>
                <div className="eyebrow">{contentLabel}</div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {log.log ?? <span className="dim">—</span>}
                </div>
                {log.model_name && (
                    <>
                        <div className="eyebrow" style={{ marginTop: 10 }}>Record</div>
                        <div><code>{log.model_name}#{log.model_id}</code></div>
                    </>
                )}
            </div>
            <div>
                <div className="eyebrow">Request context</div>
                <div>{log.method ?? '—'} <code>{log.path ?? '—'}</code></div>
                <div className="dim">IP {log.ip ?? '—'}{log.duid && <> · DUID <code>{log.duid}</code></>}</div>
                <div className="dim" style={{ wordBreak: 'break-word' }}>{log.user_agent ?? ''}</div>
                <div className="dim">uid {log.uid || '—'} · gid {log.gid || '—'} · <code>#{log.id}</code> · {fmt.datetime(log.created)}</div>
            </div>
            <div>
                <div className="eyebrow">Auxiliary payload</div>
                {payload != null
                    ? <JsonBlock value={payload} defaultOpen />
                    : <span className="dim">No payload</span>}
            </div>
        </div>
    );
}

export function openLogInspector(log: LogRow): void {
    void modal.detail((close) => <LogInspector log={log} onClose={() => close(null)} />);
}

export function LogsPage() {
    return (
        <ModelTable<LogRow>
            model={LogModel}
            eyebrow="System"
            title="Logs"
            searchPlaceholder="Search path, message, user…"
            columns={LOG_COLUMNS}
            filters={LOG_FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'errors', label: 'Errors', params: { level__in: 'error,critical' } },
                { key: 'warnings', label: 'Warnings', params: { level: 'warning' } },
                { key: 'requests', label: 'Requests', params: { kind: 'request' } },
                { key: 'responses', label: 'Responses', params: { kind: 'response' } },
                { key: 'logins', label: 'Logins', params: { kind: 'login' } },
            ]}
            defaultSort="-created"
            columnChooser
            persistState
            exportFormats={['csv', 'json']}
            autoRefresh={15}
            onRowClick={openLogInspector}
            rowExpand={(log) => <LogQuickLook log={log} />}
            {...groupByDay<LogRow>('created')}
        />
    );
}
