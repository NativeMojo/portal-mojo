import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { login } from 'portal-mojo/client';
import { GeoLocationPage } from '../../../../../packages/portal-mojo/src/admin/geolocation/GeoLocationPage';
import { mockGeoProviderScenarios, setMockGeoProviderScenario, type MockGeoProviderScenario } from '../../../../../packages/portal-mojo/src/client/geo-provider-mock';

export function AdminGeoLocationDemo() {
    const qc = useQueryClient();
    const [scenario, setScenario] = useState<MockGeoProviderScenario>('ready'), [persona, setPersona] = useState('dns.platform@nativemojo.com');
    const [ready, setReady] = useState(false), [narrow, setNarrow] = useState(false);
    useEffect(() => {
        let active = true; setReady(false); setMockGeoProviderScenario(scenario);
        void login(persona, 'mojo').then(async () => { await qc.invalidateQueries(); if (active) setReady(true); });
        return () => { active = false; };
    }, [scenario, persona, qc]);
    useEffect(() => () => { setMockGeoProviderScenario('ready'); void login('showcase.operator@nativemojo.com', 'mojo'); }, []);
    return <div style={{ display: 'grid', gap: 16, minWidth: 0 }}><section className="panel panel-pad"><h2>GeoLocation provider setup</h2><p>The actual global Admin page, backed only by local fixtures. Test verifies the Mojo credential; Save publishes provider changes and preserves a blank replacement. Advanced preserves ordered additional providers. No real provider is contacted.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}><label className="field"><span className="field-label">GeoLocation scenario</span><select className="input" value={scenario} onChange={e => { setReady(false); setScenario(e.target.value as MockGeoProviderScenario); }}>{mockGeoProviderScenarios.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="field"><span className="field-label">GeoLocation identity</span><select className="input" value={persona} onChange={e => { setReady(false); setPersona(e.target.value); }}><option value="dns.platform@nativemojo.com">Interactive superuser</option><option value="dns.manager@nativemojo.com">Ordinary manager (denied)</option></select></label><label><input type="checkbox" checked={narrow} onChange={e => setNarrow(e.target.checked)} /> 390px embedded page</label></div>
        <p className="dim">The published-origin-pending fixture deliberately shows a desired origin different from the node-loaded origin: keeping the key may fail until Fleet Configuration is applied. Use a replacement fixture key to proceed. The stale-revision fixture refuses the first Save; Refresh before retrying.</p>
    </section><div style={{ width: narrow ? 'min(100%, 390px)' : undefined, minWidth: 0 }}>{ready ? <GeoLocationPage key={`${scenario}:${persona}`} /> : <p role="status">Preparing local fixture…</p>}</div></div>;
}
