// UserDeviceDetail — the DeviceView port (961 lines, read in full), as a
// KISS `modal.detail`.
//
// What the source had that is NOT carried, because the backend field does not
// exist: the `is_trusted` active toggle, the "Mark trusted/untrusted" kebab
// item, the Trusted and Blocked chips, the TRUST timeline row, and "Forget
// device" (no CAN_DELETE anywhere on UserDevice). Also dropped: the
// `session_count` / `location_count` KPIs and chips, which existed on no
// model and rendered "—" forever.
//
// What is NEW because the backend actually has it: the Sessions section is
// REAL — `UserDevice`'s `sessions` graph exposes `bouncer_device`,
// `active_sessions` (24h of BouncerSignal grouped by msid, with a per-tab
// breakdown) and `recent_locations`. The source's "Session history is not yet
// recorded server-side" placeholder is obsolete. Logins are new too: the
// `UserLoginEvent.device` FK exists and web-mojo never used it.
import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, DetailView, Eyebrow, FlatRow, KnownFieldsCard, MetricCard, Timeline,
    fmt, modal, toast, type Chip, type Tone,
} from '../../../ui';
import { useCan } from '../../../client';
import { BOUNCER_VIEW_PERMS, BouncerDeviceModel } from '../../bouncer/models';
import { showBouncerDeviceDetail } from '../../bouncer/devices';
import { GEOIP_VIEW_PERMS, countryFlag, threatTone } from '../geoip/models';
import { showGeoIpDossierForAddress } from '../geoip/GeoIpDossier';
import { showLoginEventDetail } from './LoginEventDetail';
import { showUserDeviceLocationDetail } from './UserDeviceLocationDetail';
import {
    DEVICE_LOCATION_VIEW_PERMS, LOGIN_EVENT_VIEW_PERMS,
    LoginEventModel, UserDeviceLocationModel, UserDeviceModel,
    browserLabel, browserVersion, daysActive, deviceIcon, deviceLabel,
    osLabel, osVersion, presenceOf, useDeviceSiblings, useUserDeviceSessions,
    type UserDeviceRow,
} from './models';

const DASH = <span className="dim-italic">—</span>;

/** parse_user_agent emits no screen/locale/timezone block. The rows stay so
 *  the shape is documented, but they render an honest em dash rather than
 *  pretending a field that never arrives is merely empty. */
const NOT_COLLECTED = <span className="dim-italic" title="parse_user_agent does not collect this">—</span>;

function presenceChip(row: UserDeviceRow): Chip {
    const presence = presenceOf(row.last_seen);
    if (presence === 'online') return { icon: 'bi-circle-fill', text: 'Online', tone: 'success' };
    if (presence === 'never') return { icon: 'bi-circle', text: 'Never seen', tone: 'muted' };
    return { icon: 'bi-circle', text: 'Offline', tone: 'muted' };
}

// ── Sections ──────────────────────────────────────────────────────────

function LocationsSection({ deviceId, canView }: { deviceId: number; canView: boolean }) {
    const query = UserDeviceLocationModel.useList(
        { user_device: deviceId, size: 25, sort: '-last_seen' },
        { enabled: canView },
    );
    const rows = query.data?.rows ?? [];
    return (
        <>
            <Eyebrow>Locations</Eyebrow>
            {!canView && <p className="dim-italic">You do not have permission to read device locations.</p>}
            {canView && query.isPending && <p className="dim">Loading locations…</p>}
            {canView && query.error && <p className="text-bad">{query.error.message}</p>}
            {canView && !query.isPending && !rows.length && <p className="dim-italic">No locations recorded for this device.</p>}
            {rows.map((row) => {
                const geo = row.geolocation;
                const place = [geo?.city, geo?.region].filter(Boolean).join(', ') || geo?.country_name || 'Unknown location';
                return (
                    <button
                        key={row.id}
                        type="button"
                        className="ud-loc-row"
                        onClick={() => showUserDeviceLocationDetail(row.id)}
                    >
                        <span className="ud-loc-main">
                            <span className="ud-loc-title">
                                <i className="bi bi-geo-alt" /> {place}
                                {geo?.country_name && <span className="dim"> · {countryFlag(geo.country_code)} {geo.country_name}</span>}
                            </span>
                            <span className="ud-loc-meta">
                                <code>{row.ip_address}</code>
                                {(geo?.isp || geo?.asn_org) && <> · {geo?.isp || geo?.asn_org}</>}
                                {geo?.is_vpn && <Badge tone="warning">VPN</Badge>}
                                {geo?.is_tor && <Badge tone="danger">Tor</Badge>}
                                {geo?.is_proxy && <Badge tone="warning">Proxy</Badge>}
                                {geo?.is_cloud && <Badge tone="info">Cloud</Badge>}
                            </span>
                        </span>
                        <span className="ud-loc-when" title={fmt.datetime(row.last_seen)}>{fmt.relative(row.last_seen)}</span>
                    </button>
                );
            })}
        </>
    );
}

