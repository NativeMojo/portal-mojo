// GeoIpDossier — the GeoIPView port (web-mojo 1255 lines, read in full),
// presented as a KISS `modal.detail` (#1425). `DetailView` already IS a rail
// plus a body, so the size is handled by seven rail entries, one tabbed
// Activity section and a collapsed raw reveal — not by a new presentation.
//
// Owned for the wave: #1287 imports `GeoIpDossier`, `showGeoIpDossier` and
// `showGeoIpDossierForAddress` rather than building its own IP inspector.
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    ArmedButton, Badge, DetailView, Eyebrow, FlatRow, KnownFieldsCard, StatusPanel,
    MetricCard, formModal, fmt, modal, toast,
    type Chip, type Tone,
} from '../../../ui';
import { WorldMap, useWorldLand } from '../../../charts';
import { useCan } from '../../../client';
import { EventModel } from '../../incidents/models';
import { SECURITY_VIEW_PERMS } from '../../security-permissions';
import { LogModel, LOGS_ADMIN_PERMISSIONS } from '../../monitoring/models';
import {
    DEVICE_LOCATION_VIEW_PERMS, LOGIN_EVENT_VIEW_PERMS,
    LoginEventModel, UserDeviceLocationModel,
} from '../devices/models';
import {
    GEOIP_BLOCK_FIELDS, GEOIP_EDIT_LOCATION_FIELDS, GEOIP_EDIT_NETWORK_FIELDS,
    GEOIP_EDIT_SECURITY_FIELDS, GEOIP_UNBLOCK_FIELDS, GEOIP_WHITELIST_FIELDS,
} from './geoip-forms';
import {
    GEOIP_MANAGE_PERMS, GeoLocatedIPModel,
    blockActive, blockExpired, countryFlag, threatTone, useGeoIpByAddress,
    useGeoIpRawRecord, whitelistActive, whitelistExpired,
    type GeoLocatedIPRow,
} from './models';

// ── Small shared bits ─────────────────────────────────────────────────

const DASH = <span className="dim-italic">—</span>;

function text(value: string | number | null | undefined): ReactNode {
    return value == null || value === '' ? DASH : value;
}

function YesNo({ value }: { value: boolean | null | undefined }) {
    return value
        ? <span className="text-bad"><i className="bi bi-check-circle-fill" /> Yes</span>
        : <span className="dim"><i className="bi bi-dash-circle" /> No</span>;
}

function CountryLabel({ row }: { row: GeoLocatedIPRow }) {
    const flag = countryFlag(row.country_code);
    if (!row.country_code && !row.country_name) return DASH;
    return (
        <>
            {flag && <span className="geoip-flag">{flag}</span>}
            {row.country_name || row.country_code}
            {row.country_code && <code className="dim geoip-cc">{row.country_code}</code>}
        </>
    );
}

/** The header's synthetic subtitle (`_refreshComputedFields`), minus the
 *  `reverse ${reverse_dns}` fragment — that field does not exist. */
function subtitleOf(row: GeoLocatedIPRow): string {
    const parts: string[] = [];
    const place = [row.city, row.region, row.country_name].filter(Boolean).join(', ');
    if (place) parts.push(place);
    if (row.asn || row.isp) {
        const asn = row.asn ? `ASN ${row.asn}` : '';
        const isp = row.isp ? ` (${row.isp})` : '';
        parts.push(`${asn}${isp}`.trim());
    }
    if (row.subnet) parts.push(`subnet ${row.subnet}`);
    return parts.join(' · ');
}

/** GeoIPView's `iconToneFn`, with expiry-aware block state. */
function iconTone(row: GeoLocatedIPRow): Tone {
    const level = String(row.threat_level ?? '').toLowerCase();
    if (blockActive(row) || row.is_threat || ['high', 'critical'].includes(level)) return 'danger';
    if (row.is_suspicious || level === 'medium') return 'warning';
    return 'info';
}

/** `_statusTone` / `_statusState` / `_statusHeadline` / `_statusMeta`, ported
 *  with `blockActive`/`whitelistActive` replacing the raw booleans. */
