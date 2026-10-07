// AccountModal — the self-service "My account" modal (portal-mojo #7184,
// approved shape 2026-10-07). ONE modal: a short rail is the whole
// navigation, each entry one flat section (no drill-ins, no cross-links),
// Sign out at the rail's foot, the section title + Close in the header.
// ≈760×520 on desktop; under 720px a full-screen sheet whose rail becomes a
// row of tabs across the top.
//
// Opened imperatively on the toolkit modal stack:
//
//     <UserMenu items={[{ label: 'My account', icon: 'bi-person-circle', onSelect: () => openAccountModal() }]} />
//
// Every focused flow (add passkey, authenticator, recovery codes, password,
// email/phone change, verify, photo) stacks its own dialog over this one;
// fresh-auth step-ups come from the app's FreshAuthHost. Styles: the app's
// theme/account.css (tokens only, both themes).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { hostedAuthUrl, logout, onAuth, redirectToHostedAuth, useAuthSnapshot, useMe, type Me } from '../client/runtime';
import { fmt, modal, toast, useAvatarUrl, type UserMenuAuthMode } from '../ui';
import type { NotificationKind } from './api';
import {
    AccountApiKeysSection, AccountNotificationsSection, AccountPasskeysSection, AccountProfileSection,
    AccountSecuritySection, AccountSessionsSection,
} from './AccountSections';

export type AccountSectionKey = 'profile' | 'passkeys' | 'security' | 'sessions' | 'notifications' | 'api-keys';

export const ACCOUNT_SECTIONS: readonly AccountSectionKey[] = ['profile', 'passkeys', 'security', 'sessions', 'notifications', 'api-keys'];

export interface AccountSectionContext {
    me: Me;
    /** Close the whole modal. */
    close: () => void;
}

/** An app-supplied rail entry, appended after the built-ins. */
export interface AccountSectionDef {
    key: string;
    label: string;
    /** Bootstrap-icons class, e.g. 'bi-building'. */
    icon: string;
    render: (ctx: AccountSectionContext) => ReactNode;
}

export interface AccountModalProps {
    /** Built-in sections to show, in order (default all six). Unknown keys warn and drop. */
    sections?: AccountSectionKey[];
    /** App sections appended to the rail. */
    extraSections?: AccountSectionDef[];
    /** Section open on mount (built-in or extra key). Unknown keys warn and fall back to the first. */
    initialSection?: string;
    /** Replaces the default `logout()` on Sign out. A rejection toasts and keeps the modal open. */
    onSignOut?: () => void | Promise<void>;
    /**
     * With the default sign out: 'hosted' sends the user to the hosted
     * auth page after logout (when the deployment has one); 'inapp' goes to
     * `#/auth/login`; omitted leaves routing to the app's auth gate.
     */
    authMode?: UserMenuAuthMode;
    /** The notification kinds this app sends (labels/descriptions/channels). */
    notificationKinds?: NotificationKind[];
    /** Called when the modal should close (Close, Escape via the host, sign out). */
    onClose: () => void;
}

const BUILT_INS: Record<AccountSectionKey, { label: string; icon: string }> = {
    profile: { label: 'Profile', icon: 'bi-person' },
    passkeys: { label: 'Passkeys', icon: 'bi-fingerprint' },
    security: { label: 'Security', icon: 'bi-shield-lock' },
    sessions: { label: 'Sessions', icon: 'bi-display' },
    notifications: { label: 'Notifications', icon: 'bi-bell' },
    'api-keys': { label: 'API keys', icon: 'bi-key' },
};

interface ResolvedSection {
    key: string;
    label: string;
    icon: string;
    render: (ctx: AccountSectionContext) => ReactNode;
}

const warned = new Set<string>();
function warnOnce(message: string) {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(message);
}

