import { useLocation } from 'react-router-dom';
import { hostedAuthUrl, logout, redirectToHostedAuth, useAuthSnapshot, useMe } from 'portal-mojo/client';
import { useTheme, type ThemePref, fmt } from 'portal-mojo/ui';

const TITLES: Record<string, string> = { '/': 'Dashboard', '/users': 'Users', '/settings': 'Settings', '/group': 'Group' };
const NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };
const PREF_ICON: Record<ThemePref, string> = { light: 'bi-sun', dark: 'bi-moon-stars', system: 'bi-circle-half' };

/**
 * Live identity chip. Signed out against a real backend → a Sign in button
 * that bounces through the django-mojo hosted /auth pages (auth_code handoff
 * on return). Under the mock there is no hosted page — the chip keeps the
 * console-login hint until the C3 login pages land.
 */
function UserChip() {
    const auth = useAuthSnapshot();
    const { data: me } = useMe();
    if (!auth.authenticated) {
        if (hostedAuthUrl()) {
            return (
                <button className="btn btn-primary btn-compact" onClick={() => redirectToHostedAuth()}>
                    <i className="bi bi-box-arrow-in-right" /> Sign in
                </button>
            );
        }
        return (
            <span className="chip chip-muted" title="No session — log in via __mojo.login(email, 'mojo') until the login pages land">
                <i className="bi bi-person-slash" /> Signed out
            </span>
        );
    }
    const name = me?.display_name ?? auth.email ?? '…';
    return (
        <div className="user-chip">
            <span className="user-avatar">{fmt.initials(name)}</span>
            <span className="user-name">{name}</span>
            <button className="btn-icon" title="Sign out" onClick={() => logout()}>
                <i className="bi bi-box-arrow-right" />
            </button>
        </div>
    );
}

export function TopNav() {
    const { pathname } = useLocation();
    const { pref, setPref } = useTheme();
    return (
        <header className="topnav">
            <h2 className="topnav-title">{TITLES[pathname] ?? 'Portal'}</h2>
            <div className="topnav-right">
                <button
                    className="btn-icon"
                    title={`Theme: ${pref} (click to change)`}
                    onClick={() => setPref(NEXT[pref])}
                >
                    <i className={`bi ${PREF_ICON[pref]}`} />
                </button>
                <UserChip />
            </div>
        </header>
    );
}
