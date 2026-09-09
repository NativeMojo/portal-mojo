import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createIncidentHistoryAdapter, mojoCall, useCan, useMe } from '../../client/runtime';
import { Badge, DetailView, Eyebrow, FlatRow, JsonBlock, KnownFieldsCard, RecordFeed, StatusPanel, fmt, toast, type Tone } from '../../ui';
import { SECURITY_MANAGE_PERMS } from '../security-permissions';
import { AssistantContextLauncher } from '../assistant/launchers';
import { showGeoIpDossier, showGeoIpDossierForAddress } from '../security/geoip/GeoIpDossier';
import { blockActive, blockExpired, countryFlag, threatTone, whitelistActive, whitelistExpired, type GeoLocatedIPRow } from '../security/geoip/models';
import { EvidenceCard, INCIDENT_METADATA_FIELDS, RequestResponseForensics, TraceForensics, first, metadataOf } from './forensics';
import { INCIDENT_LIFECYCLE, IncidentModel, showEventDetail, useIncidentEvents, type IncidentRow } from './models';
import { sanitizeIncidentHistoryRow, sanitizeIncidentRow, sanitizeSecurityText } from './sanitize';

function priorityTone(priority: number): Tone { return priority >= 8 ? 'danger' : priority >= 5 ? 'warning' : 'info'; }
function statusTone(status: string): Tone { return ['resolved', 'closed'].includes(status) ? 'success' : ['new', 'open'].includes(status) ? 'danger' : status === 'investigating' ? 'warning' : 'muted'; }

const DASH = <span className="dim-italic">—</span>;

function asRecord(value: unknown): Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

function scalar(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() ? value : null;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function temporal(value: unknown): string | number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) return value;
    return null;
}

function display(value: unknown) {
    return scalar(value) ?? DASH;
}

function Timestamp({ value, relative = true }: { value: unknown; relative?: boolean }) {
    const time = temporal(value);
    return time == null ? DASH : <>{fmt.datetime(time)}{relative && <span className="dim"> · {fmt.relative(time)}</span>}</>;
}

const SOURCE_FLAGS: readonly [string, keyof GeoLocatedIPRow][] = [
    ['Tor', 'is_tor'], ['VPN', 'is_vpn'], ['Proxy', 'is_proxy'],
    ['Cloud', 'is_cloud'], ['Datacenter', 'is_datacenter'], ['Mobile', 'is_mobile'],
    ['Known attacker', 'is_known_attacker'], ['Known abuser', 'is_known_abuser'],
];

