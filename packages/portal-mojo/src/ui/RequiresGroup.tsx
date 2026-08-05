// Guard for group-scoped screens (the `requiresGroup` idea from web-mojo's
// page config): children render only when an active group is set; otherwise
// a pick-a-group empty state. UX gating — the server still scopes every query.
import type { ReactNode } from 'react';
import { useActiveGroup } from '../client/group';

export function RequiresGroup({ fallback, children }: {
    /** Rendered when no group is active (default: a pick-a-group panel). */
    fallback?: ReactNode;
    children: ReactNode;
}) {
    const { group, loading } = useActiveGroup();
    if (group) return <>{children}</>;
    if (loading) {
        return (
            <div className="panel empty-state">
                <span className="skel skel-block" />
            </div>
        );
    }
    return (
        <>
            {fallback ?? (
                <div className="panel empty-state">
                    <i className="bi bi-diagram-3" />
                    <h3>Select a group</h3>
                    <p className="dim">This screen is group-scoped — pick an active group from the sidebar switcher.</p>
                </div>
            )}
        </>
    );
}
