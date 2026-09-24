import { mojoCall, withFreshAuth } from '../../client/runtime';

export const FLEET_HEALTH_SCOPE = 'request_service_jobs_and_dependencies';
export const FLEET_ENDPOINT = '/api/account/admin/fleet';
export interface FleetEntry {
    key: string; label: string; section: string; description: string;
    value_type: 'boolean' | 'integer' | 'string' | 'list' | 'object';
    sensitive: boolean; restart_required: boolean; overridden: boolean;
    current?: unknown; default?: unknown; configured?: boolean;
    min_value?: number | null; max_value?: number | null; max_length?: number; max_items?: number;
}
export interface FleetNode {
    hostname: string; revision: string; published: boolean; installed: boolean;
    restart_requested: boolean; restarted: boolean; healthy: boolean;
    status: string; error_code?: string | null;
}
export interface FleetReport {
    status: string; nodes: FleetNode[]; healthy_everywhere: boolean;
    error_code?: string; observed_at?: string; health_scope?: string;
}
export interface FleetState {
    schema_version: number; revision: string | null; version_id: string | null;
    entries: FleetEntry[]; published: boolean; loaded_revision: string | null;
    pending_restart: boolean; publish_configured: boolean; fleet: FleetReport;
}
export interface FleetHistory { versions: { version_id: string; current: boolean; published_at: string | null }[]; truncated: boolean }
export interface FleetOperation extends FleetReport { operation_id: string; revision: string; job_status?: string }
export type FleetChanges = Record<string, { action: 'clear' } | { action: 'set'; value: unknown }>;
export interface FleetPublication { published: boolean; revision: string; applied: boolean; pending_restart: boolean }

/** Project read responses before Query cache sees them. Never trust a secret value/default. */
export function sanitizeFleetState(state: FleetState): FleetState {
    if (state?.schema_version !== 1 || !Array.isArray(state.entries) || !state.fleet || !Array.isArray(state.fleet.nodes)) {
        throw new Error('Fleet configuration returned an unsupported response');
    }
    return { ...state, entries: state.entries.map((entry) => {
        const { current, default: fallback, ...safe } = entry;
        return entry.sensitive ? safe : { ...safe, current, default: fallback };
    }) };
}
export function displayFleetValue(value: unknown): string {
    if (value == null) return 'Not set';
    return typeof value === 'string' ? value : JSON.stringify(value);
}
export function fleetChange(entry: FleetEntry, mode: string, input: string): FleetChanges[string] | null {
    if (mode === 'keep') return null;
    if (mode === 'clear') return { action: 'clear' };
    if (mode !== 'set') throw new Error('Choose a supported change');
    if (entry.sensitive && input === '') return null;
    let value: unknown = input;
    if (entry.value_type === 'boolean') {
        if (!['true', 'false'].includes(input)) throw new Error(`${entry.label}: choose true or false`);
        value = input === 'true';
    } else if (entry.value_type === 'integer') {
        if (!/^-?\d+$/.test(input)) throw new Error(`${entry.label}: enter a whole number`);
        value = Number(input);
        if (!Number.isSafeInteger(value) || (entry.min_value != null && Number(value) < entry.min_value)
            || (entry.max_value != null && Number(value) > entry.max_value)) throw new Error(`${entry.label}: number is outside the allowed range`);
    } else if (entry.value_type === 'list' || entry.value_type === 'object') {
        try { value = JSON.parse(input); } catch { throw new Error(`${entry.label}: enter valid JSON`); }
        if (entry.value_type === 'list' ? !Array.isArray(value) : value == null || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(`${entry.label}: enter a JSON ${entry.value_type}`);
        }
        if (entry.max_items != null && Object.keys(value as object).length > entry.max_items) throw new Error(`${entry.label}: too many entries`);
    } else if (entry.max_length != null && input.length > entry.max_length) throw new Error(`${entry.label}: value is too long`);
    return { action: 'set', value };
}
export function fleetIsHealthy(report: FleetReport | undefined): boolean {
    return report?.health_scope === FLEET_HEALTH_SCOPE && report.healthy_everywhere === true && report.nodes.length > 0
        && report.nodes.every((node) => node.installed && node.restarted && node.healthy && !node.error_code);
}
export function operationFinished(operation: FleetOperation): boolean {
    // A completed job only dispatched sync; operation reads observe actual activation.
    return ['healthy', 'failed', 'expired', 'canceled', 'superseded', 'timed_out'].includes(operation.status)
        || ['failed', 'expired', 'canceled'].includes(operation.job_status ?? '');
}
export async function readFleet(): Promise<FleetState> {
    return sanitizeFleetState((await mojoCall(FLEET_ENDPOINT)).data as FleetState);
}
export async function readFleetHistory(): Promise<FleetHistory> {
    return (await mojoCall(`${FLEET_ENDPOINT}/history`)).data as FleetHistory;
}
export async function readFleetOperation(id: string): Promise<FleetOperation> {
    return (await mojoCall(`${FLEET_ENDPOINT}/operation/${encodeURIComponent(id)}`)).data as FleetOperation;
}
/** Imperative writes deliberately avoid TanStack MutationCache (submitted secrets persist there). */
export async function writeFleet<T>(body: Record<string, unknown>): Promise<T> {
    return withFreshAuth(async () => (await mojoCall(FLEET_ENDPOINT, { method: 'POST', body })).data as T);
}
