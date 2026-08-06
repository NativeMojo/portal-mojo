import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, DetailView, Eyebrow, FlatRow, JsonBlock, ModelTable,
    fmt, groupByDay, modal,
    type Column, type FilterDef, type Tone,
} from '../../ui';
import {
    BouncerSignalModel, bouncerSignalDetailKey, useBouncerSignalDetail,
    type BouncerDecision, type BouncerSignalRow,
} from './models';

export function bouncerDecisionTone(decision: BouncerDecision): Tone {
    if (decision === 'allow') return 'success';
    if (decision === 'monitor') return 'warning';
    if (decision === 'block') return 'danger';
    if (decision === 'log') return 'info';
    return 'muted';
}

export function bouncerRiskTone(score: number): Tone {
    if (score >= 80) return 'danger';
    if (score >= 50) return 'warning';
    if (score >= 20) return 'info';
    return 'success';
}

function EmbeddedDevice({ signal }: { signal: BouncerSignalRow }) {
    const device = signal.device && typeof signal.device === 'object' ? signal.device : null;
    if (!device) return <p className="dim-italic">No device record was linked to this assessment.</p>;
    return (
        <>
            <Eyebrow>Linked device</Eyebrow>
            <FlatRow label="MUID"><code>{device.muid}</code></FlatRow>
            <FlatRow label="DUID"><code>{device.duid || '—'}</code></FlatRow>
            <FlatRow label="Fingerprint"><code>{device.fingerprint_id || '—'}</code></FlatRow>
            <FlatRow label="Risk tier"><Badge tone={device.risk_tier === 'low' ? 'success' : device.risk_tier === 'medium' ? 'warning' : device.risk_tier === 'unknown' ? 'muted' : 'danger'}>{device.risk_tier}</Badge></FlatRow>
            <FlatRow label="Activity">{device.event_count} events · {device.block_count} blocks</FlatRow>
            <FlatRow label="Last seen">{fmt.datetime(device.last_seen)}</FlatRow>
        </>
    );
}

function GeoIp({ signal }: { signal: BouncerSignalRow }) {
    const geo = signal.geo_ip;
    if (!geo) return <p className="dim-italic">No GeoIP record was linked to this assessment.</p>;
    const flags = [
        geo.is_tor && 'Tor', geo.is_vpn && 'VPN', geo.is_proxy && 'Proxy',
        geo.is_cloud && 'Cloud', geo.is_datacenter && 'Datacenter',
        geo.is_known_attacker && 'Known attacker', geo.is_known_abuser && 'Known abuser',
    ].filter((flag): flag is string => Boolean(flag));
    return (
        <>
            <Eyebrow>GeoIP</Eyebrow>
            <FlatRow label="Location">{[geo.city, geo.region, geo.country_name || geo.country_code].filter(Boolean).join(', ') || '—'}</FlatRow>
            <FlatRow label="Network">{geo.asn_org || geo.isp || geo.asn || '—'}</FlatRow>
            <FlatRow label="Threat level"><Badge>{geo.threat_level || 'unknown'}</Badge></FlatRow>
            <FlatRow label="Signals">
                <span className="bouncer-token-list">
                    {flags.length ? flags.map((flag) => <Badge key={flag} tone="warning">{flag}</Badge>) : <span className="dim">None</span>}
                </span>
            </FlatRow>
        </>
    );
}

