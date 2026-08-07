import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DomainPurchasesPage, RegistrantContactPage } from 'portal-mojo/admin/infrastructure';
import { getAuthSnapshot, login, mojoGet, setMockDnsRegistrarMode, type Me } from 'portal-mojo/client';

type Leg = 'manager' | 'missing-contact' | 'viewer' | 'platform';
const LEGS: Array<{ key: Leg; label: string; email: string }> = [
    { key: 'manager', label: 'Manager · ready', email: 'dns.manager@nativemojo.com' },
    { key: 'missing-contact', label: 'Manager · contact missing', email: 'dns.manager@nativemojo.com' },
    { key: 'viewer', label: 'Viewer · ledger only', email: 'dns.viewer@nativemojo.com' },
    { key: 'platform', label: 'Platform · House actions', email: 'dns.platform@nativemojo.com' },
];
export function AdminDnsRegistrarDemo() {
    const [leg, setLeg] = useState<Leg>('manager'); const [surface, setSurface] = useState<'purchases' | 'contact'>('purchases'); const [switching, setSwitching] = useState(true); const queryClient = useQueryClient();
    useEffect(() => { let current = true; void (async () => { setSwitching(true); const item = LEGS.find((candidate) => candidate.key === leg)!; setMockDnsRegistrarMode(leg === 'missing-contact' ? 'contact-missing' : 'ready'); await login(item.email, 'mojo'); if (!current) return; queryClient.clear(); const uid = getAuthSnapshot().uid; if (uid) await queryClient.fetchQuery({ queryKey: ['me', uid], queryFn: () => mojoGet<Me>('/api/user', 'me') }); if (current) setSwitching(false); })(); return () => { current = false; }; }, [leg, queryClient]);
    useEffect(() => () => { setMockDnsRegistrarMode('ready'); void login('showcase.operator@nativemojo.com', 'mojo'); }, []);
    return <div style={{ display: 'grid', gap: 14 }}><div className="panel panel-pad"><div className="eyebrow">Registrar safety lab</div><p className="dim">Exercises tri-state search, a one-use transient quote, submitted/failed/ambiguous durable-ledger evidence, inherited contact privacy, and literal-superuser House adoption. No real quote or purchase runs.</p></div><div className="seg" aria-label="Registrar showcase identity">{LEGS.map((item) => <button key={item.key} disabled={switching} className={`seg-btn${leg === item.key ? ' seg-active' : ''}`} onClick={() => setLeg(item.key)}>{item.label}</button>)}</div><div className="seg" aria-label="Registrar showcase surface"><button className={`seg-btn${surface === 'purchases' ? ' seg-active' : ''}`} onClick={() => setSurface('purchases')}>Purchases</button><button className={`seg-btn${surface === 'contact' ? ' seg-active' : ''}`} onClick={() => setSurface('contact')}>Registrant contact</button></div>{switching ? <div className="panel panel-pad dim">Switching controlled identity…</div> : surface === 'purchases' ? <DomainPurchasesPage /> : <RegistrantContactPage />}</div>;
}
