import { ModalHost, ToastHost, useTheme, type ThemePref } from 'portal-mojo/ui';
import { ComponentsPage } from './pages/components/ComponentsPage';

const NEXT: Record<ThemePref, ThemePref> = { light: 'dark', dark: 'system', system: 'light' };
const PREF_ICON: Record<ThemePref, string> = { light: 'bi-sun', dark: 'bi-moon-stars', system: 'bi-circle-half' };

function TopBar() {
    const { pref, setPref } = useTheme();
    return (
        <header className="topnav">
            <div className="side-brand" style={{ padding: 0 }}>
                <span className="brand-dot" />
                <span className="brand-name">MOJO&nbsp;Portal — Components</span>
            </div>
            <div className="topnav-right">
                <button
                    className="btn-icon"
                    title={`Theme: ${pref} (click to change)`}
                    onClick={() => setPref(NEXT[pref])}
                >
                    <i className={`bi ${PREF_ICON[pref]}`} />
                </button>
            </div>
        </header>
    );
}

// No sidebar, no auth, no admin chrome — this app is a standalone showcase of
// every portal-mojo component, meant to be published on its own (maestro
// sites) as a living reference alongside packages/portal-mojo/docs.
export default function App() {
    return (
        <div className="showcase-shell">
            <TopBar />
            <main className="content">
                <ComponentsPage />
            </main>
            <ModalHost />
            <ToastHost />
        </div>
    );
}
