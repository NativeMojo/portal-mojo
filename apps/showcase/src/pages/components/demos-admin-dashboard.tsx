import { AdminDashboardPage } from 'portal-mojo/admin';

export function AdminDashboardDemo() {
    return <div className="flex flex-col gap-4">
        <div className="panel panel-pad">
            <div className="eyebrow">Package-owned landing</div>
            <p className="dim">The global dashboard renders only backend-authoritative metrics and permission-gates each operational signal independently.</p>
        </div>
        <AdminDashboardPage />
    </div>;
}
