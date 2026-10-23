import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CertificatesPage, DnsRecordsPage, DomainPurchasesPage, DomainsPage, ProviderCredentialsPage, RegistrantContactPage } from 'portal-mojo/admin/infrastructure';
import { useLocation, useNavigate } from 'react-router-dom';
import { armMockRegistrarPurchaseFault, getAuthSnapshot, login, mojoGet, setMockDnsRegistrarMode, type Me } from 'portal-mojo/client';

const PERSONAS = [
    { key: 'platform', label: 'Platform admin', email: 'dns.platform@nativemojo.com' },
    { key: 'manager', label: 'DNS manager', email: 'dns.manager@nativemojo.com' },
    { key: 'viewer', label: 'Viewer · inspect only', email: 'dns.viewer@nativemojo.com' },
] as const;

export function AdminDomainsDemo() {
    const { pathname } = useLocation(); const navigate = useNavigate();
    const [persona, setPersona] = useState<(typeof PERSONAS)[number]['key']>('platform');
    const [mode, setMode] = useState<'ready' | 'disabled' | 'contact-missing'>('ready');
    const [fault, setFault] = useState<'failed' | 'ambiguous' | null>(null);
    const [switching, setSwitching] = useState(true); const queryClient = useQueryClient();
    useEffect(() => {
        let current = true;
        void (async () => {
            setSwitching(true); setMockDnsRegistrarMode(mode); armMockRegistrarPurchaseFault(null); setFault(null);
            await login(PERSONAS.find((item) => item.key === persona)!.email, 'mojo');
            if (!current) return;
            queryClient.clear(); const uid = getAuthSnapshot().uid;
            if (uid) await queryClient.fetchQuery({ queryKey: ['me', uid], queryFn: () => mojoGet<Me>('/api/user', 'me') });
            if (current) setSwitching(false);
        })();
        return () => { current = false; };
    }, [persona, mode, queryClient]);
    useEffect(() => () => { setMockDnsRegistrarMode('ready'); armMockRegistrarPurchaseFault(null); void login('showcase.operator@nativemojo.com', 'mojo'); }, []);
    const target = pathname.split('/dns/')[1];
    const Page = target === 'records' ? DnsRecordsPage : target === 'purchases' ? DomainPurchasesPage : target === 'certificates' ? CertificatesPage : target === 'credentials' ? ProviderCredentialsPage : target === 'registrant' ? RegistrantContactPage : DomainsPage;
    return <div className="domains-demo"><details className="panel panel-pad demo-controls"><summary>Demo controls · mock data</summary><div className="seg" aria-label="Domains showcase identity">{PERSONAS.map(item => <button key={item.key} className={`seg-btn${persona === item.key ? ' seg-active' : ''}`} disabled={switching} onClick={() => setPersona(item.key)}>{item.label}</button>)}</div><label className="field"><span className="field-label">Purchase scenario</span><select className="input" value={mode} disabled={switching} onChange={event => setMode(event.target.value as typeof mode)}><option value="ready">Ready</option><option value="contact-missing">Contact setup needed</option><option value="disabled">Purchasing disabled</option></select></label><label className="field"><span className="field-label">Next purchase response</span><select className="input" value={fault ?? ''} disabled={switching} onChange={event => { const value = event.target.value as typeof fault | ''; setFault(value || null); armMockRegistrarPurchaseFault(value || null); }}><option value="">Normal</option><option value="ambiguous">Lost receipt</option><option value="failed">Provider failure</option></select></label></details>{Page !== DomainsPage && <div><button className="btn" onClick={() => navigate('/?demo=admin-domains')}><i className="bi bi-arrow-left" /> Back to Domains</button></div>}{switching ? <div className="panel panel-pad dim">Switching controlled identity…</div> : <Page />}</div>;
}
