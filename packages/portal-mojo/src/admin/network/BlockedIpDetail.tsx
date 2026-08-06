// BlockedIpDetail — the KISS `modal.detail` for one enforcement record.
//
// Deliberately NOT the full IP dossier: #1291 owns that
// (`showGeoIpDossier`), and this modal links to it rather than forking it.
// What lives here is the perimeter story — why this address is blocked, until
// when, and the four relaxing/refreshing actions an operator reaches for from
// the Blocked IPs table.
//
// Creating a block is deliberately absent everywhere in this module: an admin
// table that turns a typed IP into a fleet-wide iptables entry in two clicks
// is the wrong default. Unblock and whitelist — both RELAXING — are exposed.
import {
    ArmedButton, Badge, DetailView, Eyebrow, FlatRow, StatusPanel,
    fmt, formModal, modal, toast, type Field, type Tone,
} from '../../ui';
import { useCan } from '../../client';
import { countryName } from '../../charts/worldmap/countryCentroids';
import {
    GEOIP_MANAGE_PERMS, GeoLocatedIPModel, blockActive, blockExpired,
    countryFlag, riskScoreOf, showGeoIpDossier, threatTone, whitelistActive, whitelistExpired,
    type GeoLocatedIPRow, type GeoTone,
} from '../security/geoip';

const DASH = <span className="dim-italic">—</span>;

/** `blocked_until`/`whitelisted_until` null means PERMANENT, never "unknown". */
function untilText(value: number | null | undefined): string {
    return value == null ? 'Never' : fmt.datetime(value);
}

/**
 * #1291 ships `GEOIP_WHITELIST_FIELDS` with a `ttl` SELECT. This module needs a
 * precise expiry instead: `on_action_whitelist`'s dict branch parses `until`
 * through `dates.parse_datetime`, and an exemption an auditor has to justify
 * wants a date, not "30 days from whenever the button was pressed". Hence a
 * second, differently-named field set rather than a redefinition of theirs —
 * `GEOIP_UNBLOCK_FIELDS` IS imported from them unchanged.
 *
 * `until` is serialized as an ISO string (`outputFormat: 'iso'`), not the field
 * registry's default epoch seconds, because `parse_datetime` is what reads it.
 */
export const NETWORK_WHITELIST_FIELDS: Field[] = [
    {
        name: 'reason', type: 'text', label: 'Reason', required: true, columns: 12,
        placeholder: 'Office egress — Seattle HQ',
        help: 'Recorded on the record and in the firewall log.',
    },
    {
        name: 'until', type: 'datetimepicker', label: 'Expires (optional)', columns: 12,
        outputFormat: 'iso',
        help: 'Leave empty for a permanent exemption.',
    },
];

export function enforcementBadge(row: GeoLocatedIPRow) {
    if (blockActive(row)) return <Badge tone="danger"><i className="bi bi-slash-circle" /> Blocked</Badge>;
    if (whitelistActive(row)) return <Badge tone="info"><i className="bi bi-shield-check" /> Whitelisted</Badge>;
    if (blockExpired(row)) return <Badge tone="warning">Block expired</Badge>;
    if (whitelistExpired(row)) return <Badge tone="warning">Whitelist expired</Badge>;
    return <span className="dim">—</span>;
}

