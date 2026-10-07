import { useLocation } from 'react-router-dom';
import { revokeAdminSourceSession } from '../admin-source-session';
import { UserMenu } from 'portal-mojo/ui/shell';
import { AssistantLauncher } from 'portal-mojo/admin/assistant/launcher';
import { authMode } from '../pages/auth/config';

const TITLES: Record<string, string> = { '/': 'Dashboard', '/users': 'Users', '/settings': 'Settings', '/group': 'Group' };

// Sign out also revokes the packaged-Admin source session (errors swallowed,
// as before UserMenu).
const signOut = () => revokeAdminSourceSession().catch(() => {});

export function TopNav() {
    const { pathname } = useLocation();
    return (
        <header className="topnav">
            <h2 className="topnav-title">{TITLES[pathname] ?? 'Portal'}</h2>
            <div className="topnav-right">
                <AssistantLauncher />
                <UserMenu authMode={authMode()} onSignOut={signOut} />
            </div>
        </header>
    );
}
