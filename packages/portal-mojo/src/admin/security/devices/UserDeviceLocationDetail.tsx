// UserDeviceLocationDetail — the UserDeviceLocationView port (465 lines,
// read in full). The source shipped three inline <style> blocks with
// hardcoded light-only colours (#f0f0f0, #6c757d, #212529, #dc3545) that were
// unreadable in dark mode; this renders semantic classes over tokens.
//
// Two structural corrections:
//   · "Delete Record" is gone — `UserDeviceLocation` declares no CAN_DELETE,
//     so `rest.py` refuses every DELETE.
//   · "View Device" resolves BY DUID, not by id: the embedded `user_device`
//     sub-graph is `basic`, whose field list carries no `id`. The source read
//     `this._ud?.id` and therefore never showed the item.
import { Badge, DetailView, Eyebrow, FlatRow, fmt, modal, type Tone } from '../../../ui';
import { useCan } from '../../../client/runtime';
import { EventModel } from '../../incidents/models';
import { SECURITY_VIEW_PERMS } from '../../security-permissions';
import { LogModel, LOGS_ADMIN_PERMISSIONS } from '../../monitoring/models';
import { GEOIP_VIEW_PERMS, countryFlag, threatTone } from '../geoip/models';
import { showGeoIpDossier } from '../geoip/GeoIpDossier';
import {
    UserDeviceLocationModel,
    browserLabel, browserVersion, deviceIcon, deviceLabel, osVersion,
} from './models';

const DASH = <span className="dim-italic">—</span>;

function RiskRow({ label, icon, value }: { label: string; icon: string; value: boolean | null | undefined }) {
    return (
        <FlatRow label={label}>
            <span className={value ? 'text-bad' : 'dim'}>
                <i className={`bi ${value ? 'bi-check-circle-fill' : 'bi-dash-circle'}`} /> {value ? 'Yes' : 'No'}
            </span>
            <span className="dim udl-risk-icon"><i className={`bi ${icon}`} /></span>
        </FlatRow>
    );
}

