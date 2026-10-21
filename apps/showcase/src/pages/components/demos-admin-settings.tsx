import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { login, setMockConnectionScenario, type MockConnectionScenario } from 'portal-mojo/client';
import { SharedValidationConnectionPage } from '../../../../../packages/portal-mojo/src/admin/fleet-configuration/SharedValidationConnectionPanel';
import {
    SettingsPage,
    buildSettingPayload,
    type SettingRow,
} from 'portal-mojo/admin/operations';

const SECRET_ROW: SettingRow = {
    id: 402,
    created: 1_720_000_000,
    modified: 1_725_000_000,
    key: 'MAIL_API_TOKEN',
    display_value: '******',
    is_secret: true,
    group: null,
};

const PLAIN_ROW: SettingRow = {
    ...SECRET_ROW,
    id: 401,
    key: 'MAIL_FROM_NAME',
    value: 'NativeMojo',
    display_value: 'NativeMojo',
    is_secret: false,
};

export function AdminSettingsDemo() {
    const toPlain = buildSettingPayload({
        key: SECRET_ROW.key,
        value: '',
        valueTouched: true,
        is_secret: false,
        group: null,
    }, SECRET_ROW);
    const toSecret = buildSettingPayload({
        key: PLAIN_ROW.key,
        value: 'replacement-token',
        valueTouched: true,
        is_secret: true,
        group: null,
    }, PLAIN_ROW);
    return (
        <div style={{ display: 'grid', gap: 16 }}>
            <div className="panel panel-pad">
                <div className="eyebrow">Directional atomic writes</div>
                <p className="dim">
                    The live backend applies fields in insertion order. The two transitions
                    deliberately serialize in opposite directions.
                </p>
                <div style={{ display: 'grid', gap: 8 }}>
                    <span>Plain → Secret: <code>{Object.keys(toSecret ?? {}).join(' → ')}</code></span>
                    <span>Secret → Plain: <code>{Object.keys(toPlain ?? {}).join(' → ')}</code></span>
                </div>
            </div>
            <SettingsPage />
        </div>
    );
}

export function FleetConfigurationDemo() {
    const [scenario, setScenario] = useState<MockConnectionScenario>('ready');
    const [persona, setPersona] = useState('dns.platform@nativemojo.com');
    const [narrow, setNarrow] = useState(false), [ready, setReady] = useState(false); const qc = useQueryClient();
    useEffect(() => { setMockConnectionScenario(scenario); }, [scenario]);
    useEffect(() => { let active = true; setReady(false); void login(persona, 'mojo').then(async () => { await qc.invalidateQueries(); if (active) setReady(true); }); return () => { active = false; }; }, [persona, qc]);
    useEffect(() => () => { setMockConnectionScenario('ready'); void login('showcase.operator@nativemojo.com', 'mojo'); }, []);
    return <div className="dns-shared-showcase" style={{ display: 'grid', gap: 16 }}><h2>Shared validation setup</h2><p>This is the actual Fleet configuration page using local fixtures. Enable sharing on the hub after a normal deployment; configure a consumer connection with a protected key from Group API Keys. Local fixtures never configure a real hub.</p><div className="dns-shared-demo-controls"><label className="field"><span className="field-label">Connection scenario</span><select className="input" value={scenario} onChange={e => setScenario(e.target.value as MockConnectionScenario)}>{['ready','hub-ready','hub-unconfigured','hub-no-deployment','hub-upgrade-required','hub-incomplete','hub-conflict','hub-reauth','hub-uncertain','old-api','unavailable','dnsman-absent','empty-catalog','sharing-disabled','identity-mismatch','busy','catalog-conflict','revision-conflict','publication-uncertain','offline','draining','stale-proof','malformed','recipient-denied','recipient-renamed','issue-uncertain','reauth','disable-ineligible'].map(value => <option value={value} key={value}>{value}</option>)}</select></label><label className="field"><span className="field-label">Connection identity</span><select className="input" value={persona} onChange={e => setPersona(e.target.value)}><option value="dns.platform@nativemojo.com">Deployment operator</option><option value="dns.manager@nativemojo.com">Ordinary DNS manager</option></select></label><label><input type="checkbox" checked={narrow} onChange={e => setNarrow(e.target.checked)} />390px embedded connection</label></div><div style={{ maxWidth: narrow ? 390 : undefined, minWidth: 0 }}>{ready ? <SharedValidationConnectionPage key={`${scenario}:${persona}`} /> : <p>Preparing fixture…</p>}</div></div>;
}
