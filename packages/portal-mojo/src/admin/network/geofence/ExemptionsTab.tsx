// ExemptionsTab — the auditor's "who is exempt" surface. Port of web-mojo
// `GeofenceExemptionsView.js`. Every entry shows who it covers, why, and until
// when; expired entries render inactive and are NEVER hidden (the backend
// lists them with `active: false` for exactly that reason).
//
// Three planes, three different write paths:
//   1. Network ranges — the GEOFENCE_ALLOWLIST setting, a FULL-REPLACE POST.
//      Every write refetches and compares first (see useSaveGeoAllowlist):
//      the source posted from possibly-stale local state and could silently
//      drop a concurrent editor's entry.
//   2. Individual IPs — GeoLocatedIP whitelist rows, written through the
//      standard geoip magic-field actions (#1291's model).
//   3. Bypass holders — read-only. Grants are managed on user records; the
//      endpoint deliberately returns id/username only so a geofence-only
//      grant cannot be used to enumerate user PII.
import {
    ArmedButton, Badge, formModal, modal, toast, type Field,
} from '../../../ui';
import { useCan } from '../../../client/runtime';
import { GEOIP_MANAGE_PERMS, GeoLocatedIPModel } from '../../security/geoip';
import {
    AllowlistRaceError, findGeoIpIdByAddress, resolveGeoIpIdForAddress,
    useBypassHolders, useGeoAllowlist, useSaveGeoAllowlist,
    type AllowlistWriteEntry,
} from '../models';
import {
    GEOFENCE_MANAGE_PERMS,
    type AllowlistEntry, type BypassHolder, type GeoIpAllowlistEntry,
} from './geofence-data';

const RANGE_FIELDS: Field[] = [
    {
        name: 'cidr', type: 'text', label: 'Range (CIDR or IP)', required: true, columns: 12,
        placeholder: '198.51.100.0/24',
        help: 'Validated server-side — an unparseable value is refused with the entry index.',
    },
    {
        name: 'reason', type: 'text', label: 'Reason', required: true, columns: 12,
        placeholder: 'Office egress — Seattle HQ',
    },
    {
        name: 'until', type: 'datetimepicker', label: 'Expires (optional)', columns: 12,
        outputFormat: 'iso',
        help: 'Leave empty for a permanent exemption.',
    },
];

const IP_FIELDS: Field[] = [
    { name: 'ip', type: 'text', label: 'IP address', required: true, columns: 12, placeholder: '203.0.113.7' },
    { name: 'reason', type: 'text', label: 'Reason', required: true, columns: 12, placeholder: 'Dev box — Paris' },
    {
        name: 'until', type: 'datetimepicker', label: 'Expires (optional)', columns: 12,
        outputFormat: 'iso',
        help: 'Leave empty for a permanent exemption.',
    },
];

function StatusPill({ active }: { active: boolean }) {
    return <Badge tone={active ? 'success' : 'muted'}>{active ? 'Active' : 'Expired'}</Badge>;
}

function untilText(until: string | null | undefined): string {
    return until ? until : 'Never';
}

/** The wire form of one stored entry: only `{cidr, reason, until}` is legal. */
function toWriteEntry(entry: AllowlistEntry): AllowlistWriteEntry {
    const out: AllowlistWriteEntry = { cidr: entry.cidr };
    if (entry.reason) out.reason = entry.reason;
    if (entry.until) out.until = entry.until;
    return out;
}

