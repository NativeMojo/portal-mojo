import { MetricsExplorerPage } from 'portal-mojo/admin';

export function AdminMetricsExplorerDemo() {
    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <div className="panel panel-pad">
                <div className="eyebrow">Data-backed Admin workspace</div>
                <p className="dim" style={{ margin: '3px 0 0' }}>
                    The central mock intentionally truncates history and scalar keys like django-mojo. Try the
                    <code> collisions</code> category to prove <code>foo:count</code> and <code>bar:count</code> remain separate,
                    or <code>group-1</code> with child kind <code>team</code> for fan-out.
                </p>
            </div>
            <MetricsExplorerPage />
        </div>
    );
}
