import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, DetailView, Eyebrow, FlatRow, ModelTable,
    fmt, modal,
    type Column, type FilterDef, type Tone,
} from '../../ui';
import {
    BOUNCER_INCIDENT_VIEW_PERMS,
    BouncerDeviceModel, BouncerIncidentModel, BouncerSignalModel,
    type BouncerDeviceRow, type BouncerIncidentRow, type BouncerRiskTier,
} from './models';
import { bouncerDecisionTone, bouncerRiskTone, showBouncerSignalDetail } from './signals';

function riskTierTone(tier: BouncerRiskTier): Tone {
    if (tier === 'low') return 'success';
    if (tier === 'medium') return 'warning';
    if (tier === 'high' || tier === 'blocked') return 'danger';
    return 'muted';
}

function LocalPager({ start, size, count, onStart }: {
    start: number;
    size: number;
    count: number;
    onStart: (start: number) => void;
}) {
    if (count <= size) return null;
    const first = count === 0 ? 0 : start + 1;
    const last = Math.min(count, start + size);
    return (
        <div className="bouncer-local-pager">
            <span className="dim">{first}–{last} of {count}</span>
            <div>
                <button className="btn btn-compact" disabled={start === 0} onClick={() => onStart(Math.max(0, start - size))}>
                    <i className="bi bi-chevron-left" /> Previous
                </button>
                <button className="btn btn-compact" disabled={start + size >= count} onClick={() => onStart(start + size)}>
                    Next <i className="bi bi-chevron-right" />
                </button>
            </div>
        </div>
    );
}

function RelatedSignals({ device }: { device: BouncerDeviceRow }) {
    const size = 10;
    const [start, setStart] = useState(0);
    const query = BouncerSignalModel.useList({
        size, start, sort: '-created', muid: device.muid,
    });
    const rows = query.data?.rows ?? [];
    if (query.isPending) return <p className="dim">Loading related signals…</p>;
    if (query.error) return <p className="text-bad">{query.error.message}</p>;
    if (!rows.length) return <p className="dim-italic">No signal assessments found for this MUID.</p>;
    return (
        <div className="bouncer-local-table">
            <table className="tbl">
                <thead><tr><th>Time</th><th>IP</th><th>Decision</th><th className="align-end">Risk</th><th>Page</th></tr></thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id} className="row-click" onClick={() => showBouncerSignalDetail(row.id)}>
                            <td>{fmt.relative(row.created)}</td>
                            <td><code>{row.ip_address || '—'}</code></td>
                            <td><Badge tone={bouncerDecisionTone(row.decision)}>{row.decision.toUpperCase()}</Badge></td>
                            <td className="align-end"><strong className={`bouncer-risk bouncer-risk-${bouncerRiskTone(row.risk_score)}`}>{row.risk_score}</strong></td>
                            <td>{row.page_type || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <LocalPager start={start} size={size} count={query.data?.count ?? 0} onStart={setStart} />
        </div>
    );
}

function incidentPriorityTone(priority: number): Tone {
    if (priority >= 7) return 'danger';
    if (priority >= 5) return 'warning';
    if (priority > 0) return 'info';
    return 'muted';
}

function RelatedIncidents({ device }: { device: BouncerDeviceRow }) {
    const size = 10;
    const [start, setStart] = useState(0);
    const query = BouncerIncidentModel.useList({
        size,
        start,
        sort: '-created',
        category__startswith: 'security:bouncer',
        model_name: 'account.BouncerDevice',
        model_id: device.id,
    });
    const rows: BouncerIncidentRow[] = query.data?.rows ?? [];
    if (query.isPending) return <p className="dim">Loading related incidents…</p>;
    if (query.error) return <p className="text-bad">{query.error.message}</p>;
    if (!rows.length) return <p className="dim-italic">No Bouncer incidents are linked to this device.</p>;
    return (
        <div className="bouncer-local-table">
            <table className="tbl">
                <thead><tr><th>Created</th><th>Status</th><th>Priority</th><th>Category</th><th>Title</th></tr></thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.id}>
                            <td>{fmt.datetime(row.created)}</td>
                            <td><Badge>{row.status}</Badge></td>
                            <td><Badge tone={incidentPriorityTone(row.priority)}>{row.priority}</Badge></td>
                            <td><code>{row.category}</code></td>
                            <td>{row.title || row.details || `Incident #${row.id}`}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <LocalPager start={start} size={size} count={query.data?.count ?? 0} onStart={setStart} />
        </div>
    );
}

