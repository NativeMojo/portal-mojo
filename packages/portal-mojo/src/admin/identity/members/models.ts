import {
    defineModel,
    type Field,
    type Group,
    type Params,
    type User,
} from '../../../client';

/** Group-local read gate for the reusable fixed-group composition. */
export const MEMBER_GROUP_READ_PERMISSIONS = [
    'view_members',
    'view_groups',
    'manage_groups',
    'manage_group',
    'groups',
];

/** Global Member Admin gates. `sys.` prevents active-group grants leaking in. */
export const MEMBER_READ_PERMISSIONS = [
    'sys.view_members',
    'sys.view_groups',
    'sys.manage_groups',
    'sys.manage_group',
    'sys.groups',
];
export const MEMBER_SAVE_PERMISSIONS = [
    'sys.manage_groups',
    'sys.manage_group',
    'sys.groups',
];
export const MEMBER_INVITE_PERMISSIONS = [
    'sys.manage_users',
    'sys.manage_members',
    'sys.manage_group',
    'sys.manage_groups',
];
export const MEMBER_USER_DIRECTORY_PERMISSIONS = [
    'sys.view_users',
    'sys.manage_users',
    'sys.users',
];

export interface MemberUser extends User {
    requires_mfa?: boolean;
    has_passkey?: boolean;
}

/** `/api/group/member` default graph. `metadata.role` is a display label only. */
export interface MemberRow {
    id: number;
    created: number;
    modified: number;
    is_active: boolean;
    permissions: Record<string, unknown>;
    metadata: Record<string, unknown> & {
        role?: unknown;
        invited_by?: unknown;
        invited_by_name?: unknown;
    };
    user: MemberUser | null;
    group: Group | null;
}

const MEMBER_LIST_KEYS = new Set([
    'start', 'size', 'search', 'sort',
    'group', 'user', 'is_active',
    'user__email__icontains', 'user__display_name__icontains',
    'group__name__icontains', 'metadata__role__icontains',
    'dr_field', 'dr_start', 'dr_end',
]);
const MEMBER_SORT_FIELDS = new Set(['id', 'created', 'modified', 'is_active']);
const MEMBER_DATE_FIELDS = new Set(['created', 'modified']);

/**
 * URL/persisted table state is untrusted. Keep only verified GroupMember
 * lookups and ordering fields before it reaches either the query key or wire.
 */
export function normalizeMemberListParams(params: Params): Params {
    const safe: Params = {};
    for (const [key, value] of Object.entries(params)) {
        if (MEMBER_LIST_KEYS.has(key)) safe[key] = value;
    }
    if (typeof safe.sort === 'string') {
        const field = safe.sort.replace(/^-/, '');
        if (!MEMBER_SORT_FIELDS.has(field)) delete safe.sort;
    }
    if (typeof safe.dr_field !== 'string' || !MEMBER_DATE_FIELDS.has(safe.dr_field)) {
        delete safe.dr_field;
        delete safe.dr_start;
        delete safe.dr_end;
    }
    return safe;
}

export const MemberModel = defineModel<MemberRow>({
    name: 'member',
    endpoint: '/api/group/member',
    permissions: {
        view: MEMBER_READ_PERMISSIONS,
        manage: MEMBER_SAVE_PERMISSIONS,
        create: MEMBER_SAVE_PERMISSIONS,
    },
    normalizeListParams: normalizeMemberListParams,
    actions: {
        // GroupMember.on_action_resend_invite answers `{status:true}`.
        resend_invite: { permissions: MEMBER_SAVE_PERMISSIONS, response: 'payload' },
    },
});

export interface MemberPermissionDef {
    name: string;
    label: string;
    tooltip?: string;
}

const permissionRegistry = new Map<string, MemberPermissionDef>();
let permissionVersion = 0;
const permissionListeners = new Set<() => void>();

/** Keys that are derived or unsafe to offer as editable member grants. */
export function isEditableMemberPermission(name: string): boolean {
    return Boolean(name)
        && !name.startsWith('sys.')
        && !['admin', 'member', 'full_member'].includes(name);
}

/**
 * Extend the editable catalog for product-specific group grants. Invalid
 * system/derived/client-only names remain visible as raw read-only values but
 * can never become switches.
 */
export function registerMemberPermissions(defs: MemberPermissionDef[]): void {
    let changed = false;
    for (const def of defs) {
        if (!isEditableMemberPermission(def.name)) {
            console.warn(`registerMemberPermissions: "${def.name}" is not an editable member grant — ignored`);
            continue;
        }
        permissionRegistry.set(def.name, { ...def });
        changed = true;
    }
    if (!changed) return;
    permissionVersion += 1;
    for (const listener of permissionListeners) listener();
}

export function getMemberPermissions(): MemberPermissionDef[] {
    return [...permissionRegistry.values()].map((def) => ({ ...def }));
}

export function subscribeMemberPermissions(listener: () => void): () => void {
    permissionListeners.add(listener);
    return () => permissionListeners.delete(listener);
}

export function memberPermissionsVersion(): number {
    return permissionVersion;
}

registerMemberPermissions([
    { name: 'manage_group', label: 'Manage Group' },
    { name: 'view_metrics', label: 'View Metrics' },
    { name: 'view_logs', label: 'View Logs' },
    { name: 'view_tickets', label: 'View Tickets' },
    { name: 'view_members', label: 'View Members' },
    { name: 'manage_members', label: 'Manage Members' },
    { name: 'view_billing', label: 'View Billing' },
    {
        name: 'guest',
        label: 'Guest membership',
        tooltip: 'Guests do not receive the derived full_member tier. Other grants remain independent.',
    },
]);

export function memberPermissionFields(): Field[] {
    return getMemberPermissions().map((permission) => ({
        name: `permissions.${permission.name}`,
        type: 'switch',
        label: permission.label,
        columns: 6,
        help: permission.tooltip,
    }));
}

export function rawMemberGrants(permissions: Record<string, unknown> | null | undefined): string[] {
    return Object.entries(permissions ?? {})
        .filter(([, value]) => value === true || value === 1)
        .map(([name]) => name)
        .sort();
}

/** Server-effective membership grants, excluding ignored/client-only keys. */
export function effectiveMemberGrants(permissions: Record<string, unknown> | null | undefined): string[] {
    const raw = rawMemberGrants(permissions);
    const effective = raw.filter((name) => name !== 'admin' && name !== 'full_member' && !name.startsWith('sys.'));
    effective.push('member');
    if (!raw.includes('guest')) effective.push('full_member');
    return [...new Set(effective)].sort();
}

export function ignoredMemberGrants(permissions: Record<string, unknown> | null | undefined): string[] {
    return rawMemberGrants(permissions).filter((name) =>
        name === 'admin' || name === 'full_member' || name.startsWith('sys.'));
}
