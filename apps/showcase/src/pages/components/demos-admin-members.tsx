import { GroupMembersPanel, MembersPage } from 'portal-mojo/admin';

const DEMO_GROUP = { id: 1, name: 'Acme Corp', kind: 'org' };

export function AdminMembersDemo() {
    return (
        <div className="demo-stack">
            <section className="panel panel-pad">
                <div className="eyebrow">Reusable Group detail panel</div>
                <h2>Fixed-group members</h2>
                <p className="dim">Invite and directory-backed Add are distinct. Rows open the shared membership detail.</p>
                <GroupMembersPanel group={DEMO_GROUP} />
            </section>
            <section className="panel panel-pad">
                <div className="eyebrow">Global Admin contribution</div>
                <MembersPage />
            </section>
        </div>
    );
}
