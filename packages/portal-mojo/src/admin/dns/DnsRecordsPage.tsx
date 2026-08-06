import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CollectionSelect } from '../../ui';
import { DnsRecordsPanel } from './DnsRecordsPanel';
import { DomainModel, type DomainRow } from './models';

export function DnsRecordsPage() {
    const [params, setParams] = useSearchParams();
    const rawDomain = params.get('domain');
    const parsed = rawDomain != null && /^[1-9]\d*$/.test(rawDomain) ? Number(rawDomain) : null;
    const invalidSyntax = rawDomain != null && parsed == null;
    const first = DomainModel.useList({ status: 'active', sort: 'name', size: 1 }, { enabled: rawDomain == null });
    const selected = DomainModel.useOne(parsed);
    const recordType = params.get('record_type') ?? '';
    const update = (key: 'domain' | 'record_type', value: string | number | null) => {
        const next = new URLSearchParams(params);
        if (value == null || value === '') next.delete(key); else next.set(key, String(value));
        setParams(next, { replace: true });
    };
    useEffect(() => {
        if (rawDomain != null || !first.data?.rows[0]) return;
        update('domain', first.data.rows[0].id);
    }, [rawDomain, first.data]);
    const domain = selected.data;
    return <div className="dns-records-page">
        <div className="panel panel-pad dns-records-picker"><div><div className="eyebrow">Infrastructure · DNS</div><h1>DNS Records</h1><p className="dim">Live provider record sets. Writes always replace a complete type/name set.</p></div><CollectionSelect<DomainRow> model={DomainModel} label="Active domain" value={parsed} onChange={(id) => update('domain', id)} defaultParams={{ status: 'active', sort: 'name' }} placeholder="Search active domains…" maxItems={50} /></div>
        {rawDomain == null && first.isPending && <div className="panel panel-pad dim">Finding the first active domain…</div>}
        {rawDomain == null && first.isError && <div className="panel panel-pad text-bad">{first.error.message}</div>}
        {rawDomain == null && first.data && first.data.rows.length === 0 && <div className="panel panel-pad dim">No active DNS domains are available.</div>}
        {invalidSyntax && <div className="panel panel-pad text-bad">The deep-linked domain id is invalid. Choose an active domain explicitly.</div>}
        {parsed != null && selected.isPending && <div className="panel panel-pad dim">Loading the selected domain…</div>}
        {parsed != null && selected.isError && <div className="panel panel-pad text-bad">{selected.error.message}. The selection was preserved; no fallback domain was chosen.</div>}
        {domain && domain.status !== 'active' && <div className="panel panel-pad text-bad">{domain.name} is {domain.status}, not active. The selection was preserved; choose another domain explicitly.</div>}
        {domain?.status === 'active' && <div className="panel panel-pad"><DnsRecordsPanel domain={domain} recordType={recordType} onRecordTypeChange={(value) => update('record_type', value)} /></div>}
    </div>;
}
