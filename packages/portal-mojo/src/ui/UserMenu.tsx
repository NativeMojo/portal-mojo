// UserMenu — the shared top-nav identity/account menu. Successor to the
// hand-rolled "user chip" every portal carried, and the React port of
// web-mojo's TopNav user dropdown (src/core/views/navigation/TopNav.js —
// avatar-or-icon trigger, `dropdown-menu-end` items, divider rows) plus
// PortalApp._injectThemeToggleItems (theme choice injected just above the
// trailing logout). Here the theme choice is an inline Light/Dark/System
// segmented control instead of a separate settings dialog.
//
// Identity comes from `useMe()`; the avatar capability (URL) is fetched from
// `/api/fileman/file/<id>` ONLY while mounted and kept in component state —
// never written into a Query cache (the `me` row is sanitized to `{id}` by
// design). Same contract as FileField's stored preview.
import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { mojoCall } from '../client/client';
import { hostedAuthUrl, logout, redirectToHostedAuth } from '../client/auth';
import { useAuthSnapshot, useMe } from '../client/me';
import { initials } from './format';
import { Popover } from './Popover';
import { safePreviewUrl } from './safe-url';
import { useTheme, type ThemePref } from './ThemeProvider';
import { toast } from './toast';
import { warnOnce } from './warn-once';

/** One app-supplied entry in the account menu. */
export interface UserMenuItem {
    label: string;
    /** Bootstrap-icons class, e.g. `'bi-person'`. */
    icon?: string;
    /** Router destination — renders a react-router `<Link>`. */
    to?: string;
    /** Called after the menu closes (also called for `to` items). */
    onSelect?: () => void;
    /** Danger tone (destructive actions). */
    danger?: boolean;
    /** Draw a separator line ABOVE this item. */
    divider?: boolean;
}

export type UserMenuAuthMode = 'inapp' | 'hosted';
export type UserMenuSize = 'sm' | 'md';

export interface UserMenuProps {
    /** App items, rendered between the theme control and Sign out. */
    items?: UserMenuItem[];
    /** Extra content rendered above Sign out (after `items`). Elements with
     *  `role="menuitem"` join arrow-key navigation and close the menu on click. */
    children?: ReactNode;
    /** Signed-out affordance: 'inapp' → Link to /auth/login; 'hosted' →
     *  button calling redirectToHostedAuth(); omitted → "Signed out" chip. */
    authMode?: UserMenuAuthMode;
    /** Replaces the default `logout()`. A pending state shows while it runs;
     *  a rejection toasts and leaves the menu open for a retry. */
    onSignOut?: () => void | Promise<void>;
    /** Trigger density (default 'md'). */
    size?: UserMenuSize;
    className?: string;
}

const SIZES: readonly UserMenuSize[] = ['sm', 'md'];
const AUTH_MODES: readonly UserMenuAuthMode[] = ['inapp', 'hosted'];

const THEMES: { value: ThemePref; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: 'bi-sun' },
    { value: 'dark', label: 'Dark', icon: 'bi-moon-stars' },
    { value: 'system', label: 'System', icon: 'bi-circle-half' },
];

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

function cx(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(' ');
}

function Avatar({ src, name, className, onError }: {
    src: string | null;
    name: string;
    className: string;
    onError: () => void;
}) {
    return (
        <span className={cx('user-menu-avatar', className)} aria-hidden="true">
            {src
                ? <img src={src} alt="" referrerPolicy="no-referrer" onError={onError} />
                : initials(name)}
        </span>
    );
}

/** Stored avatar capability for `avatarId`, fetched while mounted only. */
function useAvatarUrl(avatarId: number | null): [string | null, () => void] {
    const [fetched, setFetched] = useState<{ id: number; src: string | null } | null>(null);
    const [failedSrc, setFailedSrc] = useState<string | null>(null);

    useEffect(() => {
        if (avatarId == null) return;
        const controller = new AbortController();
        let live = true;
        void mojoCall(`/api/fileman/file/${avatarId}`, { signal: controller.signal }).then((envelope) => {
            if (!live || controller.signal.aborted) return;
            const row = (envelope.data ?? {}) as { url?: unknown; thumbnail?: unknown };
            setFetched({ id: avatarId, src: safePreviewUrl(row.thumbnail) ?? safePreviewUrl(row.url) });
        }, () => { /* capability and failure remain local and silent */ });
        return () => { live = false; controller.abort(); };
    }, [avatarId]);

    // Derived, so a previous identity's image never shows for the next one.
    const src = avatarId != null && fetched?.id === avatarId ? fetched.src : null;
    const onError = useCallback(() => setFailedSrc(src), [src]);
    return [src && src !== failedSrc ? src : null, onError];
}

