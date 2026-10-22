import { mojoCall } from '../../client/runtime';

export type ServingStatus = 'pass' | 'warn' | 'fail' | 'pending';
export interface ServingBootstrap {
    user: { id: number; is_superuser: boolean };
    capabilities: { setup: boolean };
    edge: { available: boolean; http_enabled: boolean | null; dnsman_issuance: 'dns-01' | null };
}
export interface ServingCheck {
    code: string; status: ServingStatus; explanation: string; remediation: string;
    details?: Record<string, string | number | boolean | null>;
}
export interface ServingCoverage { total: number; returned: number; omitted: number }
export interface HostingReadiness {
    schema_version: 1; generated_at: string; overall: ServingStatus;
    summary: Record<ServingStatus, number>;
    sections: Array<{ code: 'hosting_vhosts'; label: string; status: ServingStatus; checks: ServingCheck[]; coverage: ServingCoverage }>;
    coverage: { sections: ServingCoverage; checks: ServingCoverage }; truncated?: boolean;
}
const invalid = (): never => { throw new Error('Serving evidence unavailable: incompatible or missing response fields.'); };
function object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function text(value: unknown, limit = 4096): string { return typeof value === 'string' && value.length <= limit ? value : invalid(); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function status(value: unknown): ServingStatus { return typeof value === 'string' && ['pass', 'warn', 'fail', 'pending'].includes(value) ? value as ServingStatus : invalid(); }
function coverage(value: unknown): ServingCoverage {
    const row = object(value), total = count(row.total), returned = count(row.returned), omitted = count(row.omitted);
    if (returned > total || omitted !== total - returned) invalid();
    return { total, returned, omitted };
}
/** Positive projection only. Bootstrap carries unrelated private fields. */
export function parseServingBootstrap(value: unknown, userId: number): ServingBootstrap {
    const row = object(value), user = object(row.user), capabilities = object(row.capabilities), edge = object(row.edge);
    if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0 || user.id !== userId) invalid();
    if (!Object.hasOwn(edge, 'dnsman_issuance') || !(edge.dnsman_issuance === null || typeof edge.dnsman_issuance === 'string')) invalid();
    const available = bool(edge.available);
    const http = edge.http_enabled === null && !available ? null : bool(edge.http_enabled);
    return { user: { id: userId, is_superuser: bool(user.is_superuser) }, capabilities: { setup: bool(capabilities.setup) }, edge: {
        available, http_enabled: http, dnsman_issuance: edge.dnsman_issuance === 'dns-01' ? 'dns-01' : null,
    } };
}
export function parseHostingReadiness(value: unknown): HostingReadiness {
    const row = object(value);
    if (row.schema_version !== 1) invalid();
    const generated_at = text(row.generated_at, 64);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(generated_at) || !Number.isFinite(Date.parse(generated_at))) invalid();
    const sections: unknown[] = Array.isArray(row.sections) && row.sections.length <= 64 ? row.sections : invalid();
    const selected = sections.map(object).filter(section => section.code === 'hosting_vhosts');
    if (selected.length !== 1) invalid();
    const section = selected[0]!;
    const wireChecks: unknown[] = Array.isArray(section.checks) && section.checks.length <= 64 ? section.checks : invalid();
    const checks = wireChecks.map(value => {
        const check = object(value);
        const out: ServingCheck = { code: text(check.code, 256), status: status(check.status), explanation: text(check.explanation), remediation: text(check.remediation) };
        if (check.details != null) {
            const entries = Object.entries(object(check.details));
            out.details = {};
            for (const [key, value] of entries.slice(0, 16)) {
                if (key.length <= 128 && (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 1024))) out.details[key] = value;
            }
        }
        return out;
    });
    const summary = object(row.summary), wireCoverage = object(row.coverage);
    const result: HostingReadiness = { schema_version: 1, generated_at, overall: status(row.overall), summary: {
        pass: count(summary.pass), warn: count(summary.warn), fail: count(summary.fail), pending: count(summary.pending),
    }, sections: [{ code: 'hosting_vhosts', label: text(section.label, 256), status: status(section.status), checks, coverage: coverage(section.coverage) }], coverage: { sections: coverage(wireCoverage.sections), checks: coverage(wireCoverage.checks) } };
    if (row.truncated !== undefined) result.truncated = bool(row.truncated);
    return result;
}
export async function readServingBootstrap(userId: number, signal?: AbortSignal): Promise<ServingBootstrap> {
    return parseServingBootstrap((await mojoCall('/api/account/admin/bootstrap', { signal })).data, userId);
}
export async function readHostingReadiness(signal?: AbortSignal): Promise<HostingReadiness> {
    return parseHostingReadiness((await mojoCall('/api/account/admin/setup/readiness', { params: { section: 'hosting_vhosts' }, signal })).data);
}
