// AuthLayout — the full-viewport shell for the in-app auth pages: centered
// mission-control card, brand row, themed footer. Layout voice from
// web-mojo's mountAuth card (extensions/auth/index.js + css/auth.css),
// re-tokenized; the app chrome (Sidebar/TopNav) is deliberately absent —
// authRoutes mount as SIBLINGS of the App route, not children.
import { Navigate, Outlet, useSearchParams } from 'react-router-dom';
import { useTheme, type ThemePref } from 'portal-mojo/ui/shell';
import { usingMockTransport } from 'portal-mojo/client/runtime';

const NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };
const PREF_ICON: Record<ThemePref, string> = { light: 'bi-sun', dark: 'bi-moon-stars', system: 'bi-circle-half' };

export function AuthLayout() {
    const { pref, setPref } = useTheme();
    return (
        <div className="auth-shell" data-testid="auth-shell">
            <div className="auth-card">
                <div className="auth-brand">
                    <span className="brand-dot" />
                    <span className="auth-brand-name">MOJO&nbsp;Portal</span>
                </div>
                <Outlet />
            </div>
            <div className="auth-foot">
                <button
                    className="btn-icon"
                    title={`Theme: ${pref} (click to change)`}
                    onClick={() => setPref(NEXT[pref])}
                >
                    <i className={`bi ${PREF_ICON[pref]}`} />
                </button>
                {usingMockTransport() && <span className="auth-foot-hint">mock transport</span>}
            </div>
        </div>
    );
}

/**
 * The /auth index: dispatch a token landing that arrived INSIDE the hash —
 * a deployment may point django-mojo's WEBAPP_AUTH_PATH at `/#/auth`, and
 * build_token_url appends `?flow=<flow>&token=<token>` to it, which the hash
 * router surfaces as this route's search params. Token prefixes are the
 * wire truth (`pr:` password reset, `ml:` magic login); `flow` breaks ties
 * for tokens without a known prefix. No token → the login page.
 * (Real-search landings — `/?flow=…&token=…` — are translated at boot by
 * handleAuthTokenLanding() in routes.tsx.)
 */
export function AuthIndexRoute() {
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const flow = params.get('flow') ?? '';
    const search = params.toString() ? `?${params.toString()}` : '';

    if (token.startsWith('pr:') || flow === 'password_reset') {
        return <Navigate to={`/auth/reset${search}`} replace />;
    }
    if (token.startsWith('ml:') || flow === 'magic_login') {
        return <Navigate to={`/auth/magic${search}`} replace />;
    }
    if (token || flow) {
        console.warn(`Unrecognized auth landing (flow=${JSON.stringify(flow)}, token prefix=${JSON.stringify(token.slice(0, 3))}) — falling back to the login page`);
    }
    return <Navigate to="/auth/login" replace />;
}
