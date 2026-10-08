// Edge admin (#1616): the shipped pages against the central mock, under the
// stable identities a reviewer needs to see each permission split.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BlocklistPage, UpstreamsPage, VhostsPage, openBlocklistEditor, openDeclareUpstream, openVhostWizard } from 'portal-mojo/admin/infrastructure';
import { getAuthSnapshot, login, mojoGet, type Me } from 'portal-mojo/client';

type Surface = 'vhosts' | 'upstreams' | 'blocklist';
type Leg = 'platform' | 'manager' | 'viewer' | 'security' | 'security-viewer';

const SURFACES: Array<{ key: Surface; label: string }> = [
    { key: 'vhosts', label: 'Vhosts' },
    { key: 'upstreams', label: 'Upstreams' },
    { key: 'blocklist', label: 'Edge Blocklist' },
];
const LEGS: Array<{ key: Leg; label: string; email: string; opens: Surface[]; note: string }> = [
    { key: 'platform', label: 'Platform administrator', email: 'dns.platform@nativemojo.com', opens: ['vhosts', 'upstreams', 'blocklist'], note: 'Sees house rows, and may declare and retire upstreams.' },
    { key: 'manager', label: 'DNS manager', email: 'dns.manager@nativemojo.com', opens: ['vhosts', 'upstreams'], note: 'Creates and edits vhosts and routes, and switches an upstream on or off. House rows are hidden.' },
    { key: 'viewer', label: 'DNS viewer', email: 'dns.viewer@nativemojo.com', opens: ['vhosts', 'upstreams'], note: 'Reads everything a manager sees; every change control is absent.' },
    { key: 'security', label: 'Security manager', email: 'security.manager@nativemojo.com', opens: ['blocklist'], note: 'Owns the fleet blocklist. Has no access to vhosts.' },
    { key: 'security-viewer', label: 'Security viewer', email: 'security.viewer@nativemojo.com', opens: ['blocklist'], note: 'Reads the blocklist; cannot change it.' },
];

export function AdminEdgeDemo() {
    const [leg, setLeg] = useState<Leg>('platform');
    const [surface, setSurface] = useState<Surface | null>(null);
    const [pendingSurface, setPendingSurface] = useState<Surface | null>('vhosts');
    const [switching, setSwitching] = useState(true);
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const identity = LEGS.find((entry) => entry.key === leg)!;

    const selectSurface = (next: Surface) => {
        if (surface === next && pendingSurface == null) return;
        setPendingSurface(next);
        // Each page owns the URL params; empty the slot before the next mounts.
        setSurface(null);
    };

    useEffect(() => {
        if (surface !== null || pendingSurface == null) return;
        const isolated = new URLSearchParams();
        const demo = searchParams.get('demo');
        if (demo) isolated.set('demo', demo);
        if (isolated.toString() !== searchParams.toString()) {
            setSearchParams(isolated, { replace: true });
            return; // wait for the router to publish the clean params
        }
        setSurface(pendingSurface);
        setPendingSurface(null);
    }, [surface, pendingSurface, searchParams, setSearchParams]);

    useEffect(() => {
        let active = true;
        const selectIdentity = async () => {
            setSwitching(true);
            await login(identity.email, 'mojo');
            if (!active) return;
            queryClient.removeQueries({ queryKey: ['me'] });
            const uid = getAuthSnapshot().uid;
            if (uid) await queryClient.fetchQuery({ queryKey: ['me', uid], queryFn: () => mojoGet<Me>('/api/user', 'me') });
            for (const endpoint of ['/api/edge/vhost', '/api/edge/route', '/api/edge/upstream', '/api/edge/blocklist', '/api/dnsman/domain', '/api/dnsman/certificate']) {
                queryClient.removeQueries({ queryKey: [endpoint] });
            }
            if (active) setSwitching(false);
        };
        void selectIdentity();
        return () => { active = false; };
    }, [identity.email, queryClient]);

    useEffect(() => () => { void login('showcase.operator@nativemojo.com', 'mojo'); }, []);

    const shown = surface ?? pendingSurface;
    const allowed = surface !== null && identity.opens.includes(surface);
    const canChangeVhosts = leg === 'platform' || leg === 'manager';

    return (
        <div style={{ display: 'grid', gap: 14 }}>
            <div className="seg" style={{ flexWrap: 'wrap' }} aria-label="Edge showcase surface">
                {SURFACES.map((entry) => <button key={entry.key} type="button" disabled={switching || surface === null} className={`seg-btn${shown === entry.key ? ' seg-active' : ''}`} onClick={() => selectSurface(entry.key)}>{entry.label}</button>)}
            </div>
            <div className="seg" style={{ flexWrap: 'wrap' }} aria-label="Edge showcase identity">
                {LEGS.map((entry) => <button key={entry.key} type="button" disabled={switching || surface === null} className={`seg-btn${leg === entry.key ? ' seg-active' : ''}`} onClick={() => setLeg(entry.key)}>{entry.label}</button>)}
            </div>

            {switching && <div className="panel panel-pad dim">Switching identity…</div>}
            {!switching && surface === null && <div className="panel panel-pad dim">Switching surface…</div>}

            {!switching && surface !== null && <>
                <div className="panel panel-pad">
                    <div className="eyebrow">{identity.label}</div>
                    <p className="dim">{identity.note}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {canChangeVhosts && <button type="button" className="btn" onClick={() => void openVhostWizard()}><i className="bi bi-magic" /> Vhost wizard: pick a shape, then only its settings</button>}
                        {leg === 'platform' && <button type="button" className="btn" onClick={() => void openDeclareUpstream()}><i className="bi bi-hdd-rack" /> Declare upstream</button>}
                        {leg === 'security' && <button type="button" className="btn" onClick={() => void openBlocklistEditor()}><i className="bi bi-slash-circle" /> New blocklist entry: log first</button>}
                    </div>
                    <p className="dim" style={{ marginBottom: 0 }}>To see the create order for a site with API paths: open the wizard, choose “Site + API paths”, add a route and a quiet path under it. The vhost is created disabled, the routes land, then one last save applies the quiet paths and switches it on.</p>
                </div>
                {!allowed && <div className="panel panel-pad"><div className="eyebrow">Denied</div><p className="dim" style={{ marginBottom: 0 }}>This identity has no access to this surface, and the navigation would not show it.</p></div>}
                {allowed && surface === 'vhosts' && <VhostsPage />}
                {allowed && surface === 'upstreams' && <UpstreamsPage />}
                {allowed && surface === 'blocklist' && <BlocklistPage />}
            </>}
        </div>
    );
}
