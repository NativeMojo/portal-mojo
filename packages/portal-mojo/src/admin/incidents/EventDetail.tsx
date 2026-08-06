import { DetailView, Eyebrow, FlatRow, KnownFieldsCard, StatusPanel, fmt } from '../../ui';
import { EvidenceCard, INCIDENT_METADATA_FIELDS, RequestResponseForensics, TraceForensics, first, metadataOf } from './forensics';
import { showIncidentDetail, useEventDetail } from './models';

function incidentId(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') return (value as { id: number }).id;
    return null;
}
export function EventDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const query = useEventDetail(id);
    if (query.isPending) return <div className="modal-pad dim">Loading event…</div>;
    if (!query.data || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Event not found'}</div>;
    const event = query.data;
    const metadata = metadataOf(event);
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
            { key: 'source', label: 'Source', icon: 'bi-globe2', render: () => <><Eyebrow>Source and network</Eyebrow><FlatRow label="Source IP"><code>{event.source_ip || '—'}</code></FlatRow><FlatRow label="Hostname"><code>{event.hostname || '—'}</code></FlatRow><FlatRow label="Country">{String(event.country_code || metadata.country_code || '—')}</FlatRow><FlatRow label="Server">{String(metadata.server ?? '—')}</FlatRow></> },
            { key: 'request', label: 'Request', icon: 'bi-funnel', render: () => <RequestResponseForensics metadata={metadata} /> },
            ...(trace ? [{ key: 'trace', label: 'Stack trace', icon: 'bi-code-square', render: () => <TraceForensics metadata={metadata} /> }] : []),
            ...(hasOssec ? [{ key: 'ossec', label: 'OSSEC', icon: 'bi-shield-exclamation', render: () => <EvidenceCard metadata={metadata} /> }] : []),
            ...(hasBouncer ? [{ key: 'bouncer', label: 'Bouncer', icon: 'bi-shield-shaded', render: () => <KnownFieldsCard data={metadata} showRaw={false} known={[{ key: 'decision', hideEmpty: true }, { key: 'risk_score', hideEmpty: true }, { key: 'page', hideEmpty: true }, { key: 'page_type', hideEmpty: true }, { key: 'muid', hideEmpty: true }, { key: 'duid', hideEmpty: true }, { key: 'triggered_signals', hideEmpty: true }]} /> }] : []),
            ...(hasPermissions ? [{ key: 'permissions', label: 'Auth evidence', icon: 'bi-key', render: () => <KnownFieldsCard data={metadata} showRaw={false} known={[{ key: 'permission_keys', hideEmpty: true }, { key: 'perms', hideEmpty: true }, { key: 'auth_result', hideEmpty: true }, { key: 'user_email', hideEmpty: true }]} /> }] : []),
            { key: 'metadata', label: 'Known fields', icon: 'bi-braces', render: () => <KnownFieldsCard data={metadata} known={[...INCIDENT_METADATA_FIELDS, { key: 'alert_id', hideEmpty: true }, { key: 'logfile', hideEmpty: true }, { key: 'error_code', hideEmpty: true }, { key: 'error_message', hideEmpty: true }]} showRaw={false} /> },
        ]}
        initialSection="overview"
        onClose={onClose}
    />;
}
