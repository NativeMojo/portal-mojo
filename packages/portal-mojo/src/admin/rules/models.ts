import { defineModel, type Params } from '../../client/runtime';
import type { FieldOption, FormData } from '../../client/types';
import { SECURITY_MANAGE_PERMS, SECURITY_VIEW_PERMS } from '../security-permissions';

export const RULESET_VIEW_PERMS = SECURITY_VIEW_PERMS;
export const RULESET_MANAGE_PERMS = SECURITY_MANAGE_PERMS;

export interface RuleSetRow {
    id: number; created: number; modified: number; priority: number; category: string; name: string | null;
    bundle_minutes: number | null; bundle_by: number; bundle_by_rule_set: boolean; match_by: number;
    handler: string | null; trigger_count: number | null; trigger_window: number | null;
    retrigger_every: number | null; metadata: Record<string, unknown>; is_active: boolean;
    [field: string]: unknown;
}
export interface RuleRow {
    id: number; created: number; modified: number; parent: number | { id: number; name?: string | null };
    name: string | null; index: number; comparator: string; field_name: string | null;
    value: string; value_type: string; is_required: number; [field: string]: unknown;
}

export const BUNDLE_BY_OPTIONS: readonly FieldOption[] = [
    'Each event', 'Hostname', 'Model type', 'Specific model', 'Source IP', 'Hostname + model type',
    'Hostname + specific model', 'IP + model type', 'IP + specific model', 'IP + hostname',
    'Group', 'Group + model type', 'Group + specific model', 'Group + source IP',
].map((label, value) => ({ value, label }));
export const MATCH_BY_OPTIONS: readonly FieldOption[] = [{ value: 0, label: 'All conditions' }, { value: 1, label: 'Any condition' }];
export const COMPARATOR_OPTIONS: readonly FieldOption[] = ['==', 'eq', '>', '>=', '<', '<=', 'contains', 'regex'].map((value) => ({ value, label: value }));
export const VALUE_TYPE_OPTIONS: readonly FieldOption[] = ['str', 'int', 'float', 'bool'].map((value) => ({ value, label: value }));

export function optionsWithUnknownValue(options: readonly FieldOption[], raw: unknown): FieldOption[] {
    const out = options.map((option) => ({ ...option }));
    if (raw != null && raw !== '' && !out.some((option) => String(option.value) === String(raw))) out.push({ value: String(raw), label: `Unknown (${String(raw)})` });
    return out;
}

function normalize(params: Params, allowed: Set<string>, defaultSort: string): Params {
    const out: Params = { graph: 'default' };
    for (const [key, value] of Object.entries(params)) if (['start', 'size', 'sort', 'search'].includes(key) || allowed.has(key)) if (value != null && value !== '') out[key] = value;
    out.sort = String(out.sort ?? defaultSort); return out;
}
export const normalizeRuleSetListParams = (params: Params) => normalize(params, new Set(['id', 'category', 'category__icontains', 'priority', 'is_active', 'bundle_by', 'match_by']), 'priority');
export const normalizeRuleListParams = (params: Params) => normalize(params, new Set(['id', 'parent', 'index', 'field_name', 'comparator', 'value_type', 'is_required']), 'index');

export const RuleSetModel = defineModel<RuleSetRow>({ name: 'incident_ruleset', endpoint: '/api/incident/event/ruleset', permissions: { view: RULESET_VIEW_PERMS, manage: RULESET_MANAGE_PERMS, delete: RULESET_MANAGE_PERMS }, normalizeListParams: normalizeRuleSetListParams });
export const RuleModel = defineModel<RuleRow>({ name: 'incident_rule', endpoint: '/api/incident/event/ruleset/rule', permissions: { view: RULESET_VIEW_PERMS, manage: RULESET_MANAGE_PERMS, delete: RULESET_MANAGE_PERMS }, normalizeListParams: normalizeRuleListParams });

