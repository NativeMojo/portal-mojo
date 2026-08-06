// Global DNS administration foundation (#1429). The live leg below is the
// shipped page against the central mock; the other two legs document the
// fail-closed states reviewers need to exercise with the stable identities.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    ProviderCredentialsPage,
} from 'portal-mojo/admin';
import {
    getAuthSnapshot, login, mojoGet, setMockDnsConfigMalformed, type Me,
} from 'portal-mojo/client';
import { AdminDnsRecordsDemo } from './demos-admin-dns-records';

type Leg = 'manager' | 'viewer' | 'unavailable';

const LEGS: Array<{ key: Leg; label: string }> = [
    { key: 'manager', label: 'Manager — live' },
    { key: 'viewer', label: 'Viewer contract' },
    { key: 'unavailable', label: 'Capability unavailable' },
];

export function AdminDnsDemo() {
    const [leg, setLeg] = useState<Leg>('manager');
    const [switching, setSwitching] = useState(true);
    const queryClient = useQueryClient();

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

            {!switching && leg === 'manager' && (
                <>
                    <div className="panel panel-pad">
                        <div className="eyebrow">Executable manager leg</div>
                        <p className="dim" style={{ marginBottom: 0 }}>
                            Link with <code>invalid</code> in either secret to see first-link rejection;
                            use any other pair for a verified row. Open a row to rotate (failed rotation
                            preserves both masks), retire/activate, inspect masked detail, or arm deletion.
                        </p>
                    </div>
                    <ProviderCredentialsPage />
                    <AdminDnsRecordsDemo />
                </>
            )}

            {!switching && leg === 'viewer' && (
                <>
                    <div className="panel panel-pad">
                        <div className="eyebrow">Executable viewer leg</div>
                        <p className="dim" style={{ marginBottom: 0 }}>
                            The real page is signed in as the stable DNS viewer. Safe rows and masked
                            detail remain available; every mutation control is absent.
                        </p>
                    </div>
                    <ProviderCredentialsPage />
                    <AdminDnsRecordsDemo />
                </>
            )}

            {!switching && leg === 'unavailable' && (
                <>
                    <div className="panel panel-pad">
                        <div className="eyebrow">Executable fail-closed leg</div>
                        <p className="dim" style={{ marginBottom: 0 }}>
                            The real manager page receives a deliberately malformed config response;
                            no provider defaults or dependent controls may render.
                        </p>
                    </div>
                    <ProviderCredentialsPage />
                </>
            )}
        </div>
    );
}
