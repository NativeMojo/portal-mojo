// GeoIP Cache — the GeoLocatedIPTablePage port. The source shipped six
// filters and a search placeholder promising "IP, country, or ISP"; the
// model's real SEARCH_FIELDS are `ip_address, city, country_name, asn_org,
// isp`, and eleven more fields are indexed and filterable. Both are corrected
// here rather than reproduced.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    Badge, ModelTable, formModal, fmt, toast,
    type Column, type FilterDef, type Tone,
} from '../../../ui';
import { useCan } from '../../../client';
import { COUNTRY_OPTIONS } from '../../../charts';
import { GEOIP_LOOKUP_FIELDS } from './geoip-forms';
import { showGeoIpDossier } from './GeoIpDossier';
import {
    GEOIP_MANAGE_PERMS, GeoLocatedIPModel, THREAT_LEVEL_OPTIONS,
    blockActive, blockExpired, countryFlag, geoIpSafeExporter, lookupGeoIp,
    threatTone, whitelistActive, whitelistExpired,
    type GeoLocatedIPRow,
} from './models';

const COLUMNS: Column<GeoLocatedIPRow>[] = [
    {
        key: 'ip_address', label: 'IP address', sortable: true, hideable: false,
        render: (row) => <code>{row.ip_address}</code>,
    },
    { key: 'city', label: 'City', sortable: true, render: (row) => row.city || '—' },
    { key: 'region', label: 'Region', sortable: true, render: (row) => row.region || '—' },
    {
        key: 'country_name', label: 'Country', sortable: true,
        render: (row) => {
            const flag = countryFlag(row.country_code);
            if (!row.country_code && !row.country_name) return '—';
            return <>{flag && <span className="geoip-flag">{flag}</span>}{row.country_name || row.country_code}</>;
        },
    },
    { key: 'isp', label: 'ISP', sortable: true, render: (row) => row.isp || row.asn_org || '—' },
    {
        key: 'threat_level', label: 'Threat', sortable: true,
        render: (row) => <Badge tone={threatTone(row.threat_level) as Tone}>{row.threat_level || 'none'}</Badge>,
    },
    {
        // Enforcement is COMPUTED, not `is_blocked` — an expired block reads
        // "Block expired", and a whitelist beats a block, exactly like the
        // model's Python properties.
        key: 'is_blocked', label: 'Enforcement', sortable: true,
        render: (row) => {
            if (blockActive(row)) return <Badge tone="danger"><i className="bi bi-slash-circle" /> Blocked</Badge>;
            if (whitelistActive(row)) return <Badge tone="info"><i className="bi bi-shield-check" /> Whitelisted</Badge>;
            if (blockExpired(row)) return <Badge tone="warning">Block expired</Badge>;
            if (whitelistExpired(row)) return <Badge tone="warning">Whitelist expired</Badge>;
            return <span className="dim">—</span>;
        },
    },
    { key: 'last_seen', label: 'Last seen', sortable: true, render: (row) => fmt.relative(row.last_seen) },
];

const FILTERS: FilterDef[] = [
    { key: 'country_code', label: 'Country', type: 'select', options: [...COUNTRY_OPTIONS] },
    { key: 'threat_level', label: 'Threat level', type: 'select', options: THREAT_LEVEL_OPTIONS.filter((o) => o.value !== '') },
    { key: 'isp', label: 'ISP contains', type: 'text' },
    { key: 'asn_org', label: 'ASN org contains', type: 'text' },
    { key: 'is_blocked', label: 'Blocked', type: 'boolean' },
    { key: 'is_whitelisted', label: 'Whitelisted', type: 'boolean' },
    { key: 'is_vpn', label: 'VPN', type: 'boolean' },
    { key: 'is_tor', label: 'Tor', type: 'boolean' },
    { key: 'is_proxy', label: 'Proxy', type: 'boolean' },
    { key: 'is_datacenter', label: 'Datacenter', type: 'boolean' },
    { key: 'is_known_attacker', label: 'Known attacker', type: 'boolean' },
    { key: 'last_seen', label: 'Last seen', type: 'daterange' },
];

export function GeoIpCachePage() {
    const qc = useQueryClient();
    const canManage = useCan(GEOIP_MANAGE_PERMS).can;
    const [busy, setBusy] = useState(false);

    /**
     * "Look up IP" is the ONE place `/system/geoip/lookup` is called. It
     * creates and refreshes records at provider cost behind a 30/ip rate
     * limit, so it is never a background query — and a 429 lands as a toast
     * rather than a silent no-op.
     */
    const onLookup = async () => {
        if (busy) return;
        const data = await formModal({
            title: 'Look up IP',
            fields: GEOIP_LOOKUP_FIELDS,
            submitText: 'Look up',
            intro: 'Fetches geolocation and threat intelligence from the configured provider and caches the result.',
        });
        const ip = String(data?.ip ?? '').trim();
        if (!ip) return;
        setBusy(true);
        try {
            const row = await lookupGeoIp(qc, ip);
            toast.success(`Looked up ${row.ip_address}`);
            showGeoIpDossier(row.id);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : `Lookup failed for ${ip}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <ModelTable<GeoLocatedIPRow>
            model={GeoLocatedIPModel}
            eyebrow="Security · IP Intelligence"
            title="GeoIP Cache"
            searchPlaceholder="Search IP, city, country, ASN org, or ISP"
            columns={COLUMNS}
            filters={FILTERS}
            presets={[
                { key: 'all', label: 'All', params: {} },
                { key: 'threats', label: 'Threats', params: { threat_level__in: 'high,critical' } },
                { key: 'blocked', label: 'Blocked', params: { is_blocked: 'true' } },
                { key: 'whitelisted', label: 'Whitelisted', params: { is_whitelisted: 'true' } },
                // One preset is one param bundle, and Django cannot OR across
                // three boolean columns — so this is honestly "Tor exits",
                // not a catch-all "Anonymizers". VPN and Proxy are filters.
                { key: 'tor', label: 'Tor exits', params: { is_tor: 'true' } },
            ]}
            defaultSort="-last_seen"
            columnChooser
            persistState
            persistKey="admin:geoip:cache"
            exporter={geoIpSafeExporter}
            exportFormats={['csv', 'json']}
            {...(canManage ? { addLabel: 'Look up IP', onAdd: () => void onLookup() } : {})}
            onRowClick={(row) => showGeoIpDossier(row.id)}
        />
    );
}