function LoginsSectionBody({ deviceId, canView }: { deviceId: number; canView: boolean }) {
    const query = LoginEventModel.useList(
        { device: deviceId, size: 25, sort: '-created', graph: 'list' },
        { enabled: canView },
    );
    const rows = query.data?.rows ?? [];
    // Display-only day grouping — the order stays the server's.
    const groups: { label: string; rows: typeof rows }[] = [];
    for (const row of rows) {
        const label = fmt.date(row.created);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.rows.push(row);
        else groups.push({ label, rows: [row] });
    }
    return (
        <>
            <Eyebrow>Logins from this device</Eyebrow>
            {!canView && <p className="dim-italic">You do not have permission to read login events.</p>}
            {canView && query.isPending && <p className="dim">Loading logins…</p>}
            {canView && query.error && <p className="text-bad">{query.error.message}</p>}
            {canView && !query.isPending && !rows.length && (
                <p className="dim-italic">No logins are linked to this device record.</p>
            )}
            {groups.map((group) => (
                <div key={group.label}>
                    <div className="us-day-head">{group.label}</div>
                    {group.rows.map((row) => (
                        <button key={row.id} type="button" className="ud-loc-row" onClick={() => showLoginEventDetail(row.id)}>
                            <span className="ud-loc-main">
                                <span className="ud-loc-title">
                                    {[row.city, row.region, row.country_code].filter(Boolean).join(', ') || 'Unknown location'}
                                    {row.is_new_country && <Badge tone="danger">New country</Badge>}
                                    {!row.is_new_country && row.is_new_region && <Badge tone="warning">New region</Badge>}
                                </span>
                                <span className="ud-loc-meta">
                                    {row.ip_address && <code>{row.ip_address}</code>}
                                    {row.source && <> · {row.source}</>}
                                </span>
                            </span>
                            <span className="ud-loc-when" title={fmt.datetime(row.created)}>{fmt.relative(row.created)}</span>
                        </button>
                    ))}
                </div>
            ))}
        </>
    );
}

