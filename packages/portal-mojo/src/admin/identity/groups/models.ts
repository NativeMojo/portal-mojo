// Source: NativeMojo portal-mojo v0.2.5 reference app, apps/portal/src/models.ts.
import { defineModel, type Group } from '../../../client/runtime';
import { GROUP_DESTRUCTIVE_PERMS, GROUP_MANAGE_PERMS, GROUP_VIEW_PERMS } from './group-permissions';

export { MemberModel, type MemberRow } from '../members';

export { GROUP_DESTRUCTIVE_PERMS, GROUP_MANAGE_PERMS, GROUP_VIEW_PERMS } from './group-permissions';

export const GROUP_KIND_OPTIONS = [
    { value: 'org', label: 'Org' },
    { value: 'organization', label: 'Organization' },
    { value: 'team', label: 'Team' },
    { value: 'project', label: 'Project' },
    { value: 'group', label: 'Group' },
];

export type GroupRow = Group & {
    id: number;
    uuid: string | null;
    created: number;
    modified: number;
    last_activity: number | null;
    is_active: boolean;
    auth_domain: string | null;
    metadata: Record<string, unknown>;
    member_count: number;
};

export const GroupModel = defineModel<GroupRow>({
    name: 'group',
    endpoint: '/api/group',
    permissions: { view: GROUP_VIEW_PERMS, manage: GROUP_MANAGE_PERMS },
    forms: {
        create: {
            title: 'Add group',
            submitText: 'Create',
            fields: [
                { name: 'name', type: 'text', label: 'Name', required: true, placeholder: 'Acme West' },
                {
                    name: 'kind', type: 'combo', label: 'Kind', required: true,
                    options: GROUP_KIND_OPTIONS, placeholder: 'Type or pick a kind…',
                    help: 'Drives the sidebar menu context and the portal look for this group.',
                },
                {
                    name: 'parent', type: 'collection', label: 'Parent group',
                    endpoint: '/api/group', labelField: 'name', valueField: 'id',
                    placeholder: 'None — top-level', help: 'Optional. Search by name.',
                },
            ],
        },
        disable: {
            title: 'Deactivate group',
            submitText: 'Deactivate',
            fields: [
                {
                    name: 'reason', type: 'select', label: 'Reason', required: true, options: [
                        { value: 'admin', label: 'Admin — manual block' },
                        { value: 'abuse', label: 'Abuse — banned' },
                        { value: 'archived', label: 'Archived — no longer in use' },
                    ],
                },
                { name: 'note', type: 'textarea', label: 'Note', placeholder: 'Optional note about why this group is being deactivated.' },
            ],
        },
    },
    actions: {
        disable: { permissions: GROUP_DESTRUCTIVE_PERMS },
        reactivate: { permissions: GROUP_DESTRUCTIVE_PERMS },
    },
});
