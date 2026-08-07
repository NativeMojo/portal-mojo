import { defineModel, mojoSave, withFreshAuth, type Params } from '../../client/runtime';

/** The exact system-level ANY-of gate declared by Setting.RestMeta. */
export const SETTINGS_PERMISSIONS = ['sys.manage_settings', 'sys.groups'];

export interface SettingGroup {
    id: number;
    name: string;
    kind?: string;
}

export interface SettingRow {
    id: number;
    created: number;
    modified: number;
    key: string;
    /** Absent for secret rows after the client sanitation boundary. */
    value?: string;
    display_value: string;
    is_secret: boolean;
    group: SettingGroup | number | null;
}

function sanitizeSettingRow(row: SettingRow): SettingRow {
    const safe = { ...row };
    if (safe.is_secret) delete safe.value;
    return safe;
}

function normalizeSettingListParams(params: Params): Params {
    const safe: Params = {};
    for (const key of ['start', 'size', 'search', 'is_secret', 'group', 'group__isnull']) {
        const value = params[key];
        if (value !== undefined && value !== null && value !== '') safe[key] = value;
    }
    if (typeof params.sort === 'string') {
        const field = params.sort.replace(/^-/, '');
        if (['key', 'is_secret', 'created', 'modified'].includes(field)) safe.sort = params.sort;
    }
    return safe;
}

export const SettingModel = defineModel<SettingRow>({
    name: 'setting',
    endpoint: '/api/settings',
    permissions: {
        view: SETTINGS_PERMISSIONS,
        manage: SETTINGS_PERMISSIONS,
        create: SETTINGS_PERMISSIONS,
    },
    normalizeListParams: normalizeSettingListParams,
    sanitizeRow: sanitizeSettingRow,
});

export interface SettingDraft {
    key: string;
    value: string;
    /** True only after the operator edits the replacement-value control. */
    valueTouched: boolean;
    is_secret: boolean;
    group: number | null;
}

function groupId(group: SettingRow['group']): number | null {
    if (group == null) return null;
    return typeof group === 'number' ? group : group.id;
}

/**
 * Build one atomic django-mojo save body. Property insertion order is part of
 * the wire contract: django-mojo applies each field against the model's
 * current secrecy state. Create keeps is_secret→value. Existing transitions
 * are directional: Plain→Secret is value→is_secret; Secret→Plain is
 * is_secret→value. Same-secret replacement needs only value.
 */
export function buildSettingPayload(draft: SettingDraft, original: SettingRow | null): Record<string, unknown> | null {
    const changes: Record<string, unknown> = {};
    const key = draft.key.trim();
    if (!key) throw new Error('Key is required');

    if (original == null) {
        if (draft.is_secret && draft.value === '') throw new Error('Enter a secret value');
        changes.key = key;
        changes.group = draft.group;
        changes.is_secret = draft.is_secret;
        // Plain settings deliberately support an empty string.
        changes.value = draft.value;
        return changes;
    }

    if (draft.group !== groupId(original.group)) changes.group = draft.group;

    const secrecyChanged = draft.is_secret !== original.is_secret;
    if (secrecyChanged) {
        if (!draft.valueTouched) {
            throw new Error('Enter a replacement value when changing secret status');
        }
        if (draft.is_secret && draft.value === '') throw new Error('Enter a secret replacement value');
        if (draft.is_secret) {
            // Plain → Secret: stage the plaintext while the row is still
            // plain, then flip the flag so on_rest_pre_save encrypts it.
            changes.value = draft.value;
            changes.is_secret = true;
        } else {
            // Secret → Plain: flip first, then write the explicit plain
            // replacement. Empty is valid in this direction.
            changes.is_secret = false;
            changes.value = draft.value;
        }
    } else if (original.is_secret) {
        // Blank means preserve the write-only value. It never becomes a
        // placeholder payload, even if the input was focused and cleared.
        if (draft.valueTouched && draft.value !== '') changes.value = draft.value;
    } else if (draft.valueTouched && draft.value !== (original.value ?? original.display_value ?? '')) {
        changes.value = draft.value;
    }

    return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Secret-bearing writes deliberately bypass TanStack MutationCache: mutation
 * variables retain submitted bodies. Only the sanitized response may leave
 * this helper and enter Query cache.
 */
export async function saveSettingAtomic(
    original: SettingRow | null,
    draft: SettingDraft,
): Promise<SettingRow | null> {
    const changes = buildSettingPayload(draft, original);
    if (changes == null) return null;
    const row = await withFreshAuth(() => mojoSave<SettingRow>(
        SettingModel.endpoint,
        original?.id ?? null,
        changes,
    ));
    return sanitizeSettingRow(row);
}

export function settingGroupLabel(group: SettingRow['group']): string {
    if (group == null) return 'Global';
    return typeof group === 'number' ? `Group #${group}` : group.name;
}
