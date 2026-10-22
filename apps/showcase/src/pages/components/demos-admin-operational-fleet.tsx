import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { login } from 'portal-mojo/client/runtime';
import { FleetOverview } from '../../../../../packages/portal-mojo/src/admin/fleet/FleetOverview';
import { mockOperationalFleetScenarios, setMockOperationalFleetScenario, type MockOperationalFleetScenario } from '../../../../../packages/portal-mojo/src/client/operational-fleet-mock';
const noLinks = Object.fromEntries(['certificates', 'incidents', 'tickets', 'jobs', 'email', 'sms', 'framework', 'last_deployment'].map(key => [key, null]));
/** The actual reusable overview/editor, backed exclusively by the central mock bridge. */
export function AdminOperationalFleetDemo() {
    const queryClient = useQueryClient();
    const [scenario, setScenario] = useState<MockOperationalFleetScenario>('healthy');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const change = async (value: MockOperationalFleetScenario) => { setBusy(true); setError(''); try {
        await login('dns.platform@nativemojo.com', 'mojo');
        setMockOperationalFleetScenario(value);
        setScenario(value);
        await queryClient.invalidateQueries({ queryKey: ['operational-fleet'] });
    }
    catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Mock persona could not be selected.');
    }
    finally {
        setBusy(false);
    } };
    useEffect(() => { void change('healthy'); }, []);
    return <div className="flex flex-col gap-4"><details className="panel panel-pad demo-controls"><summary>Demo controls · mock data</summary><div className="eyebrow">Operational overview and reviewed scaling</div><p>Use the operator persona to stage nodes, independent database sizes and Redis capacity. Review the actual server plan, apply once and observe the batch. Mock outcomes advance after three observations; nothing contacts AWS.</p><div className="flex gap-2 flex-wrap"><button className="btn" disabled={busy} onClick={() => void change(scenario)}>Use fleet operator</button><label className="field"><span className="field-label">Mock evidence and outcome</span><select className="input" value={scenario} disabled={busy} onChange={e => void change(e.target.value as MockOperationalFleetScenario)}>{mockOperationalFleetScenarios.map(value => <option key={value} value={value}>{value.replaceAll('-', ' ')}</option>)}</select></label></div><p className="dim">Unknown outcomes deliberately retain a reconciliation block, including after closing and reopening the dialog. Scenario selection never clears an unresolved operation; inspect and observe the original batch before starting another change.</p>{error && <p className="form-alert" role="alert">{error}</p>}</details><FleetOverview mount="" links={noLinks} showConfigurationLink={false}/></div>;
}
