// IPSetEditor — the focused create/edit dialogs, ported from web-mojo
// `admin/models/IPSet.js` (IPSetForms) + `IPSetTablePage._handleAdd`'s
// country-code transform.
//
// TWO SAFETY FIXES over the source, both forced by the backend:
//
//  1. **Records are created DISABLED, and `is_enabled` is never written as a
//     plain field — here or in the edit form.** `on_action_enable` is the only
//     path that runs the cache-only rejection; a plain field write produces a
//     row that reads "Enabled" and silently never syncs (`sync()` no-ops for
//     cache-only sets without raising). Direct #1097 lineage. The source's
//     create form defaulted `is_enabled` to true and its edit form carried a
//     switch — both bypassed `on_action_enable` entirely.
//
//  2. **`data` is posted as a JSON LIST, never as a string.** `IPSet` defines
//     `set_data(cidr_list)` and `on_rest_save_field` prefers a `set_<key>`
//     method over a plain assignment, so a posted `data` runs
//     `"\n".join(value)`. A string therefore gets a newline interleaved
//     between every CHARACTER and `cidr_count` becomes the character count.
//     The source posted the raw textarea string.
import { formModal, type Field, type FormData } from '../../ui';
import { COUNTRY_OPTIONS, countryName } from '../../charts/worldmap/countryCentroids';
import {
    IPSET_COMMON_BLOCK_COUNTRIES, IPSET_KIND_BADGE_OPTIONS, IPSET_KIND_OPTIONS,
    IPSET_SOURCE_OPTIONS, parseCidrLines, type IPSetRow,
} from './models';

/**
 * The FULL ISO2 list with the twenty `CommonBlockCountries` pinned on top.
 * The source offered ONLY those twenty, so no other country could be blocked
 * from the UI at all.
 */
const COUNTRY_PICKER_OPTIONS: { value: string; label: string }[] = (() => {
    const common = IPSET_COMMON_BLOCK_COUNTRIES
        .filter((code) => COUNTRY_OPTIONS.some((option) => option.value === code))
        .map((code) => ({ value: code, label: `${countryName(code)} — commonly blocked` }));
    const rest = COUNTRY_OPTIONS.filter((option) => !IPSET_COMMON_BLOCK_COUNTRIES.includes(option.value));
    return [...common, ...rest.map((option) => ({ value: option.value, label: option.label }))];
})();

const CIDR_PLACEHOLDER = '# One CIDR per line\n192.0.2.0/24\n198.51.100.0/24\n203.0.113.0/24';

export const IPSET_CREATE_FIELDS: Field[] = [
    {
        name: 'kind', type: 'select', label: 'What do you want to block?',
        required: true, options: IPSET_KIND_OPTIONS, columns: 12,
    },
    {
        name: 'country_code', type: 'select', label: 'Country', required: true,
        options: COUNTRY_PICKER_OPTIONS, columns: 12,
        showWhen: { field: 'kind', value: 'country' },
        help: 'CIDRs are fetched from IPDeny. The set is named country_<code>, which is exactly what the backend derives the zone-file URL from.',
    },
    {
        name: 'source_key', type: 'text', label: 'AbuseIPDB API key', required: true,
        placeholder: 'Your AbuseIPDB API key', columns: 12,
        showWhen: { field: 'kind', value: 'abuse' },
        help: 'Write-only — the key is excluded from every serializer graph and can never be read back.',
    },
    {
        name: 'source_url', type: 'text', label: 'Source URL', required: true,
        placeholder: 'https://example.com/datacenter-ranges.txt', columns: 12,
        showWhen: { field: 'kind', value: 'datacenter' },
        help: 'A plain-text file with one CIDR per line.',
    },
    {
        name: 'data', type: 'textarea', label: 'CIDR list', columns: 12,
        placeholder: CIDR_PLACEHOLDER,
        showWhen: { field: 'kind', value: 'custom' },
        help: 'One range per line in CIDR notation. Blank lines and # comments are dropped before the list is sent.',
    },
    {
        name: 'name', type: 'text', label: 'Name', required: true,
        placeholder: 'abuse_ips, dc_aws…', columns: 6,
        showWhen: { field: 'kind', value: 'country', negate: true },
        help: 'Unique — used verbatim as the kernel ipset name.',
    },
    {
        name: 'description', type: 'text', label: 'Description',
        placeholder: 'Human-readable label', columns: 6,
        showWhen: { field: 'kind', value: 'country', negate: true },
    },
];

