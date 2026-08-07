// LoginEventDetail — a small, strictly read-only `modal.detail`.
// `UserLoginEvent.RestMeta` sets CAN_CREATE / CAN_UPDATE / CAN_DELETE all
// False, so there are no actions here by contract: only the record, and
// cross-links to the user, the device and the IP dossier.
import { Badge, DetailView, Eyebrow, FlatRow, fmt, modal } from '../../../ui';
import { useCan } from '../../../client/runtime';
import { countryFlag, GEOIP_VIEW_PERMS } from '../geoip/models';
import { showGeoIpDossierForAddress } from '../geoip/GeoIpDossier';
import {
    LoginEventModel, USER_DEVICE_VIEW_PERMS,
    browserLabel, osLabel, type LoginEventRow,
} from './models';

const DASH = <span className="dim-italic">—</span>;

function whereOf(row: LoginEventRow): string {
    return [row.city, row.region, row.country_code].filter(Boolean).join(', ') || 'Unknown location';
}

export function LoginEventDetail({ id, onClose, onOpenUser, onOpenDeviceByDuid }: {
    id: number;
    onClose: () => void;
    onOpenUser?: (userId: number) => void;
    onOpenDeviceByDuid?: (duid: string) => void;
}) {
    const { data: row, isPending, error } = LoginEventModel.useOne(id);
    const canGeoIp = useCan(GEOIP_VIEW_PERMS).can;
    const canDevice = useCan(USER_DEVICE_VIEW_PERMS).can;

    if (isPending) return <div className="modal-pad dim">Loading login event…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'Login event not found'}</div>;

    const flag = countryFlag(row.country_code);
    const device = row.device ?? null;

    return (
        <DetailView
            icon="bi-box-arrow-in-right"
            title={whereOf(row)}
            subtitle={`${fmt.datetime(row.created)}${row.source ? ` · via ${row.source}` : ''}`}
            chips={[
                ...(row.is_new_country ? [{ icon: 'bi-globe-americas', text: 'New country', tone: 'danger' as const }] : []),
                ...(row.is_new_region ? [{ icon: 'bi-pin-map', text: 'New region', tone: 'warning' as const }] : []),
                ...(row.source ? [{ text: row.source }] : []),
            ]}
            sections={[
                {
                    key: 'event', label: 'Login', icon: 'bi-box-arrow-in-right', render: () => (
                        <>
                            <Eyebrow>When &amp; where</Eyebrow>
                            <FlatRow label="Timestamp"><code>{fmt.datetime(row.created)}</code> <span className="dim">· {fmt.relative(row.created)}</span></FlatRow>
                            <FlatRow label="City">{row.city || DASH}</FlatRow>
                            <FlatRow label="Region">
                                {row.region || DASH}
                                {row.region_code && <code className="dim geoip-cc">{row.region_code}</code>}
                            </FlatRow>
                            <FlatRow label="Country">
                                {row.country_code
                                    ? <>{flag && <span className="geoip-flag">{flag}</span>}{row.country_code}</>
                                    : DASH}
                            </FlatRow>
                            <FlatRow label="Coordinates">
                                {row.latitude != null && row.longitude != null
                                    ? <code>{row.latitude}, {row.longitude}</code>
                                    : <span className="dim-italic">— (private-range logins carry none)</span>}
                            </FlatRow>

                            <Eyebrow>Origin</Eyebrow>
                            <FlatRow label="IP address">
                                {row.ip_address
                                    ? (canGeoIp
                                        ? <button className="btn-link" onClick={() => showGeoIpDossierForAddress(row.ip_address!)}><code>{row.ip_address}</code></button>
                                        : <code>{row.ip_address}</code>)
                                    : DASH}
                            </FlatRow>
                            <FlatRow label="Source">{row.source || DASH}</FlatRow>
                            <FlatRow label="New country"><Badge tone={row.is_new_country ? 'danger' : 'muted'}>{row.is_new_country ? 'Yes' : 'No'}</Badge></FlatRow>
                            <FlatRow label="New region"><Badge tone={row.is_new_region ? 'warning' : 'muted'}>{row.is_new_region ? 'Yes' : 'No'}</Badge></FlatRow>

                            <Eyebrow>Identity</Eyebrow>
                            <FlatRow label="User">
                                {row.user
                                    ? (onOpenUser
                                        ? <button className="btn-link" onClick={() => onOpenUser(row.user!.id)}>{row.user.display_name || row.user.username}</button>
                                        : (row.user.display_name || row.user.username))
                                    : DASH}
                            </FlatRow>
                            <FlatRow label="Device">
                                {device
                                    ? (
                                        <>
                                            {browserLabel(device.device_info)} on {osLabel(device.device_info)}
                                            {' '}
                                            {canDevice && onOpenDeviceByDuid
                                                ? <button className="btn-link" onClick={() => onOpenDeviceByDuid(device.duid)}><code>{fmt.truncateMiddle(device.duid, 14)}</code></button>
                                                : <code>{fmt.truncateMiddle(device.duid, 14)}</code>}
                                        </>
                                    )
                                    : <span className="dim-italic">— (no device linked to this login)</span>}
                            </FlatRow>
                            {row.user_agent_info?.string && (
                                <>
                                    <Eyebrow>User agent</Eyebrow>
                                    <pre className="ud-ua-block">{row.user_agent_info.string}</pre>
                                </>
                            )}
                        </>
                    ),
                },
            ]}
            initialSection="event"
            // No context menu: the model is read-only by RestMeta contract.
            onClose={onClose}
        />
    );
}

export function showLoginEventDetail(id: number, opts: {
    onOpenUser?: (userId: number) => void;
    onOpenDeviceByDuid?: (duid: string) => void;
} = {}): void {
    void modal.detail((close) => <LoginEventDetail id={id} onClose={() => close(null)} {...opts} />);
}
