/** Read-only Serving fixtures. Controls import this module directly, never through runtime. */
export const SERVING_SCENARIOS = ['ready', 'http-disabled', 'unavailable', 'missing-edge', 'unexpected-issuance', 'bootstrap-denied', 'bootstrap-identity', 'bootstrap-malformed', 'old-backend', 'readiness-denied', 'readiness-malformed', 'reordered', 'missing-section', 'truncated', 'stale-refresh'] as const;
export type ServingMockScenario = typeof SERVING_SCENARIOS[number];
let scenario: ServingMockScenario = 'ready', reads = 0;
const admitted = new Set<string>();
export function setMockServingScenario(value: ServingMockScenario): void { scenario = value; reads = 0; admitted.clear(); }
const identity = (id: number, authTime?: number) => `${id}:${authTime ?? 'no-interactive-time'}`;
export function readServingBootstrapFacts() {
    return { bootstrap: scenario === 'bootstrap-denied' ? 'denied' : 'ok', mismatch: scenario === 'bootstrap-identity', edge: scenario === 'missing-edge' ? undefined : scenario === 'bootstrap-malformed' ? { available: 'unknown' } : scenario === 'unavailable' ? { available: false, http_enabled: null, dnsman_issuance: null } : { available: true, http_enabled: scenario !== 'http-disabled', dnsman_issuance: scenario === 'unexpected-issuance' ? 'other' : 'dns-01' } };
}
export function recordServingBootstrap(id: number, authTime?: number): void { if (!['bootstrap-denied', 'bootstrap-identity', 'bootstrap-malformed', 'missing-edge'].includes(scenario)) admitted.add(identity(id, authTime)); }
export function servingReadinessMock(method: string, params: Record<string, unknown> | undefined, id: number, superuser: boolean, authTime?: number): unknown {
    const fail = (error: string, error_code: number) => ({ status: false, error, error_code });
    if (method !== 'GET') return fail('Method not allowed', 405);
    if (!superuser || !admitted.has(identity(id, authTime)) || scenario === 'readiness-denied') return fail('permission denied', 403);
    if (params?.section !== 'hosting_vhosts' || scenario === 'old-backend') return fail('Not found', 404);
    if (scenario === 'stale-refresh' && reads++ > 0) return fail('Latest hosting observation unavailable', 503);
    const coverage = (total: number, returned = total) => ({ total, returned, omitted: total - returned });
    const checks = [{ code: 'hosting.vhost.1', status: 'pass', explanation: 'Enabled hostname has active domain and certificate configuration.', remediation: 'Inspect Serving for configuration changes.', details: { configuration_only: true } }];
    const section = { code: 'hosting_vhosts', label: 'Hosting readiness', status: 'pass', checks, coverage: coverage(scenario === 'truncated' ? 3 : 1, 1) };
    return { status: true, data: { schema_version: scenario === 'readiness-malformed' ? 99 : 1, generated_at: new Date().toISOString(), overall: 'pass', summary: { pass: 1, warn: 0, fail: 0, pending: 0 }, sections: scenario === 'missing-section' ? [] : scenario === 'reordered' ? [{ code: 'unrelated', label: 'Unrelated readiness', status: 'pending', checks: [], coverage: coverage(0) }, section] : [section], coverage: { sections: coverage(1), checks: coverage(scenario === 'truncated' ? 3 : 1, 1) }, truncated: scenario === 'truncated' } };
}
