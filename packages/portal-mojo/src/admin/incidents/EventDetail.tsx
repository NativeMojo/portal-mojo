import { useQuery } from '@tanstack/react-query';
import { mojoCall } from '../../client/runtime';
import { DetailView, Eyebrow, FlatRow, JsonBlock, KnownFieldsCard, StatusPanel, fmt, type KnownField } from '../../ui';
import { EvidenceCard, INCIDENT_METADATA_FIELDS, RequestResponseForensics, TraceForensics, first, metadataOf } from './forensics';
import { sanitizeEventRow } from './sanitize';
import { EventModel, showIncidentDetail, type EventRow } from './models';

const MOJOSEC_SUMMARY_FIELDS: KnownField[] = [
    { key: 'kind', label: 'Detection kind', hideEmpty: true },
    { key: 'count', label: 'Occurrences', hideEmpty: true },
    { key: 'event_id', label: 'Sensor event ID', hideEmpty: true },
    { key: 'sensor_id', label: 'Sensor', hideEmpty: true },
    { key: 'sensor_severity', label: 'Sensor severity', hideEmpty: true },
    { key: 'effective_level', label: 'Effective level', hideEmpty: true },
    { key: 'recommendation', label: 'Recommendation', hideEmpty: true },
    { key: 'first_seen', label: 'First seen', format: 'datetime', hideEmpty: true },
    { key: 'last_seen', label: 'Last seen', format: 'datetime', hideEmpty: true },
    { key: 'protocol_version', label: 'Protocol version', hideEmpty: true },
    { key: 'installation_key_id', label: 'Installation key ID', hideEmpty: true },
    { key: 'sensor_policy_revision_sha256', label: 'Sensor policy revision', hideEmpty: true },
    { key: 'expected_change', label: 'Expected change', hideEmpty: true },
];

const MOJOSEC_EVIDENCE_FIELDS: KnownField[] = [
    { key: 'actor', label: 'Actor', hideEmpty: true },
    { key: 'target_user', label: 'Target user', hideEmpty: true },
    { key: 'user', label: 'User', hideEmpty: true },
    { key: 'auth_method', label: 'Authentication method', hideEmpty: true },
    { key: 'service', label: 'Service', hideEmpty: true },
    { key: 'attribution', label: 'Attribution', hideEmpty: true },
    { key: 'command', label: 'Command', hideEmpty: true },
    { key: 'command_path', label: 'Command path', hideEmpty: true },
    { key: 'command_family', label: 'Command family', hideEmpty: true },
    { key: 'command_truncated', label: 'Command truncated', hideEmpty: true },
    { key: 'command_path_truncated', label: 'Command path truncated', hideEmpty: true },
    { key: 'cwd', label: 'Working directory', hideEmpty: true },
    { key: 'cwd_truncated', label: 'Working directory truncated', hideEmpty: true },
    { key: 'proof_status', label: 'Proof status', hideEmpty: true },
    { key: 'producer_comm', label: 'Producer process', hideEmpty: true },
    { key: 'producer_exe', label: 'Producer executable', hideEmpty: true },
    { key: 'producer_pid', label: 'Producer PID', hideEmpty: true },
    { key: 'producer_uid', label: 'Producer UID', hideEmpty: true },
    { key: 'target_uid', label: 'Target UID', hideEmpty: true },
    { key: 'opener_uid', label: 'Opener UID', hideEmpty: true },
    { key: 'audit_session', label: 'Audit session', hideEmpty: true },
    { key: 'audit_loginuid', label: 'Audit login UID', hideEmpty: true },
    { key: 'tty', label: 'TTY', hideEmpty: true },
    { key: 'boot_id', label: 'Boot ID', hideEmpty: true },
    { key: 'monotonic', label: 'Monotonic timestamp', hideEmpty: true },
    { key: 'systemd_unit', label: 'systemd unit', hideEmpty: true },
    { key: 'cgroup', label: 'Control group', hideEmpty: true },
    { key: 'selinux', label: 'SELinux context', hideEmpty: true },
    { key: 'job_function', label: 'Job function', hideEmpty: true },
    { key: 'origin_kind', label: 'Origin kind', hideEmpty: true },
    { key: 'operation_id', label: 'Operation ID', hideEmpty: true },
    { key: 'execution_id', label: 'Execution ID', hideEmpty: true },
    { key: 'job_id', label: 'Job ID', hideEmpty: true },
    { key: 'lineage_sha256', label: 'Lineage digest', hideEmpty: true },
    { key: 'receipt_semantics', label: 'Receipt semantics', hideEmpty: true },
    { key: 'ancestors', label: 'Process ancestry', hideEmpty: true },
    { key: 'peer_ip', label: 'Peer IP', hideEmpty: true },
    { key: 'method', label: 'HTTP method', hideEmpty: true },
    { key: 'host', label: 'HTTP host', hideEmpty: true },
    { key: 'status', label: 'HTTP status', hideEmpty: true },
    { key: 'response_class', label: 'Response class', hideEmpty: true },
    { key: 'resource_id', label: 'Resource ID', hideEmpty: true },
    { key: 'edge_policy_version', label: 'Edge policy version', hideEmpty: true },
    { key: 'path', label: 'Request path', hideEmpty: true },
    { key: 'upstream_status', label: 'Upstream status', hideEmpty: true },
    { key: 'request_id', label: 'Request ID', hideEmpty: true },
    { key: 'scheme', label: 'Scheme', hideEmpty: true },
    { key: 'protocol', label: 'Protocol', hideEmpty: true },
    { key: 'tls_protocol', label: 'TLS protocol', hideEmpty: true },
    { key: 'tls_cipher', label: 'TLS cipher', hideEmpty: true },
    { key: 'remote_port', label: 'Remote port', hideEmpty: true },
    { key: 'peer_port', label: 'Peer port', hideEmpty: true },
    { key: 'server_port', label: 'Server port', hideEmpty: true },
    { key: 'request_length', label: 'Request bytes', hideEmpty: true },
    { key: 'response_bytes', label: 'Response bytes', hideEmpty: true },
    { key: 'response_body_bytes', label: 'Response body bytes', hideEmpty: true },
    { key: 'request_time_ms', label: 'Request time (ms)', hideEmpty: true },
    { key: 'upstream_connect_time_ms', label: 'Upstream connect time (ms)', hideEmpty: true },
    { key: 'upstream_header_time_ms', label: 'Upstream header time (ms)', hideEmpty: true },
    { key: 'upstream_response_time_ms', label: 'Upstream response time (ms)', hideEmpty: true },
    { key: 'upstream_response_length', label: 'Upstream response bytes', hideEmpty: true },
    { key: 'upstream_bytes_received', label: 'Upstream bytes received', hideEmpty: true },
    { key: 'upstream_bytes_sent', label: 'Upstream bytes sent', hideEmpty: true },
    { key: 'referrer_origin', label: 'Referrer origin', hideEmpty: true },
    { key: 'referrer', label: 'Referrer', hideEmpty: true },
    { key: 'user_agent', label: 'User agent', hideEmpty: true },
    { key: 'last_occurrence_sample', label: 'Last occurrence sample', hideEmpty: true },
    { key: 'unit', label: 'Unit', hideEmpty: true },
    { key: 'failure_kind', label: 'Failure kind', hideEmpty: true },
];

