import { Link } from 'react-router-dom';
import { MetricsChart } from '../../charts';
import { modal } from '../../ui';
import { useAuthSnapshot, useCan } from '../../client';
import { SECURITY_VIEW_PERMS } from '../security-permissions';
import { JOBS_VIEW_PERMS } from '../jobs';
import { EMAIL_ADMIN_PERMISSIONS } from '../messaging';
import { LoginLocationMap } from '../security/devices/LoginLocationMap';
import { LOGIN_SUMMARY_PERMS } from '../security/devices/models';
import {
    DASHBOARD_METRIC_PERMISSIONS, DASHBOARD_SERIES, dashboardLoginStart,
    useDashboardCount, useDashboardScalars,
} from './data';

function MetricOverview() {
    const { can } = useCan(DASHBOARD_METRIC_PERMISSIONS);
    const auth = useAuthSnapshot();
    const scalars = useDashboardScalars(can);
    if (!can) return null;
    return <>
        <div className="admin-dashboard-kpis">
            {(['total_users', 'total_groups'] as const).map((slug) => (
                <div className="panel panel-pad admin-dashboard-kpi" key={slug}>
                    <div className="eyebrow">Directory</div>
                    <div className="admin-dashboard-kpi-value">{scalars.isPending ? '…' : scalars.data?.[slug].toLocaleString() ?? '—'}</div>
                    <div className="dim">{slug === 'total_users' ? 'Total users' : 'Total groups'}</div>
                </div>
            ))}
        </div>
        {scalars.error && <div className="panel panel-pad text-bad">{scalars.error.message}</div>}
        <MetricsChart
            title="Platform activity"
            account="global"
            slugs={[...DASHBOARD_SERIES]}
            seriesLabels={{ user_activity_day: 'User activity', group_activity_day: 'Group activity', api_calls: 'API calls', api_errors: 'API errors' }}
            seriesCacheKey={`admin-dashboard:${auth.uid ?? 'anonymous'}:activity`}
            defaultRange="30d"
            defaultGranularity="days"
            height={300}
        />
    </>;
}

function AttentionCard({ permission, endpoint, params, to, icon, label }: {
    permission: string[]; endpoint: string; params: Record<string, string>; to: string; icon: string; label: string;
}) {
    const { can } = useCan(permission);
    const count = useDashboardCount(endpoint, params, can);
    if (!can) return null;
    return <Link className="panel panel-pad admin-dashboard-attention" to={to}>
        <i className={`bi ${icon}`} />
        <span><strong>{count.isPending ? '…' : count.data?.toLocaleString() ?? '—'}</strong><small>{label}</small></span>
        <i className="bi bi-arrow-right" />
    </Link>;
}

function AttentionOverview() {
    return <section>
        <div className="admin-dashboard-section-heading"><div><div className="eyebrow">Attention</div><h2>Needs review</h2></div></div>
        <div className="admin-dashboard-attention-grid">
            <AttentionCard permission={SECURITY_VIEW_PERMS} endpoint="/api/incident/incident" params={{ status: 'open' }} to="/security/incidents?status=open" icon="bi-shield-exclamation" label="Open incidents" />
            <AttentionCard permission={JOBS_VIEW_PERMS} endpoint="/api/jobs/job" params={{ status: 'failed' }} to="/jobs/list?status=failed" icon="bi-cpu" label="Failed jobs" />
            <AttentionCard permission={EMAIL_ADMIN_PERMISSIONS} endpoint="/api/aws/email/sent" params={{ status: 'bounced' }} to="/email/sent?status=bounced" icon="bi-envelope-exclamation" label="Bounced messages" />
        </div>
    </section>;
}

function LoginOverview() {
    const { can } = useCan(LOGIN_SUMMARY_PERMS);
    if (!can) return null;
    const openUser = (id: number) => { void import('../identity/users/UserDetail').then(({ UserDetail }) => modal.detail((close) => <UserDetail id={id} onClose={() => close(null)} />)); };
    const openDevice = (duid: string) => { void import('../security/devices/UserDeviceDetail').then(({ showUserDeviceDetailByDuid }) => showUserDeviceDetailByDuid(duid)); };
    const openLogin = (id: number) => { void import('../security/devices/LoginEventDetail').then(({ showLoginEventDetail }) => showLoginEventDetail(id, { onOpenUser: openUser, onOpenDeviceByDuid: openDevice })); };
    return <section className="panel panel-pad dashboard-login-map">
        <div><div className="eyebrow">Security</div><h2>Login locations · last 30 days</h2></div>
        <LoginLocationMap
            height={360}
            drStart={dashboardLoginStart()}
            onOpenUser={openUser}
            onOpenLogin={openLogin}
        />
    </section>;
}

export function AdminDashboardPage() {
    return <div className="admin-dashboard">
        <header className="admin-dashboard-header"><div className="eyebrow">Overview</div><h1>Admin dashboard</h1><p className="dim">Authoritative operational signals for this django-mojo deployment.</p></header>
        <MetricOverview />
        <AttentionOverview />
        <LoginOverview />
    </div>;
}
