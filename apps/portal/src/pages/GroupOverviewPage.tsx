// Group overview — the group-context proving surface: active group details
// plus the signed-in user's membership (role + permissions) from the
// GroupProvider. Wrapped in RequiresGroup: without an active group it shows
// the pick-a-group state instead.
import { useActiveGroup } from 'portal-mojo/client';
import { Badge, RequiresGroup, fmt } from 'portal-mojo/ui';

function Overview() {
    const { group, member, loading } = useActiveGroup();
    if (!group) return null;
    const perms = Object.entries((member?.permissions as Record<string, unknown>) ?? {})
        .filter(([, v]) => v === true || v === 1)
        .map(([k]) => k);
    // Real member rows carry no role field — the member `admin` permission IS
    // the role signal (verified against a live /api/group/<id>/member).
    const memberRole = perms.includes('admin') ? 'admin' : 'member';
    return (
        <div className="panel panel-pad max-w-2xl">
            <div className="eyebrow">Active group</div>
            <div className="detail-header" style={{ padding: '10px 0 16px', border: 'none' }}>
                <div className="detail-avatar"><i className="bi bi-diagram-3" /></div>
                <div className="detail-id">
                    <h3 className="detail-title">{group.name}</h3>
                    <div className="detail-sub">
                        <Badge tone="primary">{group.kind}</Badge>
                        {group.parent && <span className="dim">in {group.parent.name}</span>}
                        <span className="dim">#{group.id}</span>
                    </div>
                </div>
            </div>
            <div className="eyebrow section-eyebrow">Your membership</div>
            {loading && <span className="skel skel-block" />}
            {!loading && (
                <>
                    <div className="flat-row">
                        <span className="flat-label">Role</span>
                        <span className="flat-value"><Badge>{memberRole}</Badge></span>
                    </div>
                    <div className="flat-row">
                        <span className="flat-label">Permissions</span>
                        <span className="flat-value">
                            {perms.length === 0 && <span className="dim-italic">none — membership only</span>}
                            {perms.map((p) => <Badge key={p} tone={p === 'admin' ? 'primary' : 'info'}>{p}</Badge>)}
                        </span>
                    </div>
                    {group.created != null && (
                        <div className="flat-row">
                            <span className="flat-label">Created</span>
                            <span className="flat-value">{fmt.date(group.created as number | string)}</span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

export function GroupOverviewPage() {
    return (
        <RequiresGroup>
            <Overview />
        </RequiresGroup>
    );
}