export function AccountModal({
    sections = [...ACCOUNT_SECTIONS],
    extraSections,
    initialSection,
    onSignOut,
    authMode,
    notificationKinds,
    onClose,
}: AccountModalProps) {
    const auth = useAuthSnapshot();
    const { data: me, isPending, isError, error } = useMe();
    const uid = useId();
    const tabRefs = useRef(new Map<string, HTMLButtonElement>());
    const [signingOut, setSigningOut] = useState(false);

    const resolved = useMemo<ResolvedSection[]>(() => {
        const out: ResolvedSection[] = [];
        for (const key of sections) {
            if (!(key in BUILT_INS)) { warnOnce(`AccountModal: unknown section "${String(key)}" — dropped`); continue; }
            const meta = BUILT_INS[key];
            out.push({
                key,
                ...meta,
                render: ({ me: row }) => {
                    switch (key) {
                        case 'profile': return <AccountProfileSection me={row} />;
                        case 'passkeys': return <AccountPasskeysSection me={row} />;
                        case 'security': return <AccountSecuritySection me={row} />;
                        case 'sessions': return <AccountSessionsSection me={row} />;
                        case 'notifications': return <AccountNotificationsSection me={row} kinds={notificationKinds} />;
                        case 'api-keys': return <AccountApiKeysSection me={row} />;
                    }
                },
            });
        }
        for (const extra of extraSections ?? []) {
            if (out.some((s) => s.key === extra.key)) { warnOnce(`AccountModal: duplicate section key "${extra.key}" — dropped`); continue; }
            out.push(extra);
        }
        return out;
    }, [sections, extraSections, notificationKinds]);

    const [active, setActive] = useState<string>(() => {
        if (initialSection && resolved.some((s) => s.key === initialSection)) return initialSection;
        if (initialSection) warnOnce(`AccountModal: unknown initialSection "${initialSection}" — opening "${resolved[0]?.key ?? ''}"`);
        return resolved[0]?.key ?? '';
    });
    const current = resolved.find((s) => s.key === active) ?? resolved[0];

    // On phones the rail is a scrolling tab strip: keep the active tab visible.
    useEffect(() => {
        tabRefs.current.get(active)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [active]);

    // The session ended underneath us (sign out elsewhere, refresh failure):
    // there is no account to show. The auth events cover an app that drops
    // this host on sign-out before the snapshot effect can run; the toolkit
    // modal stack closes the child dialogs on the same events.
    useEffect(() => {
        if (!auth.authenticated) onClose();
    }, [auth.authenticated, onClose]);
    useEffect(() => {
        const offs = [onAuth('logout', onClose), onAuth('unauthorized', onClose)];
        return () => { for (const off of offs) off(); };
    }, [onClose]);

    const [avatarSrc, onAvatarError] = useAvatarUrl(me?.avatar?.id ?? null);
    const name = (typeof me?.display_name === 'string' && me.display_name) || (typeof me?.email === 'string' && me.email) || auth.email || 'My account';

    const signOut = async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            if (onSignOut) {
                await onSignOut();
            } else {
                logout();
                if (authMode === 'hosted' && hostedAuthUrl()) redirectToHostedAuth();
                else if (authMode === 'inapp' && typeof window !== 'undefined') window.location.hash = '#/auth/login';
            }
            onClose();
        } catch (err) {
            toast.error(`Sign out failed: ${err instanceof Error && err.message ? err.message : 'unknown error'}`);
            setSigningOut(false);
        }
    };

    // Roving tabs: arrows move between rail entries (vertical rail on
    // desktop, horizontal strip on phones), Home/End jump to the ends.
    const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
        const keys = resolved.map((s) => s.key);
        const at = keys.indexOf(active);
        let next = -1;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (at + 1) % keys.length;
        else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (at - 1 + keys.length) % keys.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = keys.length - 1;
        if (next < 0) return;
        event.preventDefault();
        setActive(keys[next]!);
        tabRefs.current.get(keys[next]!)?.focus();
    };

    const tabId = (key: string) => `${uid}-tab-${key}`;
    const panelId = `${uid}-panel`;
    const titleId = `${uid}-title`;

    const signOutButton = (className: string) => (
        <button
            type="button"
            className={`acct-rail-item is-danger ${className}`}
            aria-busy={signingOut || undefined}
            disabled={signingOut}
            onClick={() => void signOut()}
        >
            <i className={signingOut ? 'bi bi-arrow-repeat spin' : 'bi bi-box-arrow-right'} aria-hidden="true" />
            <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
    );

    return (
        <div className="acct" aria-labelledby={titleId}>
            <nav className="acct-rail" aria-label="Account sections">
                <div className="acct-who">
                    <span className="acct-avatar acct-avatar-sm" aria-hidden="true">
                        {avatarSrc ? <img src={avatarSrc} alt="" referrerPolicy="no-referrer" onError={onAvatarError} /> : fmt.initials(name)}
                    </span>
                    <span className="acct-who-text">
                        <span className="acct-who-name">{name}</span>
                        <span className="acct-who-sub">My account</span>
                    </span>
                </div>
                <div className="acct-tabs" role="tablist" aria-label="Account sections" aria-orientation="vertical">
                    {resolved.map((section) => (
                        <button
                            key={section.key}
                            ref={(node) => { if (node) tabRefs.current.set(section.key, node); else tabRefs.current.delete(section.key); }}
                            id={tabId(section.key)}
                            type="button"
                            role="tab"
                            aria-selected={section.key === current?.key}
                            aria-controls={panelId}
                            tabIndex={section.key === current?.key ? 0 : -1}
                            className={`acct-rail-item${section.key === current?.key ? ' is-active' : ''}`}
                            onClick={() => setActive(section.key)}
                            onKeyDown={onTabKey}
                        >
                            <i className={`bi ${section.icon}`} aria-hidden="true" />
                            <span>{section.label}</span>
                        </button>
                    ))}
                </div>
                {signOutButton('acct-signout-rail')}
            </nav>
            <div className="acct-panel">
                <header className="acct-head">
                    <h2 id={titleId} className="acct-title">
                        <span className="acct-title-section">{current?.label ?? 'My account'}</span>
                        <span className="acct-title-sheet">My account</span>
                    </h2>
                    <button type="button" className="btn-icon" aria-label="Close" title="Close" onClick={onClose}>
                        <i className="bi bi-x-lg" aria-hidden="true" />
                    </button>
                </header>
                <div
                    id={panelId}
                    className="acct-body"
                    role="tabpanel"
                    aria-labelledby={current ? tabId(current.key) : undefined}
                    data-section={current?.key}
                >
                    {isPending && <div className="acct-skel" aria-busy="true"><span className="skel skel-block" /><span className="skel skel-block" /></div>}
                    {isError && <div className="form-alert" role="alert">{error instanceof Error ? error.message : 'Could not load your account.'}</div>}
                    {me && current && <div key={current.key} className="acct-section">{current.render({ me, close: onClose })}</div>}
                    {signOutButton('acct-signout-sheet')}
                </div>
            </div>
        </div>
    );
}

/**
 * Open the AccountModal on the toolkit modal stack. Resolves when it closes.
 * Pass any AccountModalProps except `onClose`.
 */
export function openAccountModal(props: Omit<AccountModalProps, 'onClose'> = {}): Promise<unknown> {
    return modal.open((close) => <AccountModal {...props} onClose={() => close(null)} />, { size: 'lg' });
}
