// Global DNS administration foundation (#1429). The live leg below is the
// shipped page against the central mock; the other two legs document the
// fail-closed states reviewers need to exercise with the stable identities.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
    ProviderCredentialsPage,
} from 'portal-mojo/admin';
import {
    getAuthSnapshot, login, mojoGet, setMockDnsConfigMalformed, type Me,
} from 'portal-mojo/client';
import { AdminDnsRecordsDemo } from './demos-admin-dns-records';

type Leg = 'manager' | 'viewer' | 'unavailable';
type Surface = 'credentials' | 'domains' | 'records';

const LEGS: Array<{ key: Leg; label: string }> = [
    { key: 'manager', label: 'Manager — live' },
    { key: 'viewer', label: 'Viewer contract' },
    { key: 'unavailable', label: 'Capability unavailable' },
];
const SURFACES: Array<{ key: Surface; label: string }> = [
    { key: 'credentials', label: 'Credentials' },
    { key: 'domains', label: 'Domains' },
    { key: 'records', label: 'DNS Records' },
];

export function AdminDnsDemo() {
    const [leg, setLeg] = useState<Leg>('manager');
    const [surface, setSurface] = useState<Surface>('credentials');
    const [switching, setSwitching] = useState(true);
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();

    const selectSurface = (nextSurface: Surface) => {
        // Every shipped page owns URL state. The showcase intentionally keeps
        // only its demo selector while crossing surfaces so a Records domain
        // cannot masquerade as a ModelTable filter on Domains/Credentials.
        const isolated = new URLSearchParams();
        const demo = searchParams.get('demo');
        if (demo) isolated.set('demo', demo);
        setSearchParams(isolated, { replace: true });
        setSurface(nextSurface);
    };

    useEffect(() => {
        const isolated = new URLSearchParams();
        const demo = searchParams.get('demo');
        if (demo) isolated.set('demo', demo);
        if (isolated.toString() === searchParams.toString()) return;
        setSearchParams(isolated, { replace: true });
        // One-time showcase mount isolation; production pages retain their
        // complete URL-backed contracts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let active = true;
        const selectIdentity = async () => {
            setSwitching(true);
            setMockDnsConfigMalformed(false);
            const email = leg === 'viewer'
                ? 'dns.viewer@nativemojo.com'
                : leg === 'unavailable' ? 'dns.manager@nativemojo.com' : 'showcase.operator@nativemojo.com';
            await login(email, 'mojo');
            if (!active) return;
            queryClient.removeQueries({ queryKey: ['me'] });
            const uid = getAuthSnapshot().uid;
            if (uid) {
                await queryClient.fetchQuery({
                    queryKey: ['me', uid],
                    queryFn: () => mojoGet<Me>('/api/user', 'me'),
                });
            }
            setMockDnsConfigMalformed(leg === 'unavailable');
            queryClient.removeQueries({ queryKey: ['dnsman'] });
            queryClient.removeQueries({ queryKey: ['/api/dnsman/credential'] });
            if (active) setSwitching(false);
        };
        void selectIdentity();
        return () => { active = false; };
    }, [leg, queryClient]);

    useEffect(() => () => {
        setMockDnsConfigMalformed(false);
        void login('showcase.operator@nativemojo.com', 'mojo');
    }, []);

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <div className="seg" style={{ flexWrap: 'wrap' }} aria-label="DNS showcase surface">
                {SURFACES.map((entry) => <button key={entry.key} type="button" disabled={switching} className={`seg-btn${surface === entry.key ? ' seg-active' : ''}`} onClick={() => selectSurface(entry.key)}>{entry.label}</button>)}
            </div>
            <div className="seg" style={{ flexWrap: 'wrap' }}>
                {LEGS.map((entry) => (
                    <button
                        key={entry.key}
                        type="button"
                        disabled={switching}
                        className={`seg-btn${leg === entry.key ? ' seg-active' : ''}`}
                        onClick={() => setLeg(entry.key)}
                    >
                        {entry.label}
                    </button>
                ))}
            </div>

            {switching && <div className="panel panel-pad dim">Switching controlled DNS identity…</div>}

            {!switching && <>
                <div className="panel panel-pad">
                    <div className="eyebrow">{leg === 'manager' ? 'Executable manager leg' : leg === 'viewer' ? 'Executable viewer leg' : 'Executable fail-closed leg'}</div>
                    <p className="dim" style={{ marginBottom: 0 }}>{leg === 'manager' ? 'The real selected surface runs with manager controls against the central mock.' : leg === 'viewer' ? 'The stable DNS viewer can inspect safe state while every mutation control remains absent.' : 'The manager receives a deliberately malformed capability response, so dependent controls fail closed.'}</p>
                </div>
                {surface === 'credentials' ? <ProviderCredentialsPage /> : <AdminDnsRecordsDemo surface={surface} />}
            </>}
        </div>
    );
}