function statusOf(row: GeoLocatedIPRow): { tone: Tone; state: string; headline: string; meta: ReactNode } {
    const level = String(row.threat_level ?? '').toLowerCase();
    const blocked = blockActive(row);
    const whitelisted = whitelistActive(row);

    if (blocked) {
        return {
            tone: 'danger',
            state: 'Blocked',
            headline: row.blocked_reason ? `Blocked: ${row.blocked_reason}` : 'Currently blocked',
            meta: (
                <>
                    Blocked {row.blocked_until != null
                        ? <>until <strong>{fmt.datetime(row.blocked_until)}</strong></>
                        : 'permanently'}
                    {row.blocked_at != null && <> · {fmt.relative(row.blocked_at)}</>}
                </>
            ),
        };
    }
    if (whitelisted) {
        return {
            tone: 'success',
            state: 'Whitelisted',
            headline: row.whitelisted_reason ? `Whitelisted: ${row.whitelisted_reason}` : 'On whitelist',
            meta: row.whitelisted_until != null
                ? <>This IP bypasses the firewall until <strong>{fmt.datetime(row.whitelisted_until)}</strong></>
                : 'This IP bypasses the firewall',
        };
    }

    const scoreMeta: ReactNode = (
        <>
            Risk score <strong>{row.risk_score ?? '—'}</strong>
            {row.last_seen != null && <> · last seen {fmt.relative(row.last_seen)}</>}
            {blockExpired(row) && <> · <span className="text-warn">previous block expired</span></>}
            {whitelistExpired(row) && <> · <span className="text-warn">whitelist expired</span></>}
        </>
    );

    if (row.is_threat || ['high', 'critical'].includes(level)) {
        return { tone: 'danger', state: 'Allowed · high risk', headline: `Active threat (${level || 'high'})`, meta: scoreMeta };
    }
    if (row.is_suspicious || level === 'medium') {
        const flags: string[] = [];
        if (row.is_vpn) flags.push('VPN');
        if (row.is_tor) flags.push('Tor');
        if (row.is_proxy) flags.push('proxy');
        if (row.is_datacenter) flags.push('datacenter');
        return {
            tone: 'warning',
            state: 'Allowed · elevated risk',
            headline: flags.length ? `${flags.join(' / ')} signal detected` : `Suspicious${level ? ` · ${level}` : ''}`,
            meta: scoreMeta,
        };
    }
    return { tone: 'success', state: 'Allowed', headline: 'No active threat signals', meta: scoreMeta };
}

/** `firedFlags` from GeoIPView.js:519-538 — descriptions carried verbatim. */
const REPUTATION_FLAGS: readonly { key: keyof GeoLocatedIPRow; label: string; icon: string; tone: Tone; title: string; detail: string }[] = [
    { key: 'is_threat', label: 'Threat', icon: 'bi-shield-exclamation', tone: 'danger', title: 'Active threat', detail: 'Marked as an active threat' },
    { key: 'is_suspicious', label: 'Suspicious', icon: 'bi-question-octagon', tone: 'warning', title: 'Suspicious', detail: 'Flagged suspicious by enrichment' },
    { key: 'is_known_attacker', label: 'Attacker', icon: 'bi-exclamation-octagon-fill', tone: 'danger', title: 'Known attacker', detail: 'Recorded in attacker feeds' },
    { key: 'is_known_abuser', label: 'Abuser', icon: 'bi-exclamation-triangle-fill', tone: 'danger', title: 'Known abuser', detail: 'Recorded in abuse feeds' },
    { key: 'is_vpn', label: 'VPN', icon: 'bi-shield-shaded', tone: 'warning', title: 'VPN exit', detail: 'Detected as a VPN exit node' },
    { key: 'is_tor', label: 'Tor', icon: 'bi-shield-lock', tone: 'danger', title: 'Tor exit', detail: 'Detected as a Tor exit node' },
    { key: 'is_proxy', label: 'Proxy', icon: 'bi-diagram-3', tone: 'warning', title: 'Open proxy', detail: 'Detected as an open proxy' },
];

function chipsOf(row: GeoLocatedIPRow): Chip[] {
    const chips: Chip[] = [];
    const flag = countryFlag(row.country_code);
    if (row.country_code || row.country_name) {
        chips.push({ text: `${flag ? `${flag} ` : ''}${row.country_name || row.country_code}`.trim() });
    }
    const level = String(row.threat_level ?? '').toLowerCase();
    if (level) {
        chips.push({
            icon: threatTone(level) === 'danger' ? 'bi-exclamation-triangle-fill' : 'bi-shield-check',
            text: `Threat: ${row.threat_level}`,
            tone: threatTone(level) as Tone,
        });
    }
    if (row.risk_score != null) chips.push({ text: `Risk score ${row.risk_score}` });
    if (row.is_vpn) chips.push({ icon: 'bi-shield-shaded', text: 'VPN', tone: 'warning' });
    if (row.is_tor) chips.push({ icon: 'bi-shield-lock', text: 'Tor', tone: 'danger' });
    if (row.is_proxy) chips.push({ icon: 'bi-diagram-3', text: 'Proxy', tone: 'warning' });
    if (row.is_cloud) chips.push({ icon: 'bi-cloud-fill', text: 'Cloud', tone: 'info' });
    if (row.is_datacenter) chips.push({ icon: 'bi-hdd-stack', text: 'Datacenter', tone: 'warning' });
    if (row.is_mobile) chips.push({ icon: 'bi-phone', text: 'Mobile', tone: 'info' });
    if (blockActive(row)) chips.push({ icon: 'bi-slash-circle', text: 'Blocked', tone: 'danger' });
    if (whitelistActive(row)) chips.push({ icon: 'bi-shield-check', text: 'Whitelisted', tone: 'success' });
    return chips;
}