export function ExemptionsTab() {
    const { can: canManage } = useCan(GEOFENCE_MANAGE_PERMS);
    const canGeoIpManage = useCan(GEOIP_MANAGE_PERMS).can;
    const allowlist = useGeoAllowlist();
    const bypass = useBypassHolders();
    const save = useSaveGeoAllowlist();
    const whitelist = GeoLocatedIPModel.useAction('whitelist');
    const unwhitelist = GeoLocatedIPModel.useAction('unwhitelist');

    const setting: AllowlistEntry[] = allowlist.data?.setting ?? [];
    const geoips: GeoIpAllowlistEntry[] = allowlist.data?.geoip ?? [];
    const holders: BypassHolder[] = bypass.data?.holders ?? [];

    const writeAllowlist = async (entries: AllowlistWriteEntry[], label: string) => {
        try {
            await save.mutateAsync({ entries, baseline: setting });
            toast.success(label);
        } catch (err) {
            if (err instanceof AllowlistRaceError) {
                toast.error(err.message);
                void allowlist.refetch();
                return;
            }
            toast.error(err instanceof Error ? err.message : 'Failed to save the allowlist');
        }
    };

    const onAddRange = async () => {
        const data = await formModal({
            title: 'Add network exemption',
            fields: RANGE_FIELDS,
            submitText: 'Add',
            intro: 'An allowlisted address passes EVERY rule, including the VPN and Tor checks.',
        });
        if (!data) return;
        const until = typeof data.until === 'string' && data.until ? data.until : undefined;
        await writeAllowlist(
            [...setting.map(toWriteEntry), { cidr: String(data.cidr).trim(), reason: String(data.reason), ...(until ? { until } : {}) }],
            'Exemption added',
        );
    };

    const onEditRange = async (index: number) => {
        const entry = setting[index];
        if (!entry) return;
        const data = await formModal({
            title: 'Edit network exemption',
            fields: RANGE_FIELDS,
            submitText: 'Save',
            initial: { cidr: entry.cidr, reason: entry.reason ?? '', until: entry.until ?? '' },
        });
        if (!data) return;
        const until = typeof data.until === 'string' && data.until ? data.until : undefined;
        const next = setting.map(toWriteEntry);
        next[index] = { cidr: String(data.cidr).trim(), reason: String(data.reason), ...(until ? { until } : {}) };
        await writeAllowlist(next, 'Exemption saved');
    };

    const onRemoveRange = async (index: number) => {
        const entry = setting[index];
        if (!entry) return;
        const next = setting.filter((_, i) => i !== index).map(toWriteEntry);
        // Clearing the LAST entry posts `entries: []`, which is a legitimate
        // clear — not "no change". It is confirmed explicitly.
        if (next.length === 0) {
            const ok = await modal.confirm({
                title: 'Clear every network exemption?',
                message: 'This removes the last entry, so the allowlist will be empty. Every range is evaluated against the rules again immediately.',
                confirmText: 'Clear the allowlist',
                danger: true,
            });
            if (!ok) return;
        }
        await writeAllowlist(next, `Exemption for ${entry.cidr} removed`);
    };

    const onWhitelistIp = async () => {
        const data = await formModal({
            title: 'Whitelist an IP',
            fields: IP_FIELDS,
            submitText: 'Whitelist',
            intro: 'The address is resolved through the GeoIP provider (creating the record if it is new) and then whitelisted.',
        });
        if (!data) return;
        const ip = String(data.ip).trim();
        const until = typeof data.until === 'string' && data.until ? data.until : null;
        try {
            const id = await resolveGeoIpIdForAddress(GeoLocatedIPModel.endpoint, ip);
            await whitelist.mutateAsync({
                id,
                payload: until ? { reason: String(data.reason), until } : { reason: String(data.reason) },
            });
            await allowlist.refetch();
            toast.success(`${ip} whitelisted`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `Could not whitelist ${ip}`);
        }
    };

    const onUnwhitelistIp = async (ip: string) => {
        try {
            // A cached read, not `/lookup` — the record exists by definition,
            // so removal costs no provider call and no rate-limit budget.
            const id = await findGeoIpIdByAddress(GeoLocatedIPModel.endpoint, ip);
            await unwhitelist.mutateAsync({ id, payload: 1 });
            await allowlist.refetch();
            toast.success(`Whitelist removed for ${ip}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `Could not remove the whitelist for ${ip}`);
        }
    };

    return (
        <div className="geo-exemptions">
            <div className="netsec-note netsec-note-info">
                <i className="bi bi-shield-exclamation" />
                <div>
                    Exemptions are compliance-sensitive. Every entry shows <b>who it covers, why, and
                    until when</b> — and any exemption that bypasses a block is recorded in the audit trail.
                </div>
            </div>

            {/* ── 1. Network ranges ───────────────────────────────── */}
            <div className="panel netsec-card">
                <div className="netsec-card-head">
                    <span>Network ranges (allowlist)</span>
                    {canManage && (
                        <button type="button" className="btn btn-primary btn-compact" onClick={() => void onAddRange()}>
                            <i className="bi bi-plus-lg" /> Add range
                        </button>
                    )}
                </div>
                <div className="netsec-card-body">
                    {allowlist.isPending && <p className="dim">Loading exemptions…</p>}
                    {allowlist.error && <p className="text-bad">{allowlist.error.message}</p>}
                    {!allowlist.isPending && !allowlist.error && (
                        setting.length === 0
                            ? <p className="dim">No network exemptions.</p>
                            : (
                                <div className="netsec-table-scroll">
                                    <table className="tbl geo-exempt-table">
                                        <thead>
                                            <tr>
                                                <th>Range</th><th>Reason</th><th>Expires</th><th>Status</th>
                                                {canManage && <th aria-label="Actions" />}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {setting.map((entry, index) => (
                                                <tr key={`${entry.cidr}-${index}`} className={entry.active === false ? 'geo-row-expired' : undefined}>
                                                    <td><code>{entry.cidr}</code></td>
                                                    <td>{entry.reason || <span className="dim">—</span>}</td>
                                                    <td>{untilText(entry.until)}</td>
                                                    <td><StatusPill active={entry.active !== false} /></td>
                                                    {canManage && (
                                                        <td className="netsec-row-actions">
                                                            <button type="button" className="btn-link" onClick={() => void onEditRange(index)}>Edit</button>
                                                            <ArmedButton
                                                                className="btn-compact"
                                                                label="Remove"
                                                                armedLabel="Click again — this range is evaluated against the rules again immediately"
                                                                onConfirm={() => onRemoveRange(index)}
                                                            />
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                    )}
                    <p className="dim">
                        Allowlisted addresses pass <b>every</b> rule, including the VPN and Tor checks.
                        Expired entries stay listed until they are removed.
                    </p>
                </div>
            </div>

            {/* ── 2. Individual IPs ───────────────────────────────── */}
            <div className="panel netsec-card">
                <div className="netsec-card-head">
                    <span>Individual IPs</span>
                    {canManage && canGeoIpManage && (
                        <button type="button" className="btn btn-compact" onClick={() => void onWhitelistIp()}>
                            <i className="bi bi-shield-check" /> Whitelist an IP…
                        </button>
                    )}
                </div>
                <div className="netsec-card-body">
                    {geoips.length === 0
                        ? <p className="dim">No individually whitelisted IPs.</p>
                        : (
                            <div className="netsec-table-scroll">
                                <table className="tbl geo-exempt-table">
                                    <thead>
                                        <tr>
                                            <th>IP address</th><th>Reason</th><th>Expires</th><th>Status</th>
                                            {canManage && canGeoIpManage && <th aria-label="Actions" />}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {geoips.map((entry) => (
                                            <tr key={entry.ip} className={entry.active === false ? 'geo-row-expired' : undefined}>
                                                <td><code>{entry.ip}</code></td>
                                                <td>{entry.reason || <span className="dim">—</span>}</td>
                                                <td>{untilText(entry.until)}</td>
                                                <td><StatusPill active={entry.active !== false} /></td>
                                                {canManage && canGeoIpManage && (
                                                    <td className="netsec-row-actions">
                                                        <ArmedButton
                                                            className="btn-compact"
                                                            label="Remove"
                                                            armedLabel="Click again — this address is evaluated against the rules again immediately"
                                                            onConfirm={() => onUnwhitelistIp(entry.ip)}
                                                        />
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    <p className="dim">
                        Whitelisting takes a reason and an optional expiry. Full enforcement management
                        lives on the <b>Blocked IPs</b> page.
                    </p>
                </div>
            </div>

            {/* ── 3. Bypass holders ───────────────────────────────── */}
            <div className="panel netsec-card">
                <div className="netsec-card-head">
                    <span>Users who bypass geofencing</span>
                    <span className="eyebrow">read-only</span>
                </div>
                <div className="netsec-card-body">
                    {bypass.isPending && <p className="dim">Loading bypass holders…</p>}
                    {bypass.error && <p className="text-bad">{bypass.error.message}</p>}
                    {!bypass.isPending && !bypass.error && (
                        holders.length === 0
                            ? <p className="dim">No users hold a geofence bypass.</p>
                            : (
                                <div className="netsec-table-scroll">
                                    <table className="tbl geo-exempt-table">
                                        <thead><tr><th>User</th><th>Status</th><th>Source</th></tr></thead>
                                        <tbody>
                                            {holders.map((holder) => (
                                                <tr key={holder.id}>
                                                    <td>{holder.username}</td>
                                                    <td><Badge tone={holder.is_active ? 'success' : 'muted'}>{holder.is_active ? 'Active' : 'Inactive'}</Badge></td>
                                                    <td>
                                                        <Badge tone={holder.source === 'superuser' ? 'primary' : 'info'}>
                                                            {holder.source === 'superuser' ? 'Superuser' : 'Permission grant'}
                                                        </Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                    )}
                    <p className="dim">
                        {/* The honest cap, from the response's own count/capped pair. */}
                        {bypass.data?.capped
                            ? `Showing the first ${holders.length} of more than ${bypass.data.count ?? holders.length} — the endpoint caps at 200.`
                            : `Showing all ${bypass.data?.count ?? holders.length}.`}
                        {' '}Grants are managed on user records, not here.
                    </p>
                </div>
            </div>
        </div>
    );
}
