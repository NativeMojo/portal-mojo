import { useMemo, useState, type ClipboardEvent } from 'react';
import { modal, toast } from '../../ui';
import { upsertDnsRecord, useDnsRecordCoordinator } from './api';
import {
    DNS_RECORD_TYPES, autofixFieldValue, blankRecordValue, diffRecordSet, formatRecordValue,
    parseRecordValue, recordWarnings, snapshotRecordOwner, specFor, toFqdn, validateRecordSet,
    type DnsCorrection, type StructuredRecordValue,
} from './dns-data';
import type { DnsCapabilities, DnsRecordRow, DomainRow } from './models';

export interface DnsRecordEditorProps {
    domain: DomainRow;
    capabilities: DnsCapabilities;
    records: readonly DnsRecordRow[];
    record?: DnsRecordRow;
    onClose: (saved: boolean) => void;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export function DnsRecordEditor({ domain, capabilities, records, record, onClose }: DnsRecordEditorProps) {
    const supported = DNS_RECORD_TYPES.filter((type) => capabilities.allowed_record_types.map((entry) => entry.toUpperCase()).includes(type));
    const [type, setType] = useState(record?.type.toUpperCase() ?? supported[0] ?? 'A');
    const [name, setName] = useState(record ? record.name : '@');
    const [ttl, setTtl] = useState(String(record?.ttl ?? 300));
    const [rows, setRows] = useState<StructuredRecordValue[]>(() => record?.record_values.map((value) => parseRecordValue(record.type, value)) ?? [blankRecordValue(type)]);
    const [corrections, setCorrections] = useState<DnsCorrection[]>([]);
    const [requestError, setRequestError] = useState<string | null>(null);
    const [stale, setStale] = useState(false);
    const [saving, setSaving] = useState(false);
    const coordinate = useDnsRecordCoordinator(domain.id);
    const fqdn = toFqdn(name, domain.name);
    const currentSpec = specFor(type);
    const values = rows.map((row) => formatRecordValue(type, row));
    const desired: DnsRecordRow = { type, name: fqdn, record_values: values, ttl: Number(ttl) };
    const validation = validateRecordSet({ type, name, values, ttl, zone: domain.name, existingRecords: records, caps: capabilities, original: record ?? null });
    const pendingCorrection = autofixFieldValue('hostname', name).value !== name
        || rows.some((row) => currentSpec?.fields.some((field) => field.kind !== 'text' && autofixFieldValue(field.kind, row[field.key]).value !== (row[field.key] ?? '')));
    const diff = diffRecordSet(record ?? null, desired);
    const unchanged = !!record && diff.added.length === 0 && diff.removed.length === 0 && diff.ttl.before === diff.ttl.after;
    const opening = useMemo(() => snapshotRecordOwner(records, record?.type ?? type, record?.name ?? fqdn), [records, record, type, fqdn]);

    const correctValue = (rowIndex: number, fieldKey: string, raw: string) => {
        const field = currentSpec?.fields.find((entry) => entry.key === fieldKey);
        if (!field) return;
        const result = autofixFieldValue(field.kind, raw, fieldKey, rowIndex);
        setRows((current) => current.map((entry, index) => index === rowIndex ? { ...entry, [fieldKey]: result.value } : entry));
        if (result.corrections.length) setCorrections((current) => [...current, ...result.corrections]);
    };
    const handlePaste = (event: ClipboardEvent<HTMLInputElement>, rowIndex: number, fieldKey: string) => {
        const raw = event.clipboardData.getData('text');
        const field = currentSpec?.fields.find((entry) => entry.key === fieldKey);
        if (!field) return;
        event.preventDefault();
        const result = autofixFieldValue(field.kind, raw, fieldKey, rowIndex);
        setRows((current) => current.map((entry, index) => index === rowIndex ? { ...entry, [fieldKey]: result.value } : entry));
        if (result.corrections.length) setCorrections((current) => [...current, ...result.corrections]);
    };
    const changeType = (next: string) => { setType(next); setRows([blankRecordValue(next)]); setCorrections([]); setRequestError(null); };
    const applyFix = (errorIndex: number) => {
        const fix = validation.errors[errorIndex]?.fix;
        if (fix?.action === 'change-type' && fix.type && !record) changeType(fix.type);
        if (fix?.action === 'set-name' && fix.name) setName(fix.name);
    };
    const save = async () => {
        setRequestError(null);
        const checked = validateRecordSet({ type, name, values, ttl, zone: domain.name, existingRecords: records, caps: capabilities, original: record ?? null });
        if (!checked.ok || pendingCorrection) return;
        const warnings = recordWarnings({ provider: domain.provider, type, name, values, ttl, zone: domain.name, existingRecords: records, before: record?.record_values ?? [] });
        const confirmed = await modal.confirm({
            title: record ? 'Replace complete record set?' : 'Create record set?',
            confirmText: record ? 'Replace set' : 'Create set',
            message: <div className="dns-confirm"><p><code>{type} {fqdn}</code></p>{diff.ttl.before !== diff.ttl.after && <p>TTL: {diff.ttl.before ?? 'new'} → {diff.ttl.after}</p>}<DiffList label="Unchanged" values={diff.unchanged} /><DiffList label="Remove" values={diff.removed} tone="bad" /><DiffList label="Add" values={diff.added} tone="ok" />{domain.provider === 'godaddy' && Number(ttl) < 600 && <p className="dns-warning">GoDaddy will refresh this TTL at its 600-second provider floor.</p>}{warnings.map((warning) => <p className="dns-warning" key={warning}>{warning}</p>)}</div>,
            danger: diff.removed.length > 0,
        });
        if (!confirmed) return;
        setSaving(true);
        try {
            await coordinate({ opening, intended: desired, write: () => upsertDnsRecord(domain.id, desired) });
            toast.success(record ? 'DNS record set updated' : 'DNS record set created');
            onClose(true);
        } catch (error) {
            if (error instanceof Error && error.name === 'DnsStaleSnapshotError') setStale(true);
            const ambiguous = error != null && typeof error === 'object' && 'dnsLiveStateApplied' in error;
            setRequestError(`${errorMessage(error)}${ambiguous ? ' The refreshed live zone already reflects the requested state.' : ''}`);
        } finally { setSaving(false); }
    };

    return <div className="modal-pad dns-editor">
        <h2 className="modal-title">{record ? 'Edit DNS record set' : 'Add DNS record set'}</h2>
        <p className="dim">Writes replace the complete <code>(type, name)</code> set. Existing identity is immutable.</p>
        {corrections.length > 0 && <div className="dns-corrections"><strong>Applied corrections</strong>{corrections.map((entry, index) => <div key={`${entry.field}-${index}`}><span>{entry.message}:</span> <code>{entry.before || '∅'}</code> → <code>{entry.after || '∅'}</code></div>)}</div>}
        {requestError && <div className="dns-error" role="alert">{requestError}</div>}
        <div className="dns-editor-grid">
            <label className="field"><span className="field-label">Type</span><select className="input" value={type} disabled={!!record} onChange={(event) => changeType(event.target.value)}>{supported.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
            <label className="field dns-name-field"><span className="field-label">Name</span><input className="input" value={name} disabled={!!record} onChange={(event) => setName(event.target.value)} onBlur={(event) => { const result = autofixFieldValue('hostname', event.target.value, 'name'); setName(result.value || '@'); setCorrections((current) => [...current, ...result.corrections]); }} /></label>
            <label className="field"><span className="field-label">TTL</span><input className="input" inputMode="numeric" value={ttl} onChange={(event) => setTtl(event.target.value)} /></label>
        </div>
        <div className="dns-fqdn">Normalized owner: <code>{fqdn || '—'}</code></div>
        <div className="dns-values"><div className="field-label">{currentSpec?.valuesLabel ?? 'Values'}</div>{rows.map((row, rowIndex) => <div className="dns-value-row" key={rowIndex}>{currentSpec?.fields.map((field) => field.kind === 'enum' ? <label className="field" key={field.key}><span className="field-label">{field.label}</span><select className="input" value={row[field.key] ?? ''} onChange={(event) => setRows((current) => current.map((entry, index) => index === rowIndex ? { ...entry, [field.key]: event.target.value } : entry))}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select></label> : <label className="field" key={field.key}><span className="field-label">{field.label}</span><input className="input" style={field.width ? { width: field.width } : undefined} value={row[field.key] ?? ''} onChange={(event) => setRows((current) => current.map((entry, index) => index === rowIndex ? { ...entry, [field.key]: event.target.value } : entry))} onPaste={(event) => handlePaste(event, rowIndex, field.key)} onBlur={(event) => correctValue(rowIndex, field.key, event.target.value)} /></label>)}{currentSpec?.multi && rows.length > 1 && <button className="btn-icon" type="button" title="Remove value" onClick={() => setRows((current) => current.filter((_, index) => index !== rowIndex))}><i className="bi bi-x-lg" /></button>}</div>)}{currentSpec?.multi && <button className="btn" type="button" onClick={() => setRows((current) => [...current, blankRecordValue(type)])}><i className="bi bi-plus-lg" /> Add value</button>}</div>
        {validation.errors.length > 0 && <div className="dns-errors" role="alert">{validation.errors.map((error, index) => <div key={`${error.field}-${error.index}-${index}`}>{error.message}{error.fix && (!record || error.fix.action !== 'change-type') && <button type="button" className="btn-link" onClick={() => applyFix(index)}>{error.fix.label}</button>}</div>)}</div>}
        {pendingCorrection && <div className="dns-errors" role="alert">Paste or leave the changed field to review and acknowledge its correction before saving.</div>}
        <div className="modal-actions"><button type="button" className="btn" onClick={() => onClose(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={saving || stale || !validation.ok || pendingCorrection || unchanged} onClick={() => void save()}>{saving ? 'Checking live zone…' : record ? 'Review replacement' : 'Review creation'}</button></div>
    </div>;
}

function DiffList({ label, values, tone }: { label: string; values: readonly string[]; tone?: 'bad' | 'ok' }) {
    if (!values.length) return null;
    return <div className={tone ? `text-${tone}` : undefined}><strong>{label}</strong><ul>{values.map((value, index) => <li key={`${value}-${index}`}><code>{value}</code></li>)}</ul></div>;
}
