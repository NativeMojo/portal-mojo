import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { login } from 'portal-mojo/client';
import { modal } from 'portal-mojo/ui';
import { MaintenancePage } from '../../../../../packages/portal-mojo/src/admin/maintenance/MaintenancePage';
import { getMaintenanceAttempts, maintenanceAttemptsRevision, subscribeMaintenanceAttempts } from '../../../../../packages/portal-mojo/src/admin/maintenance/operations';
import { MAINTENANCE_SCENARIOS, setMockMaintenanceScenario, getMockMaintenanceScenario, advanceMockMaintenance, type MaintenanceScenario } from '../../../../../packages/portal-mojo/src/client/maintenance-mock';
const personas = [
    { email: 'dns.platform@nativemojo.com', label: 'Maintenance operator' },
    { email: 'showcase.operator@nativemojo.com', label: 'AWS reader' },
    { email: 'assistant.operator@nativemojo.com', label: 'No Maintenance grants' },
];
export function AdminMaintenanceDemo() {
    const [scenario, setScenario] = useState<MaintenanceScenario>(getMockMaintenanceScenario), [persona, setPersona] = useState(personas[0]!.email);
    const [epoch, setEpoch] = useState(0), [ready, setReady] = useState(false);
    const queryClient = useQueryClient();
    useEffect(() => { let active = true; setReady(false); void login(persona,'mojo').then(() => { queryClient.clear(); if (active) { setReady(true); setEpoch(n=>n+1); } }); return () => {active=false;}; },[persona,queryClient]);
    const openControls = () => void modal.open(close => <MaintenanceDemoControls initial={scenario} persona={persona} onClose={()=>close(null)} onAdvance={()=>{advanceMockMaintenance();setScenario(getMockMaintenanceScenario());close(null);}} onApply={async(next,identity)=>{await login(identity,'mojo');setMockMaintenanceScenario(next);setScenario(next);setPersona(identity);queryClient.clear();setEpoch(n=>n+1);close(null);}} />,{size:'md'});
    return <div><div className="demo-control-fields"><button className="btn" onClick={openControls}>Demo controls</button><span className="dim">Mock · {scenario.replaceAll('-',' ')}</span></div>{ready ? <MaintenancePage key={epoch} pollInterval={10_000} deploymentsHref="#/?demo=admin-deployments"/> : <p>Loading mock persona…</p>}</div>;
}
function MaintenanceDemoControls({initial,persona,onApply,onAdvance,onClose}:{initial:MaintenanceScenario;persona:string;onApply:(s:MaintenanceScenario,p:string)=>Promise<void>;onAdvance:()=>void;onClose:()=>void}) {
    useSyncExternalStore(subscribeMaintenanceAttempts,maintenanceAttemptsRevision,maintenanceAttemptsRevision);
    const unresolved=getMaintenanceAttempts().some(a=>!['complete','refused'].includes(a.state));
    const [scenario,setScenario]=useState(initial),[identity,setIdentity]=useState(persona),[busy,setBusy]=useState(false),[error,setError]=useState('');
    return <div className="modal-pad"><h2 className="modal-title">Maintenance demo controls</h2><p className="dim">All provider changes are simulated.</p><div className="form-grid"><label className="field col-12"><span className="field-label">Mock persona</span><select className="input" value={identity} disabled={busy || unresolved} onChange={e=>setIdentity(e.target.value)}>{personas.map(p=><option key={p.email} value={p.email}>{p.label}</option>)}</select></label><label className="field col-12"><span className="field-label">Mock evidence</span><select className="input" disabled={busy || unresolved} value={scenario} onChange={e=>setScenario(e.target.value as MaintenanceScenario)}>{MAINTENANCE_SCENARIOS.map(s=><option key={s} value={s}>{s.replaceAll('-',' ')}</option>)}</select></label></div>{unresolved && <p className="text-warn">Observe the submitted operation before resetting mock evidence. Advancing the provider never clears a client receipt or submits another write.</p>}{error && <p role="alert">{error}</p>}<div className="modal-actions"><button className="btn" disabled={busy} onClick={onClose}>Close</button>{unresolved && <button className="btn" disabled={busy} onClick={onAdvance}>Advance simulated provider</button>}<button className="btn btn-primary" disabled={busy || unresolved} onClick={()=>{setBusy(true);void onApply(scenario,identity).catch(()=>{setError('Mock scenario could not be loaded.');setBusy(false);});}}>Use scenario</button></div></div>;
}
