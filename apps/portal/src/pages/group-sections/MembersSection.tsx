// Thin app adapter: the package owns member listing, admission, and detail.
// Cross-domain navigation stays in the app so portal-mojo/admin never imports
// app UserDetail/GroupDetail implementations.
import { GroupMembersPanel } from 'portal-mojo/admin';
import type { GroupRow } from '../../models';
import { UserDetail } from '../UserDetail';
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