function record(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export function extractMojosecDetails(metadata: Record<string, unknown>): {
    summary: Record<string, unknown>;
    evidence: Record<string, unknown>;
} | null {
    const mojosec = record(metadata.mojosec);
    if (!mojosec) return null;
    const { evidence: rawEvidence, ...summary } = mojosec;
    return { summary, evidence: record(rawEvidence) ?? {} };
}

export function MojosecEventSection({ details }: {
    details: NonNullable<ReturnType<typeof extractMojosecDetails>>;
}) {
    return <>
        <Eyebrow>Detection and sensor</Eyebrow>
        <KnownFieldsCard data={details.summary} known={MOJOSEC_SUMMARY_FIELDS} showRaw={false} emptyText="No MojoSec detection summary was recorded." />
        <Eyebrow>Validated evidence</Eyebrow>
        <KnownFieldsCard data={details.evidence} known={MOJOSEC_EVIDENCE_FIELDS} showRaw={false} emptyText="No projected evidence was recorded." />
    </>;
}

function displayValue(value: unknown): string {
    if (value == null || value === '') return '—';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch { return String(value); }
}

function incidentId(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') return (value as { id: number }).id;
    return null;
}

function prepareEventDetailRecord(rawEvent: EventRow): { rawEvent: EventRow; event: EventRow } {
    return { rawEvent, event: sanitizeEventRow(rawEvent) };
}

/** Keep the authorized raw record isolated from every sanitized event cache. */
function useRawEventDetail(id: number | null) {
    return useQuery({
        queryKey: [EventModel.endpoint, 'raw-one', id, { graph: 'detailed' }],
        queryFn: async () => (await mojoCall(`${EventModel.endpoint}/${id!}`, { params: { graph: 'detailed' } })).data as EventRow,
        enabled: id != null,
    });
}

export function EventDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const query = useRawEventDetail(id);
    if (query.isPending) return <div className="modal-pad dim">Loading event…</div>;
    if (!query.data || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Event not found'}</div>;
    const { rawEvent, event } = prepareEventDetailRecord(query.data);
    const metadata = metadataOf(event);
    const mojosec = extractMojosecDetails(metadata);
    const linkedIncident = incidentId(event.incident);
    const trace = first(metadata, 'stack_trace', 'traceback');
    const hasOssec = event.category.startsWith('ossec') || metadata.alert_id != null || metadata.logfile != null;
    const hasBouncer = metadata.decision != null || metadata.muid != null || metadata.triggered_signals != null;
    const hasPermissions = metadata.permission_keys != null || metadata.perms != null || metadata.auth_result != null;
    return <DetailView
        icon="bi-activity"
        title={event.title || `Event #${event.id}`}
        subtitle={`Event #${event.id} · ${fmt.datetime(event.created)}`}
        chips={[{ text: `L${event.level}`, tone: event.level >= 8 ? 'danger' : event.level >= 4 ? 'warning' : 'muted' }, { text: event.scope, tone: 'muted' }, { text: event.category, tone: 'muted' }]}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <>
                <StatusPanel tone={event.level >= 8 ? 'danger' : event.level >= 4 ? 'warning' : 'info'} state={`LEVEL ${event.level}`} headline={event.details || event.title || 'No event details'} meta={`${event.category} · ${event.scope}`} actions={linkedIncident ? <button className="btn btn-compact" onClick={() => showIncidentDetail(linkedIncident)}>Open incident</button> : null} />
                <FlatRow label="Model">{event.model_name ? `${event.model_name} #${event.model_id ?? '—'}` : '—'}</FlatRow>
                <FlatRow label="Group ID">{event.group_id ?? 'Global'}</FlatRow>
            </> },
            { key: 'source', label: 'Source', icon: 'bi-globe2', render: () => <><Eyebrow>Source and network</Eyebrow><FlatRow label="Source IP"><code>{event.source_ip || '—'}</code></FlatRow><FlatRow label="Hostname"><code>{event.hostname || '—'}</code></FlatRow><FlatRow label="Country">{String(event.country_code || metadata.country_code || '—')}</FlatRow>{event.geo_ip != null && <FlatRow label="GeoIP">{displayValue(event.geo_ip)}</FlatRow>}<FlatRow label="Server">{String(metadata.server ?? '—')}</FlatRow></> },
            { key: 'request', label: 'Request', icon: 'bi-funnel', render: () => <RequestResponseForensics metadata={metadata} /> },
            ...(trace ? [{ key: 'trace', label: 'Stack trace', icon: 'bi-code-square', render: () => <TraceForensics metadata={metadata} /> }] : []),
            ...(hasOssec ? [{ key: 'ossec', label: 'OSSEC', icon: 'bi-shield-exclamation', render: () => <EvidenceCard metadata={metadata} /> }] : []),
            ...(mojosec ? [{ key: 'mojosec', label: 'MojoSec', icon: 'bi-shield-lock', render: () => <MojosecEventSection details={mojosec} /> }] : []),
            ...(hasBouncer ? [{ key: 'bouncer', label: 'Bouncer', icon: 'bi-shield-shaded', render: () => <KnownFieldsCard data={metadata} showRaw={false} known={[{ key: 'decision', hideEmpty: true }, { key: 'risk_score', hideEmpty: true }, { key: 'page', hideEmpty: true }, { key: 'page_type', hideEmpty: true }, { key: 'muid', hideEmpty: true }, { key: 'duid', hideEmpty: true }, { key: 'triggered_signals', hideEmpty: true }]} /> }] : []),
            ...(hasPermissions ? [{ key: 'permissions', label: 'Auth evidence', icon: 'bi-key', render: () => <KnownFieldsCard data={metadata} showRaw={false} known={[{ key: 'permission_keys', hideEmpty: true }, { key: 'perms', hideEmpty: true }, { key: 'auth_result', hideEmpty: true }, { key: 'user_email', hideEmpty: true }]} /> }] : []),
            { key: 'metadata', label: 'Known fields', icon: 'bi-braces', render: () => <KnownFieldsCard data={metadata} known={[...INCIDENT_METADATA_FIELDS, { key: 'alert_id', hideEmpty: true }, { key: 'logfile', hideEmpty: true }, { key: 'error_code', hideEmpty: true }, { key: 'error_message', hideEmpty: true }]} showRaw={false} /> },
            { divider: 'Raw' },
            { key: 'raw', label: 'Raw data', icon: 'bi-filetype-json', render: () => <><Eyebrow>Complete API response</Eyebrow><p className="dim">The complete event record returned by Django, including all metadata.</p><JsonBlock value={rawEvent} label="Event API record" collapsible={false} /></> },
        ]}
        initialSection="overview"
        onClose={onClose}
    />;
}