// ── Activity tabs ─────────────────────────────────────────────────────

function LocalTable({ headers, children, empty, pending, error }: {
    headers: string[];
    children: ReactNode;
    empty: boolean;
    pending: boolean;
    error: Error | null;
}) {
    if (pending) return <p className="dim">Loading…</p>;
    if (error) return <p className="text-bad">{error.message}</p>;
    if (empty) return <p className="dim-italic">Nothing recorded for this IP.</p>;
    return (
        <div className="geoip-local-table">
            <table className="tbl">
                <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    );
}

function EventsTab({ ip }: { ip: string }) {
    const query = EventModel.useList({ source_ip: ip, size: 25, sort: '-created' });
    const rows = query.data?.rows ?? [];
    return (
        <LocalTable headers={['Date', 'Level', 'Category', 'Details']} empty={!rows.length} pending={query.isPending} error={query.error}>
            {rows.map((row) => (
                <tr key={row.id}>
                    <td>{fmt.datetime(row.created)}</td>
                    <td><Badge tone={row.level >= 8 ? 'danger' : row.level >= 4 ? 'warning' : 'muted'}>L{row.level}</Badge></td>
                    <td><code>{row.category}</code></td>
                    <td>{fmt.truncate(row.title || row.details || '—', 70)}</td>
                </tr>
            ))}
        </LocalTable>
    );
}

function LogsTab({ ip }: { ip: string }) {
    const query = LogModel.useList({ ip, size: 25, sort: '-created' });
    const rows = query.data?.rows ?? [];
    return (
        <LocalTable headers={['Timestamp', 'Level', 'Kind', 'Log']} empty={!rows.length} pending={query.isPending} error={query.error}>
            {rows.map((row) => (
                <tr key={row.id}>
                    <td>{fmt.datetime(row.created)}</td>
                    <td>{row.level}</td>
                    <td>{row.kind || '—'}</td>
                    <td>{fmt.truncate(row.log || row.path || '—', 70)}</td>
                </tr>
            ))}
        </LocalTable>
    );
}

/** NEW vs the source, and half of "who else used this IP". */
function LoginsTab({ ip, onOpenLogin }: { ip: string; onOpenLogin?: (id: number) => void }) {
    const query = LoginEventModel.useList({ ip_address: ip, size: 25, sort: '-created', graph: 'list' });
    const rows = query.data?.rows ?? [];
    return (
        <LocalTable headers={['When', 'User', 'Where', 'Source', 'New']} empty={!rows.length} pending={query.isPending} error={query.error}>
            {rows.map((row) => (
                <tr key={row.id} className={onOpenLogin ? 'row-click' : undefined} onClick={onOpenLogin ? () => onOpenLogin(row.id) : undefined}>
                    <td>{fmt.datetime(row.created)}</td>
                    <td>{row.user?.display_name || row.user?.username || '—'}</td>
                    <td>{[row.city, row.region].filter(Boolean).join(', ') || '—'}</td>
                    <td>{row.source || '—'}</td>
                    <td>{row.is_new_country ? <Badge tone="danger">Country</Badge> : row.is_new_region ? <Badge tone="warning">Region</Badge> : '—'}</td>
                </tr>
            ))}
        </LocalTable>
    );
}

/** The other half — which devices have been seen on this address. */
function DevicesTab({ ip, onOpenLocation }: { ip: string; onOpenLocation?: (id: number) => void }) {
    const query = UserDeviceLocationModel.useList({ ip_address: ip, size: 25, sort: '-last_seen' });
    const rows = query.data?.rows ?? [];
    return (
        <LocalTable headers={['Owner', 'Device', 'First seen', 'Last seen']} empty={!rows.length} pending={query.isPending} error={query.error}>
            {rows.map((row) => (
                <tr key={row.id} className={onOpenLocation ? 'row-click' : undefined} onClick={onOpenLocation ? () => onOpenLocation(row.id) : undefined}>
                    <td>{row.user?.display_name || row.user?.username || '—'}</td>
                    <td><code title={row.user_device?.duid}>{fmt.truncateMiddle(row.user_device?.duid ?? '—', 16)}</code></td>
                    <td>{fmt.relative(row.first_seen)}</td>
                    <td>{fmt.relative(row.last_seen)}</td>
                </tr>
            ))}
        </LocalTable>
    );
}

/**
 * Each tab carries its OWN backend gate — the section is not gated as a
 * whole, because the four tabs answer to four different endpoints. An
 * operator holding only `sys.users` can read the Logins and Devices tabs but
 * not Events or Logs, and must see exactly that rather than nothing.
 */
