// Media rendering settings (#7729): the data layer behind the Storage →
// Media rendering page. Reads django-mojo's rendition descriptor
// (`GET /api/fileman/renditions/options`, fileman #7728) and writes the three
// FILEMAN_RENDITIONS_* settings through the ordinary `/api/settings` REST.
//
// Everything about roles, fields, choices and limits comes from the
// descriptor. The ONE rule this module hardcodes is the mp4-only trio
// (`codec`/`crf`/`preset`), which the server refuses on a non-mp4 role.
import { mojoCall, mojoList, mojoSave, withFreshAuth } from '../../client/runtime';
import type { SettingRow } from '../settings/model';

export type RenditionCategoryKey = 'image' | 'video' | 'document';
export type RenditionFieldType = 'number' | 'boolean' | 'choice' | 'string';
export type RenditionRoleOptions = Record<string, unknown>;

export interface RenditionCategory {
    key: string;
    defaults: Record<string, RenditionRoleOptions>;
    automatic_default: string[];
    /** The global DATABASE row, parsed, or null. A deployment-file value is applied but never reported here. */
    override: Record<string, unknown> | null;
    effective: { roles: Record<string, RenditionRoleOptions>; automatic: string[] };
    role_kinds: Record<string, string>;
    fields: Record<string, string[]>;
    choices: Record<string, Record<string, string[]>>;
    limits: Record<string, [number, number]>;
}

export interface RenditionOptions {
    categories: Partial<Record<RenditionCategoryKey, RenditionCategory>> & Record<string, RenditionCategory>;
    engine: { key: string; choices: string[]; effective: string };
}

export interface CategoryDraft {
    roles: Record<string, RenditionRoleOptions>;
    automatic: string[];
}

export interface RenditionFieldError {
    role: string;
    field: string | null;
    message: string;
}

/** A routed server refusal: `role` null = panel-level, `_automatic` = the upload switches. */
export interface RoutedRenditionError {
    role: string | null;
    field: string | null;
    message: string;
}

export const RENDITION_OPTIONS_ENDPOINT = '/api/fileman/renditions/options';
export const RENDITION_CATEGORY_ORDER: RenditionCategoryKey[] = ['image', 'video', 'document'];
export const RENDITION_CATEGORY_LABELS: Record<RenditionCategoryKey, string> = { image: 'Images', video: 'Video', document: 'Documents' };
export const AUTOMATIC_KEY = '_automatic';
/** Options only an mp4 transcode accepts; the server refuses them on a webm role (`config.MP4_ONLY_OPTIONS`). */
export const MP4_ONLY_OPTIONS = ['codec', 'crf', 'preset'] as const;
const BITRATE_RE = /^\d+[kKmM]?$/;
const TIME_OFFSET_RE = /^\d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function renditionCategoryLabel(category: string): string {
    const label = (RENDITION_CATEGORY_LABELS as Record<string, string>)[category];
    if (label) return label;
    console.warn(`Media rendering: unknown rendition category "${category}" — rendering its raw key`);
    return category;
}

