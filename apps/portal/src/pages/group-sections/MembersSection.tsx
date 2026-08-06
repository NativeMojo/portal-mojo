// Thin app adapter: the package owns member listing, admission, and detail.
// Cross-domain navigation stays in the app so the package never imports the
// app-owned GroupDetail implementation.
import { GroupMembersPanel, UserDetail } from 'portal-mojo/admin';
import type { GroupRow } from '../../models';
import { modal } from 'portal-mojo/ui';

export function MembersSection({ group, openGroup }: { group: GroupRow; openGroup: (id: number) => void }) {
    return (
        <GroupMembersPanel
            group={group}
            onNavigateGroup={openGroup}
            onNavigateUser={(id) => {
                void modal.detail((close) => <UserDetail id={id} onClose={() => close(null)} />);
            }}
        />
    );
}
