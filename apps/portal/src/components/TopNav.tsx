import { useLocation } from 'react-router-dom';
import { useTheme, type ThemePref } from 'portal-mojo/ui';

const TITLES: Record<string, string> = { '/': 'Dashboard', '/users': 'Users', '/settings': 'Settings' };
const NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };
const PREF_ICON: Record<ThemePref, string> = { light: 'bi-sun', dark: 'bi-moon-stars', system: 'bi-circle-half' };

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
                <div className="user-chip">
                    <span className="user-avatar">IS</span>
                    <span className="user-name">Ian Starnes</span>
                </div>
            </div>
        </header>
    );
}
