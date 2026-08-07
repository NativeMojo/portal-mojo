import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createIncidentHistoryAdapter, useCan, useMe } from '../../client';
import { Badge, DetailView, Eyebrow, FlatRow, KnownFieldsCard, RecordFeed, StatusPanel, fmt, toast, type Tone } from '../../ui';
import { SECURITY_MANAGE_PERMS } from '../security-permissions';
import { AssistantContextLauncher } from '../assistant/launchers';
import { EvidenceCard, INCIDENT_METADATA_FIELDS, RequestResponseForensics, TraceForensics, metadataOf } from './forensics';
import { INCIDENT_LIFECYCLE, IncidentModel, showEventDetail, useIncidentDetail, useIncidentEvents } from './models';
import { sanitizeIncidentHistoryRow, sanitizeSecurityText } from './sanitize';

function priorityTone(priority: number): Tone { return priority >= 8 ? 'danger' : priority >= 5 ? 'warning' : 'info'; }
function statusTone(status: string): Tone { return ['resolved', 'closed'].includes(status) ? 'success' : ['new', 'open'].includes(status) ? 'danger' : status === 'investigating' ? 'warning' : 'muted'; }

export function IncidentDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const query = useIncidentDetail(id);
    const events = useIncidentEvents(id);
    const save = IncidentModel.useSave();
    const { can: canManage } = useCan(SECURITY_MANAGE_PERMS);
    const { data: me } = useMe();
    const adapter = useMemo(() => createIncidentHistoryAdapter(id, {
        sanitizeRow: sanitizeIncidentHistoryRow,
        sanitizeText: sanitizeSecurityText,
    }), [id]);
    if (query.isPending) return <div className="modal-pad dim">Loading incident…</div>;
    if (!query.data || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Incident not found'}</div>;
    const incident = query.data;
    const metadata = metadataOf(incident);
    const patchStatus = async (status: string) => {
        try {
            await save.mutateAsync({ id, changes: { status } });
            await queryClient.invalidateQueries({ queryKey: IncidentModel.keys.root });
            toast.success(`Incident moved to ${status}`);
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Status update failed'); }
    };
    const trace = metadata.stack_trace ?? metadata.traceback;
    return <DetailView
        icon="bi-shield-exclamation"
        title={incident.title || `Incident #${incident.id}`}
        subtitle={`Incident #${incident.id} · ${incident.scope} · ${fmt.datetime(incident.created)}`}
        chips={[
            { text: incident.status.toUpperCase(), tone: statusTone(incident.status) },
            { text: `P${incident.priority}`, tone: priorityTone(incident.priority) },
            { text: incident.category, tone: 'muted' },
            ...(metadata.do_not_delete ? [{ text: 'PROTECTED', tone: 'warning' as const }] : []),
        ]}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => <>
                <StatusPanel tone={statusTone(incident.status)} state={incident.status.toUpperCase()} headline={incident.details || incident.title || 'No incident details'} meta={`${incident.category} · ${incident.scope}`} actions={<div className="assistant-action-row"><AssistantContextLauncher model="incident.Incident" pk={incident.id} />{canManage && <select className="input input-compact" value={incident.status} disabled={save.isPending} onChange={(event) => void patchStatus(event.target.value)} aria-label="Incident lifecycle">{INCIDENT_LIFECYCLE.map((status) => <option key={status} value={status}>{status}</option>)}</select>}</div>} />
                <Eyebrow>Incident facts</Eyebrow>
                <FlatRow label="State"><code>{incident.state || '—'}</code></FlatRow>
                <FlatRow label="Source IP"><code>{incident.source_ip || '—'}</code></FlatRow>
                <FlatRow label="Hostname"><code>{incident.hostname || '—'}</code></FlatRow>
                <FlatRow label="Model">{incident.model_name ? `${incident.model_name} #${incident.model_id ?? '—'}` : '—'}</FlatRow>
            </> },
            { key: 'evidence', label: 'Evidence', icon: 'bi-funnel', render: () => <EvidenceCard metadata={{ ...metadata, model_name: incident.model_name, model_id: incident.model_id }} /> },
            { key: 'events', label: 'Events', icon: 'bi-list-ul', render: () => events.isPending ? <p className="dim">Loading events…</p> : events.data?.rows.length ? <div className="incident-events-list">{events.data.rows.map((event) => <button type="button" className="incident-event-row" key={event.id} onClick={() => showEventDetail(event.id)}><Badge tone={event.level >= 8 ? 'danger' : event.level >= 4 ? 'warning' : 'muted'}>L{event.level}</Badge><span><strong>{event.title || event.category}</strong><small>{fmt.datetime(event.created)} · {event.details || 'No details'}</small></span></button>)}</div> : <p className="dim-italic">No events on this incident.</p> },
            { key: 'request', label: 'Request', icon: 'bi-globe2', render: () => <RequestResponseForensics metadata={metadata} /> },
            ...(trace ? [{ key: 'trace', label: 'Stack trace', icon: 'bi-code-square', render: () => <TraceForensics metadata={metadata} /> }] : []),
            { key: 'history', label: 'History', icon: 'bi-chat-left-text', render: () => <RecordFeed adapter={adapter} variant="compact" showInput={canManage} currentUserId={me?.id ?? null} placeholder="Add an incident note…" /> },
            { key: 'metadata', label: 'Known fields', icon: 'bi-braces', render: () => <KnownFieldsCard data={metadata} known={[...INCIDENT_METADATA_FIELDS]} showRaw={false} emptyText="No curated forensic metadata." /> },
        ]}
        initialSection="overview"
        onClose={onClose}
    />;
}
