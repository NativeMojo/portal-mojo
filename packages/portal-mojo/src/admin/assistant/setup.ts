/** Owner-only, imperative setup protocol. Never put these operations in Query/Mutation caches. */
import { apiOrigin, mojoCall, usingMockTransport, type FetchOpts } from '../../client/client';

export const ASSISTANT_SETUP_ENDPOINT = '/api/account/admin/assistant';
export type SetupTarget = 'assistant' | 'handler';
export interface SetupKey { configured: boolean; source: 'admin' | 'deployment' | 'none'; hint: string }
export interface SetupCheck { ok: boolean | null; code: string; message: string; at: string }
export interface SetupGrant {
    id: number; client: { id: number; client_id: string; name: string };
    user: { id: number; email: string; display_name: string }; resource: string; scopes: string[];
    access: 'tools' | 'api' | 'both'; created: string; last_used: string; expires: string; is_active: boolean; revoked_reason: string;
}
export interface AssistantSetupState {
    schema_version: 2; enabled: boolean; key: SetupKey; handler_key: SetupKey;
    model: { selected: string; effective: string; source: string; choices: Array<{ id: string; label: string }>; capability?: {
        mode: 'auto' | 'pinned' | 'fixed'; editable: boolean; policy_model: string;
        restriction: '' | 'fixed_policy' | 'provider_unsupported' | 'deployment_pin' | 'policy_unavailable';
        discovery: { status: 'fresh' | 'stale' | 'unavailable' | 'not_applicable'; fetched_at: string | null; attempted_at: string | null; expires_at: string | null; max_stale_at: string | null; error_code: string };
        refresh: { attempted: boolean; ok: boolean | null; code: string };
    } };
    verify: SetupCheck; handler_verify: SetupCheck;
    emergency_stop: boolean; emergency_stop_static: boolean; emergency_stop_database: boolean;
    route: { feature: string; provider: string; model: string; credential: string; credential_configured: boolean; ready: boolean; can_invoke?: boolean; error: string };
    autonomous_triage: boolean; autonomous_triage_activated_at: string;
    assistant_installed: boolean; realtime_installed: boolean;
    mcp: { enabled: boolean; path: string; url: string; discovery_url: string;
        discovery: { ok: boolean | null; code: string; detail: string; checked_at: string }; grants: SetupGrant[]; grant_count: number };
    safety: { hours: number; error: string; requests: Array<{ provider: string; feature: string; status: string; requests: number; input_tokens: number; output_tokens: number }>;
        breakers: Array<{ provider: string; state: string; error_code: string; count: number }> };
}
export interface SetupSave {
    action: 'save'; enabled: boolean; model?: string; api_key?: string; clear_api_key?: boolean;
    handler_api_key?: string; clear_handler_api_key?: boolean; mcp_enabled?: boolean; emergency_stop?: boolean; autonomous_triage?: boolean;
}
export type SetupAction = SetupSave
    | { action: 'set_model_selection'; mode: 'auto'; model?: never }
    | { action: 'set_model_selection'; mode: 'pinned'; model: string }
    | { action: 'verify'; target: SetupTarget; api_key?: string }
    | { action: 'activate_policy' }
    | { action: 'reset_breaker'; provider?: 'anthropic' | 'bedrock' }
    | { action: 'historical_triage'; before: string; limit: number }
    | { action: 'revoke_grant'; grant_id: number }
    | { action: 'revoke_all_grants' };
