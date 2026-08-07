import { useState } from 'react';
import { DetailView, FlatRow } from '../../ui';
import { LazyCloudWatchChart } from './CloudWatchChart';
import { CLOUDWATCH_RESOURCE_CHARTS, type CloudWatchAccount, type CloudWatchResource } from './data';

const TYPE_META: Record<CloudWatchAccount, { label: string; icon: string }> = {
    ec2: { label: 'EC2 instances', icon: 'bi-pc-display' },
    rds: { label: 'RDS databases', icon: 'bi-database' },
    redis: { label: 'ElastiCache Redis', icon: 'bi-lightning-charge' },
};

function ResourceMetadata({ resource }: { resource: CloudWatchResource }) {
    if (resource.kind === 'ec2') return <><FlatRow label="AWS id"><code>{resource.id}</code></FlatRow><FlatRow label="State">{resource.state}</FlatRow><FlatRow label="Instance type">{resource.instance_type || '—'}</FlatRow><FlatRow label="Private IP">{resource.private_ip || '—'}</FlatRow><FlatRow label="Public IP">{resource.public_ip || '—'}</FlatRow></>;
    if (resource.kind === 'rds') return <><FlatRow label="AWS id"><code>{resource.id}</code></FlatRow><FlatRow label="Status">{resource.status}</FlatRow><FlatRow label="Engine">{resource.engine || '—'}</FlatRow><FlatRow label="Instance class">{resource.instance_class || '—'}</FlatRow><FlatRow label="Endpoint">{resource.endpoint || '—'}</FlatRow></>;
    return <><FlatRow label="AWS id"><code>{resource.id}</code></FlatRow><FlatRow label="Status">{resource.status}</FlatRow><FlatRow label="Engine">{resource.engine || '—'}</FlatRow><FlatRow label="Node type">{resource.node_type || '—'}</FlatRow><FlatRow label="Nodes">{resource.num_nodes.toLocaleString()}</FlatRow></>;
}

export function CloudWatchResourceDetail({ resource, onClose }: { resource: CloudWatchResource; onClose: () => void }) {
    const [refreshSignal, setRefreshSignal] = useState(0);
    const meta = TYPE_META[resource.kind];
    const definitions = CLOUDWATCH_RESOURCE_CHARTS[resource.kind].map((definition) => ({ ...definition, account: resource.kind }));
    return <DetailView
        title={resource.slug}
        subtitle={meta.label}
        icon={meta.icon}
        chips={[{ text: resource.status, tone: resource.status === 'available' || resource.status === 'running' ? 'success' : 'warning' }]}
        onClose={onClose}
        sections={[
            { key: 'overview', label: 'Overview', icon: 'bi-info-circle', render: () => <div className="detail-section"><p className="dim">Charts target the raw AWS id. The backend deliberately returns the friendly slug as the series label.</p><ResourceMetadata resource={resource} /></div> },
            { key: 'metrics', label: 'Metrics', icon: 'bi-graph-up', render: () => <div className="detail-section"><div className="cloudwatch-detail-actions"><button className="btn" onClick={() => setRefreshSignal((value) => value + 1)}><i className="bi bi-arrow-repeat" /> Refresh metrics</button></div><div className="cloudwatch-grid">{definitions.map((definition, index) => <LazyCloudWatchChart key={definition.category} definition={definition} slugs={[resource.id]} refreshSignal={refreshSignal} eager={index < 2} />)}</div></div> },
        ]}
    />;
}