function ActivitySection({ ip, canEvents, canLogs, canLogins, canDevices, onOpenLogin, onOpenLocation }: {
    ip: string;
    canEvents: boolean;
    canLogs: boolean;
    canLogins: boolean;
    canDevices: boolean;
    onOpenLogin?: (id: number) => void;
    onOpenLocation?: (id: number) => void;
}) {
    const tabs = [
        ...(canEvents ? [{ key: 'events', label: 'Events', render: () => <EventsTab ip={ip} /> }] : []),
        ...(canLogs ? [{ key: 'logs', label: 'Logs', render: () => <LogsTab ip={ip} /> }] : []),
        ...(canLogins ? [{ key: 'logins', label: 'Logins', render: () => <LoginsTab ip={ip} onOpenLogin={onOpenLogin} /> }] : []),
        ...(canDevices ? [{ key: 'devices', label: 'Devices', render: () => <DevicesTab ip={ip} onOpenLocation={onOpenLocation} /> }] : []),
    ];
    const [tab, setTab] = useState(tabs[0]?.key ?? '');
    const active = tabs.find((t) => t.key === tab) ?? tabs[0];
    if (!active) {
        return (
            <>
                <Eyebrow>Activity</Eyebrow>
                <p className="dim-italic">
                    None of the activity feeds for this IP are readable with your grants.
                </p>
            </>
        );
    }
    return (
        <>
            <Eyebrow>Activity</Eyebrow>
            <div className="us-tabs" role="tablist">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={t.key === active.key}
                        className={`us-tab${t.key === active.key ? ' us-tab-active' : ''}`}
                        onClick={() => setTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {active.render()}
        </>
    );
}

// ── Raw provider record (manage-gated, never cached) ──────────────────

function RawRecordReveal({ id, canManage }: { id: number; canManage: boolean }) {
    const [open, setOpen] = useState(false);
    const { data, isPending, error } = useGeoIpRawRecord(id, canManage && open);
    if (!canManage) {
        return <p className="dim-italic">The raw provider record requires a security-management grant.</p>;
    }
    if (!open) {
        return (
            <button className="btn btn-compact" onClick={() => setOpen(true)}>
                <i className="bi bi-braces" /> Show raw provider record
            </button>
        );
    }
    return (
        <div className="geoip-raw">
            <div className="geoip-raw-head">
                <span className="dim">Provider: <code>{data?.provider || 'unknown'}</code></span>
                <button className="btn btn-compact" onClick={() => setOpen(false)}>Hide</button>
            </div>
            {isPending && <p className="dim">Loading…</p>}
            {error && <p className="text-bad">{error.message}</p>}
            {data && <pre className="geoip-raw-body">{data.text}</pre>}
        </div>
    );
}

// ── The dossier ───────────────────────────────────────────────────────

export interface GeoIpDossierProps {
    id: number;
    onClose: () => void;
    /** Cross-link seams for the consuming surface. */
    onOpenLogin?: (id: number) => void;
    onOpenLocation?: (id: number) => void;
}

export function GeoIpDossier({ id, onClose, onOpenLogin, onOpenLocation }: GeoIpDossierProps) {
    const qc = useQueryClient();
    const { data: row, isPending, error } = GeoLocatedIPModel.useOne(id);
    const canManage = useCan(GEOIP_MANAGE_PERMS).can;
    const canEvents = useCan(SECURITY_VIEW_PERMS).can;
    const canLogs = useCan(LOGS_ADMIN_PERMISSIONS).can;
    const canLogins = useCan(LOGIN_EVENT_VIEW_PERMS).can;
    const canDevices = useCan(DEVICE_LOCATION_VIEW_PERMS).can;

    const save = GeoLocatedIPModel.useSave();
    const blockAction = GeoLocatedIPModel.useAction('block');
    const unblockAction = GeoLocatedIPModel.useAction('unblock');
    const whitelistAction = GeoLocatedIPModel.useAction('whitelist');
    const unwhitelistAction = GeoLocatedIPModel.useAction('unwhitelist');
    const refreshAction = GeoLocatedIPModel.useAction('refresh');
    const threatAction = GeoLocatedIPModel.useAction('threat_analysis');

    // Count KPIs replacing the four phantom fields (`event_count`,
    // `incident_count`, `login_attempts`, `login_count` exist on no model and
    // rendered "—" forever). size:0 returns the count with no rows.
    const ip = row?.ip_address ?? '';
    const eventCount = EventModel.useList({ source_ip: ip, size: 0 }, { enabled: Boolean(ip) && canEvents }).data?.count;
    const loginCount = LoginEventModel.useList({ ip_address: ip, size: 0 }, { enabled: Boolean(ip) && canLogins }).data?.count;
    const deviceCount = UserDeviceLocationModel.useList({ ip_address: ip, size: 0 }, { enabled: Boolean(ip) && canDevices }).data?.count;

    // Basemap for the Overview mini-map, in its own lazily-fetched chunk. Must
    // sit above the early returns below — it is a hook.
    const land = useWorldLand(row?.latitude != null && row?.longitude != null);

    if (isPending) return <div className="modal-pad dim">Loading GeoIP record…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'GeoIP record not found'}</div>;

    const status = statusOf(row);
    const blocked = blockActive(row);
    const whitelisted = whitelistActive(row);
    const fired = REPUTATION_FLAGS.filter((flag) => Boolean(row[flag.key]));
    const hasCoords = row.latitude != null && row.longitude != null;

    const editForm = async (title: string, fields: typeof GEOIP_EDIT_LOCATION_FIELDS) => {
        const initial: Record<string, string | boolean> = {};
        for (const field of fields) {
            const value = (row as unknown as Record<string, unknown>)[field.name];
            initial[field.name] = field.type === 'switch' ? Boolean(value) : (value == null ? '' : String(value));
        }
        const data = await formModal({ title: `${title} — ${row.ip_address}`, fields, initial });
        if (!data) return;
        try {
            await save.mutateAsync({ id: row.id, changes: data });
            toast.success(`${title} saved`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `Failed to save ${title.toLowerCase()}`);
        }
    };

    const doBlock = async () => {
        const data = await formModal({
            title: `Block ${row.ip_address}`,
            fields: GEOIP_BLOCK_FIELDS,
            initial: { reason: '', ttl: '86400' },
            submitText: 'Block',
        });
        if (!data) return;
        try {
            await blockAction.mutateAsync({
                id: row.id,
                payload: { reason: String(data.reason ?? ''), ttl: Number(data.ttl ?? 0) },
            });
            toast.success('IP blocked');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to block IP');
        }
    };

    const doUnblock = async () => {
        const data = await formModal({
            title: `Unblock ${row.ip_address}`,
            fields: GEOIP_UNBLOCK_FIELDS,
            initial: { reason: '' },
            submitText: 'Unblock',
        });
        if (!data) return;
        try {
            // `on_action_unblock` takes a STRING reason, not a dict.
            await unblockAction.mutateAsync({ id: row.id, payload: String(data.reason || 'Unblocked from admin') });
            toast.success('IP unblocked');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to unblock IP');
        }
    };

    const doWhitelist = async () => {
        const data = await formModal({
            title: `Whitelist ${row.ip_address}`,
            fields: GEOIP_WHITELIST_FIELDS,
            initial: { reason: '', ttl: '0' },
            submitText: 'Whitelist',
        });
        if (!data) return;
        const ttl = Number(data.ttl ?? 0);
        try {
            await whitelistAction.mutateAsync({
                id: row.id,
                payload: ttl > 0 ? { reason: String(data.reason ?? ''), ttl } : { reason: String(data.reason ?? '') },
            });
            toast.success('IP whitelisted');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to whitelist IP');
        }
    };

    const doUnwhitelist = async () => {
        const ok = await modal.confirm({
            title: 'Remove whitelist',
            message: <>Remove <code>{row.ip_address}</code> from the whitelist? It becomes eligible for auto-blocking again.</>,
            confirmText: 'Remove',
            danger: true,
        });
        if (!ok) return;
        try {
            await unwhitelistAction.mutateAsync({ id: row.id, payload: 1 });
            toast.success('IP removed from whitelist');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to remove from whitelist');
        }
    };

    const doRefresh = async (kind: 'refresh' | 'threat_analysis') => {
        const action = kind === 'refresh' ? refreshAction : threatAction;
        try {
            await action.mutateAsync({ id: row.id, payload: 1 });
            toast.success(kind === 'refresh' ? 'Geolocation refreshed' : 'Threat data refreshed');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Refresh failed');
        }
    };

    const copy = (label: string, value: string) => {
        void navigator.clipboard?.writeText(value)
            .then(() => toast.success(`${label} copied`))
            .catch(() => toast.error(`Could not copy ${label.toLowerCase()}`));
    };

    return (
        <DetailView<GeoLocatedIPRow>
            icon="bi-globe2"
            title={row.ip_address}
            subtitle={subtitleOf(row)}
            chips={chipsOf(row)}
            menuContext={row}
            sections={[
                {
                    key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', render: () => (
                        <>
                            <Eyebrow>Overview</Eyebrow>
                            <StatusPanel
                                tone={status.tone}
                                state={status.state}
                                headline={status.headline}
                                meta={status.meta}
                                icon={iconTone(row) === 'danger' ? 'bi-shield-exclamation' : undefined}
                                actions={canManage ? (
                                    <>
                                        {!blocked
                                            ? <button className="btn btn-danger btn-compact" onClick={() => void doBlock()}><i className="bi bi-slash-circle" /> Block</button>
                                            : <button className="btn btn-compact" onClick={() => void doUnblock()}><i className="bi bi-unlock" /> Unblock</button>}
                                        {!whitelisted
                                            ? <button className="btn btn-compact" onClick={() => void doWhitelist()}><i className="bi bi-shield-check" /> Whitelist</button>
                                            : <button className="btn btn-compact" onClick={() => void doUnwhitelist()}><i className="bi bi-x-circle" /> Remove whitelist</button>}
                                    </>
                                ) : undefined}
                            />

                            <div className="geoip-kpis">
                                <MetricCard label="Risk score" value={row.risk_score != null ? `${row.risk_score} / 100` : '—'} icon="bi-speedometer2" />
                                <MetricCard label="Incident events" value={canEvents ? (eventCount ?? '—') : '—'} icon="bi-shield-exclamation" />
                                <MetricCard label="Logins from this IP" value={canLogins ? (loginCount ?? '—') : '—'} icon="bi-box-arrow-in-right" />
                                <MetricCard label="Devices seen" value={canDevices ? (deviceCount ?? '—') : '—'} icon="bi-laptop" />
                            </div>

                            <Eyebrow>Location &amp; network</Eyebrow>
                            <FlatRow label="Country"><CountryLabel row={row} /></FlatRow>
                            <FlatRow label="Region · City">{text([row.region, row.city].filter(Boolean).join(' · '))}</FlatRow>
                            <FlatRow label="Coordinates">{hasCoords ? <code>{row.latitude}, {row.longitude}</code> : DASH}</FlatRow>
                            <FlatRow label="ASN · ISP">
                                {row.asn || row.isp
                                    ? <>{row.asn && <code>{row.asn}</code>}{row.asn_org ? ` ${row.asn_org}` : ''}{row.isp ? `${row.asn ? ' · ' : ''}${row.isp}` : ''}</>
                                    : DASH}
                            </FlatRow>
                            <FlatRow label="Last seen">{row.last_seen != null ? fmt.datetime(row.last_seen) : DASH}</FlatRow>

                            {hasCoords && (
                                <div className="geoip-map">
                                    <WorldMap
                                        height={160}
                                        land={land}
                                        interactive={false}
                                        showLegend={false}
                                        markers={[{
                                            id: `geoip-${row.id}`,
                                            lat: row.latitude!,
                                            lng: row.longitude!,
                                            size: 16,
                                            tone: threatTone(row.threat_level) === 'danger' ? 'bad' : 'accent',
                                            label: row.ip_address,
                                            detail: [row.city, row.region, row.country_name].filter(Boolean).join(', ') || undefined,
                                        }]}
                                        status="Approximate location — city-level accuracy at best"
                                    />
                                </div>
                            )}
                        </>
                    ),
                },
                {
                    key: 'network', label: 'Network', icon: 'bi-diagram-3', render: () => (
                        <>
                            <Eyebrow>Identity</Eyebrow>
                            <FlatRow label="IP address"><code>{row.ip_address}</code></FlatRow>
                            <FlatRow label="Subnet">{row.subnet ? <code>{row.subnet}</code> : DASH}</FlatRow>
                            {/* `reverse_dns` and `ip_version` do not exist on
                                GeoLocatedIP — the source's two rows here were
                                permanently blank and are not carried. */}

                            <Eyebrow>Carrier · ASN · ISP</Eyebrow>
                            <FlatRow label="ASN">{row.asn ? <code>{row.asn}</code> : DASH}</FlatRow>
                            <FlatRow label="ASN org">{text(row.asn_org)}</FlatRow>
                            <FlatRow label="ISP">{text(row.isp)}</FlatRow>
                            <FlatRow label="Connection">{text(row.connection_type)}</FlatRow>
                            <FlatRow label="Mobile carrier">{text(row.mobile_carrier)}</FlatRow>

                            <Eyebrow>Hosting flags</Eyebrow>
                            <FlatRow label="Cloud provider"><YesNo value={row.is_cloud} /></FlatRow>
                            <FlatRow label="Datacenter"><YesNo value={row.is_datacenter} /></FlatRow>
                            <FlatRow label="Mobile"><YesNo value={row.is_mobile} /></FlatRow>
                            <FlatRow label="VPN"><YesNo value={row.is_vpn} /></FlatRow>
                            <FlatRow label="Tor exit"><YesNo value={row.is_tor} /></FlatRow>
                            <FlatRow label="Proxy"><YesNo value={row.is_proxy} /></FlatRow>
                        </>
                    ),
                },
                {
                    key: 'risk', label: 'Risk & Reputation', icon: 'bi-shield-exclamation', render: () => (
                        <>
                            <Eyebrow>Summary</Eyebrow>
                            <FlatRow label="Threat level">
                                <Badge tone={threatTone(row.threat_level) as Tone}>{row.threat_level || 'unknown'}</Badge>
                            </FlatRow>
                            <FlatRow label="Risk score">
                                {row.risk_score != null ? <><strong>{row.risk_score}</strong> / 100</> : DASH}
                            </FlatRow>
                            <FlatRow label="Last checked">{row.last_seen != null ? fmt.relative(row.last_seen) : DASH}</FlatRow>
                            <FlatRow label="Cache expires">{row.expires_at != null ? fmt.datetime(row.expires_at) : <span className="dim-italic">Never (internal record)</span>}</FlatRow>

                            <Eyebrow>Reputation flags</Eyebrow>
                            {fired.length === 0
                                ? <FlatRow label="Status"><span className="dim-italic">No reputation flags fired.</span></FlatRow>
                                : fired.map((flag) => (
                                    <FlatRow key={String(flag.key)} label={flag.label}>
                                        <Badge tone={flag.tone}><i className={`bi ${flag.icon}`} /> {flag.title}</Badge>
                                        <span className="dim"> · {flag.detail}</span>
                                    </FlatRow>
                                ))}
                        </>
                    ),
                },
                { divider: 'Enforcement' },
                {
                    key: 'enforcement', label: 'Block & Whitelist', icon: 'bi-slash-circle', render: () => (
                        <>
                            <Eyebrow>Block</Eyebrow>
                            <FlatRow label="Status">
                                {blocked
                                    ? <Badge tone="danger"><i className="bi bi-slash-circle" /> Blocked</Badge>
                                    : blockExpired(row)
                                        ? <Badge tone="warning"><i className="bi bi-hourglass-bottom" /> Block expired</Badge>
                                        : <Badge tone="success"><i className="bi bi-check2" /> Allowed</Badge>}
                            </FlatRow>
                            <FlatRow label="Reason">{text(row.blocked_reason)}</FlatRow>
                            <FlatRow label="Blocked at">{row.blocked_at != null ? <code>{fmt.datetime(row.blocked_at)}</code> : DASH}</FlatRow>
                            <FlatRow label="Blocked until">
                                {row.blocked_until != null
                                    ? <><code>{fmt.datetime(row.blocked_until)}</code>{blockExpired(row) && <span className="text-warn"> · expired</span>}</>
                                    : <span className="dim-italic">Permanent / —</span>}
                            </FlatRow>
                            <FlatRow label="Block count">{row.block_count ?? 0}</FlatRow>
                            {canManage && (
                                <div className="geoip-actions">
                                    {!blocked
                                        ? <button className="btn btn-compact" onClick={() => void doBlock()}><i className="bi bi-slash-circle" /> Block this IP…</button>
                                        : <ArmedButton
                                            label="Unblock"
                                            armedLabel="Click again — traffic resumes fleet-wide"
                                            icon="bi-unlock"
                                            className="btn-compact"
                                            onConfirm={() => doUnblock()}
                                        />}
                                </div>
                            )}

                            <Eyebrow>Whitelist</Eyebrow>
                            <FlatRow label="Status">
                                {whitelisted
                                    ? <Badge tone="info"><i className="bi bi-shield-check" /> Whitelisted</Badge>
                                    : whitelistExpired(row)
                                        ? <Badge tone="warning"><i className="bi bi-hourglass-bottom" /> Whitelist expired</Badge>
                                        : <Badge tone="muted">Not whitelisted</Badge>}
                            </FlatRow>
                            <FlatRow label="Reason">{text(row.whitelisted_reason)}</FlatRow>
                            <FlatRow label="Whitelisted until">
                                {row.whitelisted_until != null
                                    ? <><code>{fmt.datetime(row.whitelisted_until)}</code>{whitelistExpired(row) && <span className="text-warn"> · expired</span>}</>
                                    : <span className="dim-italic">Permanent / —</span>}
                            </FlatRow>
                            {canManage && (
                                <div className="geoip-actions">
                                    {!whitelisted
                                        ? <button className="btn btn-compact" onClick={() => void doWhitelist()}><i className="bi bi-shield-check" /> Whitelist this IP…</button>
                                        : <ArmedButton
                                            label="Remove whitelist"
                                            armedLabel="Click again — auto-blocking resumes"
                                            icon="bi-x-circle"
                                            className="btn-compact"
                                            onConfirm={() => doUnwhitelist()}
                                        />}
                                </div>
                            )}
                        </>
                    ),
                },
                { divider: 'Activity' },
                {
                    key: 'activity', label: 'Activity', icon: 'bi-list-ul',
                    render: () => (
                        <ActivitySection
                            ip={row.ip_address}
                            canEvents={canEvents}
                            canLogs={canLogs}
                            canLogins={canLogins}
                            canDevices={canDevices}
                            onOpenLogin={onOpenLogin}
                            onOpenLocation={onOpenLocation}
                        />
                    ),
                },
                { divider: 'Detail' },
                {
                    key: 'metadata', label: 'Metadata', icon: 'bi-braces', render: () => (
                        <>
                            <Eyebrow>Metadata</Eyebrow>
                            {/* GeoLocatedIP has NO `metadata` field — the card
                                is fed the record itself, which is what the
                                source actually wanted. */}
                            <KnownFieldsCard
                                data={row as unknown as Record<string, unknown>}
                                known={[
                                    { key: 'id', label: 'Record ID' },
                                    { key: 'ip_address', label: 'IP address' },
                                    { key: 'created', label: 'Created', format: 'datetime' },
                                    { key: 'modified', label: 'Modified', format: 'datetime' },
                                    { key: 'last_seen', label: 'Last seen', format: 'datetime' },
                                    { key: 'expires_at', label: 'Expires at', format: 'datetime' },
                                ]}
                                showRaw={false}
                            />
                            <Eyebrow>Raw provider record</Eyebrow>
                            <RawRecordReveal id={row.id} canManage={canManage} />
                        </>
                    ),
                },
            ]}
            initialSection="overview"
            contextMenu={[
                { label: 'Refresh geolocation', icon: 'bi-arrow-clockwise', permissions: GEOIP_MANAGE_PERMS, onSelect: () => void doRefresh('refresh') },
                { label: 'Refresh threat data', icon: 'bi-shield-exclamation', permissions: GEOIP_MANAGE_PERMS, onSelect: () => void doRefresh('threat_analysis') },
                { divider: true },
                { label: 'Edit location', icon: 'bi-geo-alt', permissions: GEOIP_MANAGE_PERMS, onSelect: () => void editForm('Edit location', GEOIP_EDIT_LOCATION_FIELDS) },
                { label: 'Edit network', icon: 'bi-diagram-3', permissions: GEOIP_MANAGE_PERMS, onSelect: () => void editForm('Edit network', GEOIP_EDIT_NETWORK_FIELDS) },
                { label: 'Edit security', icon: 'bi-shield-lock', permissions: GEOIP_MANAGE_PERMS, onSelect: () => void editForm('Edit security', GEOIP_EDIT_SECURITY_FIELDS) },
                { divider: true },
                { label: 'Block 24h', icon: 'bi-slash-circle', permissions: GEOIP_MANAGE_PERMS, when: (ctx) => !blockActive(ctx), onSelect: () => void doBlock() },
                { label: 'Unblock', icon: 'bi-unlock', permissions: GEOIP_MANAGE_PERMS, when: (ctx) => blockActive(ctx), onSelect: () => void doUnblock() },
                { label: 'Whitelist', icon: 'bi-shield-check', permissions: GEOIP_MANAGE_PERMS, when: (ctx) => !whitelistActive(ctx), onSelect: () => void doWhitelist() },
                { label: 'Remove whitelist', icon: 'bi-x-circle', permissions: GEOIP_MANAGE_PERMS, when: (ctx) => whitelistActive(ctx), onSelect: () => void doUnwhitelist() },
                { divider: true },
                { label: 'Copy IP', icon: 'bi-clipboard', onSelect: () => copy('IP address', row.ip_address) },
                {
                    label: 'Refresh record', icon: 'bi-arrow-repeat',
                    onSelect: () => { void qc.invalidateQueries({ queryKey: GeoLocatedIPModel.keys.one(row.id) }); },
                },
                {
                    label: 'Open coordinates in Google Maps', icon: 'bi-box-arrow-up-right',
                    when: () => hasCoords,
                    // The ONLY third-party egress in this surface, and it is
                    // operator-initiated, never automatic.
                    onSelect: () => { window.open(`https://www.google.com/maps/search/?api=1&query=${row.latitude},${row.longitude}`, '_blank', 'noopener,noreferrer'); },
                },
                // NO Delete: GeoLocatedIP declares no CAN_DELETE, so rest.py
                // refuses every DELETE. The source's item could never work.
            ]}
            onClose={onClose}
        />
    );
}

