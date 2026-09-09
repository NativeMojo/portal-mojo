import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    defineModel, mojoCall, mojoSave, withFreshAuth,
    type Params, type PermSpec,
} from '../../client/runtime';

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

export interface ApiKeyRateLimitOverride {
    /** Requests permitted inside `window`. Positive whole number, no fixed maximum. */
    limit: number;
    /** Window length in minutes. Positive whole number, no fixed maximum. */
    window: number;
}

export type ApiKeyRateLimitEntryKind = 'valid' | 'repairable' | 'scalar' | 'reserved';

/** A derived view of one raw `ApiKey.limits` entry. The source value is never rewritten. */
export interface ApiKeyRateLimitEntry {
    rawEndpoint: string;
    rawValue: unknown;
    kind: ApiKeyRateLimitEntryKind;
    override: ApiKeyRateLimitOverride | null;
    issue: string | null;
    canEdit: boolean;
    canClear: boolean;
}

export interface ApiKeyRateLimitsRead {
    /** False when the top-level wire value is not a JSON object. */
    isObject: boolean;
    /** True only for a valid, genuinely empty object. */
    isEmpty: boolean;
    /** Unsafe top-level or entry data prevents an unlimited/configured-safe claim. */
    hasUnsafe: boolean;
    entries: ApiKeyRateLimitEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Derive editable and review-required entries without normalizing raw endpoint
 * identity or discarding extension-owned values.
 */
export function readApiKeyRateLimits(raw: unknown): ApiKeyRateLimitsRead {
    if (!isPlainObject(raw)) {
        return { isObject: false, isEmpty: false, hasUnsafe: true, entries: [] };
    }
    const entries = Object.entries(raw)
        .sort(([left], [right]) => left.localeCompare(right))
        .map<ApiKeyRateLimitEntry>(([rawEndpoint, rawValue]) => {
            const reserved = rawEndpoint === '__replace';
            const blank = rawEndpoint.trim().length === 0;
            const objectValue = isPlainObject(rawValue);
            const validValue = objectValue
                && isPositiveInteger(rawValue.limit)
                && isPositiveInteger(rawValue.window);

            if (reserved) {
                return {
                    rawEndpoint, rawValue, kind: 'reserved', override: null,
                    issue: 'Reserved __replace data cannot be changed or cleared by a generic JSON update. Repair the full stored value outside this editor.',
                    canEdit: false, canClear: false,
                };
            }
            if (blank) {
                return {
                    rawEndpoint, rawValue, kind: objectValue ? 'repairable' : 'scalar', override: null,
                    issue: 'The stored endpoint key is empty or whitespace-only. It may only be cleared using its exact raw identity.',
                    canEdit: false, canClear: true,
                };
            }
            if (validValue) {
                return {
                    rawEndpoint, rawValue, kind: 'valid',
                    override: { limit: rawValue.limit as number, window: rawValue.window as number },
                    issue: null, canEdit: true, canClear: true,
                };
            }
            if (objectValue) {
                const usesDecoratorWindow = isPositiveInteger(rawValue.limit)
                    && !Object.prototype.hasOwnProperty.call(rawValue, 'window');
                return {
                    rawEndpoint, rawValue, kind: 'repairable', override: null,
                    issue: usesDecoratorWindow
                        ? 'Legacy override has no explicit window. The server uses the endpoint decorator default; repair it to store a positive whole-minute window.'
                        : 'Invalid stored override: limit and window must both be positive integers in minutes. This entry does not create a per-key hard ceiling.',
                    canEdit: true, canClear: true,
                };
            }
            return {
                rawEndpoint, rawValue, kind: 'scalar', override: null,
                issue: 'Stored override is not an object. It may be cleared, but cannot be edited as a structured limit.',
                canEdit: false, canClear: true,
            };
        });
    return {
        isObject: true,
        isEmpty: entries.length === 0,
        hasUnsafe: entries.some((entry) => entry.kind !== 'valid'),
        entries,
    };
}

export interface ApiKeyRateLimitInput {
    endpoint?: unknown;
    limit?: unknown;
    window?: unknown;
}

function parsePositiveInteger(value: unknown, label: string): number {
    if (typeof value === 'boolean') throw new Error(`${label} must be a positive integer.`);
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
}

/** Validate normalized Add input or an immutable existing endpoint Edit. */
export function validateApiKeyRateLimitInput(
    input: ApiKeyRateLimitInput,
    options: { existing?: unknown; fixedEndpoint?: string } = {},
): { endpoint: string; override: ApiKeyRateLimitOverride } {
    const adding = options.fixedEndpoint === undefined;
    const endpoint = adding ? String(input.endpoint ?? '').trim() : options.fixedEndpoint!;
    if (!endpoint) throw new Error('Endpoint key is required.');
    if (endpoint === '__replace') throw new Error('__replace is reserved and cannot be used as an endpoint key.');
    if (adding && isPlainObject(options.existing)
        && Object.prototype.hasOwnProperty.call(options.existing, endpoint)) {
        throw new Error('That endpoint key already has an override. Edit the existing row instead.');
    }
    return {
        endpoint,
        override: {
            limit: parsePositiveInteger(input.limit, 'Request limit'),
            window: parsePositiveInteger(input.window, 'Window in minutes'),
        },
    };
}

/**
 * Build one narrow JSONField patch. `currentValue` is optional for Add; Edit
 * passes the exact raw object so extension-owned nested siblings survive the
 * backend's recursive merge. Null is an exact-key tombstone after django-mojo
 * 3105. The reserved root signal is deliberately impossible to target.
 */
export function buildApiKeyLimitPatch(
    rawEndpoint: string,
    override: ApiKeyRateLimitOverride | null,
    currentValue?: unknown,
): Record<string, unknown> {
    if (rawEndpoint === '__replace') {
        throw new Error('__replace is a reserved JSON update signal and cannot be edited or cleared here.');
    }
    if (override === null) return { [rawEndpoint]: null };
    const limit = parsePositiveInteger(override.limit, 'Request limit');
    const window = parsePositiveInteger(override.window, 'Window in minutes');
    const preserved = isPlainObject(currentValue) ? currentValue : {};
    return { [rawEndpoint]: { ...preserved, limit, window } };
}

interface GroupApiKeyCreateResponse extends GroupApiKeyRow {
    /** Present on the create echo only. Never written to Query cache. */
    token?: string;
}

/** Defense in depth for every Query/Mutation cache write. */
function sanitizeGroupApiKeyRow(row: GroupApiKeyRow): GroupApiKeyRow {
    const safe = { ...row } as GroupApiKeyRow & Record<string, unknown>;
    delete safe.token;
    delete safe.token_hash;
    return safe;
}

/**
 * Ordinary lists are always the safe default graph. URL/persisted state may
 * carry arbitrary params, so remove graph/search and reject unsupported sort
 * fields before this object becomes either the query key or wire request.
 */
function normalizeGroupApiKeyListParams(params: Params): Params {
    const safe: Params = { ...params };
    delete safe.graph;
    delete safe.search;
    if (typeof safe.sort === 'string') {
        const field = safe.sort.replace(/^-/, '');
        if (!['name', 'is_active', 'last_used', 'created'].includes(field)) delete safe.sort;
    }
    return { ...safe, graph: 'default' };
}

export const GroupApiKeyModel = defineModel<GroupApiKeyRow>({
    name: 'group_api_key',
    endpoint: '/api/group/apikey',
    permissions: {
        view: GROUP_CREDENTIAL_PERMS,
        manage: GROUP_CREDENTIAL_PERMS,
    },
    normalizeListParams: normalizeGroupApiKeyListParams,
    sanitizeRow: sanitizeGroupApiKeyRow,
});

export interface CreateGroupApiKeyVariables {
    changes: Record<string, unknown>;
    /** Uncached one-shot channel invoked before the mutation resolves. */
    onToken?: (token: string, row: GroupApiKeyRow) => void | Promise<void>;
}

/**
 * Create is deliberately separate from ModelDef.useSave(): the backend adds
 * the raw token to the create echo. Split it before any cache write and invoke
 * the transient callback while the mutation is still pending. MutationCache
 * resolves with only the safe row and never retains the raw token as data.
 */
export function useCreateGroupApiKey() {
    const qc = useQueryClient();
    return useMutation<GroupApiKeyRow, Error, CreateGroupApiKeyVariables>({
        mutationFn: async ({ changes, onToken }) => {
            const created = await withFreshAuth(() =>
                mojoSave<GroupApiKeyCreateResponse>(GroupApiKeyModel.endpoint, null, changes));
            const safeRow = sanitizeGroupApiKeyRow(created);
            let token = typeof created.token === 'string' && created.token ? created.token : null;
            try {
                if (token && onToken) await onToken(token, safeRow);
            } finally {
                // Drop both references before the safe result resolves into
                // MutationCache. The dialog has unmounted when its promise ends.
                token = null;
                delete created.token;
            }
            return safeRow;
        },
        onSuccess: (row) => {
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
        name: 'send_sms',
        label: 'Send SMS',
        tooltip: 'Send outbound SMS messages for this key\'s group.',
    },
    {
        name: 'comms',
        label: 'Communications',
        tooltip: 'Broad communications access, including SMS. Prefer Send SMS when that is all the integration needs.',
    },
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

/** TagInput CSV or array to unique permission names. */
export function normalizeApiKeyPermissionNames(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
    const names: string[] = [];
    for (const value of values) {
        let name = String(value ?? '').trim();
        if (name.startsWith('permissions.')) name = name.slice('permissions.'.length).trim();
        if (!name) continue;
        if (name === '__replace') {
            throw new Error('Permission "__replace" is reserved and cannot be granted.');
        }
        if (!names.includes(name)) names.push(name);
    }
    return names;
}

/** Truthy stored grants that have no registered guided control. */
export function customApiKeyPermissionNames(
    dict: Record<string, unknown> | null | undefined,
): string[] {
    const registered = new Set(getGroupApiKeyPermissions().map((permission) => permission.name));
    return grantedPermissions(dict).filter((name) => !registered.has(name)).sort();
}

/**
 * Build a merge-safe permissions patch from rendered switches and freeform
 * tags. Only rendered switches are diffed, so protected controls hidden from
 * this operator remain untouched. Missing previously-custom tags are revoked.
 */
export function buildApiKeyPermissionChanges(
    current: Record<string, unknown> | null | undefined,
    rendered: ApiKeyPermissionDef[],
    form: Record<string, unknown>,
    customRaw: unknown,
): Record<string, boolean> {
    const currentGranted = new Set(grantedPermissions(current));
    const changes: Record<string, boolean> = {};

    for (const permission of rendered) {
        const next = form[`permissions.${permission.name}`] === true;
        if (currentGranted.has(permission.name) !== next) changes[permission.name] = next;
    }

    const beforeCustom = new Set(customApiKeyPermissionNames(current));
    const afterCustom = normalizeApiKeyPermissionNames(customRaw);
    for (const name of afterCustom) {
        if (!currentGranted.has(name)) changes[name] = true;
    }
    for (const name of beforeCustom) {
        if (!afterCustom.includes(name)) changes[name] = false;
    }
    return changes;
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

function normalizeWebhookListParams(params: Params): Params {
    const safe: Params = { ...params };
    delete safe.search;
    if (typeof safe.sort === 'string') {
        const field = safe.sort.replace(/^-/, '');
        if (!['url', 'is_active', 'created'].includes(field)) delete safe.sort;
    }
    return safe;
}

export const WebhookSubscriptionModel = defineModel<WebhookSubscriptionRow>({
    name: 'webhook_subscription',
    endpoint: '/api/group/webhook_subscriptions',
    permissions: {
        view: GROUP_CREDENTIAL_PERMS,
        manage: GROUP_CREDENTIAL_PERMS,
    },
    normalizeListParams: normalizeWebhookListParams,
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