export function BlockedIpDetail({ id, onClose }: { id: number; onClose: () => void }) {
    const { data: row, isPending, error } = GeoLocatedIPModel.useOne(id);
    const canManage = useCan(GEOIP_MANAGE_PERMS).can;
    const unblock = GeoLocatedIPModel.useAction('unblock');
    const whitelist = GeoLocatedIPModel.useAction('whitelist');
    const unwhitelist = GeoLocatedIPModel.useAction('unwhitelist');
    const analyze = GeoLocatedIPModel.useAction('threat_analysis');

    if (isPending) return <div className="modal-pad dim">Loading enforcement record…</div>;
    if (!row || error) return <div className="modal-pad text-bad">{error?.message ?? 'IP record not found'}</div>;

    const flag = countryFlag(row.country_code);
    const active = blockActive(row);
    const risk = riskScoreOf(row);

    const runUnblock = async () => {
        try {
            await unblock.mutateAsync({ id, payload: 'Unblocked from the admin portal' });
            toast.success(`${row.ip_address} unblocked`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Unblock failed');
        }
    };

    const runWhitelist = async () => {
        const data = await formModal({
            title: `Whitelist ${row.ip_address}`,
            fields: NETWORK_WHITELIST_FIELDS,
            submitText: 'Whitelist',
            intro: 'A whitelisted address passes EVERY rule, including the VPN and Tor checks, and an active block is cleared immediately.',
        });
        if (!data) return;
        const until = typeof data.until === 'string' && data.until ? data.until : null;
        try {
            await whitelist.mutateAsync({
                id,
                payload: until ? { reason: String(data.reason), until } : { reason: String(data.reason) },
            });
            toast.success(`${row.ip_address} whitelisted`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Whitelist failed');
        }
    };

    const runUnwhitelist = async () => {
        try {
            await unwhitelist.mutateAsync({ id, payload: 1 });
            toast.success(`Whitelist removed for ${row.ip_address}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not remove the whitelist');
        }
    };

    const runAnalyze = async () => {
        try {
            await analyze.mutateAsync({ id });
            toast.success('Threat analysis re-run');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Threat analysis failed');
        }
    };

    return (
        <DetailView
            icon="bi-slash-circle"
            title={row.ip_address}
            subtitle={[row.city, row.region, row.country_name ?? countryName(row.country_code)].filter(Boolean).join(', ') || 'Unknown location'}
            chips={[
                { text: active ? 'Block active' : blockExpired(row) ? 'Block expired' : 'Not blocked', tone: active ? 'danger' : blockExpired(row) ? 'warning' : 'muted' },
                ...(whitelistActive(row) ? [{ icon: 'bi-shield-check', text: 'Whitelisted', tone: 'info' as const }] : []),
                { text: row.threat_level || 'no threat level', tone: threatTone(row.threat_level) as Tone },
            ]}
            sections={[
                {
                    key: 'enforcement', label: 'Enforcement', icon: 'bi-shield-slash', render: () => (
                        <>
                            <StatusPanel
                                tone={active ? 'danger' : whitelistActive(row) ? 'info' : 'warning'}
                                state={active ? 'BLOCKED' : whitelistActive(row) ? 'WHITELISTED' : 'NOT ENFORCED'}
                                headline={row.blocked_reason || 'No reason recorded on the block.'}
                                meta={active
                                    ? `Expires ${untilText(row.blocked_until)} · blocked ${row.block_count} time${row.block_count === 1 ? '' : 's'}`
                                    : 'A whitelist beats a block, and an expired block stops enforcing — the raw is_blocked flag stays set either way.'}
                                actions={canManage ? (
                                    <div className="netsec-action-row">
                                        {row.is_blocked && (
                                            <ArmedButton
                                                className="btn-compact"
                                                icon="bi-unlock"
                                                label="Unblock"
                                                armedLabel="Click again — traffic from this address is allowed fleet-wide"
                                                onConfirm={runUnblock}
                                            />
                                        )}
                                        <button className="btn btn-compact" onClick={() => void runWhitelist()}>
                                            <i className="bi bi-shield-check" /> Whitelist…
                                        </button>
                                        {row.is_whitelisted && (
                                            <ArmedButton
                                                className="btn-compact"
                                                icon="bi-shield-x"
                                                label="Remove whitelist"
                                                armedLabel="Click again — this address is evaluated against the rules again immediately"
                                                onConfirm={runUnwhitelist}
                                            />
                                        )}
                                        <button className="btn btn-compact" onClick={() => void runAnalyze()}>
                                            <i className="bi bi-arrow-repeat" /> Re-run threat analysis
                                        </button>
                                    </div>
                                ) : null}
                            />

                            <Eyebrow>Block lifecycle</Eyebrow>
                            <FlatRow label="State">{enforcementBadge(row)}</FlatRow>
                            <FlatRow label="Blocked at">{row.blocked_at != null ? fmt.datetime(row.blocked_at) : DASH}</FlatRow>
                            <FlatRow label="Blocked until">
                                {row.blocked_until == null
                                    ? <><b>Never</b> <span className="dim">— permanent</span></>
                                    : <>{fmt.datetime(row.blocked_until)} <span className="dim">· {fmt.relative(row.blocked_until)}</span></>}
                            </FlatRow>
                            <FlatRow label="Reason">{row.blocked_reason || DASH}</FlatRow>
                            <FlatRow label="Block count">{row.block_count}</FlatRow>

                            <Eyebrow>Whitelist</Eyebrow>
                            <FlatRow label="Whitelisted"><Badge tone={whitelistActive(row) ? 'info' : 'muted'}>{whitelistActive(row) ? 'Yes' : row.is_whitelisted ? 'Expired' : 'No'}</Badge></FlatRow>
                            <FlatRow label="Reason">{row.whitelisted_reason || DASH}</FlatRow>
                            <FlatRow label="Until">{row.is_whitelisted ? untilText(row.whitelisted_until) : DASH}</FlatRow>
                        </>
                    ),
                },
                {
                    key: 'origin', label: 'Origin', icon: 'bi-globe2', render: () => (
                        <>
                            <Eyebrow>Location</Eyebrow>
                            <FlatRow label="Country">
                                {row.country_code
                                    ? <>{flag && <span className="geoip-flag">{flag}</span>}{row.country_name || countryName(row.country_code)} <code className="dim geoip-cc">{row.country_code}</code></>
                                    : DASH}
                            </FlatRow>
                            <FlatRow label="Region">{row.region || DASH}{row.region_code && <code className="dim geoip-cc">{row.region_code}</code>}</FlatRow>
                            <FlatRow label="City">{row.city || DASH}</FlatRow>
                            <FlatRow label="Postal code">{row.postal_code || DASH}</FlatRow>
                            <FlatRow label="Timezone">{row.timezone || DASH}</FlatRow>

                            <Eyebrow>Network</Eyebrow>
                            <FlatRow label="Subnet"><code>{row.subnet || '—'}</code></FlatRow>
                            <FlatRow label="ASN">{row.asn || DASH}</FlatRow>
                            <FlatRow label="ASN org">{row.asn_org || DASH}</FlatRow>
                            <FlatRow label="ISP">{row.isp || DASH}</FlatRow>
                            <FlatRow label="Connection">{row.connection_type || DASH}</FlatRow>
                            <FlatRow label="Last seen">{fmt.datetime(row.last_seen)} <span className="dim">· {fmt.relative(row.last_seen)}</span></FlatRow>
                        </>
                    ),
                },
                {
                    key: 'threat', label: 'Threat', icon: 'bi-exclamation-triangle', render: () => (
                        <>
                            <Eyebrow>Assessment</Eyebrow>
                            <FlatRow label="Threat level">
                                <Badge tone={threatTone(row.threat_level) as GeoTone as Tone}>{row.threat_level || 'none'}</Badge>
                            </FlatRow>
                            <FlatRow label="Risk score">{risk == null ? DASH : risk}</FlatRow>
                            <FlatRow label="Is threat"><Badge tone={row.is_threat ? 'danger' : 'muted'}>{row.is_threat ? 'Yes' : 'No'}</Badge></FlatRow>
                            <FlatRow label="Is suspicious"><Badge tone={row.is_suspicious ? 'warning' : 'muted'}>{row.is_suspicious ? 'Yes' : 'No'}</Badge></FlatRow>

                            <Eyebrow>Signals</Eyebrow>
                            <div className="netsec-flags">
                                {([
                                    ['Tor', row.is_tor], ['VPN', row.is_vpn], ['Proxy', row.is_proxy],
                                    ['Cloud', row.is_cloud], ['Datacenter', row.is_datacenter], ['Mobile', row.is_mobile],
                                    ['Known attacker', row.is_known_attacker], ['Known abuser', row.is_known_abuser],
                                ] as const).map(([label, on]) => (
                                    <span key={label} className={`chip ${on ? 'chip-danger' : 'chip-muted'}`}>
                                        <i className={`bi ${on ? 'bi-check-lg' : 'bi-dash'}`} /> {label}
                                    </span>
                                ))}
                            </div>

                            <Eyebrow>Full record</Eyebrow>
                            <p className="dim">
                                Location, network and security editing — plus the raw provider record —
                                live in the IP Intelligence dossier.
                            </p>
                            <button className="btn btn-compact" onClick={() => { onClose(); showGeoIpDossier(row.id); }}>
                                <i className="bi bi-box-arrow-up-right" /> Open the full IP dossier
                            </button>
                        </>
                    ),
                },
            ]}
            initialSection="enforcement"
            onClose={onClose}
        />
    );
}

export function showBlockedIpDetail(id: number): void {
    void modal.detail((close) => <BlockedIpDetail id={id} onClose={() => close(null)} />);
}
