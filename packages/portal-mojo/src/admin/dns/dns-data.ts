import type { DnsCapabilities, DnsRecordRow } from './models';

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV', 'CAA', 'NS'] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];
export const CAA_TAGS = ['issue', 'issuewild', 'iodef'] as const;

export type RecordFieldKind = 'ipv4' | 'ipv6' | 'hostname' | 'uint16' | 'uint8' | 'port' | 'enum' | 'quoted' | 'text';
export interface RecordFieldSpec { key: string; label: string; kind: RecordFieldKind; default?: string; options?: readonly string[]; width?: string; grow?: boolean }
export interface RecordSpec { multi: boolean; valuesLabel: string; fields: readonly RecordFieldSpec[] }
export type StructuredRecordValue = Record<string, string>;

export const RECORD_SPECS: Readonly<Record<DnsRecordType, RecordSpec>> = {
    A: { multi: true, valuesLabel: 'IPv4 addresses', fields: [{ key: 'ip', label: 'IPv4 address', kind: 'ipv4', grow: true }] },
    AAAA: { multi: true, valuesLabel: 'IPv6 addresses', fields: [{ key: 'ip', label: 'IPv6 address', kind: 'ipv6', grow: true }] },
    CNAME: { multi: false, valuesLabel: 'Alias target', fields: [{ key: 'target', label: 'Target', kind: 'hostname', grow: true }] },
    TXT: { multi: true, valuesLabel: 'Text values', fields: [{ key: 'text', label: 'Value', kind: 'text', grow: true }] },
    MX: { multi: true, valuesLabel: 'Mail servers', fields: [{ key: 'priority', label: 'Priority', kind: 'uint16', default: '10', width: '96px' }, { key: 'target', label: 'Target', kind: 'hostname', grow: true }] },
    SRV: { multi: true, valuesLabel: 'Service targets', fields: [{ key: 'priority', label: 'Priority', kind: 'uint16', default: '10', width: '96px' }, { key: 'weight', label: 'Weight', kind: 'uint16', default: '10', width: '96px' }, { key: 'port', label: 'Port', kind: 'port', width: '96px' }, { key: 'target', label: 'Target', kind: 'hostname', grow: true }] },
    CAA: { multi: true, valuesLabel: 'Certificate authorities', fields: [{ key: 'flags', label: 'Flags', kind: 'uint8', default: '0', width: '86px' }, { key: 'tag', label: 'Tag', kind: 'enum', options: CAA_TAGS, default: 'issue', width: '130px' }, { key: 'value', label: 'Value', kind: 'quoted', grow: true }] },
    NS: { multi: true, valuesLabel: 'Nameservers', fields: [{ key: 'target', label: 'Nameserver', kind: 'hostname', grow: true }] },
};

const text = (value: unknown): string => value == null ? '' : String(value);
const stripDot = (value: string): string => value.replace(/\.+$/, '');
const stripQuotes = (value: string): string => value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
const LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/i;

export function specFor(type: unknown): RecordSpec | null {
    return RECORD_SPECS[text(type).toUpperCase() as DnsRecordType] ?? null;
}
export function blankRecordValue(type: unknown): StructuredRecordValue {
    return Object.fromEntries((specFor(type)?.fields ?? []).map((field) => [field.key, field.default ?? '']));
}
/** Compatibility with the completed web-mojo contract. */
export const blankValue = blankRecordValue;

export function recordKey(record: Pick<DnsRecordRow, 'type' | 'name'>): string {
    return `${text(record.type).trim().toUpperCase()}|${stripDot(text(record.name).trim().toLowerCase())}`;
}
export function isInZone(recordName: unknown, zone: unknown): boolean {
    const name = stripDot(text(recordName).trim().toLowerCase());
    const root = stripDot(text(zone).trim().toLowerCase());
    return !!root && (name === root || name.endsWith(`.${root}`));
}
export function toFqdn(name: unknown, zone: unknown): string {
    const raw = stripDot(text(name).trim().toLowerCase());
    const root = stripDot(text(zone).trim().toLowerCase());
    if (!raw || raw === '@') return root;
    if (raw.includes('.')) return raw;
    return root ? `${raw}.${root}` : raw;
}
export function relativeRecordName(name: unknown, zone: unknown): string {
    const fqdn = stripDot(text(name).trim().toLowerCase());
    const root = stripDot(text(zone).trim().toLowerCase());
    if (fqdn === root) return '@';
    return fqdn.endsWith(`.${root}`) ? fqdn.slice(0, -(root.length + 1)) : fqdn;
}
export function hasValidLabels(fqdn: unknown): boolean {
    const raw = stripDot(text(fqdn));
    return !!raw && raw.length <= 253 && raw.split('.').every((label, index) => label.length <= 63 && (label === '*' ? index === 0 : LABEL_RE.test(label)));
}

