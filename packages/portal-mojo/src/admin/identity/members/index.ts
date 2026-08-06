import type { AdminSection } from '../../index';
import { MembersPage } from './MembersPage';
import { MEMBER_READ_PERMISSIONS } from './models';

export * from './models';
export * from './member-flows';
export * from './MemberDetail';
export * from './GroupMembersPanel';
export * from './MembersPage';

export const MEMBERS_ADMIN_SECTION: AdminSection = {
    id: 'members',
    basePath: '',
    title: 'Members',
    icon: 'bi-person-badge',
    navigationGroup: 'identity-access',
    permissions: MEMBER_READ_PERMISSIONS,
    routes: [{
        path: 'members',
        label: 'Members',
        component: MembersPage,
        permissions: MEMBER_READ_PERMISSIONS,
    }],
};
