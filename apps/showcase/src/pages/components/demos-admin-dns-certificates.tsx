import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CertificatesPage, DomainsPage, DomainDetail } from 'portal-mojo/admin/infrastructure';
import { getAuthSnapshot, login, mojoGet, setMockDnsAcmeMode, setMockSharedValidationScenario, type MockSharedValidationScenario, type Me } from 'portal-mojo/client';
import { openSharedValidation } from '../../../../../packages/portal-mojo/src/admin/dns/SharedValidationDialog';

const scenarios: Array<{ value: MockSharedValidationScenario; label: string }> = [
    { value: 'ready', label: 'New handshake' }, { value: 'controller-maintenance', label: 'Controller maintenance · pages + inactive consumer' }, { value: 'missing-trust', label: 'Awaiting controller' }, { value: 'revoked', label: 'Trust revoked' }, { value: 'pending-dns', label: 'DNS lookup pending' }, { value: 'changed-alias', label: 'Changed alias' }, { value: 'chained-alias', label: 'Chained alias' }, { value: 'unavailable', label: 'Hub disconnected' }, { value: 'unconfigured', label: 'Server unconfigured' }, { value: 'old-api', label: 'Older backend' }, { value: 'disabled', label: 'Sharing disabled' }, { value: 'renewal-error', label: 'Valid certificate · failed renewal' },
];
export function AdminDnsCertificatesDemo() {
    const [scenario, setScenario] = useState<MockSharedValidationScenario>('ready');
    const [persona, setPersona] = useState('dns.manager@nativemojo.com');
    const [surface, setSurface] = useState('domains'); const [narrow, setNarrow] = useState(false);
    const [switching, setSwitching] = useState(true); const qc = useQueryClient();
    useEffect(() => { setMockSharedValidationScenario(scenario); void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'dnsman' || String(q.queryKey[0]).startsWith('/api/dnsman') }); }, [scenario, qc]);
    useEffect(() => {
        let active = true; setSwitching(true); setMockDnsAcmeMode('staging');
        void (async () => { await login(persona, 'mojo'); if (!active) return; qc.removeQueries({ queryKey: ['me'] }); const uid = getAuthSnapshot().uid; if (uid) await qc.fetchQuery({ queryKey: ['me', uid], queryFn: () => mojoGet<Me>('/api/user', 'me') }); if (active) { await qc.invalidateQueries(); setSwitching(false); } })();
        return () => { active = false; };
    }, [persona, qc]);
    useEffect(() => () => { setMockSharedValidationScenario('ready'); setMockDnsAcmeMode('staging'); void login('showcase.operator@nativemojo.com', 'mojo'); }, []);
    return <div className="dns-shared-showcase">
        <div className="panel panel-pad"><div className="eyebrow">Independent wildcard certificates</div><p className="dim">Use existing <code>shared-acme.acme-hub.example</code> for acme.example, or <code>shared-customer.acme-hub.example</code> for a new customer.example in an eligible group. Prepare as Manager, download the public request file, switch to Controller, import it, find and select its allocation, and grant it, then switch back to connect, check and request. Persona changes preserve the mock handshake. Scenario changes reset it. For cold maintenance select the controller maintenance scenario and Allocation controller identity, open Controller review, check access and find maintenance.example. The last allocation and inactive consumer are on their second pages; no request file is needed to revoke or retry cleanup.</p></div>
        <div className="dns-shared-demo-controls">
            <label className="field"><span className="field-label">Scenario</span><select className="input" value={scenario} onChange={(e) => { setScenario(e.target.value as MockSharedValidationScenario); setSurface('domains'); }}>{scenarios.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
            <label className="field"><span className="field-label">Identity</span><select className="input" disabled={switching} value={persona} onChange={(e) => setPersona(e.target.value)}><option value="dns.manager@nativemojo.com">Project manager</option><option value="dns.platform@nativemojo.com">Allocation controller</option><option value="dns.viewer@nativemojo.com">Viewer</option></select></label>
            <label className="field"><span className="field-label">Existing DNS surface</span><select className="input" value={surface} onChange={(e) => setSurface(e.target.value)}><option value="domains">Domains entry</option><option value="detail">Fixed-domain detail</option><option value="certificates">Certificates</option></select></label>
            <label><input type="checkbox" checked={narrow} onChange={(e) => setNarrow(e.target.checked)} /> 390px embedded content</label>
            {persona !== 'dns.viewer@nativemojo.com' && <button className="btn" disabled={switching} onClick={() => void openSharedValidation()}>Open shared setup</button>}
        </div>
        <div style={{ width: narrow ? 390 : '100%', maxWidth: '100%' }}>
            {switching ? <div className="panel panel-pad dim">Switching controlled DNS identity…</div> : surface === 'detail' ? <DomainDetail id={8201} onClose={() => setSurface('domains')} /> : surface === 'certificates' ? <CertificatesPage /> : <DomainsPage />}
        </div>
    </div>;
}