function nullablePositive(value: unknown, label: string, allowZero = false): number | null {
    if (value == null || value === '') return null;
    const parsed = Number(String(value).trim());
    if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) throw new Error(`${label} must be ${allowZero ? 'zero or ' : ''}a positive integer.`);
    return parsed;
}
function integer(value: unknown, label: string): number { const parsed = Number(String(value).trim()); if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`); return parsed; }
function text(value: unknown, label: string): string { const parsed = String(value ?? '').trim(); if (!parsed) throw new Error(`${label} is required.`); return parsed; }
function present(data: FormData, key: string): boolean { return Object.prototype.hasOwnProperty.call(data, key); }

export function validateRuleSetTuple(values: { bundle_by: number; bundle_minutes: number | null; trigger_count: number | null; trigger_window: number | null; retrigger_every: number | null }): void {
    const effectiveBundle = values.bundle_by !== 0 && values.bundle_minutes !== 0;
    if (values.trigger_window != null && values.trigger_count == null) throw new Error('Trigger window requires a trigger count.');
    if (values.retrigger_every != null && values.trigger_count == null) throw new Error('Re-trigger count requires a trigger count.');
    if (values.trigger_count != null && !effectiveBundle) throw new Error('A count threshold requires effective bundling.');
    if (values.trigger_window != null && values.bundle_minutes != null && values.bundle_minutes > 0 && values.trigger_window > values.bundle_minutes) throw new Error('Trigger window cannot exceed the finite bundle window.');
}

export function ruleSetChanges(data: FormData, creating: boolean, original?: Partial<RuleSetRow>): Record<string, unknown> {
    const defaults = { priority: 10, category: '', name: '', bundle_minutes: 30, bundle_by: 4, bundle_by_rule_set: true, match_by: 0, handler: '', trigger_count: null, trigger_window: null, retrigger_every: null };
    const source = { ...defaults, ...original, ...data } as Record<string, unknown>;
    const tuple = {
        bundle_by: integer(source.bundle_by, 'Bundle mode'),
        bundle_minutes: nullablePositive(source.bundle_minutes, 'Bundle window', true),
        trigger_count: nullablePositive(source.trigger_count, 'Trigger count'),
        trigger_window: nullablePositive(source.trigger_window, 'Trigger window'),
        retrigger_every: nullablePositive(source.retrigger_every, 'Re-trigger count'),
    };
    const changedBundleMode = creating || original?.bundle_by == null || tuple.bundle_by !== original.bundle_by;
    if (changedBundleMode && (tuple.bundle_by < 0 || tuple.bundle_by > 13)) throw new Error('Bundle mode must be 0 through 13. Existing future values may be preserved unchanged.');
    validateRuleSetTuple(tuple);
    const out: Record<string, unknown> = {};
    const write = (key: string, value: unknown) => { if (creating || present(data, key)) out[key] = value; };
    write('name', text(source.name, 'Name')); write('category', text(source.category, 'Category'));
    write('priority', integer(source.priority, 'Priority')); write('match_by', integer(source.match_by, 'Match mode'));
    write('bundle_by', tuple.bundle_by); write('bundle_minutes', tuple.bundle_minutes);
    write('bundle_by_rule_set', source.bundle_by_rule_set === true); write('trigger_count', tuple.trigger_count);
    write('trigger_window', tuple.trigger_window); write('retrigger_every', tuple.retrigger_every);
    write('handler', String(source.handler ?? ''));
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) if (key.startsWith('metadata.')) metadata[key.slice(9)] = value;
    if (Object.keys(metadata).length) out.metadata = metadata;
    if (creating) out.is_active = false; else if (present(data, 'is_active')) out.is_active = data.is_active === true;
    return out;
}

export function ruleChanges(data: FormData, creating: boolean, original?: Partial<RuleRow>): Record<string, unknown> {
    const source = { index: 0, comparator: '==', value_type: 'str', is_required: 0, value: '', ...original, ...data } as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const write = (key: string, value: unknown) => { if (creating || present(data, key)) out[key] = value; };
    const fieldName = text(source.field_name, 'Field name');
    const changedField = creating || original?.field_name == null || fieldName !== original.field_name;
    if (changedField && fieldName.startsWith('_')) throw new Error('Field names beginning with “_” cannot be matched.');
    const valueType = String(source.value_type ?? 'str');
    const changesComparison = creating
        || (present(data, 'value') && String(data.value ?? '') !== String(original?.value ?? ''))
        || (present(data, 'value_type') && valueType !== String(original?.value_type ?? ''));
    if (valueType === 'bool' && changesComparison) throw new Error('Boolean authoring is disabled: django-mojo treats the stored string “false” as true. Existing boolean rules remain preservable.');
    const value = String(source.value ?? '');
    if (changesComparison && valueType === 'int' && !/^[+-]?\d+$/.test(value.trim())) throw new Error('Comparison value must be an integer.');
    if (changesComparison && valueType === 'float' && !Number.isFinite(Number(value.trim()))) throw new Error('Comparison value must be numeric.');
    write('parent', integer(source.parent, 'Rule set')); write('name', text(source.name, 'Name')); write('index', integer(source.index, 'Index'));
    write('field_name', fieldName); write('comparator', String(source.comparator)); write('value_type', valueType); write('value', value);
    write('is_required', source.is_required === true || String(source.is_required) === '1' ? 1 : 0);
    return out;
}
