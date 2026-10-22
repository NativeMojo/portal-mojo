import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAuthSessionRevision, getAuthSnapshot, hasPermission, subscribeAuth, useAuthSnapshot, useMe } from '../../client/runtime';
import { Badge, FlatRow, fmt } from '../../ui';
import { OperationsHelp } from '../core/OperationsHelp';
import { fetchPurchaseDetail } from './api';
import { dnsAdminMount } from './domain-navigation';
import { PURCHASE_MAY_HAVE_MOVED, redactRegistrarError } from './purchase-data';
import { DNS_VIEW_PERMISSIONS, type DomainPurchaseRow } from './models';

export function DomainPurchaseDetail({ id, close, knownDomainId, privacyDowngraded = false }: { id: number; close: () => void; knownDomainId?: number; privacyDowngraded?: boolean }) {
    const { data: me } = useMe(); const auth = useAuthSnapshot();
    const revision = useSyncExternalStore(subscribeAuth, getAuthSessionRevision, getAuthSessionRevision);
    const canView = auth.authenticated && hasPermission(me ?? null, DNS_VIEW_PERMISSIONS, null);
    const owner = JSON.stringify([id, auth.uid, revision, canView]); const latest = useRef(owner); latest.current = owner;
    const [loaded, setLoaded] = useState<{ owner: string; row: DomainPurchaseRow } | null>(null);
    const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const flight = useRef(false); const generation = useRef(0);
    const location = useLocation(); const navigate = useNavigate(); const row = loaded?.owner === owner && canView ? loaded.row : null;
    const refresh = useCallback(async () => {
        if (!canView || flight.current || !Number.isInteger(id) || id <= 0) return;
        const accepted = ++generation.current, uid = auth.uid; flight.current = true; setLoading(true); setError('');
        const current = () => latest.current === owner && generation.current === accepted && getAuthSnapshot().uid === uid && getAuthSessionRevision() === revision;
        try { const value = await fetchPurchaseDetail(id); if (!current()) return; if (value.id !== id) throw new Error('The ledger response did not match this purchase'); setLoaded({ owner, row: value }); }
        catch (reason) { if (current()) setError(redactRegistrarError(reason)); }
        finally { if (current()) { flight.current = false; setLoading(false); } }
    }, [id, owner, canView, auth.uid, revision]);
    useEffect(() => { flight.current = false; setLoaded(null); setError(''); setLoading(false); void refresh(); return () => { generation.current++; }; }, [refresh]);
    const openDomain = () => {
        if (!row || row.status !== 'completed') return;
        if (knownDomainId && Number.isInteger(knownDomainId) && knownDomainId > 0) void import('./DomainDetail').then(({ showDomainDetails }) => { if (latest.current === owner && getAuthSnapshot().uid === auth.uid && getAuthSessionRevision() === revision) return showDomainDetails(knownDomainId); });
        else { close(); navigate(`${dnsAdminMount(location.pathname)}/dns/domains?search=${encodeURIComponent(row.domain_name)}`); }
    };
    return <div className="modal-pad dns-purchase-detail"><div className="eyebrow">Purchase #{id}</div><h2 className="modal-title">{row?.domain_name ?? 'Domain purchase'}</h2>
        {!canView && <p className="dim" role="status">DNS viewing permission is required to inspect this purchase.</p>}
        {loading && !row && <p className="dim" role="status">Loading purchase…</p>}{error && <div className="form-alert" role="alert">{row ? 'Refresh failed. Showing the previous result. ' : ''}{error}</div>}
        {row && <><div className="chip-row"><Badge tone={row.status === 'completed' ? 'success' : row.status === 'failed' || row.status === 'expired' ? 'danger' : 'warning'}>{row.status}</Badge><OperationsHelp label="purchase ledger">This is the durable record of this exact purchase. Refresh only reads its status; it never submits another purchase. A submitted status can remain here while the registrar finishes registration.</OperationsHelp></div>
            <FlatRow label="Price">{row.price ?? '—'} {row.currency} · {row.years} year{row.years === 1 ? '' : 's'}</FlatRow><FlatRow label="Created">{fmt.datetime(row.created)}</FlatRow>
            {row.status === 'quoted' && <FlatRow label="Quote expires">{fmt.datetime(row.quote_expires)}</FlatRow>}
            {row.operation_id && <FlatRow label="Registrar operation"><code>{row.operation_id}</code></FlatRow>}
            {row.error && <div className="form-alert">{redactRegistrarError(row.error)}</div>}
            {row.status === 'submitted' && <p className="form-alert">{PURCHASE_MAY_HAVE_MOVED}</p>}
            {privacyDowngraded && <p className="form-alert" role="alert">Registration proceeded without WHOIS privacy. Your registrant contact may be publicly visible.</p>}
        </>}
        <div className="modal-actions">{row?.status === 'completed' && <button className="btn" onClick={openDomain}>{knownDomainId ? 'View domain' : 'Find domain'}</button>}<button className="btn" disabled={!canView || loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh'}</button><button className="btn btn-primary" onClick={close}>Close</button></div>
    </div>;
}
