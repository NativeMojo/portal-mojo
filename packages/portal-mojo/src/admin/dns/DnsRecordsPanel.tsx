import type { ReactNode } from 'react';
import { modal, toast } from '../../ui';
import { useCan } from '../../client/runtime';
import { deleteDnsRecordSet, useDnsCapabilities, useDnsRecordCoordinator, useDnsRecords } from './api';
import { DNS_RECORD_TYPES, diffRecordSet, isSpentAcmeChallenge, recordKey, recordWarnings, relativeRecordName, snapshotRecordOwner } from './dns-data';
import { DnsRecordEditor } from './DnsRecordEditor';
import { DNS_MANAGE_PERMISSIONS, type DnsRecordRow, type DomainRow } from './models';

export interface DnsRecordsPanelProps { domain: DomainRow; recordType?: string; onRecordTypeChange?: (type: string) => void }
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
const groupId = (domain: DomainRow): number | null => typeof domain.group === 'number' ? domain.group : domain.group?.id ?? null;

export function DnsRecordsPanel({ domain, recordType = '', onRecordTypeChange }: DnsRecordsPanelProps) {
    const active = domain.status === 'active';
    const generalProvider = ['route53', 'godaddy'].includes(domain.provider.toLowerCase());
    const credential = typeof domain.credential === 'object' ? domain.credential : null;
    const credentialUsable = domain.provider !== 'godaddy' || (!!credential && credential.is_active && credential.verified);
    const eligible = active && generalProvider && credentialUsable;
    const capabilities = useDnsCapabilities(groupId(domain), { enabled: eligible });
    const records = useDnsRecords(domain.id, eligible && !capabilities.isError);
    const { can: canManage } = useCan(DNS_MANAGE_PERMISSIONS);
    const coordinate = useDnsRecordCoordinator(domain.id);
    const providerKnown = capabilities.data?.providers.some((provider) => provider.name.toLowerCase() === domain.provider.toLowerCase()) ?? false;
    const rows = records.data?.records ?? [];
    const knownObserved = [...new Set(rows.map((record) => record.type.toUpperCase()))];
    const choices = [...DNS_RECORD_TYPES.filter((type) => capabilities.data?.allowed_record_types.includes(type) || knownObserved.includes(type)), ...knownObserved.filter((type) => !DNS_RECORD_TYPES.includes(type as typeof DNS_RECORD_TYPES[number]))];
    const visible = recordType ? rows.filter((record) => record.type.toUpperCase() === recordType.toUpperCase()) : rows;

    if (!active) return <Blocked title="DNS changes are unavailable">This domain is {domain.status}. Live records are available only after activation completes.</Blocked>;
    if (domain.provider === 'mojo') return <Blocked title="Certificate-only domain">Mojo domains mark delegated certificate coverage and do not support general DNS record management.</Blocked>;
    if (!generalProvider) return <Blocked title="Unsupported DNS provider">The {domain.provider || 'unknown'} provider does not expose general DNS through this administration surface.</Blocked>;
    if (!credentialUsable) return <Blocked title="Provider credential unavailable">This GoDaddy domain needs an active, verified provider credential. {credential?.is_active === false ? 'The linked credential is inactive.' : credential?.verified === false ? 'The linked credential is unverified.' : 'No usable credential is linked.'}</Blocked>;
    if (capabilities.isLoading) return <div className="dns-state dim">Loading DNS capabilities…</div>;
    if (capabilities.isError) return <Retry error={capabilities.error} retry={() => void capabilities.refetch()} />;
    if (!providerKnown) return <Blocked title="Provider unavailable">This deployment did not advertise {domain.provider} in its DNS capabilities.</Blocked>;
    if (records.isLoading) return <div className="dns-state dim">Reading the live provider zone…</div>;
    if (records.isError) return <Retry error={records.error} retry={() => void records.refetch()} />;

    const openEditor = (record?: DnsRecordRow) => {
        void modal.open<boolean>((close) => <DnsRecordEditor domain={domain} capabilities={capabilities.data!} records={rows} record={record} onClose={(saved) => close(saved)} />, { size: 'lg' });
    };
    const remove = async (record: DnsRecordRow) => {
        const opening = snapshotRecordOwner(rows, record.type, record.name);
        const diff = diffRecordSet(record, null);
        const warnings = recordWarnings({ provider: domain.provider, type: record.type, name: record.name, values: [], ttl: record.ttl, zone: domain.name, existingRecords: rows, before: record.record_values, deleting: true });
        const ok = await modal.confirm({ title: 'Delete whole record set?', danger: true, confirmText: 'Delete set', message: <div className="dns-confirm"><p>Delete <code>{record.type} {record.name}</code>?</p><p>Every value will be removed:</p><ul>{diff.removed.map((value, index) => <li key={`${value}-${index}`}><code>{value}</code></li>)}</ul>{warnings.map((warning) => <p className="dns-warning" key={warning}>{warning}</p>)}</div> });
        if (!ok) return;
        try {
            await coordinate({ opening, intended: null, write: () => deleteDnsRecordSet(domain.id, { type: record.type, name: record.name }) });
            toast.success('DNS record set deleted');
        } catch (error) {
            const ambiguous = error != null && typeof error === 'object' && 'dnsLiveStateApplied' in error;
            toast.error(`${errorMessage(error)}${ambiguous ? ' The refreshed live zone shows that the set is gone.' : ''}`);
        }
    };

    return <div className="dns-records-panel">
        <div className="dns-record-toolbar"><label className="field dns-record-filter"><span className="field-label">Record type</span><select className="input" value={recordType} onChange={(event) => onRecordTypeChange?.(event.target.value)}><option value="">All record types</option>{choices.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><div className="dns-toolbar-actions"><button type="button" className="btn" onClick={() => void records.refetch()}><i className={`bi ${records.isFetching ? 'bi-arrow-repeat spin' : 'bi-arrow-clockwise'}`} /> Refresh</button>{canManage && <button type="button" className="btn btn-primary" onClick={() => openEditor()}><i className="bi bi-plus-lg" /> Add record set</button>}</div></div>
        {domain.provider === 'godaddy' && <div className="dns-provider-note">GoDaddy DNS is managed here. Registrar purchase, renewal, privacy, and WHOIS remain in the provider account; refreshed TTLs have a 600-second floor and whole-set deletion is unavailable.</div>}
        {visible.length === 0 ? <div className="dns-state dim">{rows.length ? 'No records match this type.' : 'The provider returned an empty zone.'}</div> : <div className="dns-table-wrap"><table className="tbl dns-record-table"><thead><tr><th>Type</th><th>Name</th><th>Values</th><th>TTL</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((record) => {
            const type = record.type.toUpperCase();
            const supported = !!capabilities.data?.allowed_record_types.map((entry) => entry.toUpperCase()).includes(type) && DNS_RECORD_TYPES.includes(type as typeof DNS_RECORD_TYPES[number]);
            const spent = isSpentAcmeChallenge(domain.provider, record);
            const mayDelete = canManage && supported && !spent && domain.provider === 'route53' && !(['NS', 'SOA'].includes(type) && relativeRecordName(record.name, domain.name) === '@');
            return <tr key={recordKey(record)}><td><code>{type}</code>{spent && <span className="chip chip-muted dns-spent">spent</span>}</td><td><code>{relativeRecordName(record.name, domain.name)}</code></td><td><ul className="dns-record-values">{record.record_values.map((value, index) => <li key={`${value}-${index}`}><code>{value}</code></li>)}</ul></td><td>{record.ttl}s</td><td><div className="dns-row-actions">{canManage && supported && !spent && <button type="button" className="btn-icon" title="Edit complete set" onClick={() => openEditor(record)}><i className="bi bi-pencil" /></button>}{mayDelete && <button type="button" className="btn-icon text-bad" title="Delete complete set" onClick={() => void remove(record)}><i className="bi bi-trash" /></button>}</div></td></tr>;
        })}</tbody></table></div>}
    </div>;
}

function Blocked({ title, children }: { title: string; children: ReactNode }) { return <div className="dns-blocked"><i className="bi bi-shield-lock" /><div><strong>{title}</strong><p>{children}</p></div></div>; }
function Retry({ error, retry }: { error: unknown; retry: () => void }) { return <div className="dns-error" role="alert"><strong>Could not read the live zone.</strong><p>{errorMessage(error)}</p><button type="button" className="btn" onClick={retry}>Retry</button></div>; }
