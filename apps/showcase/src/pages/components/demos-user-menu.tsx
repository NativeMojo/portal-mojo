// UserMenu demos — the shared top-nav account menu, in two mock top bars:
// a system admin WITH an avatar (md) and a plain user WITHOUT one (sm, and a
// sign-out that fails so the error path is visible). Each bar runs under its
// own private QueryClient seeded with a mock `me` row, so the showcase's real
// session is never touched and sign-out here is simulated.
//
// The avatar user points at mock File 5109, whose thumbnail rendition is
// served from apps/showcase/public/mock-storage/renditions/6104 in dev. Where
// that path is not served (e.g. a sub-path static publish) the <img> fails
// and the trigger falls back to initials — the same silent degradation a
// real expired capability gets.
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAuthSnapshot, type Me } from 'portal-mojo/client/runtime';
import { UserMenu, toast, type UserMenuItem } from 'portal-mojo/ui';

const WITH_AVATAR: Me = {
    id: 2,
    display_name: 'Maya Okonkwo',
    email: 'maya.okonkwo@nativemojo.com',
    is_superuser: true,
    permissions: {},
    avatar: { id: 5109 },
};

const NO_AVATAR: Me = {
    id: 14,
    display_name: 'Showcase Operator',
    email: 'showcase.operator@nativemojo.com',
    is_superuser: false,
    permissions: {},
    avatar: null,
};

/** A private Query cache holding only this mock identity — never refetched. */
function MockIdentity({ me, children }: { me: Me; children: ReactNode }) {
    const [client] = useState(() => {
        const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
        qc.setQueryData(['me', getAuthSnapshot().uid], me);
        return qc;
    });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function MockBar({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="topnav" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '0 14px' }}>
            <h2 className="topnav-title" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
            <div className="topnav-right">{children}</div>
        </div>
    );
}

export function UserMenuDemo() {
    const [last, setLast] = useState('—');
    const pick = (label: string) => () => {
        setLast(label);
        toast.info(`selected: ${label}`);
    };
    const items: UserMenuItem[] = [
        { label: 'My profile', icon: 'bi-person', onSelect: pick('My profile') },
        { label: 'Security & MFA', icon: 'bi-shield-check', onSelect: pick('Security & MFA') },
        { label: 'Open the Popover demo', icon: 'bi-front', to: '/?demo=popover', divider: true, onSelect: pick('Popover demo (Link)') },
        { label: 'Leave organization', icon: 'bi-box-arrow-left', danger: true, divider: true, onSelect: pick('Leave organization') },
    ];

    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">With avatar · system admin · size md</div>
                <MockIdentity me={WITH_AVATAR}>
                    <MockBar title="Dashboard">
                        <UserMenu
                            items={items}
                            onSignOut={async () => {
                                await wait(1200);
                                setLast('Sign out (simulated)');
                                toast.success('Signed out (demo — the showcase session is kept)');
                            }}
                        >
                            <button type="button" role="menuitem" tabIndex={-1} className="user-menu-item" onClick={pick('Keyboard shortcuts (children slot)')}>
                                <i className="bi bi-keyboard" aria-hidden="true" /> <span>Keyboard shortcuts</span>
                            </button>
                        </UserMenu>
                    </MockBar>
                </MockIdentity>
                <p className="dim" style={{ margin: '12px 0 0' }}>
                    Avatar fetched from <code>/api/fileman/file/5109</code> while mounted (thumbnail through
                    <code> safePreviewUrl</code>, kept in component state — never a Query cache). Sign out runs a
                    1.2s <code>onSignOut</code> so the pending state shows. Last selection: <b>{last}</b>
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">No avatar · initials · size sm · failing sign-out</div>
                <MockIdentity me={NO_AVATAR}>
                    <MockBar title="Group settings">
                        <UserMenu
                            size="sm"
                            items={[{ label: 'My profile', icon: 'bi-person', onSelect: pick('My profile (sm)') }]}
                            onSignOut={async () => {
                                await wait(700);
                                throw new Error('revocation endpoint unreachable');
                            }}
                        />
                    </MockBar>
                </MockIdentity>
                <p className="dim" style={{ margin: '12px 0 0' }}>
                    No <code>avatar</code> → initials. A rejected <code>onSignOut</code> toasts the error and leaves the
                    menu open for a retry.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">Keyboard · responsive · signed out</div>
                <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Trigger: Enter/Space/↓ opens on the first item, ↑ on the last.</li>
                    <li>Menu: ↑/↓ move (wrap), Home/End, ←/→ inside the theme control, Enter/Space activate, Esc closes back to the trigger, Tab closes and moves on.</li>
                    <li>Theme picks apply instantly and keep the menu open; every other item closes it.</li>
                    <li>Under 720px only the avatar shows — the name and caret hide (the trigger keeps its <code>aria-label</code>).</li>
                    <li>Signed out: <code>authMode="inapp"</code> → Sign in link to <code>/auth/login</code>; <code>"hosted"</code> → Sign in button (hosted auth redirect); omitted → a muted "Signed out" chip.</li>
                </ul>
            </div>
        </>
    );
}