export function BouncerSignalDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const { data: signal, isPending, error } = useBouncerSignalDetail(id);
    if (isPending) return <div className="modal-pad dim">Loading signal assessment…</div>;
    if (!signal || error) return <div className="modal-pad text-bad">{error?.message ?? 'Signal assessment not found'}</div>;

    return (
        <DetailView
            icon="bi-activity"
            title="Signal Assessment"
            subtitle={`${signal.ip_address || 'Unknown IP'} · ${fmt.datetime(signal.created)}`}
            chips={[
                { text: signal.decision.toUpperCase(), tone: bouncerDecisionTone(signal.decision) },
                { text: `Risk ${signal.risk_score}`, tone: bouncerRiskTone(signal.risk_score) },
                { text: signal.stage, tone: 'muted' },
            ]}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Assessment</Eyebrow>
                            <FlatRow label="Decision"><Badge tone={bouncerDecisionTone(signal.decision)}>{signal.decision.toUpperCase()}</Badge></FlatRow>
                            <FlatRow label="Risk score"><strong className={`bouncer-risk bouncer-risk-${bouncerRiskTone(signal.risk_score)}`}>{signal.risk_score}</strong></FlatRow>
                            <FlatRow label="Stage">{signal.stage}</FlatRow>
                            <FlatRow label="Page type">{signal.page_type || '—'}</FlatRow>
                            <FlatRow label="IP address"><code>{signal.ip_address || '—'}</code></FlatRow>
                            <FlatRow label="Created">{fmt.datetime(signal.created)}</FlatRow>
                            <Eyebrow>Identity</Eyebrow>
                            <FlatRow label="MUID"><code>{signal.muid || '—'}</code></FlatRow>
                            <FlatRow label="DUID"><code>{signal.duid || '—'}</code></FlatRow>
                            <FlatRow label="MSID"><code>{signal.msid || '—'}</code></FlatRow>
                            <FlatRow label="MTAB"><code>{signal.mtab || '—'}</code></FlatRow>
                            <FlatRow label="Session"><code>{signal.session_id || '—'}</code></FlatRow>
                            <Eyebrow>Triggered signals</Eyebrow>
                            <div className="bouncer-token-list">
                                {signal.triggered_signals?.length
                                    ? signal.triggered_signals.map((name) => <Badge key={name} tone="warning">{name}</Badge>)
                                    : <span className="dim-italic">No signals triggered.</span>}
                            </div>
                        </>
                    ),
                },
                { key: 'device', label: 'Device', icon: 'bi-fingerprint', render: () => <EmbeddedDevice signal={signal} /> },
                { key: 'geoip', label: 'GeoIP', icon: 'bi-geo-alt', render: () => <GeoIp signal={signal} /> },
                { key: 'raw', label: 'Raw Signals', icon: 'bi-code-square', render: () => <JsonBlock label="Client signal payload" value={signal.raw_signals ?? {}} defaultOpen /> },
                { key: 'server', label: 'Server Signals', icon: 'bi-hdd-stack', render: () => <JsonBlock label="Server signal payload" value={signal.server_signals ?? {}} defaultOpen /> },
            ]}
            contextMenu={[
                {
                    label: 'Refresh', icon: 'bi-arrow-clockwise', onSelect: () => {
                        void queryClient.invalidateQueries({ queryKey: bouncerSignalDetailKey(signal.id) });
                    },
                },
            ]}
            onClose={onClose}
        />
    );
}

export function showBouncerSignalDetail(id: number): void {
    void modal.detail((close) => (
        <BouncerSignalDetail id={id} onClose={() => close(null)} />
    ));
}

const SIGNAL_COLUMNS: Column<BouncerSignalRow>[] = [
    { key: 'created', label: 'Timestamp', sortable: true, hideable: false, render: (row) => fmt.datetime(row.created) },
    { key: 'ip_address', label: 'IP', render: (row) => <code>{row.ip_address || '—'}</code> },
    { key: 'decision', label: 'Decision', render: (row) => <Badge tone={bouncerDecisionTone(row.decision)}>{row.decision.toUpperCase()}</Badge> },
    { key: 'risk_score', label: 'Risk', sortable: true, align: 'end', render: (row) => <strong className={`bouncer-risk bouncer-risk-${bouncerRiskTone(row.risk_score)}`}>{row.risk_score}</strong> },
    { key: 'page_type', label: 'Page', render: (row) => row.page_type || '—' },
    { key: 'stage', label: 'Stage', render: (row) => <Badge tone="muted">{row.stage}</Badge> },
    { key: 'muid', label: 'Device', render: (row) => <code title={row.muid}>{fmt.truncateMiddle(row.muid, 16)}</code> },
];

const SIGNAL_FILTERS: FilterDef[] = [
    { key: 'created', label: 'Created', type: 'daterange' },
    { key: 'ip_address', label: 'IP address', type: 'text' },
    { key: 'decision', label: 'Decision', type: 'select', options: [
        { value: 'allow', label: 'Allow' }, { value: 'monitor', label: 'Monitor' },
        { value: 'block', label: 'Block' }, { value: 'log', label: 'Log' },
    ] },
    { key: 'risk_score', label: 'Minimum risk', type: 'number', lookup: 'gte' },
    { key: 'page_type', label: 'Page type', type: 'text' },
    { key: 'stage', label: 'Stage', type: 'select', options: [
        { value: 'assess', label: 'Assess' }, { value: 'submit', label: 'Submit' }, { value: 'event', label: 'Event' },
    ] },
];

const signalGroups = groupByDay<BouncerSignalRow>('created');

export function BouncerSignalsPage() {
    return (
        <ModelTable<BouncerSignalRow>
            model={BouncerSignalModel}
            eyebrow="Security · Bouncer"
            title="Signal Decisions"
            searchPlaceholder="Search MUID, DUID, IP, or decision"
            columns={SIGNAL_COLUMNS}
            filters={SIGNAL_FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'blocked', label: 'Blocked', params: { decision: 'block' } },
                { key: 'monitor', label: 'Monitor', params: { decision: 'monitor' } },
            ]}
            defaultSort="-created"
            columnChooser
            persistState
            persistKey="admin:bouncer:signals"
            exportFormats={['csv', 'json']}
            onRowClick={(row) => showBouncerSignalDetail(row.id)}
            groupBy={signalGroups.groupBy}
            groupHeaderLabel={signalGroups.groupHeaderLabel}
            groupHeaderStyle="mark"
        />
    );
}
