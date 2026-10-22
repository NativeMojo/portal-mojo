import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { login } from 'portal-mojo/client';
import { MaintenancePage } from '../../../../../packages/portal-mojo/src/admin/maintenance/MaintenancePage';
import {
    MAINTENANCE_SCENARIOS,
    setMockMaintenanceScenario,
    type MaintenanceScenario,
} from '../../../../../packages/portal-mojo/src/client/maintenance-mock';
const personas = [
    { email: 'dns.platform@nativemojo.com', label: 'Maintenance operator' },
    { email: 'showcase.operator@nativemojo.com', label: 'AWS reader' },
    { email: 'assistant.operator@nativemojo.com', label: 'No Maintenance grants' },
];
/** Actual page and transport. Attempts deliberately survive scenario remounts. */
export function AdminMaintenanceDemo() {
    const [scenario, setScenario] = useState<MaintenanceScenario>('findings');
    const [persona, setPersona] = useState(personas[0]!.email);
    const [epoch, setEpoch] = useState(0),
        [ready, setReady] = useState(false);
    const queryClient = useQueryClient();
    useEffect(() => {
        let active = true;
        setReady(false);
        void login(persona, 'mojo').then(() => {
            queryClient.clear();
            if (active) {
                setReady(true);
                setEpoch((n) => n + 1);
            }
        });
        return () => {
            active = false;
        };
    }, [persona, queryClient]);
    return (
        <div>
            <div className="panel panel-pad">
                <label>
                    Mock persona{' '}
                    <select value={persona} onChange={(event) => setPersona(event.target.value)}>
                        {personas.map((p) => (
                            <option key={p.email} value={p.email}>
                                {p.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    {' '}
                    Mock evidence{' '}
                    <select
                        value={scenario}
                        onChange={(event) => {
                            const next = event.target.value as MaintenanceScenario;
                            setMockMaintenanceScenario(next);
                            setScenario(next);
                            setEpoch((n) => n + 1);
                        }}
                    >
                        {MAINTENANCE_SCENARIOS.map((s) => (
                            <option key={s} value={s}>
                                {s}
                            </option>
                        ))}
                    </select>
                </label>
                <p>
                    Provider changes are simulated. Submitted attempts stay guarded across scenario changes.
                    Next-window and unknown operations require provider reconciliation; no automatic resend
                    occurs.
                </p>
            </div>
            {ready ? (
                <MaintenancePage key={epoch} pollInterval={10_000} deploymentsHref="#/system/deployments" />
            ) : (
                <p>Loading mock persona…</p>
            )}
        </div>
    );
}