export function isIPv4(value: unknown): boolean {
    const parts = text(value).trim().split('.');
    return parts.length === 4 && parts.every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}
function ipv6Words(part: string): number | null {
    if (!part) return 0;
    const groups = part.split(':');
    let words = 0;
    for (let i = 0; i < groups.length; i += 1) {
        const group = groups[i]!;
        if (/^[0-9a-f]{1,4}$/i.test(group)) { words += 1; continue; }
        if (i === groups.length - 1 && isIPv4(group)) { words += 2; continue; }
        return null;
    }
    return words;
}
export function isIPv6(value: unknown): boolean {
    const raw = text(value).trim();
    if (!raw || raw.includes('%') || !raw.includes(':') || (raw.match(/::/g) ?? []).length > 1) return false;
    if (raw.includes(':::')) return false;
    const compressed = raw.includes('::');
    const [left = '', right = ''] = compressed ? raw.split('::') : [raw, ''];
    const leftWords = ipv6Words(left);
    const rightWords = compressed ? ipv6Words(right) : 0;
    if (leftWords == null || rightWords == null) return false;
    const total = leftWords + rightWords;
    return compressed ? total < 8 : total === 8;
}
export const isIP = (value: unknown): boolean => isIPv4(value) || isIPv6(value);
export function isHostname(value: unknown): boolean {
    const raw = stripDot(text(value).trim());
    return !!raw && raw.length <= 253 && !isIP(raw) && raw.split('.').length >= 2 && raw.split('.').every((label) => label.length <= 63 && LABEL_RE.test(label));
}
const isUint = (value: unknown, max: number): boolean => /^\d+$/.test(text(value).trim()) && Number(text(value).trim()) <= max;

export function isSpentAcmeChallenge(provider: unknown, record: Pick<DnsRecordRow, 'type' | 'name' | 'record_values'>): boolean {
    return text(provider).toLowerCase() === 'godaddy'
        && text(record.type).toUpperCase() === 'TXT'
        && (text(record.name).toLowerCase() === '_acme-challenge' || text(record.name).toLowerCase().startsWith('_acme-challenge.'))
        && record.record_values.length === 1 && text(record.record_values[0]).trim() === 'retired';
}
export const isAcmeChallenge = (record: Pick<DnsRecordRow, 'type' | 'name'>): boolean => text(record.type).toUpperCase() === 'TXT' && text(record.name).toLowerCase().startsWith('_acme-challenge');

export function parseRecordValue(type: unknown, wire: unknown): StructuredRecordValue {
    const spec = specFor(type);
    const raw = text(type).toUpperCase() === 'TXT' ? text(wire) : text(wire).trim();
    if (!spec) return { text: raw };
    if (spec.fields.length === 1) return { [spec.fields[0]!.key]: spec.fields[0]!.kind === 'quoted' ? stripQuotes(raw) : raw };
    const parts = raw ? raw.split(/\s+/) : [];
    return Object.fromEntries(spec.fields.map((field, index) => {
        const part = index === spec.fields.length - 1 ? parts.slice(index).join(' ') : parts[index] ?? '';
        return [field.key, field.kind === 'quoted' ? stripQuotes(part) : part];
    }));
}
export function formatRecordValue(type: unknown, value: StructuredRecordValue): string {
    const spec = specFor(type);
    if (!spec) return text(value.text).trim();
    if (text(type).toUpperCase() === 'TXT') return text(value.text);
    return spec.fields.map((field) => {
        const raw = text(value[field.key]).trim();
        return field.kind === 'quoted' && raw ? `"${stripQuotes(raw)}"` : raw;
    }).filter(Boolean).join(' ');
}
/** Shape conversion only: validation, never this helper, detects blanks/duplicates. */
export function normalizeRecordValues(input: unknown): string[] {
    if (Array.isArray(input)) return input.map(text);
    if (input == null) return [];
    return text(input).split('\n');
}

