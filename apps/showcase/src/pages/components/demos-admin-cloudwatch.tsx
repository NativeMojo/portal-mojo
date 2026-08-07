import { CloudWatchDashboardPage } from 'portal-mojo/admin';

export function AdminCloudWatchDemo() {
    return <div className="flex flex-col gap-4">
        <div className="panel panel-pad"><div className="eyebrow">Live mock contract</div><p className="dim">Open Resources to inspect the exact top-level EC2/RDS/Redis inventory, then select a row for its package-owned KISS metric detail.</p></div>
        <CloudWatchDashboardPage />
    </div>;
}