function IncidentSourceIntelligence({ incident, metadata }: { incident: IncidentRow; metadata: Record<string, unknown> }) {
    const infoRecord = asRecord(incident.ip_info);
    const info = infoRecord as Partial<GeoLocatedIPRow>;
    const sourceIp = scalar(incident.source_ip)
        ?? scalar(first(metadata, 'source_ip', 'request_ip'))
        ?? scalar(info.ip_address);
    const dossierId = Number.isSafeInteger(info.id) && Number(info.id) > 0 ? Number(info.id) : null;
    const openDossier = dossierId != null
        ? () => showGeoIpDossier(dossierId)
        : sourceIp ? () => showGeoIpDossierForAddress(sourceIp) : null;

    const enforcement = {
        is_blocked: info.is_blocked === true,
        blocked_until: temporal(info.blocked_until) as number | null,
        is_whitelisted: info.is_whitelisted === true,
        whitelisted_until: temporal(info.whitelisted_until) as number | null,
    };
    const blocked = blockActive(enforcement);
    const whitelisted = whitelistActive(enforcement);
    const level = scalar(info.threat_level)?.toLowerCase() ?? '';
    const risk = typeof info.risk_score === 'number' ? info.risk_score : null;
    const hasAssessment = ['threat_level', 'risk_score', 'is_threat', 'is_suspicious'].some((key) => key in infoRecord);
    const hasEnforcement = ['is_blocked', 'is_whitelisted', 'blocked_at', 'blocked_until', 'whitelisted_until'].some((key) => key in infoRecord);
    const hasFirewall = ['firewall_generation', 'firewall_pending', 'firewall_sync_error', 'firewall_observed_at'].some((key) => key in infoRecord);
    const hasObservation = ['created', 'modified', 'last_seen', 'expires_at'].some((key) => key in infoRecord);
    const context = [
        ['Request IP', first(metadata, 'request_ip')],
        ['Server', first(metadata, 'server')],
        ['Protocol', first(metadata, 'http_protocol', 'protocol')],
        ['Connection ID', first(metadata, 'connection_id')],
        ['User agent', first(metadata, 'http_user_agent', 'user_agent')],
    ] as const;
    const contextRows = context.filter(([, value]) => scalar(value) != null);
    const countryCode = scalar(info.country_code) ?? scalar(incident.country_code) ?? scalar(metadata.country_code);
    const countryName = scalar(info.country_name) ?? scalar(metadata.country_name);
    const flag = countryFlag(countryCode);
    const place = [scalar(info.city) ?? scalar(metadata.city), scalar(info.region) ?? scalar(metadata.region), countryName ?? countryCode].filter(Boolean).join(', ');
    const status = blocked
        ? { tone: 'danger' as const, state: 'BLOCKED', headline: scalar(info.blocked_reason) ? `Blocked: ${scalar(info.blocked_reason)}` : 'Currently blocked' }
        : whitelisted
            ? { tone: 'success' as const, state: 'WHITELISTED', headline: scalar(info.whitelisted_reason) ? `Whitelisted: ${scalar(info.whitelisted_reason)}` : 'Currently whitelisted' }
            : hasAssessment && (info.is_threat === true || ['high', 'critical'].includes(level))
                ? { tone: 'danger' as const, state: 'ALLOWED · HIGH RISK', headline: `${level || 'high'} threat assessment` }
                : hasAssessment && (info.is_suspicious === true || level === 'medium')
                    ? { tone: 'warning' as const, state: 'ALLOWED · ELEVATED RISK', headline: 'Suspicious source signals detected' }
                    : hasAssessment
                        ? { tone: 'success' as const, state: 'ALLOWED', headline: 'No active threat signals' }
                        : { tone: 'info' as const, state: 'SOURCE RECORDED', headline: 'No cached IP intelligence was attached' };

    return <>
        <StatusPanel
            tone={status.tone}
            state={status.state}
            headline={status.headline}
            meta={`${place || sourceIp || 'Unknown source'}${risk == null ? '' : ` · risk ${risk}/100`}`}
            actions={openDossier && <button type="button" className="btn btn-compact" onClick={openDossier}><i className="bi bi-box-arrow-up-right" /> Open full IP dossier</button>}
        />

        <Eyebrow>Location &amp; network</Eyebrow>
        <FlatRow label="IP address">{sourceIp ? (openDossier ? <button type="button" className="btn-link" onClick={openDossier}><code>{sourceIp}</code></button> : <code>{sourceIp}</code>) : DASH}</FlatRow>
        <FlatRow label="Hostname"><code>{incident.hostname || '—'}</code></FlatRow>
        <FlatRow label="Country">{countryCode || countryName ? <>{flag && <span className="geoip-flag">{flag}</span>}{countryName || countryCode}{countryCode && <code className="dim geoip-cc">{countryCode}</code>}</> : DASH}</FlatRow>
        <FlatRow label="Region">{display(info.region ?? metadata.region)}{info.region_code && <code className="dim geoip-cc">{info.region_code}</code>}</FlatRow>
        <FlatRow label="City / postal">{[scalar(info.city ?? metadata.city), scalar(info.postal_code)].filter(Boolean).join(' · ') || DASH}</FlatRow>
        <FlatRow label="Timezone">{display(info.timezone ?? metadata.timezone)}</FlatRow>
        <FlatRow label="Coordinates">{info.latitude != null && info.longitude != null ? <code>{info.latitude}, {info.longitude}</code> : DASH}</FlatRow>
        <FlatRow label="Subnet"><code>{scalar(info.subnet) || '—'}</code></FlatRow>
        <FlatRow label="ASN">{display(info.asn)}</FlatRow>
        <FlatRow label="ASN organization">{display(info.asn_org)}</FlatRow>
        <FlatRow label="ISP">{display(info.isp)}</FlatRow>
        <FlatRow label="Connection">{[scalar(info.connection_type), scalar(info.mobile_carrier)].filter(Boolean).join(' · ') || DASH}</FlatRow>

        {hasAssessment && <>
            <Eyebrow>Risk &amp; reputation</Eyebrow>
            <FlatRow label="Threat level"><Badge tone={threatTone(info.threat_level) as Tone}>{info.threat_level || 'none'}</Badge></FlatRow>
            <FlatRow label="Risk score">{risk == null ? DASH : <strong>{risk}/100</strong>}</FlatRow>
            <FlatRow label="Threat"><Badge tone={info.is_threat ? 'danger' : 'muted'}>{info.is_threat ? 'Yes' : 'No'}</Badge></FlatRow>
            <FlatRow label="Suspicious"><Badge tone={info.is_suspicious ? 'warning' : 'muted'}>{info.is_suspicious ? 'Yes' : 'No'}</Badge></FlatRow>
            <div className="netsec-flags">
                {SOURCE_FLAGS.map(([label, key]) => {
                    const active = info[key] === true;
                    return <span key={label} className={`chip ${active ? 'chip-danger' : 'chip-muted'}`}><i className={`bi ${active ? 'bi-check-lg' : 'bi-dash'}`} /> {label}</span>;
                })}
            </div>
        </>}

        {hasEnforcement && <>
            <Eyebrow>Enforcement</Eyebrow>
            <FlatRow label="Effective state"><Badge tone={blocked ? 'danger' : whitelisted ? 'success' : 'muted'}>{blocked ? 'Blocked' : whitelisted ? 'Whitelisted' : blockExpired(enforcement) ? 'Block expired' : whitelistExpired(enforcement) ? 'Whitelist expired' : 'Allowed'}</Badge></FlatRow>
            <FlatRow label="Blocked at"><Timestamp value={info.blocked_at} /></FlatRow>
            <FlatRow label="Blocked until"><Timestamp value={info.blocked_until} relative={false} /></FlatRow>
            <FlatRow label="Block reason">{display(info.blocked_reason)}</FlatRow>
            <FlatRow label="Block count">{typeof info.block_count === 'number' ? info.block_count : DASH}</FlatRow>
            <FlatRow label="Whitelist until"><Timestamp value={info.whitelisted_until} relative={false} /></FlatRow>
            <FlatRow label="Whitelist reason">{display(info.whitelisted_reason)}</FlatRow>
        </>}

        {hasFirewall && <>
            <Eyebrow>Firewall reconciliation</Eyebrow>
            <FlatRow label="State"><Badge tone={info.firewall_pending ? 'warning' : info.firewall_sync_error ? 'danger' : 'success'}>{info.firewall_pending ? 'Pending' : info.firewall_sync_error ? 'Error' : 'In sync'}</Badge></FlatRow>
            <FlatRow label="Generation">{typeof info.firewall_generation === 'number' ? info.firewall_generation : DASH}</FlatRow>
            <FlatRow label="Observed"><Timestamp value={info.firewall_observed_at} /></FlatRow>
            <FlatRow label="Sync error">{display(info.firewall_sync_error)}</FlatRow>
        </>}

        {hasObservation && <>
            <Eyebrow>Observation</Eyebrow>
            <FlatRow label="First recorded"><Timestamp value={info.created} /></FlatRow>
            <FlatRow label="Modified"><Timestamp value={info.modified} /></FlatRow>
            <FlatRow label="Last seen"><Timestamp value={info.last_seen} /></FlatRow>
            <FlatRow label="Cache expires"><Timestamp value={info.expires_at} relative={false} /></FlatRow>
        </>}

        {contextRows.length > 0 && <>
            <Eyebrow>Incident context</Eyebrow>
            {contextRows.map(([label, value]) => <FlatRow key={label} label={label}>{label === 'Connection ID' || label === 'Request IP' ? <code>{scalar(value)}</code> : scalar(value)}</FlatRow>)}
        </>}
    </>;
}