const ZERO_WIDTH_RE = /[\u200b\u200c\u200d\ufeff]/g;
const SMART_REPLACEMENTS: Record<string, string> = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"' };
export interface DnsCorrection { field: string; row: number | null; before: string; after: string; message: string }
function correct(step: DnsCorrection[], field: string, row: number | null, before: string, after: string, message: string): string {
    if (before !== after) step.push({ field, row, before, after, message });
    return after;
}
export function autofixFieldValue(kind: RecordFieldKind, raw: unknown, field = 'value', row: number | null = null): { value: string; fixes: string[]; corrections: DnsCorrection[] } {
    const corrections: DnsCorrection[] = [];
    let value = text(raw);
    let next = value.replace(ZERO_WIDTH_RE, ''); value = correct(corrections, field, row, value, next, 'Removed invisible characters');
    next = value.replace(/\u00a0/g, ' '); value = correct(corrections, field, row, value, next, 'Replaced non-breaking spaces');
    next = value.replace(/[\u2018\u2019\u201c\u201d]/g, (char) => SMART_REPLACEMENTS[char] ?? char); value = correct(corrections, field, row, value, next, 'Replaced curly quotes with plain quotes');
    next = value.trim(); value = correct(corrections, field, row, value, next, 'Trimmed surrounding whitespace');
    if (kind === 'hostname') {
        next = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''); value = correct(corrections, field, row, value, next, 'Removed the URL scheme');
        next = value.split('/')[0]!; value = correct(corrections, field, row, value, next, 'Removed the URL path');
        next = stripDot(value); value = correct(corrections, field, row, value, next, 'Removed the trailing dot');
        next = value.toLowerCase(); value = correct(corrections, field, row, value, next, 'Lowercased the hostname');
    } else if (kind === 'ipv4' || kind === 'ipv6') {
        next = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
        value = correct(corrections, field, row, value, next, 'Removed square brackets');
    } else if (kind === 'text' || kind === 'quoted') {
        next = stripQuotes(value); value = correct(corrections, field, row, value, next, 'Removed surrounding quotes');
    } else if (kind === 'enum') {
        next = value.toLowerCase(); value = correct(corrections, field, row, value, next, 'Lowercased the value');
    }
    return { value, fixes: corrections.map((entry) => entry.message), corrections };
}
export function autofixRecordValue(type: unknown, raw: unknown, row: number | null = null): { value: string; parts: StructuredRecordValue; fixes: string[]; corrections: DnsCorrection[] } {
    const parsed = parseRecordValue(type, raw);
    const spec = specFor(type);
    if (!spec) {
        const result = autofixFieldValue('text', raw, 'text', row);
        return { value: result.value, parts: { text: result.value }, fixes: result.fixes, corrections: result.corrections };
    }
    const parts: StructuredRecordValue = {};
    const corrections: DnsCorrection[] = [];
    for (const field of spec.fields) {
        const result = autofixFieldValue(field.kind, parsed[field.key], field.key, row);
        parts[field.key] = result.value; corrections.push(...result.corrections);
    }
    return { value: formatRecordValue(type, parts), parts, fixes: [...new Set(corrections.map((entry) => entry.message))], corrections };
}

export interface DnsValidationFix { action: 'change-type' | 'set-name'; type?: string; name?: string; label: string }
export interface DnsValidationError { index: number | null; field: string; message: string; fix?: DnsValidationFix }
export interface ValidateRecordSetOptions { type: unknown; name: unknown; values: unknown; ttl: unknown; zone: unknown; existingRecords?: readonly DnsRecordRow[]; caps?: Pick<DnsCapabilities, 'allowed_record_types'> | null; original?: Pick<DnsRecordRow, 'type' | 'name'> | null }
const validationError = (index: number | null, field: string, message: string, fix?: DnsValidationFix): DnsValidationError => ({ index, field, message, ...(fix ? { fix } : {}) });