export function BouncerDeviceDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const queryClient = useQueryClient();
    const { data: device, isPending, error } = BouncerDeviceModel.useOne(id);
    if (isPending) return <div className="modal-pad dim">Loading Bouncer device…</div>;
    if (!device || error) return <div className="modal-pad text-bad">{error?.message ?? 'Bouncer device not found'}</div>;

    return (
        <DetailView
            icon="bi-fingerprint"
            title="Bouncer Device"
            subtitle={`MUID ${device.muid}`}
            chips={[
                { text: device.risk_tier.toUpperCase(), tone: riskTierTone(device.risk_tier) },
                { text: `${device.event_count} events`, tone: 'info' },
                { text: `${device.block_count} blocks`, tone: device.block_count ? 'danger' : 'muted' },
            ]}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Device identity</Eyebrow>
                            <FlatRow label="MUID"><code>{device.muid}</code></FlatRow>
                            <FlatRow label="DUID"><code>{device.duid || '—'}</code></FlatRow>
                            <FlatRow label="MSID"><code>{device.msid || '—'}</code></FlatRow>
                            <FlatRow label="Fingerprint"><code>{device.fingerprint_id || '—'}</code></FlatRow>
                            <FlatRow label="Risk tier"><Badge tone={riskTierTone(device.risk_tier)}>{device.risk_tier.toUpperCase()}</Badge></FlatRow>
                            <FlatRow label="Last IP"><code>{device.last_seen_ip || '—'}</code></FlatRow>
                            <FlatRow label="First seen">{device.first_seen ? fmt.datetime(device.first_seen) : '—'}</FlatRow>
                            <FlatRow label="Last seen">{fmt.datetime(device.last_seen)}</FlatRow>
                            <Eyebrow>Activity</Eyebrow>
                            <FlatRow label="Events">{device.event_count}</FlatRow>
                            <FlatRow label="Blocks">{device.block_count}</FlatRow>
                            <FlatRow label="Linked MUIDs">
                                <span className="bouncer-token-list">
                                    {device.linked_muids?.length
                                        ? device.linked_muids.map((muid) => <code className="bouncer-code-token" key={muid}>{muid}</code>)
                                        : <span className="dim">None</span>}
                                </span>
                            </FlatRow>
                        </>
                    ),
                },
                { key: 'signals', label: 'Signals', icon: 'bi-activity', render: () => <RelatedSignals device={device} /> },
                {
                    key: 'incidents', label: 'Incidents', icon: 'bi-shield-exclamation',
                    permissions: BOUNCER_INCIDENT_VIEW_PERMS,
                    render: () => <RelatedIncidents device={device} />,
                },
            ]}
            initialSection="overview"
            contextMenu={[
                {
                    label: 'Refresh', icon: 'bi-arrow-clockwise', onSelect: () => {
                        void queryClient.invalidateQueries({ queryKey: BouncerDeviceModel.keys.one(device.id) });
                    },
                },
            ]}
            onClose={onClose}
        />
    );
}

export function showBouncerDeviceDetail(id: number): void {
    void modal.detail((close) => (
        <BouncerDeviceDetail id={id} onClose={() => close(null)} />
    ));
}

const DEVICE_COLUMNS: Column<BouncerDeviceRow>[] = [
    { key: 'muid', label: 'MUID', sortable: true, hideable: false, render: (row) => <code title={row.muid}>{fmt.truncateMiddle(row.muid, 18)}</code> },
    { key: 'risk_tier', label: 'Risk Tier', sortable: true, render: (row) => <Badge tone={riskTierTone(row.risk_tier)}>{row.risk_tier.toUpperCase()}</Badge> },
    { key: 'event_count', label: 'Events', sortable: true, align: 'end' },
    { key: 'block_count', label: 'Blocks', sortable: true, align: 'end', render: (row) => <strong className={row.block_count ? 'text-bad' : undefined}>{row.block_count}</strong> },
    { key: 'last_seen_ip', label: 'Last IP', render: (row) => <code>{row.last_seen_ip || '—'}</code> },
    { key: 'last_seen', label: 'Last Seen', sortable: true, render: (row) => fmt.relative(row.last_seen) },
];

const DEVICE_FILTERS: FilterDef[] = [
    { key: 'muid', label: 'MUID', type: 'text' },
    { key: 'risk_tier', label: 'Risk tier', type: 'select', options: [
        { value: 'unknown', label: 'Unknown' }, { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
        { value: 'blocked', label: 'Blocked' },
    ] },
    { key: 'last_seen_ip', label: 'Last IP', type: 'text' },
    { key: 'last_seen', label: 'Last seen', type: 'daterange' },
];

export function BouncerDevicesPage() {
    return (
        <ModelTable<BouncerDeviceRow>
            model={BouncerDeviceModel}
            eyebrow="Security · Bouncer"
            title="Device Reputation"
            searchPlaceholder="Search MUID, DUID, fingerprint, or IP"
            columns={DEVICE_COLUMNS}
            filters={DEVICE_FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'high', label: 'High risk', params: { risk_tier: 'high' } },
                { key: 'blocked', label: 'Blocked', params: { risk_tier: 'blocked' } },
            ]}
            defaultSort="-last_seen"
            columnChooser
            persistState
            persistKey="admin:bouncer:devices"
            exportFormats={['csv', 'json']}
            onRowClick={(row) => showBouncerDeviceDetail(row.id)}
        />
    );
}