function ActivityTable({ headers, children, empty, pending, error }: {
    headers: string[];
    children: React.ReactNode;
    empty: boolean;
    pending: boolean;
    error: Error | null;
}) {
    if (pending) return <p className="dim">Loading…</p>;
    if (error) return <p className="text-bad">{error.message}</p>;
    if (empty) return <p className="dim-italic">Nothing recorded for this address.</p>;
    return (
        <div className="geoip-local-table">
            <table className="tbl">
                <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}

export function UserDeviceLocationDetail({ id, onClose, onOpenUser, onOpenDeviceByDuid }: {
    id: number;
    onClose: () => void;
    onOpenUser?: (userId: number) => void;
    onOpenDeviceByDuid?: (duid: string) => void;
}) {
    const { data: row, isPending, error } = UserDeviceLocationModel.useOne(id);
    const canGeoIp = useCan(GEOIP_VIEW_PERMS).can;
    const canLogs = useCan(LOGS_ADMIN_PERMISSIONS).can;
    const canEvents = useCan(SECURITY_VIEW_PERMS).can;

    const ip = row?.ip_address ?? '';
    const events = EventModel.useList({ source_ip: ip, size: 10, sort: '-created' }, { enabled: Boolean(ip) && canEvents });
    const logs = LogModel.useList({ ip, size: 10, sort: '-created' }, { enabled: Boolean(ip) && canLogs });

    if (isPending) return <div className="modal-pad dim">Loading location record…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'Location record not found'}</div>;

    const geo = row.geolocation;
    const info = row.user_device?.device_info ?? null;
    const where = [geo?.city, geo?.region, geo?.country_name].filter(Boolean).join(', ') || 'Unknown location';
    const hasCoords = geo?.latitude != null && geo.longitude != null;
    const flag = countryFlag(geo?.country_code);

    return (
        <DetailView
            icon={deviceIcon(info)}
            title={where}
            subtitle={`${browserLabel(info)} on ${deviceLabel(info)} · ${row.ip_address}`}
            chips={[
                ...(geo?.threat_level ? [{ text: `Threat: ${geo.threat_level}`, tone: threatTone(geo.threat_level) as Tone }] : []),
                ...(geo?.is_vpn ? [{ icon: 'bi-shield-shaded', text: 'VPN', tone: 'warning' as const }] : []),
                ...(geo?.is_tor ? [{ icon: 'bi-shield-lock', text: 'Tor', tone: 'danger' as const }] : []),
                ...(geo?.is_proxy ? [{ icon: 'bi-diagram-3', text: 'Proxy', tone: 'warning' as const }] : []),
                ...(geo?.is_datacenter ? [{ icon: 'bi-hdd-stack', text: 'Datacenter', tone: 'warning' as const }] : []),
                ...(geo?.is_cloud ? [{ icon: 'bi-cloud-fill', text: 'Cloud', tone: 'info' as const }] : []),
            ]}
            sections={[
                {
                    key: 'location', label: 'Location', icon: 'bi-geo-alt', render: () => (
                        <>
                            <Eyebrow>Geography</Eyebrow>
                            <FlatRow label="City">{geo?.city || DASH}</FlatRow>
                            <FlatRow label="Region">
                                {geo?.region || DASH}
                                {geo?.region_code && <code className="dim geoip-cc">{geo.region_code}</code>}
                            </FlatRow>
                            <FlatRow label="Country">
                                {geo?.country_name || geo?.country_code
                                    ? <>{flag && <span className="geoip-flag">{flag}</span>}{geo?.country_name || geo?.country_code}</>
                                    : DASH}
                            </FlatRow>
                            <FlatRow label="Postal code">{geo?.postal_code || DASH}</FlatRow>
                            <FlatRow label="Timezone">{geo?.timezone || DASH}</FlatRow>
                            <FlatRow label="Coordinates">{hasCoords ? <code>{geo!.latitude}, {geo!.longitude}</code> : DASH}</FlatRow>

                            <Eyebrow>Network</Eyebrow>
                            <FlatRow label="IP address">
                                {canGeoIp && geo
                                    ? <button className="btn-link" onClick={() => showGeoIpDossier(geo.id)}><code>{row.ip_address}</code></button>
                                    : <code>{row.ip_address}</code>}
                            </FlatRow>
                            <FlatRow label="ISP">{geo?.isp || DASH}</FlatRow>
                            <FlatRow label="ASN">
                                {geo?.asn ? <code>{geo.asn}</code> : DASH}
                                {geo?.asn_org && <span className="dim"> · {geo.asn_org}</span>}
                            </FlatRow>
                            <FlatRow label="Connection">{geo?.connection_type || DASH}</FlatRow>

                            <Eyebrow>Timestamps</Eyebrow>
                            <FlatRow label="First seen"><code>{fmt.datetime(row.first_seen)}</code></FlatRow>
                            <FlatRow label="Last seen"><code>{fmt.datetime(row.last_seen)}</code> <span className="dim">· {fmt.relative(row.last_seen)}</span></FlatRow>
                        </>
                    ),
                },
                {
                    key: 'device', label: 'Device', icon: 'bi-laptop', render: () => (
                        <>
                            <Eyebrow>Browser</Eyebrow>
                            <FlatRow label="Name">{info?.user_agent.family || DASH}</FlatRow>
                            <FlatRow label="Version">{browserVersion(info) || DASH}</FlatRow>

                            <Eyebrow>Operating system</Eyebrow>
                            <FlatRow label="Name">{info?.os.family || DASH}</FlatRow>
                            <FlatRow label="Version">{osVersion(info) || DASH}</FlatRow>

                            <Eyebrow>Hardware</Eyebrow>
                            <FlatRow label="Brand">{info?.device.brand || DASH}</FlatRow>
                            <FlatRow label="Family">{info?.device.family || DASH}</FlatRow>
                            <FlatRow label="Model">{info?.device.model || DASH}</FlatRow>

                            <Eyebrow>Identification</Eyebrow>
                            {/* The embedded `basic` graph carries no `id` —
                                cross-links resolve by DUID. */}
                            <FlatRow label="Device ID">{row.user_device ? <code>{row.user_device.duid}</code> : DASH}</FlatRow>
                            <FlatRow label="MUID">{row.user_device?.muid ? <code>{row.user_device.muid}</code> : DASH}</FlatRow>
                            <FlatRow label="Owner">
                                {row.user
                                    ? (onOpenUser
                                        ? <button className="btn-link" onClick={() => onOpenUser(row.user!.id)}>{row.user.display_name || row.user.username}</button>
                                        : (row.user.display_name || row.user.username))
                                    : DASH}
                            </FlatRow>
                            {info?.string && (
                                <>
                                    <Eyebrow>User agent</Eyebrow>
                                    <pre className="ud-ua-block">{info.string}</pre>
                                </>
                            )}
                        </>
                    ),
                },
                {
                    key: 'risk', label: 'Risk', icon: 'bi-shield-exclamation', render: () => (
                        <>
                            <Eyebrow>Threat assessment</Eyebrow>
                            <FlatRow label="Threat level">
                                <Badge tone={threatTone(geo?.threat_level) as Tone}>{geo?.threat_level || 'unknown'}</Badge>
                            </FlatRow>
                            <FlatRow label="Risk score">{geo?.risk_score != null ? <><strong>{geo.risk_score}</strong> / 100</> : DASH}</FlatRow>

                            <Eyebrow>Detection flags</Eyebrow>
                            <RiskRow label="VPN" icon="bi-shield-shaded" value={geo?.is_vpn} />
                            <RiskRow label="Tor exit node" icon="bi-shield-lock" value={geo?.is_tor} />
                            <RiskRow label="Proxy" icon="bi-diagram-3" value={geo?.is_proxy} />
                            <RiskRow label="Cloud provider" icon="bi-cloud" value={geo?.is_cloud} />
                            <RiskRow label="Datacenter" icon="bi-hdd-stack" value={geo?.is_datacenter} />
                            <RiskRow label="Mobile" icon="bi-phone" value={geo?.is_mobile} />

                            <Eyebrow>Reputation</Eyebrow>
                            <RiskRow label="Known attacker" icon="bi-exclamation-triangle" value={geo?.is_known_attacker} />
                            <RiskRow label="Known abuser" icon="bi-flag" value={geo?.is_known_abuser} />
                            <RiskRow label="Threat" icon="bi-shield-exclamation" value={geo?.is_threat} />
                            <RiskRow label="Suspicious" icon="bi-question-circle" value={geo?.is_suspicious} />
                        </>
                    ),
                },
                { divider: 'Activity' },
                {
                    key: 'events', label: 'Events', icon: 'bi-calendar-event',
                    permissions: SECURITY_VIEW_PERMS,
                    render: () => (
                        <>
                            <Eyebrow>Security events from this IP</Eyebrow>
                            <ActivityTable
                                headers={['Date', 'Category', 'Details']}
                                empty={!(events.data?.rows ?? []).length}
                                pending={events.isPending}
                                error={events.error}
                            >
                                {(events.data?.rows ?? []).map((event) => (
                                    <tr key={event.id}>
                                        <td>{fmt.datetime(event.created)}</td>
                                        <td><code>{event.category}</code></td>
                                        <td>{fmt.truncate(event.title || event.details || '—', 70)}</td>
                                    </tr>
                                ))}
                            </ActivityTable>
                        </>
                    ),
                },
                {
                    key: 'logs', label: 'Logs', icon: 'bi-journal-text',
                    permissions: LOGS_ADMIN_PERMISSIONS,
                    render: () => (
                        <>
                            <Eyebrow>Request logs from this IP</Eyebrow>
                            <ActivityTable
                                headers={['Timestamp', 'Level', 'Kind', 'Log']}
                                empty={!(logs.data?.rows ?? []).length}
                                pending={logs.isPending}
                                error={logs.error}
                            >
                                {(logs.data?.rows ?? []).map((log) => (
                                    <tr key={log.id}>
                                        <td>{fmt.datetime(log.created)}</td>
                                        <td>{log.level}</td>
                                        <td>{log.kind || '—'}</td>
                                        <td>{fmt.truncate(log.log || log.path || '—', 70)}</td>
                                    </tr>
                                ))}
                            </ActivityTable>
                        </>
                    ),
                },
            ]}
            initialSection="location"
            contextMenu={[
                ...(row.user && onOpenUser
                    ? [{ label: 'Open user', icon: 'bi-person', onSelect: () => onOpenUser(row.user!.id) }]
                    : []),
                ...(row.user_device && onOpenDeviceByDuid
                    ? [{ label: 'Open device', icon: 'bi-laptop', onSelect: () => onOpenDeviceByDuid(row.user_device!.duid) }]
                    : []),
                ...(geo && canGeoIp
                    ? [{ label: 'Open GeoIP dossier', icon: 'bi-globe2', onSelect: () => showGeoIpDossier(geo.id) }]
                    : []),
                ...(hasCoords
                    ? [{
                        label: 'Open coordinates in Google Maps', icon: 'bi-box-arrow-up-right',
                        onSelect: () => { window.open(`https://www.google.com/maps/search/?api=1&query=${geo!.latitude},${geo!.longitude}`, '_blank', 'noopener,noreferrer'); },
                    }]
                    : []),
                // NO Delete — UserDeviceLocation declares no CAN_DELETE.
            ]}
            onClose={onClose}
        />
    );
}

export function showUserDeviceLocationDetail(id: number, opts: {
    onOpenUser?: (userId: number) => void;
    onOpenDeviceByDuid?: (duid: string) => void;
} = {}): void {
    void modal.detail((close) => <UserDeviceLocationDetail id={id} onClose={() => close(null)} {...opts} />);
}