export function validateRecordSet(options: ValidateRecordSetOptions): { ok: boolean; errors: DnsValidationError[]; fqdn: string } {
    const type = text(options.type).toUpperCase();
    const zone = stripDot(text(options.zone).trim().toLowerCase());
    const fqdn = toFqdn(options.name, zone);
    const errors: DnsValidationError[] = [];
    const allowed = options.caps?.allowed_record_types?.map((entry) => entry.toUpperCase()) ?? [...DNS_RECORD_TYPES];
    if (!type) errors.push(validationError(null, 'type', 'A record type is required.'));
    else if (!allowed.includes(type)) errors.push(validationError(null, 'type', `${type} is not an allowed record type (${allowed.join(', ')}).`));
    if (!fqdn) errors.push(validationError(null, 'name', 'A record name is required.'));
    else if (zone && !isInZone(fqdn, zone)) errors.push(validationError(null, 'name', `"${fqdn}" is not inside the ${zone} zone.`, { action: 'set-name', name: `${fqdn}.${zone}`, label: `Use ${fqdn}.${zone}` }));
    else if (!hasValidLabels(fqdn)) errors.push(validationError(null, 'name', fqdn.split('.').includes('*') ? 'A wildcard may only be the leftmost label.' : `"${fqdn}" is not a valid record name.`));
    const apex = !!zone && fqdn === zone;
    if (apex && ['NS', 'SOA'].includes(type)) errors.push(validationError(null, 'type', `The apex ${type} record set cannot be changed.`));
    if (apex && type === 'CNAME') errors.push(validationError(null, 'name', "A CNAME can't sit at the apex."));
    if (options.original && (recordKey({ type, name: fqdn }) !== recordKey(options.original))) errors.push(validationError(null, 'identity', 'Existing record type and name are immutable.'));

    const originalKey = options.original ? recordKey(options.original) : null;
    const other = (options.existingRecords ?? []).filter((record) => recordKey(record) !== originalKey && stripDot(record.name.toLowerCase()) === fqdn);
    if (type === 'CNAME' && other.length) errors.push(validationError(null, 'name', `${fqdn} already has ${other.map((record) => record.type.toUpperCase()).join(', ')}. A CNAME cannot coexist with another record.`));
    if (type !== 'CNAME' && other.some((record) => record.type.toUpperCase() === 'CNAME')) errors.push(validationError(null, 'name', `${fqdn} is a CNAME. No other record type can share that name.`));

    const values = normalizeRecordValues(options.values);
    const spec = specFor(type);
    if (!values.length) errors.push(validationError(null, 'values', 'At least one value is required.'));
    if (spec && !spec.multi && values.length > 1) errors.push(validationError(null, 'values', `A ${type} record holds exactly one value.`));
    const seen = new Set<string>();
    values.forEach((wire, index) => {
        if (!wire || wire.trim() === '') errors.push(validationError(index, 'value', 'A record value is required.'));
        else if (type !== 'TXT' && wire.trim() !== wire) errors.push(validationError(index, 'value', 'Apply the visible correction before saving.'));
        if (seen.has(wire)) errors.push(validationError(index, 'value', 'Duplicate values are not allowed.'));
        seen.add(wire);
        const parts = parseRecordValue(type, wire);
        for (const field of spec?.fields ?? []) {
            const value = parts[field.key] ?? '';
            if (!value || (type === 'TXT' && value.trim() === '')) { errors.push(validationError(index, field.key, `${field.label} is required.`)); continue; }
            if (field.kind === 'ipv4' && !isIPv4(value)) errors.push(validationError(index, field.key, isIPv6(value) ? "That's IPv6 — use AAAA." : `"${value}" is not a valid IPv4 address.`, isIPv6(value) ? { action: 'change-type', type: 'AAAA', label: 'Change type to AAAA' } : undefined));
            if (field.kind === 'ipv6' && !isIPv6(value)) errors.push(validationError(index, field.key, isIPv4(value) ? "That's IPv4 — use A." : `"${value}" is not a valid IPv6 address.`, isIPv4(value) ? { action: 'change-type', type: 'A', label: 'Change type to A' } : undefined));
            if (field.kind === 'hostname' && !isHostname(value)) errors.push(validationError(index, field.key, isIP(value) ? `${field.label} must be a hostname, not an IP address.` : `"${value}" is not a valid hostname.`));
            if (field.kind === 'uint16' && !isUint(value, 65535)) errors.push(validationError(index, field.key, `${field.label} must be 0 to 65535.`));
            if (field.kind === 'uint8' && !isUint(value, 255)) errors.push(validationError(index, field.key, `${field.label} must be 0 to 255.`));
            if (field.kind === 'port' && (!isUint(value, 65535) || Number(value) === 0)) errors.push(validationError(index, field.key, 'Port must be 1 to 65535.'));
            if (field.kind === 'enum' && field.options && !field.options.includes(value.toLowerCase())) errors.push(validationError(index, field.key, `${field.label} must be one of: ${field.options.join(', ')}.`));
        }
    });
    const ttl = Number(options.ttl);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) errors.push(validationError(null, 'ttl', 'TTL must be a whole number of seconds from 60 to 86400.'));
    return { ok: errors.length === 0, errors, fqdn };
}