function SessionsSection({ device, canBouncer }: { device: UserDeviceRow; canBouncer: boolean }) {
    const { data, isPending, error } = useUserDeviceSessions(device.id, Boolean(device.muid));
    // Resolve the BouncerDevice row so "Open Bouncer device" has an id.
    const bouncer = BouncerDeviceModel.useList(
        { muid: device.muid ?? '', size: 1 },
        { enabled: canBouncer && Boolean(device.muid) },
    );
    const bouncerRow = bouncer.data?.rows?.[0];

    if (!device.muid) {
        return (
            <>
                <Eyebrow>Sessions</Eyebrow>
                <p className="dim-italic">
                    This device predates the Bouncer MUID cookie, so no pre-auth reputation or
                    session grouping is available for it. Sharing falls back to the DUID.
                </p>
            </>
        );
    }

    return (
        <>
            <Eyebrow>Pre-auth reputation</Eyebrow>
            {isPending && <p className="dim">Loading sessions…</p>}
            {error && <p className="text-bad">{error.message}</p>}
            {data?.bouncer_device
                ? (
                    <>
                        <FlatRow label="Risk tier"><Badge tone={data.bouncer_device.risk_tier === 'low' ? 'success' : data.bouncer_device.risk_tier === 'medium' ? 'warning' : data.bouncer_device.risk_tier === 'unknown' ? 'muted' : 'danger'}>{data.bouncer_device.risk_tier.toUpperCase()}</Badge></FlatRow>
                        <FlatRow label="Signals seen">{data.bouncer_device.event_count}</FlatRow>
                        <FlatRow label="Blocks">{data.bouncer_device.block_count}</FlatRow>
                        <FlatRow label="Fingerprint">{data.bouncer_device.fingerprint_id ? <code>{data.bouncer_device.fingerprint_id}</code> : DASH}</FlatRow>
                        <FlatRow label="First seen">{fmt.datetime(data.bouncer_device.first_seen)}</FlatRow>
                        {canBouncer && bouncerRow && (
                            <div className="geoip-actions">
                                <button className="btn btn-compact" onClick={() => showBouncerDeviceDetail(bouncerRow.id)}>
                                    <i className="bi bi-fingerprint" /> Open Bouncer device
                                </button>
                            </div>
                        )}
                    </>
                )
                : !isPending && <p className="dim-italic">No pre-auth Bouncer record for this MUID.</p>}

            <Eyebrow>Active sessions (last 24h)</Eyebrow>
            {!isPending && !(data?.active_sessions ?? []).length && (
                <p className="dim-italic">No browser sessions recorded in the last 24 hours.</p>
            )}
            {(data?.active_sessions ?? []).map((session) => (
                <div key={session.msid} className="ud-session">
                    <div className="ud-session-head">
                        <code title={session.msid}>{fmt.truncateMiddle(session.msid, 16)}</code>
                        <span className="dim">{session.ip || '—'}</span>
                        <span className="dim">{session.signal_count} signal{session.signal_count === 1 ? '' : 's'}</span>
                        <span className="ud-loc-when">{fmt.relative(session.last_activity)}</span>
                    </div>
                    <div className="ud-session-meta dim">
                        Started {fmt.datetime(session.started)}
                        {session.tabs.length > 0 && <> · {session.tabs.length} tab{session.tabs.length === 1 ? '' : 's'}</>}
                    </div>
                    {session.tabs.length > 0 && (
                        <ul className="ud-session-tabs">
                            {session.tabs.map((tab) => (
                                <li key={tab.mtab}>
                                    <code>{fmt.truncateMiddle(tab.mtab, 12)}</code>
                                    <span className="dim">{tab.signal_count} signal{tab.signal_count === 1 ? '' : 's'} · last {fmt.relative(tab.last_activity)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ))}

            <Eyebrow>Recent locations</Eyebrow>
            {!isPending && !(data?.recent_locations ?? []).length && (
                <p className="dim-italic">No recent locations on the sessions graph.</p>
            )}
            {(data?.recent_locations ?? []).map((loc) => (
                <FlatRow key={`${loc.ip_address}-${loc.first_seen}`} label={loc.ip_address}>
                    {[loc.city, loc.country].filter(Boolean).join(', ') || <span className="dim">Unenriched</span>}
                    <span className="dim"> · last seen {fmt.relative(loc.last_seen)}</span>
                </FlatRow>
            ))}
        </>
    );
}

/** "Is this device shared across accounts?" — the item's headline question. */
function SharedSection({ device, onOpenUser }: { device: UserDeviceRow; onOpenUser?: (userId: number) => void }) {
    const { siblings, isPending, error } = useDeviceSiblings(device);
    return (
        <>
            <Eyebrow>Shared across accounts</Eyebrow>
            <FlatRow label="Matched on">
                {device.muid ? <>MUID <code>{device.muid}</code></> : <>DUID <code>{device.duid}</code> <span className="dim">(no MUID on this row)</span></>}
            </FlatRow>
            {isPending && <p className="dim">Looking for sibling device records…</p>}
            {error && <p className="text-bad">{error.message}</p>}
            {!isPending && !siblings.length && (
                <p className="dim-italic">This device is only linked to one account.</p>
            )}
            {siblings.map((sibling) => (
                <button key={sibling.id} type="button" className="ud-loc-row" onClick={() => showUserDeviceDetail(sibling.id)}>
                    <span className="ud-loc-main">
                        <span className="ud-loc-title">
                            <i className={`bi ${deviceIcon(sibling.device_info)}`} />
                            {sibling.user?.display_name || sibling.user?.username || `User #${sibling.id}`}
                        </span>
                        <span className="ud-loc-meta">
                            {browserLabel(sibling.device_info)} on {osLabel(sibling.device_info)}
                            {sibling.last_ip && <> · <code>{sibling.last_ip}</code></>}
                        </span>
                    </span>
                    <span className="ud-loc-when">{fmt.relative(sibling.last_seen)}</span>
                </button>
            ))}
            {siblings.length > 0 && onOpenUser && (
                <p className="dim ud-shared-hint">
                    Sharing a device identity across accounts is normal for shared machines and
                    suspicious for unrelated users — open each owner to judge.
                </p>
            )}
        </>
    );
}

// ── The dossier ───────────────────────────────────────────────────────

export function UserDeviceDetail({ id, onClose, onOpenUser }: {
    id: number;
    onClose: () => void;
    onOpenUser?: (userId: number) => void;
}) {
    const qc = useQueryClient();
    const { data: device, isPending, error } = UserDeviceModel.useOne(id);
    const canLocations = useCan(DEVICE_LOCATION_VIEW_PERMS).can;
    const canLogins = useCan(LOGIN_EVENT_VIEW_PERMS).can;
    const canBouncer = useCan(BOUNCER_VIEW_PERMS).can;
    const canGeoIp = useCan(GEOIP_VIEW_PERMS).can;

    // Real counts replacing the phantom `session_count` / `location_count`.
    const locationCount = UserDeviceLocationModel.useList(
        { user_device: id, size: 0 },
        { enabled: canLocations },
    ).data?.count;
    const loginCount = LoginEventModel.useList(
        { device: id, size: 0 },
        { enabled: canLogins },
    ).data?.count;
    const { siblings } = useDeviceSiblings(device);
    // The most recent location supplies the threat signals the source read
    // off a `device_info.last_geo` block the wire never sends.
    const latestLocation = UserDeviceLocationModel.useList(
        { user_device: id, size: 1, sort: '-last_seen' },
        { enabled: canLocations },
    ).data?.rows?.[0];

    if (isPending) return <div className="modal-pad dim">Loading device…</div>;
    if (!device || error) return <div className="modal-pad text-bad">{error?.message ?? 'Device not found'}</div>;

    const info = device.device_info;
    const geo = latestLocation?.geolocation ?? null;
    const days = daysActive(device);

    const subtitle = [
        device.last_seen != null ? `Last seen ${fmt.relative(device.last_seen)}` : 'Never seen',
        device.last_ip ? `from ${device.last_ip}` : null,
        geo ? `· ${[geo.city, geo.country_name].filter(Boolean).join(', ')}` : null,
        device.user?.display_name ? `· owner ${device.user.display_name}` : null,
    ].filter(Boolean).join(' ');

    const chips: Chip[] = [
        presenceChip(device),
        { icon: 'bi-window', text: browserLabel(info), tone: 'info' },
        { text: osLabel(info) },
        ...(locationCount != null ? [{ text: `${locationCount} location${locationCount === 1 ? '' : 's'}` }] : []),
        ...(loginCount != null ? [{ text: `${loginCount} login${loginCount === 1 ? '' : 's'}` }] : []),
        ...(siblings.length ? [{ icon: 'bi-people', text: `Shared across ${siblings.length + 1} accounts`, tone: 'warning' as const }] : []),
        ...(geo?.is_vpn ? [{ icon: 'bi-shield-shaded', text: 'VPN', tone: 'warning' as const }] : []),
        ...(geo?.is_tor ? [{ icon: 'bi-shield-lock', text: 'Tor', tone: 'danger' as const }] : []),
        ...(geo?.is_proxy ? [{ icon: 'bi-diagram-3', text: 'Proxy', tone: 'warning' as const }] : []),
        ...(geo?.is_cloud ? [{ icon: 'bi-cloud', text: 'Cloud', tone: 'info' as const }] : []),
    ];

    const copy = (label: string, value: string) => {
        void navigator.clipboard?.writeText(value)
            .then(() => toast.success(`${label} copied`))
            .catch(() => toast.error(`Could not copy ${label.toLowerCase()}`));
    };

    return (
        <DetailView
            icon={deviceIcon(info)}
            title={`${browserLabel(info)} on ${osLabel(info)}`}
            subtitle={subtitle}
            chips={chips}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Overview</Eyebrow>
                            <div className="geoip-kpis">
                                <MetricCard label="Locations" value={canLocations ? (locationCount ?? '—') : '—'} icon="bi-geo-alt" />
                                <MetricCard label="Logins" value={canLogins ? (loginCount ?? '—') : '—'} icon="bi-box-arrow-in-right" />
                                <MetricCard label="Days active" value={days ?? '—'} icon="bi-calendar-range" />
                                <MetricCard label="Last seen" value={device.last_seen != null ? fmt.relative(device.last_seen) : 'Never'} icon="bi-clock-history" />
                            </div>

                            <Eyebrow>Threat signals</Eyebrow>
                            {/* NO trust row: `is_trusted` does not exist on
                                UserDevice, so the source's first timeline
                                entry reported a field it invented. */}
                            <Timeline
                                items={[
                                    {
                                        tone: geo?.is_vpn ? 'warning' : 'success',
                                        title: geo?.is_vpn ? 'VPN detected' : 'No VPN signal',
                                        meta: latestLocation ? fmt.relative(latestLocation.last_seen) : '—',
                                        body: geo?.is_vpn ? 'The most recent location resolved to a VPN exit.' : undefined,
                                    },
                                    {
                                        tone: geo?.is_tor ? 'danger' : 'success',
                                        title: geo?.is_tor ? 'Seen from a Tor exit' : 'No Tor signal',
                                        meta: latestLocation ? fmt.relative(latestLocation.last_seen) : '—',
                                        body: geo?.is_tor ? 'Recent activity routed through the Tor network.' : undefined,
                                    },
                                    ...(geo?.is_proxy ? [{
                                        tone: 'warning' as const,
                                        title: 'Open proxy detected',
                                        meta: fmt.relative(latestLocation!.last_seen),
                                        body: 'The most recent location went through an open proxy.',
                                    }] : []),
                                    ...(geo?.threat_level ? [{
                                        tone: threatTone(geo.threat_level) as Tone,
                                        title: `Last IP threat level: ${geo.threat_level}`,
                                        meta: fmt.relative(latestLocation!.last_seen),
                                        body: <>Risk score {geo.risk_score ?? '—'} / 100 on <code>{latestLocation!.ip_address}</code></>,
                                    }] : []),
                                    {
                                        tone: 'info',
                                        title: 'Geo footprint',
                                        meta: 'live',
                                        body: locationCount != null
                                            ? <>{locationCount} distinct location{locationCount === 1 ? '' : 's'}{geo?.country_name ? <> · last from {geo.country_name}</> : null}</>
                                            : 'Location history is not visible to you.',
                                    },
                                    {
                                        tone: 'muted',
                                        title: 'Device fingerprint',
                                        meta: device.first_seen != null ? fmt.relative(device.first_seen) : '',
                                        body: <>DUID <code>{device.duid}</code>{device.muid ? <> · MUID <code>{device.muid}</code></> : null}</>,
                                    },
                                ]}
                            />
                        </>
                    ),
                },
                {
                    key: 'hardware', label: 'Hardware', icon: 'bi-cpu', render: () => (
                        <>
                            <Eyebrow>Browser</Eyebrow>
                            <FlatRow label="Family">{info?.user_agent.family || DASH}</FlatRow>
                            <FlatRow label="Version">{browserVersion(info) || DASH}</FlatRow>

                            <Eyebrow>Operating system</Eyebrow>
                            <FlatRow label="Family">{info?.os.family || DASH}</FlatRow>
                            <FlatRow label="Version">{osVersion(info) || DASH}</FlatRow>

                            <Eyebrow>Hardware</Eyebrow>
                            <FlatRow label="Brand">{info?.device.brand || DASH}</FlatRow>
                            <FlatRow label="Family">{info?.device.family || DASH}</FlatRow>
                            <FlatRow label="Model">{info?.device.model || DASH}</FlatRow>
                            <FlatRow label="Summary">{deviceLabel(info)}</FlatRow>

                            <Eyebrow>Display &amp; environment</Eyebrow>
                            {/* `parse_user_agent` emits os/device/user_agent/
                                string and nothing else — screen, locale and
                                timezone are never collected server-side. */}
                            <FlatRow label="Resolution">{NOT_COLLECTED}</FlatRow>
                            <FlatRow label="Locale">{NOT_COLLECTED}</FlatRow>
                            <FlatRow label="Timezone">{NOT_COLLECTED}</FlatRow>

                            <Eyebrow>Identification</Eyebrow>
                            <FlatRow label="Device ID (DUID)"><code>{device.duid}</code></FlatRow>
                            <FlatRow label="Managed ID (MUID)">{device.muid ? <code>{device.muid}</code> : <span className="dim-italic">— (pre-Bouncer device)</span>}</FlatRow>
                            <FlatRow label="User-agent hash">{device.user_agent_hash ? <code title={device.user_agent_hash}>{fmt.truncateMiddle(device.user_agent_hash, 20)}</code> : DASH}</FlatRow>
                            <FlatRow label="Last IP">
                                {device.last_ip
                                    ? (canGeoIp
                                        ? <button className="btn-link" onClick={() => showGeoIpDossierForAddress(device.last_ip!)}><code>{device.last_ip}</code></button>
                                        : <code>{device.last_ip}</code>)
                                    : DASH}
                            </FlatRow>
                            <FlatRow label="First seen"><code>{fmt.datetime(device.first_seen)}</code></FlatRow>
                            <FlatRow label="Last seen"><code>{fmt.datetime(device.last_seen)}</code></FlatRow>

                            {info?.string && (
                                <>
                                    <Eyebrow>User agent</Eyebrow>
                                    <pre className="ud-ua-block">{info.string}</pre>
                                </>
                            )}
                        </>
                    ),
                },
                { divider: 'Activity' },
                {
                    key: 'locations', label: 'Locations', icon: 'bi-geo-alt',
                    render: () => <LocationsSection deviceId={id} canView={canLocations} />,
                },
                {
                    key: 'logins', label: 'Logins', icon: 'bi-box-arrow-in-right',
                    render: () => <LoginsSectionBody deviceId={id} canView={canLogins} />,
                },
                {
                    key: 'sessions', label: 'Sessions', icon: 'bi-clock-history',
                    render: () => <SessionsSection device={device} canBouncer={canBouncer} />,
                },
                {
                    key: 'shared', label: 'Shared', icon: 'bi-people',
                    render: () => <SharedSection device={device} onOpenUser={onOpenUser} />,
                },
                { divider: 'Detail' },
                {
                    key: 'metadata', label: 'Metadata', icon: 'bi-braces', render: () => (
                        <>
                            <Eyebrow>Metadata</Eyebrow>
                            {/* UserDevice has no `metadata` field — the source
                                read one that does not exist. The record is the
                                blob. */}
                            <KnownFieldsCard
                                data={device as unknown as Record<string, unknown>}
                                known={[
                                    { key: 'id', label: 'Record ID' },
                                    { key: 'duid', label: 'DUID' },
                                    { key: 'muid', label: 'MUID', hideEmpty: true },
                                    { key: 'user.display_name', label: 'Owner', hideEmpty: true },
                                    { key: 'first_seen', label: 'First seen', format: 'datetime' },
                                    { key: 'last_seen', label: 'Last seen', format: 'datetime' },
                                ]}
                                rawLabel="Raw device record"
                            />
                        </>
                    ),
                },
            ]}
            initialSection="overview"
            contextMenu={[
                ...(device.user && onOpenUser
                    ? [{ label: 'View user', icon: 'bi-person', onSelect: () => onOpenUser(device.user!.id) }]
                    : []),
                ...(device.last_ip && canGeoIp
                    ? [{ label: 'Look up last IP', icon: 'bi-globe2', onSelect: () => showGeoIpDossierForAddress(device.last_ip!) }]
                    : []),
                { divider: true },
                { label: 'Copy DUID', icon: 'bi-clipboard', onSelect: () => copy('DUID', device.duid) },
                ...(device.muid
                    ? [{ label: 'Copy MUID', icon: 'bi-clipboard', onSelect: () => copy('MUID', device.muid!) }]
                    : []),
                {
                    label: 'Refresh record', icon: 'bi-arrow-repeat',
                    onSelect: () => { void qc.invalidateQueries({ queryKey: UserDeviceModel.keys.one(device.id) }); },
                },
                // NO "Forget device" and NO trust toggle — UserDevice declares
                // neither CAN_DELETE nor an `is_trusted` field.
            ]}
            onClose={onClose}
        />
    );
}

export function showUserDeviceDetail(id: number, opts: { onOpenUser?: (userId: number) => void } = {}): void {
    void modal.detail((close) => <UserDeviceDetail id={id} onClose={() => close(null)} {...opts} />);
}

/**
 * Open a device by DUID. The `basic` UserDevice sub-graph embedded on
 * location and login rows carries no `id`, so cross-links from those surfaces
 * have to resolve through the list endpoint first.
 */
export function DeviceByDuid({ duid, onClose }: { duid: string; onClose: () => void }) {
    const { data, isPending, error } = UserDeviceModel.useList({ duid, size: 1 });
    const row = data?.rows?.[0];
    if (isPending) return <div className="modal-pad dim">Resolving device…</div>;
    if (error) return <div className="modal-pad text-bad">{error.message}</div>;
    if (!row) {
        return (
            <div className="modal-pad">
                <h2 className="modal-title">Device not found</h2>
                <p className="dim">No device record matches DUID <code>{duid}</code>.</p>
                <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
            </div>
        );
    }
    return <UserDeviceDetail id={row.id} onClose={onClose} />;
}

export function showUserDeviceDetailByDuid(duid: string): void {
    void modal.detail((close) => <DeviceByDuid duid={duid} onClose={() => close(null)} />);
}
