import { useLocation } from 'react-router-dom';
import { useAuthSnapshot, useMe } from 'portal-mojo/client';
import { useTheme, type ThemePref, fmt } from 'portal-mojo/ui';

const TITLES: Record<string, string> = { '/': 'Dashboard', '/users': 'Users', '/settings': 'Settings', '/group': 'Group' };
const NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };
const PREF_ICON: Record<ThemePref, string> = { light: 'bi-sun', dark: 'bi-moon-stars', system: 'bi-circle-half' };

/** Live identity chip: session-aware, name from /api/user/me. */
function UserChip() {
    const auth = useAuthSnapshot();
    const { data: me } = useMe();
    if (!auth.authenticated) {
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