export interface RecordValueDiff { added: string[]; removed: string[]; unchanged: string[] }
export function diffRecordValues(before: readonly string[] | unknown, after: readonly string[] | unknown): RecordValueDiff {
    const from = normalizeRecordValues(before); const to = normalizeRecordValues(after);
    return { added: to.filter((value) => !from.includes(value)), removed: from.filter((value) => !to.includes(value)), unchanged: from.filter((value) => to.includes(value)) };
}
export interface RecordSetDiff extends RecordValueDiff { key: string; type: string; name: string; ttl: { before: number | null; after: number | null } }
export function diffRecordSet(before: DnsRecordRow | null, after: DnsRecordRow | null): RecordSetDiff {
    const identity = after ?? before ?? { type: '', name: '', record_values: [], ttl: 0 };
    return { key: recordKey(identity), type: identity.type, name: identity.name, ...diffRecordValues(before?.record_values ?? [], after?.record_values ?? []), ttl: { before: before?.ttl ?? null, after: after?.ttl ?? null } };
}
export function recordWarnings(options: { provider?: string; type: unknown; name: unknown; values?: unknown; ttl?: unknown; zone: unknown; existingRecords?: readonly DnsRecordRow[]; before?: unknown; deleting?: boolean }): string[] {
    const type = text(options.type).toUpperCase(); const fqdn = toFqdn(options.name, options.zone); const values = normalizeRecordValues(options.values); const warnings: string[] = [];
    const current = (options.existingRecords ?? []).find((record) => recordKey(record) === recordKey({ type, name: fqdn }));
    if (current && isAcmeChallenge(current) && !isSpentAcmeChallenge(options.provider, current)) warnings.push('This is a live _acme-challenge record. Changing it can fail certificate issuance.');
    if (['A', 'AAAA'].includes(type) && (fqdn === stripDot(text(options.zone)) || fqdn === `www.${stripDot(text(options.zone))}`) && (options.deleting || !values.length)) warnings.push(`Removing the ${type} record for ${fqdn} will take that address offline.`);
    if (type === 'MX') warnings.push('Changing MX records changes where mail for this domain is delivered.');
    if (fqdn.startsWith('*.')) warnings.push('This wildcard record answers for every name without a more specific record.');
    if (Number(options.ttl) >= 60 && Number(options.ttl) < 300) warnings.push(`A TTL of ${options.ttl}s is very short.`);
    if (type === 'SRV' && !/^_[^.]+\._[^.]+\./.test(fqdn)) warnings.push('SRV names are normally _service._protocol.name.');
    const before = normalizeRecordValues(options.before); const removed = diffRecordValues(before, values).removed;
    if (!options.deleting && removed.length && values.length < before.length) warnings.push(`${before.length - values.length} existing ${before.length - values.length === 1 ? 'value' : 'values'} will be removed.`);
    return warnings;
}

export interface RecordOwnerSnapshot { key: string; owner: string; exact: DnsRecordRow | null; ownerRecords: DnsRecordRow[] }
const cloneRecord = (record: DnsRecordRow): DnsRecordRow => ({ type: record.type, name: record.name, record_values: [...record.record_values], ttl: record.ttl });
export function snapshotRecordOwner(records: readonly DnsRecordRow[], type: string, name: string): RecordOwnerSnapshot {
    const key = recordKey({ type, name }); const owner = stripDot(name.toLowerCase());
    const ownerRecords = records.filter((record) => stripDot(record.name.toLowerCase()) === owner).map(cloneRecord);
    return { key, owner, exact: ownerRecords.find((record) => recordKey(record) === key) ?? null, ownerRecords };
}
export function sameRecordOwnerSnapshot(a: RecordOwnerSnapshot, b: RecordOwnerSnapshot): boolean {
    const canonical = (snapshot: RecordOwnerSnapshot) => JSON.stringify(snapshot.ownerRecords.map((record) => ({ ...record, type: record.type.toUpperCase(), name: stripDot(record.name.toLowerCase()) })).sort((x, y) => recordKey(x).localeCompare(recordKey(y))));
    return a.key === b.key && a.owner === b.owner && canonical(a) === canonical(b);
}