/** Open the dossier for a known record id. Exported for #1287 and the device surfaces. */
export function showGeoIpDossier(id: number, opts: Omit<GeoIpDossierProps, 'id' | 'onClose'> = {}): void {
    void modal.detail((close) => <GeoIpDossier id={id} onClose={() => close(null)} {...opts} />);
}

/**
 * Open the dossier for a raw IP string. Resolution goes through the CACHE
 * TABLE (`?ip_address=`), which is read-only and unmetered — NOT through
 * `/geoip/lookup`, which creates records, calls the provider and is rate
 * limited. Inspecting an IP must never cost a provider call.
 */
export function GeoIpDossierForAddress({ ip, onClose }: { ip: string; onClose: () => void }) {
    const { data, isPending, error } = useGeoIpByAddress(ip);
    if (isPending) return <div className="modal-pad dim">Looking up {ip}…</div>;
    if (error) return <div className="modal-pad text-bad">{error.message}</div>;
    if (!data) {
        return (
            <div className="modal-pad">
                <h2 className="modal-title">No cached geolocation</h2>
                <p className="dim">
                    Nothing is cached for <code>{ip}</code>. Use <strong>Look up IP</strong> on the
                    GeoIP Cache page to fetch it from the provider.
                </p>
                <div className="modal-actions"><button className="btn" onClick={onClose}>Close</button></div>
            </div>
        );
    }
    return <GeoIpDossier id={data.id} onClose={onClose} />;
}

export function showGeoIpDossierForAddress(ip: string): void {
    void modal.detail((close) => <GeoIpDossierForAddress ip={ip} onClose={() => close(null)} />);
}
