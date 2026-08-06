// GeoIPForms — web-mojo `src/core/models/System.js:8-67`, ported field for
// field into portal-mojo's `Field` language. Nothing is dropped; `cols: 6/12`
// becomes `columns: 6/12`, `switch` stays `switch`, and the two numeric
// coordinate fields keep `type: 'number'`.
//
// Two deviations, both forced:
//   1. `editNetwork` in the source offered a `provider` text input, but
//      `provider` is excluded from the `default` graph, so the field always
//      rendered EMPTY and saving it wrote a blank over the real value. It is
//      dropped — provider is provenance the enrichment pipeline owns, and it
//      is visible read-only in the manage-gated raw reveal.
//   2. The source's `type: 'number'` becomes `type: 'text'`. portal-mojo's
//      field registry has no `number` renderer, so `'number'` would fall back
//      to a text input WITH a console.warn — the same control, plus noise. The
//      backend coerces FloatField/IntegerField from strings, so the wire is
//      unchanged; the expected format moves into `help`.
import type { Field, ModelForm } from '../../../client';
import { THREAT_LEVEL_OPTIONS } from './models';

export const GEOIP_EDIT_LOCATION_FIELDS: Field[] = [
    { name: 'ip_address', type: 'text', label: 'IP address', required: true, disabled: true, columns: 6 },
    { name: 'subnet', type: 'text', label: 'Subnet', columns: 6 },
    { name: 'country_name', type: 'text', label: 'Country', columns: 6 },
    { name: 'country_code', type: 'text', label: 'Country code', columns: 6, help: 'ISO 3166-1 alpha-2 (or alpha-3)' },
    { name: 'region', type: 'text', label: 'Region', columns: 6 },
    { name: 'region_code', type: 'text', label: 'Region code', columns: 6, help: 'ISO 3166-2 subdivision, e.g. US-CA' },
    { name: 'city', type: 'text', label: 'City', columns: 6 },
    { name: 'postal_code', type: 'text', label: 'Postal code', columns: 6 },
    { name: 'timezone', type: 'text', label: 'Timezone', columns: 6 },
    { name: 'latitude', type: 'text', label: 'Latitude', columns: 6, placeholder: '-90 … 90', help: 'Decimal degrees' },
    { name: 'longitude', type: 'text', label: 'Longitude', columns: 6, placeholder: '-180 … 180', help: 'Decimal degrees' },
];

export const GEOIP_EDIT_NETWORK_FIELDS: Field[] = [
    { name: 'asn', type: 'text', label: 'ASN', columns: 6 },
    { name: 'asn_org', type: 'text', label: 'ASN organization', columns: 6 },
    { name: 'isp', type: 'text', label: 'ISP', columns: 12 },
    { name: 'connection_type', type: 'text', label: 'Connection type', columns: 6, help: 'residential · business · hosting · cellular' },
    { name: 'mobile_carrier', type: 'text', label: 'Mobile carrier', columns: 6 },
    { name: 'is_mobile', type: 'switch', label: 'Mobile connection', columns: 6 },
    { name: 'is_cloud', type: 'switch', label: 'Cloud provider', columns: 6 },
    { name: 'is_datacenter', type: 'switch', label: 'Datacenter', columns: 6 },
];

export const GEOIP_EDIT_SECURITY_FIELDS: Field[] = [
    { name: 'threat_level', type: 'select', label: 'Threat level', columns: 12, options: [...THREAT_LEVEL_OPTIONS] },
    { name: 'risk_score', type: 'text', label: 'Risk score', columns: 6, placeholder: '0 … 100', help: 'Recomputed server-side from the flags below' },
    { name: 'is_known_attacker', type: 'switch', label: 'Known attacker', columns: 6 },
    { name: 'is_known_abuser', type: 'switch', label: 'Known abuser', columns: 6 },
    { name: 'is_tor', type: 'switch', label: 'Tor exit node', columns: 6 },
    { name: 'is_vpn', type: 'switch', label: 'VPN', columns: 6 },
    { name: 'is_proxy', type: 'switch', label: 'Proxy', columns: 6 },
];

export const GEOIP_LOOKUP_FIELDS: Field[] = [
    {
        name: 'ip', type: 'text', label: 'IP address', required: true,
        placeholder: 'e.g. 203.0.113.9',
        help: 'Creates the record when absent and refreshes it when stale. Rate limited to 30 lookups per source IP.',
    },
];

/** Block TTLs, exactly the source set (GeoIPView.js:1118-1128). */
export const GEOIP_BLOCK_TTL_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '3600', label: '1 hour' },
    { value: '21600', label: '6 hours' },
    { value: '86400', label: '24 hours' },
    { value: '604800', label: '7 days' },
    { value: '2592000', label: '30 days' },
    { value: '0', label: 'Permanent' },
];

export const GEOIP_BLOCK_FIELDS: Field[] = [
    { name: 'reason', type: 'text', label: 'Reason', required: true, placeholder: 'e.g. Suspicious activity' },
    { name: 'ttl', type: 'select', label: 'Duration', options: [...GEOIP_BLOCK_TTL_OPTIONS] },
];

export const GEOIP_UNBLOCK_FIELDS: Field[] = [
    { name: 'reason', type: 'text', label: 'Reason', placeholder: 'e.g. False positive' },
];

export const GEOIP_WHITELIST_FIELDS: Field[] = [
    { name: 'reason', type: 'text', label: 'Reason', required: true, placeholder: 'e.g. Known office IP' },
    {
        name: 'ttl', type: 'select', label: 'Expires', options: [
            { value: '0', label: 'Permanent' },
            { value: '86400', label: '24 hours' },
            { value: '604800', label: '7 days' },
            { value: '2592000', label: '30 days' },
        ],
    },
];

export const GEOIP_FORMS: Record<string, ModelForm> = {
    edit_location: { title: 'Edit location', submitText: 'Save', fields: GEOIP_EDIT_LOCATION_FIELDS },
    edit_network: { title: 'Edit network', submitText: 'Save', fields: GEOIP_EDIT_NETWORK_FIELDS },
    edit_security: { title: 'Edit security', submitText: 'Save', fields: GEOIP_EDIT_SECURITY_FIELDS },
    lookup: { title: 'Look up IP', submitText: 'Look up', fields: GEOIP_LOOKUP_FIELDS },
    block: { title: 'Block IP', submitText: 'Block', fields: GEOIP_BLOCK_FIELDS },
    unblock: { title: 'Unblock IP', submitText: 'Unblock', fields: GEOIP_UNBLOCK_FIELDS },
    whitelist: { title: 'Whitelist IP', submitText: 'Whitelist', fields: GEOIP_WHITELIST_FIELDS },
};
