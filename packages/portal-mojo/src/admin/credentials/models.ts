import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    defineModel, mojoCall, mojoSave, withFreshAuth,
    type PermSpec,
} from '../../client';

/** Global operator gate for the cross-group credential pages. */
export const GLOBAL_CREDENTIAL_PERMS = ['sys.manage_groups', 'sys.groups'];

/** Group-member gate for credentials inside GroupDetail. */
export const GROUP_CREDENTIAL_PERMS = ['manage_group', 'manage_groups', 'groups'];

/** Who may grant the built-in fleet-wide federation permission. */
export const APIKEY_FEDERATION_GRANT_PERMS = ['manage_users', 'manage_groups', 'sys.geoip_sync'];

export interface CredentialGroup {
    id: number;
    name: string;
    kind?: string;
}

export interface GroupApiKeyRow {
    id: number;
    created: number;
    modified: number;
    name: string;
    is_active: boolean;
    permissions: Record<string, unknown>;
    limits: Record<string, unknown>;
    last_used: number | null;
    expires_at: number | null;
    metadata: Record<string, unknown>;
    override_user: boolean;
    group: CredentialGroup | number | null;
    user: unknown | null;
}

interface GroupApiKeyCreateResponse extends GroupApiKeyRow {
    /** Present on the create echo only. Never written to Query cache. */
    token?: string;
}

export const GroupApiKeyModel = defineModel<GroupApiKeyRow>({
    name: 'group_api_key',
    endpoint: '/api/group/apikey',
    permissions: {
        view: GROUP_CREDENTIAL_PERMS,
        manage: GROUP_CREDENTIAL_PERMS,
    },
});

export interface CreatedGroupApiKey {
    row: GroupApiKeyRow;
    token: string | null;
}

/**
 * Create is deliberately separate from ModelDef.useSave(): the backend adds
 * the raw token to the create echo. Split it before any cache write, keep only
 * the safe row in Query, and hand the token directly to the reveal dialog.
 */
export function useCreateGroupApiKey() {
    const qc = useQueryClient();
    return useMutation<CreatedGroupApiKey, Error, Record<string, unknown>>({
        mutationFn: async (changes) => {
            const created = await withFreshAuth(() =>
                mojoSave<GroupApiKeyCreateResponse>(GroupApiKeyModel.endpoint, null, changes));
            const { token, ...safeRow } = created;
            return { row: safeRow, token: token ?? null };
        },
        onSuccess: ({ row }) => {
            qc.setQueryData(GroupApiKeyModel.keys.one(row.id), row);
            void qc.invalidateQueries({ queryKey: GroupApiKeyModel.keys.root });
        },
    });
}

/**
 * Explicit opt-in credential read. django-mojo's `token` graph audits every
 * serialization as `api_key:token_read`; this helper never uses Query.
 */
export async function fetchApiKeyToken(id: number): Promise<string> {
    const body = await mojoCall(`${GroupApiKeyModel.endpoint}/${id}`, {
        params: { graph: 'token' },
    });
    const token = (body.data as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !token) throw new Error('The server did not return a token');
    return token;
}

export interface ApiKeyPermissionDef {
    name: string;
    label: string;
    tooltip?: string;
    /** When present, the control renders only when the operator has one. */
    grantPermissions?: PermSpec;
}

const permissionRegistry = new Map<string, ApiKeyPermissionDef>();
let permissionVersion = 0;
const permissionListeners = new Set<() => void>();

/**
 * Add or replace API-key permission controls. Mounted editors subscribe to
 * this registry, so product permissions registered after boot appear live.
 */
export function registerGroupApiKeyPermissions(defs: ApiKeyPermissionDef[]): void {
    for (const def of defs) permissionRegistry.set(def.name, { ...def });
    permissionVersion += 1;
    for (const listener of permissionListeners) listener();
}

export function getGroupApiKeyPermissions(): ApiKeyPermissionDef[] {
    return [...permissionRegistry.values()].map((def) => ({ ...def }));
}

export function subscribeGroupApiKeyPermissions(listener: () => void): () => void {
    permissionListeners.add(listener);
    return () => permissionListeners.delete(listener);
}

export function groupApiKeyPermissionsVersion(): number {
    return permissionVersion;
}

registerGroupApiKeyPermissions([
    { name: 'admin', label: 'Group Admin', tooltip: 'Full access within this group' },
    { name: 'manage_group', label: 'Manage Group' },
    { name: 'view_metrics', label: 'View Metrics' },
    { name: 'view_logs', label: 'View Logs' },
    { name: 'view_tickets', label: 'View Tickets' },
    { name: 'view_members', label: 'View Members' },
    { name: 'manage_members', label: 'Manage Members' },
    { name: 'view_billing', label: 'View Billing' },
    {
        name: 'geoip_sync',
        label: 'GeoIP Federation Sync',
        tooltip: 'Lets this key push abuse signals into the fleet shared GeoIP threat intelligence.',
        grantPermissions: APIKEY_FEDERATION_GRANT_PERMS,
    },
]);

/** Loose-truthy grants, matching django-mojo's JSON permission semantics. */
export function grantedPermissions(dict: Record<string, unknown> | null | undefined): string[] {
    return Object.entries(dict ?? {})
        .filter(([, value]) => value === true || value === 1)
        .map(([name]) => name);
}

export interface WebhookSubscriptionRow {
    id: number;
    created: number;
    modified: number;
    url: string;
    events: string[];
    is_active: boolean;
    group: CredentialGroup | number | null;
}

export const WebhookSubscriptionModel = defineModel<WebhookSubscriptionRow>({
    name: 'webhook_subscription',
    endpoint: '/api/group/webhook_subscriptions',
    permissions: {
        view: GROUP_CREDENTIAL_PERMS,
        manage: GROUP_CREDENTIAL_PERMS,
    },
});

/** TagInput CSV or an existing array to the backend JSON-list contract. */
export function normalizeWebhookEvents(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
    return values.map((value) => String(value).trim()).filter(Boolean);
}

export interface WebhookSecretInfo {
    secret: string;
    created_at: string | null;
    last_rotated_at: string | null;
}

/** Explicit reveal/rotate only: the backend auto-mints on first reveal. */
export async function fetchWebhookSecret(groupId: number, rotate = false): Promise<WebhookSecretInfo> {
    const body = await mojoCall('/api/group/webhook_secret', {
        method: 'POST',
        body: rotate ? { group: groupId, rotate: true } : { group: groupId },
    });
    const data = body.data as Partial<WebhookSecretInfo> | undefined;
    if (typeof data?.secret !== 'string' || !data.secret) {
        throw new Error('The server did not return a secret');
    }
    return {
        secret: data.secret,
        created_at: data.created_at ?? null,
        last_rotated_at: data.last_rotated_at ?? null,
    };
}
