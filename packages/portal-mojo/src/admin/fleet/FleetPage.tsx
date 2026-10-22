import { lazy, Suspense } from 'react';
import { useAuthSnapshot, useMe } from '../../client/runtime';
import { backendGlobalCan, FLEET_CAPACITY_GRANTS, FLEET_DASHBOARD_GRANTS } from './access';
import type { FleetOverviewProps } from './FleetOverview';
const Workspace = lazy(() => import('./FleetWorkspace').then(module => ({ default: module.FleetWorkspace })));
export function FleetPage(props: FleetOverviewProps = {}) {
    const auth = useAuthSnapshot(), { data: me, isLoading } = useMe();
    if (isLoading) return <p>Checking fleet access…</p>;
    if (!auth.authenticated || !backendGlobalCan(me, [...FLEET_DASHBOARD_GRANTS, ...FLEET_CAPACITY_GRANTS])) return <div className="panel panel-pad">Fleet requires dashboard or capacity access.</div>;
    return <div className="page fleet-page"><Suspense fallback={<p role="status">Loading fleet…</p>}><Workspace {...props}/></Suspense></div>;
}
