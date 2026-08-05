// Sidebar — the mission-control band. The shell (brand, group switcher,
// footer) is app-owned; the nav itself renders from the A4 menu registry
// (see src/menus.ts) — active menu derived from route + group + me.
// Picking a group navigates into the group menu's home; clearing returns
// to the main menu (navigation drives menu switching, not hidden state).
import { useNavigate } from 'react-router-dom';
import { useAuthSnapshot } from 'portal-mojo/client';
import { GroupSwitcher, SidebarNav } from 'portal-mojo/ui';

const USING_MOCK = !import.meta.env.VITE_MOJO_API;

export function Sidebar() {
    const auth = useAuthSnapshot();
    const navigate = useNavigate();
    return (
        <aside className="sidebar">
            <div className="side-brand">
                <span className="brand-dot" />
                <span className="brand-name">MOJO&nbsp;Portal</span>
            </div>
            {auth.authenticated && (
                <GroupSwitcher
                    onSelected={() => navigate('/group')}
                    onCleared={() => navigate('/')}
                />
            )}
            <SidebarNav />
            <div className="side-foot">
                <span className={`mode-chip${USING_MOCK ? '' : ' mode-live'}`}>
                    <i className={`bi ${USING_MOCK ? 'bi-database' : 'bi-broadcast'}`} />
                    {USING_MOCK ? 'Mock API' : 'Live API'}
                </span>
                <span className="side-version">v0.1.0</span>
            </div>
        </aside>
    );
}
