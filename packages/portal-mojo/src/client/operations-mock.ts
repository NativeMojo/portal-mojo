/** Lazy central bridge for the operations contracts; never imported by runtime entrypoints. */
import { backendGlobalCan, FLEET_DASHBOARD_GRANTS } from '../admin/fleet/access';
import type { User } from './types';
interface OperationsMockContext {
    user?: User;
    credentialKind?: unknown;
    authTime?: number;
    origin?: string;
}
interface OperationsMockOptions { method?: string; body?: Record<string, unknown>; params?: Record<string, unknown>; headers?: Record<string, string> }
const denied = (code = 403) => ({ status: false, error: 'permission denied', error_code: code });
const confined = (kind: unknown) => typeof kind === 'string' && ['api_key', 'group_token', 'group_scoped_token'].includes(kind);

export async function operationsMock(path: string, options: OperationsMockOptions, context: OperationsMockContext): Promise<unknown | undefined> {
    const method = (options.method ?? 'GET').toUpperCase(), user = context.user;
    const deploymentOwned = path === '/api/account/admin/platform' && options.params?.sections === 'deployments,api'
        || path.startsWith('/api/account/admin/platform/deploy/') || path.startsWith('/api/edge/webapp/onboarding/')
        || ['/api/edge/webapp/summaries', '/api/edge/webapp/summary', '/api/edge/webapp/key_status', '/api/edge/webapp/link_key', '/api/edge/webapp/revoke_key', '/api/edge/webapp/rollback', '/api/edge/webapp/health'].includes(path)
        || /^\/api\/edge\/webapp\/\d+$/.test(path) || /^\/api\/edge\/release\/deployment\/\d+$/.test(path)
        || path === '/api/edge/release' && (method === 'POST' || options.params?.webapp !== undefined)
        || path === '/api/edge/release/complete' || path === '/api/edge/deployment' && options.params?.webapp !== undefined;
    const owned = deploymentOwned || ['/api/account/admin/bootstrap', '/api/account/admin/settings', '/api/account/admin/dashboard', '/api/account/admin/setup/readiness', '/api/aws/capacity', '/api/aws/capacity/status', '/api/aws/capacity/plan', '/api/aws/capacity/plan/apply', '/api/aws/maintenance/versions', '/api/aws/maintenance/status', '/api/aws/maintenance/apply', '/api/account/admin/platform/framework', '/api/account/admin/platform/framework/update'].includes(path);
    if (!owned) return undefined;
    if (!user || user.is_active !== true) return denied(401);
    // Mock attribution comes from the validated mock bearer. Per-user UserAPIKey
    // is deliberately allowed by these ordinary operator decorators.
    const keyBacked = confined(context.credentialKind);
    if (keyBacked) return denied();
    if (path === '/api/account/admin/bootstrap') {
        if (method !== 'GET') return { status: false, error: 'Method not allowed', error_code: 405 };
        if (!backendGlobalCan(user, FLEET_DASHBOARD_GRANTS)) return denied();
        const { getMockOperationalFleetScenario } = await import('./operational-fleet-mock');
        const { readMaintenanceBootstrapFacts } = await import('./maintenance-mock');
        const maintenance = readMaintenanceBootstrapFacts();
        if (maintenance.bootstrap === 'denied') return denied();
        const malformed = maintenance.bootstrap === 'malformed';
        const { readDeploymentBootstrapFacts } = await import('./deployments-mock');
        const deployment = readDeploymentBootstrapFacts(user);
        const { readServingBootstrapFacts, recordServingBootstrap } = await import('./serving-mock');
        const serving = readServingBootstrapFacts();
        if (serving.bootstrap === 'denied') return denied();
        recordServingBootstrap(user.id, context.authTime);
        const mode = maintenance.mode === 'external' || getMockOperationalFleetScenario() === 'external' ? 'external' : 'managed';
        // One composer owns this response. Later domain facts are assigned by
        // explicit nested field ownership rather than whole-object overwrites.
        return { status: true, data: {
            admin_path: '/admin/', user: { id: serving.mismatch ? user.id + 1 : user.id, is_superuser: user.is_superuser === true },
            capabilities: { setup: user.is_superuser === true, manage_webapps: deployment.capabilities.manage_webapps }, webapp_groups: deployment.webapp_groups, can_create_webapp_group: deployment.can_create_webapp_group, ...(serving.edge !== undefined ? { edge: serving.edge } : {}), infrastructure: malformed ? {} : { mode },
            features: {
                platform: { enabled: true, capabilities: { setup: user.is_superuser === true, view: backendGlobalCan(user, ['view_platform', 'manage_platform', 'admin']), capacity: backendGlobalCan(user, 'manage_aws'), ...(!malformed ? { infrastructure_managed: mode === 'managed' } : {}) } },
                webapps: { enabled: deployment.features.webapps.enabled },
                settings: { enabled: true, capabilities: { owner_edit: user.is_superuser === true } },
            },
        } };
    }
    if (path === '/api/account/admin/setup/readiness') {
        const { servingReadinessMock } = await import('./serving-mock');
        return servingReadinessMock(method, options.params, user.id, user.is_superuser === true && backendGlobalCan(user, FLEET_DASHBOARD_GRANTS), context.authTime);
    }
    if (path === '/api/account/admin/settings') {
        if (user.is_superuser !== true) return denied();
        if (method === 'POST') {
            if (context.origin && context.origin !== globalThis.location?.origin) return denied();
            if (typeof context.authTime !== 'number' || !Number.isFinite(context.authTime) || context.authTime > Date.now() / 1000 || Date.now() / 1000 - context.authTime > 600) return { status: false, error: 'reauth_required', error_code: 440 };
        }
        const { geoProviderMock } = await import('./geo-provider-mock');
        return geoProviderMock(path, method, options.body, true) ?? { status: false, error: 'Unsupported provider topic', error_code: 400 };
    }
    if (path.startsWith('/api/aws/maintenance/') || path === '/api/account/admin/platform/framework' || path === '/api/account/admin/platform/framework/update') {
        const { maintenanceMock } = await import('./maintenance-mock');
        const age = typeof context.authTime === 'number' ? Date.now() / 1000 - context.authTime : NaN;
        return maintenanceMock(path, method, options.body, options.params, { user, keyBacked, fresh: Number.isFinite(age) && age >= 0 && age <= 600 });
    }
    if (path === '/api/account/admin/dashboard' || path.startsWith('/api/aws/capacity')) {
        const { handleOperationalFleetMock } = await import('./operational-fleet-mock');
        return handleOperationalFleetMock(path, method, options.body, options.params, user, context.authTime);
    }
    if (path === '/api/account/admin/platform' || path.startsWith('/api/account/admin/platform/deploy/') || path.startsWith('/api/edge/webapp') || path.startsWith('/api/edge/release') || path === '/api/edge/deployment') {
        const { deploymentsMock } = await import('./deployments-mock');
        const group = options.params?.group ?? options.body?.group;
        return deploymentsMock(path, options, { user, keyBacked, authTime: context.authTime ?? null, group: typeof group === 'number' ? group : typeof group === 'string' && /^\d+$/.test(group) ? Number(group) : null, interactive: !context.origin || context.origin === globalThis.location?.origin });
    }
    return undefined;
}
