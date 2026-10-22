import { useAuthSnapshot, useMe } from '../../client/runtime';
import { backendGlobalCan, FLEET_CAPACITY_GRANTS, FLEET_DASHBOARD_GRANTS } from './access';
import { FleetOverview, type FleetOverviewProps } from './FleetOverview';
export function FleetPage(props: FleetOverviewProps = {}) {
    const auth = useAuthSnapshot(), { data: me, isLoading } = useMe();
    if (isLoading)
        return <p>Checking fleet access…</p>;
    if (!auth.authenticated || !backendGlobalCan(me, [...FLEET_DASHBOARD_GRANTS, ...FLEET_CAPACITY_GRANTS]))
        return <div className="panel panel-pad">Fleet requires dashboard or capacity access.</div>;
    return <div className="page fleet-page"><header className="page-header"><h1>Fleet</h1></header><FleetOverview {...props}/></div>;
}
