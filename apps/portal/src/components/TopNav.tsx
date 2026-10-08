import { useLocation } from 'react-router-dom';
import { revokeAdminSourceSession } from '../admin-source-session';
import { UserMenu, toast, type UserMenuItem } from 'portal-mojo/ui/shell';
import { AssistantLauncher } from 'portal-mojo/admin/assistant/launcher';
import { authMode } from '../pages/auth/config';

const TITLES: Record<string, string> = { '/': 'Dashboard', '/users': 'Users', '/settings': 'Settings', '/group': 'Group' };

// Sign out also revokes the packaged-Admin source session (errors swallowed,
// as before UserMenu). The same handler backs the AccountModal's Sign out.
const signOut = () => revokeAdminSourceSession().catch(() => {});

// "My account" — portal-mojo/account's self-service modal. Loaded on first
// use so the account surface (forms, image editor, dialogs) stays out of the
// shell entry chunk. The admin app registers no notification kinds: the
// modal shows the server's catalogue.
const openMyAccount = () => {
    import('portal-mojo/account')
        .then(({ openAccountModal }) => openAccountModal({ onSignOut: signOut, authMode: authMode() }))
        .catch((err: unknown) => toast.error(`Could not open My account: ${err instanceof Error ? err.message : 'load failed'}`));
};

const ACCOUNT_ITEMS: UserMenuItem[] = [{ label: 'My account', icon: 'bi-person-circle', onSelect: openMyAccount }];

export function TopNav() {
    const { pathname } = useLocation();
    return (
        <header className="topnav">
            <h2 className="topnav-title">{TITLES[pathname] ?? 'Portal'}</h2>
            <div className="topnav-right">
                <AssistantLauncher />
                <UserMenu authMode={authMode()} onSignOut={signOut} items={ACCOUNT_ITEMS} />
            </div>
        </header>
    );
}
