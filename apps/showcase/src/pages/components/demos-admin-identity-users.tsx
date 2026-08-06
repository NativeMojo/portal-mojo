import { UsersPage } from 'portal-mojo/admin';

export function AdminIdentityUsersDemo() {
    return (
        <div className="demo-stack">
            <section className="panel panel-pad">
                <div className="eyebrow">Reusable identity bundle</div>
                <h2>Users Admin</h2>
                <p className="dim">
                    The table and 14-section detail use the packaged models,
                    system-pinned gates, and caller-only credential contracts.
                </p>
            </section>
            <UsersPage />
        </div>
    );
}