/**
 * The edit form. `kind` is disabled (changing it would orphan the source
 * plumbing) and `is_enabled` is ABSENT — enabling and disabling are actions.
 */
export const IPSET_EDIT_FIELDS: Field[] = [
    { name: 'name', type: 'text', label: 'Name', required: true, columns: 6 },
    { name: 'kind', type: 'select', label: 'Kind', options: IPSET_KIND_BADGE_OPTIONS, disabled: true, columns: 6 },
    { name: 'description', type: 'text', label: 'Description', columns: 12 },
    { name: 'source', type: 'select', label: 'Source', options: IPSET_SOURCE_OPTIONS, columns: 6 },
    { name: 'source_url', type: 'text', label: 'Source URL', columns: 6 },
    {
        name: 'source_key', type: 'text', label: 'API key', columns: 12,
        placeholder: 'Leave blank to keep the current key',
        help: 'Write-only — the stored value is never serialized, so this box is always empty.',
    },
    {
        name: 'data', type: 'textarea', label: 'CIDR list', columns: 12,
        placeholder: CIDR_PLACEHOLDER,
        showWhen: { field: 'kind', value: 'custom' },
        help: 'Saved as a list, so the stored CIDR count is recomputed by the server.',
    },
];

export interface IPSetCreatePayload {
    name: string;
    kind: string;
    source: string;
    description?: string;
    source_url?: string;
    source_key?: string;
    data?: string[];
}

/**
 * Reproduce the source's kind→fields transform. Returns null when the dialog
 * was cancelled or the derived country code is not the `[a-z]{2}` the backend
 * requires to build an ipdeny URL.
 */
export function buildIPSetCreatePayload(data: FormData): IPSetCreatePayload | null {
    const kind = String(data.kind ?? '');
    if (kind === 'country') {
        const code = String(data.country_code ?? '').toLowerCase();
        // `_fetch_ipdeny` raises unless the derived code matches [a-z]{2}.
        if (!/^[a-z]{2}$/.test(code)) return null;
        return {
            kind,
            name: `country_${code}`,
            source: 'ipdeny',
            description: `Country block: ${countryName(code.toUpperCase())}`,
        };
    }
    const base: IPSetCreatePayload = {
        kind,
        name: String(data.name ?? '').trim(),
        source: kind === 'abuse' ? 'abuseipdb' : 'manual',
        description: String(data.description ?? '').trim() || undefined,
    };
    if (kind === 'abuse') base.source_key = String(data.source_key ?? '').trim();
    if (kind === 'datacenter') base.source_url = String(data.source_url ?? '').trim();
    if (kind === 'custom') base.data = parseCidrLines(String(data.data ?? ''));
    return base;
}

/** Open the create dialog and return the ready-to-POST body (or null). */
export async function promptCreateIPSet(): Promise<IPSetCreatePayload | null> {
    const data = await formModal({
        title: 'Create IP set',
        fields: IPSET_CREATE_FIELDS,
        submitText: 'Create (disabled)',
        intro: 'The set is created DISABLED. Enabling it is a separate, armed action — that is the only path that runs the backend’s cache-only safety check and pushes CIDRs to the fleet.',
    });
    if (!data) return null;
    return buildIPSetCreatePayload(data);
}

/** Open the edit dialog and return the changed fields (or null). */
export async function promptEditIPSet(row: IPSetRow): Promise<Record<string, unknown> | null> {
    const data = await formModal({
        title: `Edit ${row.name}`,
        fields: IPSET_EDIT_FIELDS,
        submitText: 'Save',
        initial: {
            name: row.name,
            kind: row.kind,
            description: row.description ?? '',
            source: row.source,
            source_url: row.source_url ?? '',
            source_key: '',
            data: '',
        },
    });
    if (!data) return null;
    const changes: Record<string, unknown> = {
        name: String(data.name ?? '').trim(),
        description: String(data.description ?? '').trim(),
        source: String(data.source ?? ''),
        source_url: String(data.source_url ?? '').trim(),
    };
    // Write-only: an empty box means "keep the stored key", never "clear it".
    const key = String(data.source_key ?? '').trim();
    if (key) changes.source_key = key;
    // Only send `data` when the operator actually typed a list, and always as
    // an array — see the file header.
    const raw = String(data.data ?? '').trim();
    if (raw) changes.data = parseCidrLines(raw);
    return changes;
}
