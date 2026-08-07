import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CertificatesPage } from 'portal-mojo/admin/infrastructure';
import {
    getAuthSnapshot, login, mojoGet, setMockDnsAcmeMode, type Me,
} from 'portal-mojo/client';

type Leg = 'manager-staging' | 'viewer' | 'platform' | 'unconfigured';

const LEGS: Array<{ key: Leg; label: string; email: string }> = [
    { key: 'manager-staging', label: 'Manager · staging', email: 'dns.manager@nativemojo.com' },
    { key: 'viewer', label: 'Viewer', email: 'dns.viewer@nativemojo.com' },
    { key: 'platform', label: 'Platform house access', email: 'dns.platform@nativemojo.com' },
    { key: 'unconfigured', label: 'ACME unconfigured', email: 'dns.manager@nativemojo.com' },
];

export function AdminDnsCertificatesDemo() {
    const [leg, setLeg] = useState<Leg>('manager-staging');
    const [switching, setSwitching] = useState(true);
    const queryClient = useQueryClient();
    useEffect(() => {
        let active = true;
        const select = async () => {
            setSwitching(true);
            const entry = LEGS.find((candidate) => candidate.key === leg)!;
            setMockDnsAcmeMode(leg === 'unconfigured' ? 'unconfigured' : 'staging');
            await login(entry.email, 'mojo');
            if (!active) return;
            queryClient.removeQueries({ queryKey: ['me'] });
            const uid = getAuthSnapshot().uid;
            if (uid) await queryClient.fetchQuery({ queryKey: ['me', uid], queryFn: () => mojoGet<Me>('/api/user', 'me') });
            queryClient.removeQueries({ queryKey: ['dnsman'] });
            queryClient.removeQueries({ queryKey: ['/api/dnsman/certificate'] });
            queryClient.removeQueries({ queryKey: ['/api/dnsman/domain'] });
            if (active) setSwitching(false);
        };
        void select();
        return () => { active = false; };
    }, [leg, queryClient]);
    useEffect(() => () => {
        setMockDnsAcmeMode('staging');
        void login('showcase.operator@nativemojo.com', 'mojo');
    }, []);
    return <div style={{ display: 'grid', gap: 14 }}>
        <div className="panel panel-pad">
            <div className="eyebrow">DNSMan certificate custody</div>
            <p className="dim" style={{ marginBottom: 0 }}>Pending, issuing, healthy, due-renewal, renewal-error, failed, revoked, house, verified-delegation, broken-sticky-delegation, malformed-response and no-material fixtures all use the central exact mock. No PEM fixture or material route exists.</p>
        </div>
        <div className="seg" style={{ flexWrap: 'wrap' }} aria-label="Certificate showcase state">
            {LEGS.map((entry) => <button key={entry.key} type="button" disabled={switching} className={`seg-btn${entry.key === leg ? ' seg-active' : ''}`} onClick={() => setLeg(entry.key)}>{entry.label}</button>)}
        </div>
        {switching ? <div className="panel panel-pad dim">Switching controlled certificate identity…</div> : <CertificatesPage />}
    </div>;
}
