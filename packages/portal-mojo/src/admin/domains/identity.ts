import type { AdminSection } from '../core';
import { GLOBAL_CREDENTIAL_PERMS } from '../credentials/models';
import { MEMBER_READ_PERMISSIONS } from '../identity/members/models';
import { USER_VIEW_PERMISSIONS } from '../identity/users/models';
import { SIGNIN_ADMIN_PERMISSIONS } from '../signin/api';
import { GROUP_VIEW_PERMS } from '../identity/groups/group-permissions';

export const USERS_ADMIN_SECTION: AdminSection = {
    id: 'users', basePath: '', title: 'Users', icon: 'bi-people', navigationGroup: 'identity-access', permissions: USER_VIEW_PERMISSIONS,
    routes: [{ path: 'users', label: 'Users', loadComponent: () => import('../identity/users/UsersPage').then(({ UsersPage }) => ({ default: UsersPage })), permissions: USER_VIEW_PERMISSIONS }],
};

export const MEMBERS_ADMIN_SECTION: AdminSection = {
    id: 'members', basePath: '', title: 'Members', icon: 'bi-person-badge', navigationGroup: 'identity-access', permissions: MEMBER_READ_PERMISSIONS,
    routes: [{ path: 'members', label: 'Members', loadComponent: () => import('../identity/members/MembersPage').then(({ MembersPage }) => ({ default: MembersPage })), permissions: MEMBER_READ_PERMISSIONS }],
};

export const CREDENTIALS_ADMIN_SECTION: AdminSection = {
    id: 'credentials', basePath: '', title: 'Credentials', icon: 'bi-key', navigationGroup: 'identity-access', permissions: GLOBAL_CREDENTIAL_PERMS,
    routes: [
        { path: 'api-keys', label: 'Group API Keys', loadComponent: () => import('../credentials/group-api-keys').then(({ GroupApiKeysPage }) => ({ default: GroupApiKeysPage })), permissions: GLOBAL_CREDENTIAL_PERMS },
        { path: 'webhook-subscriptions', label: 'Webhooks', loadComponent: () => import('../credentials/webhook-subscriptions').then(({ WebhookSubscriptionsPage }) => ({ default: WebhookSubscriptionsPage })), permissions: GLOBAL_CREDENTIAL_PERMS },
    ],
};

export const SIGNIN_ADMIN_SECTION: AdminSection = {
    id: 'signin', basePath: 'system/sign-in', title: 'Sign-in', icon: 'bi-box-arrow-in-right', navigationGroup: 'identity-access', permissions: SIGNIN_ADMIN_PERMISSIONS,
    routes: [{ path: '', loadComponent: () => import('../signin/SigninPage').then(({ SigninPage }) => ({ default: SigninPage })), permissions: SIGNIN_ADMIN_PERMISSIONS }],
};

export const GROUPS_ADMIN_SECTION: AdminSection = {
    id: 'groups', basePath: '', title: 'Groups', icon: 'bi-diagram-3', navigationGroup: 'identity-access', permissions: GROUP_VIEW_PERMS,
    routes: [{ path: 'groups', label: 'Groups', loadComponent: () => import('../identity/groups/GroupsPage').then(({ GroupsPage }) => ({ default: GroupsPage })), permissions: GROUP_VIEW_PERMS }],
};

export const PERSONAL_API_KEYS_ADMIN_SECTION: AdminSection = {
    id: 'personal-api-keys', basePath: '', title: 'Personal API Keys', icon: 'bi-key', navigationGroup: 'identity-access', permissions: USER_VIEW_PERMISSIONS,
    routes: [{ path: 'apikeys', label: 'Personal API Keys', loadComponent: () => import('../identity/users/PersonalApiKeysPage').then(({ PersonalApiKeysPage }) => ({ default: PersonalApiKeysPage })) }],
};

export const IDENTITY_ADMIN_SECTIONS = [
    USERS_ADMIN_SECTION,
    MEMBERS_ADMIN_SECTION,
    GROUPS_ADMIN_SECTION,
    PERSONAL_API_KEYS_ADMIN_SECTION,
    CREDENTIALS_ADMIN_SECTION,
    SIGNIN_ADMIN_SECTION,
] as const;