export interface SetupActionResult { state: AssistantSetupState; result?: SetupCheck; saved?: boolean; verified?: boolean; activated?: boolean; reset?: number; revoked?: number; queued?: number }
const object = (v: unknown): Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max = 160): string => typeof v === 'string' ? v.slice(0, max) : '';
const number = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0;
const verdict = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
const rows = (v: unknown, max: number): Record<string, unknown>[] => Array.isArray(v) ? v.slice(0, max).map(object) : [];
const identifier = (v: unknown): string => /^[a-z0-9][a-z0-9.\-]{0,80}$/.test(text(v, 82)) ? text(v, 81) : '';
// The additive wire capability is all-or-nothing; malformed fields never enable a writer.
const runtimeIdentifier = (v: unknown): string => typeof v === 'string' && v.length <= 200 && /^[^\s\x00-\x1f\x7f]+$/.test(v) ? v : '';
const safeCode = (v: unknown): string => typeof v === 'string' && /^[a-z0-9_]{0,64}$/.test(v) ? v : '';
function projectModelCapability(model: Record<string, unknown>): AssistantSetupState['model']['capability'] {
    const d = object(model.discovery), r = object(model.refresh);
    const timestamp = (v: unknown) => v === null || (typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)));
    if (typeof model.mode !== 'string' || typeof model.restriction !== 'string' || typeof model.source !== 'string' || typeof d.status !== 'string' || !['auto', 'pinned', 'fixed'].includes(model.mode) || typeof model.editable !== 'boolean'
        || typeof model.policy_model !== 'string' || model.policy_model.length > 200
        || !['', 'fixed_policy', 'provider_unsupported', 'deployment_pin', 'policy_unavailable'].includes(model.restriction)
        || !['automatic', 'admin', 'deployment', 'policy'].includes(model.source)
        || !['fresh', 'stale', 'unavailable', 'not_applicable'].includes(d.status)
        || !['fetched_at', 'attempted_at', 'expires_at', 'max_stale_at'].every((key) => timestamp(d[key]))
        || typeof d.error_code !== 'string' || safeCode(d.error_code) !== d.error_code
        || typeof r.attempted !== 'boolean' || (r.ok !== null && typeof r.ok !== 'boolean')
        || typeof r.code !== 'string' || safeCode(r.code) !== r.code) return undefined;
    if (model.mode === 'fixed' ? model.editable !== false || !['fixed_policy', 'provider_unsupported', 'policy_unavailable'].includes(model.restriction)
        : model.editable !== true || model.policy_model !== 'auto:sonnet' || !['', 'deployment_pin'].includes(model.restriction)
            || (model.mode === 'auto' ? model.source !== 'automatic' || model.restriction !== '' : !['admin', 'deployment'].includes(model.source) || !identifier(model.selected))) return undefined;
    return {
        mode: model.mode as 'auto' | 'pinned' | 'fixed', editable: model.editable, policy_model: model.policy_model,
        restriction: model.restriction as NonNullable<AssistantSetupState['model']['capability']>['restriction'],
        discovery: { status: d.status as 'fresh' | 'stale' | 'unavailable' | 'not_applicable', fetched_at: d.fetched_at as string | null, attempted_at: d.attempted_at as string | null, expires_at: d.expires_at as string | null, max_stale_at: d.max_stale_at as string | null, error_code: d.error_code },
        refresh: { attempted: r.attempted, ok: r.ok as boolean | null, code: r.code },
    };
}
const CHECK_MESSAGES: Record<string, string> = { verified: 'Anthropic accepted this key.', invalid_key: 'Anthropic rejected this key.', unreachable: 'Anthropic could not be reached to check this key.', not_configured: 'No API key is configured to check.' };
function projectCheck(raw: unknown): SetupCheck {
    const v = object(raw); const code = text(v.code, 64);
    return { ok: verdict(v.ok), code, message: CHECK_MESSAGES[code] ?? 'No stored check is available.', at: text(v.at, 40) };
}
function projectKey(raw: unknown): SetupKey {
    const v = object(raw);
    return { configured: v.configured === true, source: v.source === 'admin' || v.source === 'deployment' ? v.source : 'none', hint: text(v.hint, 32) };
}
/** Positive bounded schema projection. Raw response objects never enter component state. */
export function projectAssistantSetup(raw: unknown): AssistantSetupState {
    const v = object(raw);
    if (v.schema_version !== 2) throw new Error('Assistant setup schema is unavailable.');
    const model = object(v.model), route = object(v.route), mcp = object(v.mcp), discovery = object(mcp.discovery), safety = object(v.safety);
    const capability = projectModelCapability(model);
    return {
        schema_version: 2, enabled: v.enabled === true, key: projectKey(v.key), handler_key: projectKey(v.handler_key),
        model: { selected: identifier(model.selected), effective: text(model.effective, 200), source: ['automatic', 'admin', 'deployment', 'policy', 'setting', 'default'].includes(String(model.source)) ? String(model.source) : '', choices: rows(model.choices, 200).map((row) => ({ id: runtimeIdentifier(row.id), label: text(row.label) })).filter((row) => row.id !== ''), ...(capability ? { capability } : {}) },
        verify: projectCheck(v.verify), handler_verify: projectCheck(v.handler_verify),
        emergency_stop: v.emergency_stop !== false, emergency_stop_static: v.emergency_stop_static !== false, emergency_stop_database: v.emergency_stop_database !== false,
        route: { feature: text(route.feature, 64), provider: ['anthropic', 'bedrock'].includes(String(route.provider)) ? String(route.provider) : '', model: text(route.model, 200), credential: ['admin', 'handler', 'aws'].includes(String(route.credential)) ? String(route.credential) : '', credential_configured: route.credential_configured === true, ready: route.ready === true, ...(typeof route.can_invoke === 'boolean' ? { can_invoke: route.can_invoke } : {}), error: text(route.error, 64) },
        autonomous_triage: v.autonomous_triage === true, autonomous_triage_activated_at: text(v.autonomous_triage_activated_at, 40),
        assistant_installed: v.assistant_installed === true, realtime_installed: v.realtime_installed === true,
        mcp: { enabled: mcp.enabled === true, path: text(mcp.path, 500), url: text(mcp.url, 2000), discovery_url: text(mcp.discovery_url, 2000),
            discovery: { ok: verdict(discovery.ok), code: text(discovery.code, 64), detail: text(discovery.detail, 500), checked_at: text(discovery.checked_at, 40) }, grant_count: number(mcp.grant_count),
            grants: rows(mcp.grants, 200).map((row): SetupGrant => { const client = object(row.client), user = object(row.user); return {
                id: number(row.id), client: { id: number(client.id), client_id: text(client.client_id), name: text(client.name) },
                user: { id: number(user.id), email: text(user.email, 254), display_name: text(user.display_name) }, resource: text(row.resource, 2000),
                scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === 'string').slice(0, 30).map((s) => s.slice(0, 64)) : [],
                access: row.access === 'api' || row.access === 'both' ? row.access : 'tools', created: text(row.created, 40), last_used: text(row.last_used, 40), expires: text(row.expires, 40), is_active: row.is_active === true, revoked_reason: text(row.revoked_reason, 160),
            }; }).filter((row) => Number.isSafeInteger(row.id) && row.id > 0) },
        safety: { hours: number(safety.hours), error: text(safety.error, 64),
            requests: rows(safety.requests, 200).map((row) => ({ provider: text(row.provider, 64), feature: text(row.feature, 64), status: text(row.status, 64), requests: number(row.requests), input_tokens: number(row.input_tokens), output_tokens: number(row.output_tokens) })),
            breakers: rows(safety.breakers, 100).map((row) => ({ provider: text(row.provider, 64), state: text(row.state, 64), error_code: text(row.error_code, 64), count: number(row.count) })) },
    };
}
export function assistantSetupReadiness(state: AssistantSetupState): string {
    if (!state.assistant_installed) return 'The Assistant application is not installed.';
    if (!state.realtime_installed) return 'The realtime application is not installed. Install it before using the Assistant.';
    if (state.emergency_stop) return 'An emergency stop is blocking Assistant requests.';
    if (state.model.capability?.mode === 'auto' && state.route.provider && state.route.credential && !state.model.effective) return 'Automatic model resolution is unavailable. Refresh the provider catalogue and review its reported freshness. Request admission does not prove that a usable model is ready.';
    if (!state.route.provider || !state.route.model || !state.route.credential) return 'The deployment’s model and key selection are unavailable. Review the deployed policy and its selected credential in advanced controls; adding an Assistant key alone may not resolve this.';
    if (!state.route.ready) return 'The deployment configuration needs attention. Review its selected key and policy.';
    if (!state.enabled) return 'The deployment configuration is ready. Enable the Assistant when you are ready.';
    return 'Assistant configuration is ready. Provider availability has not been checked.';
}
export function assertAssistantSetupOrigin(): void {
    if (usingMockTransport()) return;
    if (new URL(apiOrigin(), window.location.origin).origin !== window.location.origin) throw new Error('Assistant setup actions require the same origin.');
}
export type SetupRequestOptions = Pick<FetchOpts, 'signal' | 'beforeSend'>;
export async function getAssistantSetup(options: SetupRequestOptions = {}, probe?: 'models' | 'discovery'): Promise<AssistantSetupState> {
    const body = await mojoCall(ASSISTANT_SETUP_ENDPOINT, { ...options, params: probe === 'models' ? { refresh: 'models' } : probe === 'discovery' ? { check: 'discovery' } : undefined });
    return projectAssistantSetup(body.data);
}
const ACTION_KEYS: Record<SetupAction['action'], readonly string[]> = {
    save: ['action', 'enabled', 'model', 'api_key', 'clear_api_key', 'handler_api_key', 'clear_handler_api_key', 'mcp_enabled', 'emergency_stop', 'autonomous_triage'],
    set_model_selection: ['action', 'mode', 'model'],
    verify: ['action', 'target', 'api_key'], activate_policy: ['action'], reset_breaker: ['action', 'provider'], historical_triage: ['action', 'before', 'limit'], revoke_grant: ['action', 'grant_id'], revoke_all_grants: ['action'],
};
export function validateAssistantSetupAction(action: SetupAction): void {
    if (!ACTION_KEYS[action.action] || Object.keys(action).some((key) => !ACTION_KEYS[action.action].includes(key))) throw new Error('Unsupported setup action fields.');
    const v = action as unknown as Record<string, unknown>;
    for (const key of ['api_key', 'handler_api_key']) if (v[key] !== undefined && (typeof v[key] !== 'string' || (v[key] as string).length > 4096 || /\s/.test(v[key] as string))) throw new Error('Enter a valid key without spaces.');
    if (action.action === 'save') {
        if (typeof action.enabled !== 'boolean' || (action.model !== undefined && (typeof action.model !== 'string' || (action.model !== '' && identifier(action.model) !== action.model)))) throw new Error('Enabled and a valid optional legacy model are required.');
        for (const key of ['clear_api_key', 'clear_handler_api_key', 'mcp_enabled', 'emergency_stop', 'autonomous_triage']) if (v[key] !== undefined && typeof v[key] !== 'boolean') throw new Error('Setup switches must be boolean.');
        if ((action.api_key && action.clear_api_key) || (action.handler_api_key && action.clear_handler_api_key)) throw new Error('Replace and clear are separate operations.');
    }
    if (action.action === 'set_model_selection' && (action.mode === 'auto' ? Object.hasOwn(action, 'model') : action.mode !== 'pinned' || !action.model || identifier(action.model) !== action.model)) throw new Error('Choose Automatic without a model or a valid manual pin.');
    if (action.action === 'verify' && action.target !== 'assistant' && action.target !== 'handler') throw new Error('Select a credential target.');
    if (action.action === 'reset_breaker' && action.provider !== undefined && !['anthropic', 'bedrock'].includes(action.provider)) throw new Error('Unsupported provider.');
    if (action.action === 'historical_triage' && (!/^\d{4}-\d\d-\d\dT/.test(action.before) || !Number.isFinite(Date.parse(action.before)) || !Number.isInteger(action.limit) || action.limit < 1 || action.limit > 100)) throw new Error('Choose an ISO cutoff and a limit from 1 through 100.');
    if (action.action === 'revoke_grant' && (!Number.isSafeInteger(action.grant_id) || action.grant_id <= 0)) throw new Error('Select a valid connection.');
}
export async function mutateAssistantSetup(action: SetupAction, options: SetupRequestOptions = {}): Promise<SetupActionResult> {
    validateAssistantSetupAction(action); assertAssistantSetupOrigin();
    const body = await mojoCall(ASSISTANT_SETUP_ENDPOINT, { method: 'POST', body: { ...action }, signal: options.signal, beforeSend: () => { assertAssistantSetupOrigin(); options.beforeSend?.(); } });
    const raw = object(body.data);
    if (raw.schema_version !== 2) throw new Error('Assistant setup schema is unavailable.');
    return { state: projectAssistantSetup(raw.state), ...(action.action === 'verify' ? { result: projectCheck(raw.result) } : {}),
        ...(typeof raw.saved === 'boolean' ? { saved: raw.saved } : {}), ...(typeof raw.verified === 'boolean' ? { verified: raw.verified } : {}), ...(typeof raw.activated === 'boolean' ? { activated: raw.activated } : {}),
        ...(typeof raw.reset === 'number' ? { reset: number(raw.reset) } : {}), ...(typeof raw.revoked === 'number' ? { revoked: number(raw.revoked) } : {}), ...(typeof raw.queued === 'number' ? { queued: number(raw.queued) } : {}) };
}
/** Preserve old-server baselines; capable servers own model selection through its dedicated action. */
export function assistantSetupSave(state: AssistantSetupState, changes: Omit<SetupSave, 'action' | 'enabled' | 'model'> & { enabled?: boolean; model?: string }): SetupSave {
    const { model, ...other } = changes;
    return { action: 'save', enabled: state.enabled, ...(!state.model.capability ? { model: model ?? state.model.selected } : {}), ...other };
}

/** Only backend fixed pre-write credential refusals earn a definite no-write message. */
export function assistantSetupCredentialRefusal(error: unknown): string | null {
    if (!(error instanceof Error)) return null;
    for (const [wire, label] of [['api key', 'Assistant key'], ['handler api key', 'Platform key']] as const) {
        if (error.message === `The ${wire} was not accepted. Anthropic rejected this key.`) return `The ${label} was rejected. Check the replacement and try again. Nothing was stored.`;
        if (error.message === `The ${wire} was not accepted. Anthropic could not be reached to check this key.`) return `The ${label} could not be checked because Anthropic was unreachable. Nothing was stored; try again when the provider is available.`;
    }
    return null;
}
