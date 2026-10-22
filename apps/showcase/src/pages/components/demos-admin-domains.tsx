import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DomainsPage } from 'portal-mojo/admin/infrastructure';
import { getAuthSnapshot, login, mojoGet, setMockDnsRegistrarMode, type Me } from 'portal-mojo/client';

const PERSONAS = [
    { key: 'platform', label: 'Platform · all three actions', email: 'dns.platform@nativemojo.com' },
    { key: 'manager', label: 'Manager · register and buy', email: 'dns.manager@nativemojo.com' },
    { key: 'viewer', label: 'Viewer · inspect only', email: 'dns.viewer@nativemojo.com' },
] as const;

export function AdminDomainsDemo() {
    const [persona, setPersona] = useState<(typeof PERSONAS)[number]['key']>('platform');
    const [switching, setSwitching] = useState(true); const queryClient = useQueryClient();
    useEffect(() => {
        let current = true;
        void (async () => {
            setSwitching(true); setMockDnsRegistrarMode('ready');
            await login(PERSONAS.find((item) => item.key === persona)!.email, 'mojo');
            if (!current) return;
            queryClient.clear(); const uid = getAuthSnapshot().uid;
            if (uid) await queryClient.fetchQuery({ queryKey: ['me', uid], queryFn: () => mojoGet<Me>('/api/user', 'me') });
            if (current) setSwitching(false);
        })();
        return () => { current = false; };
    }, [persona, queryClient]);
    useEffect(() => () => { setMockDnsRegistrarMode('ready'); void login('showcase.operator@nativemojo.com', 'mojo'); }, []);
    return <div className="domains-demo"><details className="panel panel-pad demo-controls"><summary>Demo controls · mock data</summary><div className="eyebrow">Domains</div><p className="dim">Inspect provider, status, expiry and scope. Register an owned GoDaddy name, review an exact Platform adoption, or buy with a single-use quote. Advanced keeps external-domain and controller validation reachable. These are mock provider operations.</p><div className="seg" aria-label="Domains showcase identity">{PERSONAS.map((item) => <button key={item.key} className={`seg-btn${persona === item.key ? ' seg-active' : ''}`} disabled={switching} onClick={() => setPersona(item.key)}>{item.label}</button>)}</div></details>{switching ? <div className="panel panel-pad dim">Switching controlled identity…</div> : <DomainsPage />}</div>;
}
