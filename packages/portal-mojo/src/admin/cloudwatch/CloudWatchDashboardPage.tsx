import { useEffect, useState } from 'react';
import { Badge, modal } from '../../ui';
import { LazyCloudWatchChart } from './CloudWatchChart';
import {
    CLOUDWATCH_DASHBOARD_CHARTS, useCloudWatchResources,
    type CloudWatchAccount, type CloudWatchResource,
} from './data';

const EAGER_CHART_COUNT = 4;
const TYPE_META: Record<CloudWatchAccount, { label: string; icon: string }> = {
    ec2: { label: 'EC2 instances', icon: 'bi-pc-display' },
    rds: { label: 'RDS databases', icon: 'bi-database' },
    redis: { label: 'ElastiCache Redis', icon: 'bi-lightning-charge' },
};

export function showCloudWatchResourceDetail(resource: CloudWatchResource): void {
    void import('./CloudWatchResourceDetail').then(({ CloudWatchResourceDetail }) => (
        modal.detail((close) => <CloudWatchResourceDetail resource={resource} onClose={() => close(null)} />)
    ));
}

function CloudWatchResourcesDialog({ onClose }: { onClose: () => void }) {
    const query = useCloudWatchResources();
    return <div className="modal-pad cloudwatch-resources-dialog">
        <div className="cloudwatch-modal-heading"><div><div className="eyebrow">AWS inventory</div><h2 className="modal-title">CloudWatch resources</h2></div><button className="btn-icon" title="Close" aria-label="Close" onClick={onClose}><i className="bi bi-x-lg" /></button></div>
        {query.isPending ? <div className="cloudwatch-resource-loading"><span className="skel skel-block" /></div> : query.error ? <div className="form-alert" role="alert">{query.error.message}</div> : (
            <div className="cloudwatch-resource-groups">
                {(Object.keys(TYPE_META) as CloudWatchAccount[]).map((kind) => <section key={kind}><h3><i className={`bi ${TYPE_META[kind].icon}`} /> {TYPE_META[kind].label}</h3><div className="cloudwatch-resource-list">{query.data![kind].length === 0 ? <p className="dim">No resources discovered.</p> : query.data![kind].map((resource) => <button key={resource.id} className="cloudwatch-resource-row" onClick={() => showCloudWatchResourceDetail(resource)}><span><b>{resource.slug}</b><small>{resource.id}</small></span><Badge>{resource.status}</Badge><i className="bi bi-chevron-right" /></button>)}</div></section>)}
            </div>
        )}
    </div>;
}

export function showCloudWatchResources(): void {
    void modal.open((close) => <CloudWatchResourcesDialog onClose={() => close(null)} />, { size: 'lg' });
}

export function CloudWatchDashboardPage() {
    const [refreshSignal, setRefreshSignal] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setRefreshSignal((value) => value + 1), 300_000);
        return () => window.clearInterval(timer);
    }, []);
    return <div className="admin-dashboard cloudwatch-dashboard-page">
        <header className="admin-dashboard-header cloudwatch-page-heading">
            <div><div className="eyebrow">Infrastructure · AWS</div><h1>CloudWatch monitoring</h1><p className="dim">Global EC2, RDS, and ElastiCache Redis health from the configured AWS account.</p></div>
            <div className="cloudwatch-page-actions"><button className="btn" onClick={showCloudWatchResources}><i className="bi bi-clouds" /> Resources</button><button className="btn btn-primary" onClick={() => setRefreshSignal((value) => value + 1)}><i className="bi bi-arrow-repeat" /> Refresh charts</button></div>
        </header>
        <div className="cloudwatch-gap-note"><i className="bi bi-info-circle" /><span>ELB and Lambda are not shown because django-mojo exposes no CloudWatch account mapping for them.</span></div>
        <div className="cloudwatch-grid">{CLOUDWATCH_DASHBOARD_CHARTS.map((definition, index) => <LazyCloudWatchChart key={`${definition.account}:${definition.category}`} definition={definition} refreshSignal={refreshSignal} eager={index < EAGER_CHART_COUNT} />)}</div>
    </div>;
}