function prepareIncidentDetailRecord(rawIncident: IncidentRow): { rawIncident: IncidentRow; incident: IncidentRow } {
    return { rawIncident, incident: sanitizeIncidentRow(rawIncident) };
}

/** Keep the authorized raw record isolated from every sanitized incident cache. */
function useRawIncidentDetail(id: number | null) {
    return useQuery({
        queryKey: [IncidentModel.endpoint, 'raw-one', id, { graph: 'detailed' }],
        queryFn: async () => (await mojoCall(`${IncidentModel.endpoint}/${id!}`, { params: { graph: 'detailed' } })).data as IncidentRow,
        enabled: id != null,
    });
}

export function IncidentDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const query = useRawIncidentDetail(id);
    const events = useIncidentEvents(id);
    const save = IncidentModel.useSave();
    const { can: canManage } = useCan(SECURITY_MANAGE_PERMS);
    const { data: me } = useMe();
    if (query.isPending) return <div className="modal-pad dim">Loading incident…</div>;
    if (!query.data || query.error) return <div className="modal-pad text-bad">{query.error?.message ?? 'Incident not found'}</div>;
    const { rawIncident, incident } = prepareIncidentDetailRecord(query.data);
    const groupId = Number.isSafeInteger(incident.group_id) && Number(incident.group_id) > 0
        ? Number(incident.group_id) : null;
    const adapter = createIncidentHistoryAdapter(id, {
        groupId,
        sanitizeRow: sanitizeIncidentHistoryRow,
        sanitizeText: sanitizeSecurityText,
    });
    const metadata = metadataOf(incident);
    const patchStatus = async (status: string) => {
        try {
            await save.mutateAsync({ id, changes: { status } });
            await queryClient.invalidateQueries({ queryKey: IncidentModel.keys.root });
            toast.success(`Incident moved to ${status}`);
        } catch (error) { toast.error(error instanceof Error ? error.message : 'Status update failed'); }
    };
    const trace = metadata.stack_trace ?? metadata.traceback;
    const hasSource = Boolean(scalar(incident.source_ip) || Object.keys(asRecord(incident.ip_info)).length || scalar(first(metadata, 'source_ip', 'request_ip')));
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
            ...(hasSource ? [{ key: 'source', label: 'Source', icon: 'bi-globe2', render: () => <IncidentSourceIntelligence incident={incident} metadata={metadata} /> }] : []),
            { key: 'evidence', label: 'Evidence', icon: 'bi-funnel', render: () => <EvidenceCard metadata={{ ...metadata, model_name: incident.model_name, model_id: incident.model_id }} /> },
            { key: 'events', label: 'Events', icon: 'bi-list-ul', render: () => events.isPending ? <p className="dim">Loading events…</p> : events.data?.rows.length ? <div className="incident-events-list">{events.data.rows.map((event) => <button type="button" className="incident-event-row" key={event.id} onClick={() => showEventDetail(event.id)}><Badge tone={event.level >= 8 ? 'danger' : event.level >= 4 ? 'warning' : 'muted'}>L{event.level}</Badge><span><strong>{event.title || event.category}</strong><small>{fmt.datetime(event.created)} · {event.details || 'No details'}</small></span></button>)}</div> : <p className="dim-italic">No events on this incident.</p> },
            { key: 'request', label: 'Request', icon: 'bi-globe2', render: () => <RequestResponseForensics metadata={metadata} /> },
            ...(trace ? [{ key: 'trace', label: 'Stack trace', icon: 'bi-code-square', render: () => <TraceForensics metadata={metadata} /> }] : []),
            { key: 'history', label: 'History', icon: 'bi-chat-left-text', render: () => <RecordFeed adapter={adapter} variant="compact" showInput={canManage} currentUserId={me?.id ?? null} placeholder="Add an incident note…" attachmentUpload={{ destination: groupId == null ? {} : { groupId, use: 'uploads' }, expectedGroupId: groupId }} /> },
            { key: 'metadata', label: 'Known fields', icon: 'bi-braces', render: () => <KnownFieldsCard data={metadata} known={[...INCIDENT_METADATA_FIELDS]} showRaw={false} emptyText="No curated forensic metadata." /> },
            { divider: 'Raw' },
            { key: 'raw', label: 'Raw data', icon: 'bi-filetype-json', render: () => <><Eyebrow>Complete API response</Eyebrow><p className="dim">The complete incident record returned by Django, including all metadata and IP information.</p><JsonBlock value={rawIncident} label="Incident API record" collapsible={false} /></> },
        ]}
        initialSection="overview"
        onClose={onClose}
    />;
}