/** The categories to render, in house order, then any the descriptor adds. */
export function orderedCategories(options: RenditionOptions): string[] {
    const served = Object.keys(options.categories);
    const known = RENDITION_CATEGORY_ORDER.filter((category) => served.includes(category));
    return [...known, ...served.filter((category) => !(RENDITION_CATEGORY_ORDER as string[]).includes(category))];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

export async function readRenditionOptions(): Promise<RenditionOptions> {
    const body = await mojoCall(RENDITION_OPTIONS_ENDPOINT);
    const data = body.data as RenditionOptions | undefined;
    if (!data || !isPlainObject(data.categories)) throw new Error('Rendition options returned an unsupported response');
    for (const [category, descriptor] of Object.entries(data.categories)) {
        if (!descriptor || typeof descriptor.key !== 'string' || !isPlainObject(descriptor.defaults) || !isPlainObject(descriptor.role_kinds) || !isPlainObject(descriptor.fields)) {
            throw new Error(`Rendition options for "${category}" are incomplete`);
        }
    }
    return data;
}

/**
 * The global rows for a category key. The options endpoint does not carry a
 * row id, so one list read finds the row to update. Raw `mojoList` on
 * purpose: `SettingModel.normalizeListParams` strips `key`.
 */
export async function findCategoryRows(key: string): Promise<SettingRow[]> {
    const { rows } = await mojoList<SettingRow>('/api/settings', { key, group__isnull: true, size: 10 });
    return rows.filter((row) => row.key === key && row.group == null).sort((a, b) => a.id - b.id);
}

/** The one typing rule: render, coerce, compare, validate and emit all use it. */
export function fieldType(category: RenditionCategory, kind: string, name: string): RenditionFieldType {
    // Choices first: the server lists a limit for every option NAME it bounds anywhere in the
    // category, so document `quality` (a choice on pdf roles) also appears under `limits`.
    if (category.choices[kind]?.[name]) return 'choice';
    if (name in category.limits) return 'number';
    const boolean = Object.entries(category.defaults).some(([role, options]) => category.role_kinds[role] === kind && typeof options[name] === 'boolean');
    return boolean ? 'boolean' : 'string';
}

/** Coerce a raw control value into the draft's typed value (`null` = unset). */
export function coerceFieldValue(type: RenditionFieldType, raw: unknown): unknown {
    if (raw === '' || raw == null) return null;
    if (type === 'number') {
        const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
        return Number.isFinite(value) ? value : null;
    }
    if (type === 'boolean') return raw === true || raw === 'true';
    return String(raw);
}

function isSet(value: unknown): boolean {
    return value !== null && value !== undefined && value !== '';
}

/** Draft = defaults shallow-merged with the override. Never seeded from `effective` (see the page docs). */
export function valueToDraft(category: RenditionCategory, value: Record<string, unknown> | null | undefined): CategoryDraft {
    const override = isPlainObject(value) ? value : {};
    const roles: Record<string, RenditionRoleOptions> = {};
    for (const [role, base] of Object.entries(category.defaults)) {
        const extra = override[role];
        roles[role] = { ...base, ...(isPlainObject(extra) ? extra : {}) };
    }
    const automatic = override[AUTOMATIC_KEY];
    return {
        roles,
        automatic: Array.isArray(automatic)
            ? automatic.filter((role): role is string => typeof role === 'string' && role in category.defaults)
            : [...category.automatic_default],
    };
}

export function roleFormat(category: RenditionCategory, draft: CategoryDraft, role: string): string | null {
    const value = draft.roles[role]?.format ?? category.defaults[role]?.format;
    return typeof value === 'string' ? value : null;
}

/** Whether a kind carries the mp4-only trio and this role's format is not mp4. */
export function hidesMp4Options(category: RenditionCategory, draft: CategoryDraft, role: string): boolean {
    const kind = category.role_kinds[role];
    if (!kind || !category.fields[kind]?.includes('codec')) return false;
    return (roleFormat(category, draft, role) ?? 'mp4') !== 'mp4';
}

export function sameValue(a: unknown, b: unknown): boolean {
    if (!isSet(a) && !isSet(b)) return true;
    return a === b;
}

/** True when the draft's value for `role.name` is the default (or unset with no default). */
export function isDefaultValue(category: RenditionCategory, draft: CategoryDraft, role: string, name: string): boolean {
    return sameValue(draft.roles[role]?.[name], category.defaults[role]?.[name]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((entry) => right.has(entry));
}

/** `_automatic` as the server should store it: default order first, additions in `defaults` key order. */
export function orderedAutomatic(category: RenditionCategory, automatic: readonly string[]): string[] {
    const chosen = new Set(automatic);
    const kept = category.automatic_default.filter((role) => chosen.has(role));
    const added = Object.keys(category.defaults).filter((role) => chosen.has(role) && !category.automatic_default.includes(role));
    return [...kept, ...added];
}

/**
 * The override to write: only options that differ from the defaults, the
 * mp4-only trio dropped on a non-mp4 role, `_automatic` only when the set
 * differs from `automatic_default`. `{}` means "defaults".
 */
export function draftToValue(category: RenditionCategory, draft: CategoryDraft): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    for (const role of Object.keys(category.defaults)) {
        const kind = category.role_kinds[role] ?? '';
        const names = category.fields[kind] ?? Object.keys(category.defaults[role] ?? {});
        const hideMp4 = hidesMp4Options(category, draft, role);
        const changed: RenditionRoleOptions = {};
        for (const name of names) {
            if (hideMp4 && (MP4_ONLY_OPTIONS as readonly string[]).includes(name)) continue;
            const current = draft.roles[role]?.[name];
            if (!isSet(current)) continue;
            if (sameValue(current, category.defaults[role]?.[name])) continue;
            changed[name] = coerceFieldValue(fieldType(category, kind, name), current);
        }
        if (Object.keys(changed).length) value[role] = changed;
    }
    if (!sameSet(draft.automatic, category.automatic_default)) value[AUTOMATIC_KEY] = orderedAutomatic(category, draft.automatic);
    return value;
}

export function sameOverride(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
    return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/** Client-side mirror of the server's checks, worded identically. Advisory: the server decides. */
export function validateDraft(category: RenditionCategory, draft: CategoryDraft): RenditionFieldError[] {
    const errors: RenditionFieldError[] = [];
    for (const role of Object.keys(category.defaults)) {
        const kind = category.role_kinds[role] ?? '';
        const hideMp4 = hidesMp4Options(category, draft, role);
        for (const name of category.fields[kind] ?? []) {
            if (hideMp4 && (MP4_ONLY_OPTIONS as readonly string[]).includes(name)) continue;
            const current = draft.roles[role]?.[name];
            if (!isSet(current)) continue;
            const where = `${role}.${name}`;
            const type = fieldType(category, kind, name);
            if (type === 'number') {
                const [low, high] = category.limits[name]!;
                if (typeof current !== 'number' || !Number.isInteger(current)) errors.push({ role, field: name, message: `${where}: must be a whole number` });
                else if (current < low || current > high) errors.push({ role, field: name, message: `${where}: must be between ${low} and ${high}` });
            } else if (type === 'choice') {
                const allowed = category.choices[kind]?.[name] ?? [];
                if (typeof current !== 'string' || !allowed.includes(current)) errors.push({ role, field: name, message: `${where}: must be one of ${allowed.join(', ')}` });
            } else if (type === 'boolean') {
                if (typeof current !== 'boolean') errors.push({ role, field: name, message: `${where}: must be true or false` });
            } else if (name === 'bitrate') {
                if (typeof current !== 'string' || !BITRATE_RE.test(current)) errors.push({ role, field: name, message: `${where}: must look like 2000k or 2M` });
            } else if (name === 'time_offset') {
                if (typeof current !== 'string' || !TIME_OFFSET_RE.test(current)) errors.push({ role, field: name, message: `${where}: must look like HH:MM:SS` });
            }
        }
    }
    return errors;
}

/**
 * Route a server refusal to the thing it names. Grammar (`config.validate`):
 * `<role>.<option>: …`, `<role>: …`, `_automatic: …`, or anything else
 * (panel-level).
 */
export function routeRenditionError(message: string, knownRoles: readonly string[] = []): RoutedRenditionError {
    const trimmed = message.trim();
    const match = /^([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?:\s*(.+)$/s.exec(trimmed);
    if (!match) return { role: null, field: null, message: trimmed };
    const [, role, field, rest] = match;
    if (role === AUTOMATIC_KEY) return { role: AUTOMATIC_KEY, field: null, message: rest! };
    if (knownRoles.length && !knownRoles.includes(role!)) return { role: null, field: null, message: trimmed };
    return { role: role!, field: field ?? null, message: rest! };
}

/** Create or update the category's global row. Imperative; a failure rejects. */
export async function saveCategoryValue(category: RenditionCategory, row: SettingRow | null, value: Record<string, unknown>): Promise<SettingRow> {
    const changes: Record<string, unknown> = row ? { value } : { key: category.key, is_secret: false, group: null, value };
    return withFreshAuth(() => mojoSave<SettingRow>('/api/settings', row?.id ?? null, changes));
}

/** Reset = write `{}`. The live Setting model refuses DELETE, and `{}` is reported as `override: null`. */
export async function resetCategory(category: RenditionCategory, row: SettingRow | null): Promise<SettingRow | null> {
    if (!row) return null;
    return saveCategoryValue(category, row, {});
}
