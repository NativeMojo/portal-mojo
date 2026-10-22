/** Lazy central bridge for the operations contracts; never imported by runtime entrypoints. */
import { backendGlobalCan, FLEET_DASHBOARD_GRANTS } from '../admin/fleet/access';
import type { User } from './types';
interface OperationsMockContext {
    user?: User;
    credentialKind?: unknown;
    authTime?: number;
    origin?: string;
}
interface OperationsMockOptions { method?: string; body?: Record<string, unknown>; params?: Record<string, unknown> }
const denied = (code = 403) => ({ status: false, error: 'permission denied', error_code: code });
const confined = (kind: unknown) => typeof kind === 'string' && ['api_key', 'group_token', 'group_scoped_token'].includes(kind);

export async function operationsMock(path: string, options: OperationsMockOptions, context: OperationsMockContext): Promise<unknown | undefined> {
    const method = (options.method ?? 'GET').toUpperCase(), user = context.user;
    if (!user || user.is_active !== true) return denied(401);
    // Mock attribution comes from the validated mock bearer. Per-user UserAPIKey
    // is deliberately allowed by these ordinary operator decorators.
    const keyBacked = confined(context.credentialKind);
    if (keyBacked) return denied();
    if (path === '/api/account/admin/bootstrap') {
        if (method !== 'GET') return { status: false, error: 'Method not allowed', error_code: 405 };
        if (!backendGlobalCan(user, FLEET_DASHBOARD_GRANTS)) return denied();
        const { getMockOperationalFleetScenario } = await import('./operational-fleet-mock');
        const mode = getMockOperationalFleetScenario() === 'external' ? 'external' : 'managed';
        // One composer owns this response. Later domain facts are assigned by
        // explicit nested field ownership rather than whole-object overwrites.
        return { status: true, data: {
            admin_path: '/admin/', user: { id: user.id, is_superuser: user.is_superuser === true },
            capabilities: { setup: user.is_superuser === true }, infrastructure: { mode },
            features: {
                platform: { enabled: true, capabilities: { setup: user.is_superuser === true, view: backendGlobalCan(user, ['view_platform', 'manage_platform', 'admin']), capacity: backendGlobalCan(user, 'manage_aws'), infrastructure_managed: mode === 'managed' } },
                settings: { enabled: true, capabilities: { owner_edit: user.is_superuser === true } },
            },
        } };
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
    if (path === '/api/account/admin/dashboard' || path.startsWith('/api/aws/capacity')) {
        const { handleOperationalFleetMock } = await import('./operational-fleet-mock');
        return handleOperationalFleetMock(path, method, options.body, options.params, user, context.authTime);
    }
    return undefined;
}