export function UserMenu({
    items,
    children,
    authMode,
    onSignOut,
    size = 'md',
    className,
}: UserMenuProps) {
    const auth = useAuthSnapshot();
    const { data: me } = useMe();
    const { pref, setPref } = useTheme();

    const [open, setOpen] = useState(false);
    const [signingOut, setSigningOut] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const focusOnOpen = useRef<'first' | 'last'>('first');
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const uid = useId();
    const menuId = `${uid}-menu`;
    const triggerId = `${uid}-trigger`;

    let density = size;
    if (!SIZES.includes(density)) {
        warnOnce(`UserMenu: unknown size "${String(size)}" — falling back to "md"`);
        density = 'md';
    }
    if (authMode !== undefined && !AUTH_MODES.includes(authMode)) {
        warnOnce(`UserMenu: unknown authMode "${String(authMode)}" — rendering the signed-out chip`);
    }

    const [avatarSrc, onAvatarError] = useAvatarUrl(auth.authenticated ? me?.avatar?.id ?? null : null);
    const menuOpen = open && auth.authenticated;

    // Move focus into the menu once it is shown (Popover never moves focus).
    useEffect(() => {
        if (!menuOpen) return;
        const nodes = menuItems(menuRef.current);
        (focusOnOpen.current === 'last' ? nodes[nodes.length - 1] : nodes[0])?.focus();
    }, [menuOpen]);

    const close = useCallback((refocus: boolean) => {
        setOpen(false);
        if (refocus) triggerRef.current?.focus();
    }, []);

    // ── Signed out ───────────────────────────────────────────────────
    if (!auth.authenticated) {
        if (authMode === 'inapp') {
            return (
                <Link className={cx('btn btn-primary btn-compact', className)} to="/auth/login">
                    <i className="bi bi-box-arrow-in-right" /> Sign in
                </Link>
            );
        }
        if (authMode === 'hosted' && hostedAuthUrl()) {
            return (
                <button type="button" className={cx('btn btn-primary btn-compact', className)} onClick={() => redirectToHostedAuth()}>
                    <i className="bi bi-box-arrow-in-right" /> Sign in
                </button>
            );
        }
        return (
            <span className={cx('chip chip-muted', className)}>
                <i className="bi bi-person-slash" /> Signed out
            </span>
        );
    }

    const name = me?.display_name || me?.email || auth.email || '…';
    const email = me?.email || auth.email || null;

    const toggle = () => {
        focusOnOpen.current = 'first';
        setOpen((v) => !v);
    };

    const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        focusOnOpen.current = event.key === 'ArrowUp' ? 'last' : 'first';
        if (menuOpen) {
            const nodes = menuItems(menuRef.current);
            (event.key === 'ArrowUp' ? nodes[nodes.length - 1] : nodes[0])?.focus();
        } else {
            setOpen(true);
        }
    };

    const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
        const nodes = menuItems(menuRef.current);
        if (nodes.length === 0) return;
        const target = event.target as HTMLElement;
        const index = nodes.indexOf(target);
        const focusAt = (i: number) => nodes[(i + nodes.length) % nodes.length]?.focus();
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                focusAt(index < 0 ? 0 : index + 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                focusAt(index < 0 ? nodes.length - 1 : index - 1);
                break;
            case 'Home':
                event.preventDefault();
                focusAt(0);
                break;
            case 'End':
                event.preventDefault();
                focusAt(nodes.length - 1);
                break;
            case 'ArrowLeft':
            case 'ArrowRight': {
                // Within the theme segmented control only.
                if (target.getAttribute('role') !== 'menuitemradio') break;
                const radios = Array.from(target.parentElement?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
                const at = radios.indexOf(target);
                if (at < 0) break;
                event.preventDefault();
                const step = event.key === 'ArrowRight' ? 1 : -1;
                radios[(at + step + radios.length) % radios.length]?.focus();
                break;
            }
            case ' ':
                // Buttons activate natively; a Link only activates on Enter.
                if (target.tagName === 'A') {
                    event.preventDefault();
                    target.click();
                }
                break;
            case 'Tab':
                // Close and hand focus back to the trigger; the Tab default
                // action then moves on from there (Shift+Tab goes back).
                close(true);
                break;
            default:
                break;
        }
    };

    const select = (item: UserMenuItem) => {
        close(true);
        item.onSelect?.();
    };

    // Children: any role=menuitem click closes the menu (close-on-select).
    const onChildrenClick = (event: MouseEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest(ITEM_SELECTOR)) close(true);
    };

    const signOut = async () => {
        if (signingOut) return;
        setSigningOut(true);
        try {
            if (onSignOut) await onSignOut();
            else logout();
            if (mounted.current) setOpen(false);
        } catch (error) {
            const message = error instanceof Error && error.message ? error.message : 'unknown error';
            toast.error(`Sign out failed: ${message}`);
        } finally {
            if (mounted.current) setSigningOut(false);
        }
    };

    return (
        <>
            <button
                ref={triggerRef}
                id={triggerId}
                type="button"
                className={cx('user-menu-trigger', `user-menu-${density}`, menuOpen && 'is-open', className)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? menuId : undefined}
                aria-label={`Account menu: ${name}`}
                onClick={toggle}
                onKeyDown={onTriggerKey}
            >
                <Avatar src={avatarSrc} name={name} className="user-menu-avatar-trigger" onError={onAvatarError} />
                <span className="user-menu-name">{name}</span>
                <i className="bi bi-chevron-down user-menu-caret" aria-hidden="true" />
            </button>
            <Popover
                anchorRef={triggerRef}
                open={menuOpen}
                onClose={() => setOpen(false)}
                placement="bottom-end"
                role="none"
                className="user-menu-pop"
            >
                <div className="user-menu-identity">
                    <Avatar src={avatarSrc} name={name} className="user-menu-avatar-lg" onError={onAvatarError} />
                    <div className="user-menu-who">
                        <div className="user-menu-who-name">{name}</div>
                        {email && <div className="user-menu-who-email">{email}</div>}
                        {me?.is_superuser && (
                            <span className="chip chip-primary user-menu-tag">
                                <i className="bi bi-shield-lock" /> System admin
                            </span>
                        )}
                    </div>
                </div>
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-labelledby={triggerId}
                    className="user-menu"
                    onKeyDown={onMenuKey}
                >
                    <div className="user-menu-theme" role="group" aria-label="Theme">
                        <span className="user-menu-theme-label" aria-hidden="true">Theme</span>
                        <div className="seg user-menu-seg">
                            {THEMES.map((theme) => (
                                <button
                                    key={theme.value}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={pref === theme.value}
                                    tabIndex={-1}
                                    className={cx('seg-btn', pref === theme.value && 'seg-active')}
                                    onClick={() => setPref(theme.value)}
                                >
                                    <i className={`bi ${theme.icon}`} aria-hidden="true" /> {theme.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {items && items.length > 0 && <div className="user-menu-sep" role="separator" />}
                    {items?.map((item, i) => {
                        const cls = cx('user-menu-item', item.danger && 'is-danger');
                        const body = (
                            <>
                                <i className={`bi ${item.icon ?? 'bi-dot'}`} aria-hidden="true" />
                                <span>{item.label}</span>
                            </>
                        );
                        return (
                            <div key={`${i}:${item.label}`} role="none" className="user-menu-row">
                                {item.divider && i > 0 && <div className="user-menu-sep" role="separator" />}
                                {item.to != null
                                    ? <Link role="menuitem" tabIndex={-1} className={cls} to={item.to} onClick={() => select(item)}>{body}</Link>
                                    : <button type="button" role="menuitem" tabIndex={-1} className={cls} onClick={() => select(item)}>{body}</button>}
                            </div>
                        );
                    })}
                    {children != null && children !== false && (
                        <div role="none" className="user-menu-slot" onClick={onChildrenClick}>{children}</div>
                    )}
                    <div className="user-menu-sep" role="separator" />
                    <button
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className="user-menu-item is-danger"
                        aria-disabled={signingOut || undefined}
                        aria-busy={signingOut || undefined}
                        onClick={() => { void signOut(); }}
                    >
                        <i className={signingOut ? 'bi bi-arrow-repeat spin' : 'bi bi-box-arrow-right'} aria-hidden="true" />
                        <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
                    </button>
                </div>
            </Popover>
        </>
    );
}

function menuItems(root: HTMLElement | null): HTMLElement[] {
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
        .filter((el) => !(el as HTMLButtonElement).disabled);
}
