// DetailView + SideNav — the record-viewer layout: flat header (avatar,
// title, subtitle, chips, active switch, kebab menu, close) over a left rail
// of grouped sections. Direct port of web-mojo's headerConfig/sections schema
// (SideNavView.js + ContextMenu.js); the section bodies are plain components
// built from FlatRow / SecurityItem.
//
// C1 semantics (ported from SideNavView.js:115-160,328-438 and
// ContextMenu.js:102-116):
//   · Sections may carry `permissions` (any-of when array) — resolved through
//     the useCan path (me + active-group member), FAIL-CLOSED: no resolvable
//     grant ⇒ the section is absent from the rail AND unroutable. Divider
//     labels whose following group has no visible section drop with it.
//   · If the ACTIVE section becomes invisible (permission or schema change),
//     selection self-heals to the first visible section — and the heal is
//     STICKY (source `_reconcileActiveSection` rewrote activeSection): the
//     old section regaining visibility does not steal selection back.
//   · Rail badges are a CONTROLLED prop (`badges`), keyed by section key.
//     Deviation from source, by design: web-mojo's imperative
//     `setBadge(key, value)` patched the DOM; here React owns the state —
//     update the prop and the rail follows. Primitive values render as the
//     source's muted pill; ReactNode values render as given.
//   · `contextMenu` renders a header kebab opening a Popover menu. Entries
//     filter by `permissions` (any-of, fail-closed) ∧ `when(menuContext)`;
//     hidden entries drop; separators that end up leading, trailing, or
//     doubled collapse; the menu closes on select.
//   · Lazy mount + keep-alive: a section's content mounts on FIRST
//     activation and stays mounted-but-CSS-hidden afterwards, so section
//     state survives switching — the source's unmount-not-destroy semantic.
//     Sections hidden by permissions unmount entirely (fail-closed beats
//     keep-alive; revoked content must not linger in the DOM).
//   · Invalid config (bad permission shapes, unknown badge keys, malformed
//     menu entries) falls back WITH a console.warn — never silently. Each
//     distinct problem warns once per instance, not once per render.
//
// Note: DetailView now resolves permissions, so (like the rest of the
// toolkit's client-bound components) it must render inside the app's
// QueryClientProvider. Both are baseline requirements of the package.
import { useContext, useRef, useState, type ReactNode } from 'react';
import { initials } from './format';
import type { Tone } from './format';
import { hasPermission, useMe } from '../client/me';
import { GroupContext } from '../client/group-context';
import { Popover } from './Popover';

export interface Chip {
    icon?: string;
    text: string;
    tone?: Tone;
}

export interface Section {
    key: string;
    label: string;
    icon: string;
    render: () => ReactNode;
    /** Permission gate — ANY-of when an array; resolved like `useCan`
     *  (signed-in user + active-group member), FAIL-CLOSED: while `me`
     *  loads, while anonymous, and on a failed check the section is
     *  absent from the rail and cannot be activated. */
    permissions?: string | string[];
}

export type RailEntry = Section | { divider: string };

/** Header kebab menu entry. `{ divider: true }` renders a separator. */
export interface DetailMenuItem<TCtx = unknown> {
    label: string;
    icon?: string;
    /** Same any-of, fail-closed gate as `Section.permissions`. */
    permissions?: string | string[];
    /** Visibility predicate over `menuContext` (the record on display).
     *  Re-evaluated every render, so entries track model state live.
     *  Receives `undefined` when no `menuContext` prop is given. */
    when?: (ctx: TCtx | undefined) => boolean;
    onSelect: () => void;
    /** Destructive styling (`--bad`), the source's `danger` flag. */
    danger?: boolean;
}

export type DetailMenuEntry<TCtx = unknown> = DetailMenuItem<TCtx> | { divider: true };

export interface DetailViewProps<TCtx = unknown> {
    avatarName?: string;
    icon?: string;
    title: string;
    subtitle?: string;
    chips?: Chip[];
    active?: { value: boolean; onChange: (next: boolean) => void };
    sections: RailEntry[];
    initialSection?: string;
    /** Controlled rail badges keyed by section key — numbers, dots, text,
     *  any ReactNode. Nullish / `false` / `''` / `true` render nothing
     *  (web-mojo `_normalizeBadge` parity). */
    badges?: Record<string, ReactNode>;
    /** Header kebab menu. Renders only when at least one entry survives
     *  permissions ∧ when() filtering — an empty menu shows no kebab. */
    contextMenu?: DetailMenuEntry<TCtx>[];
    /** Handed to every `when(ctx)` predicate — by convention the record on
     *  display (web-mojo's `this.context`). */
    menuContext?: TCtx;
    onClose: () => void;
}

// ── Config validation ─────────────────────────────────────────────────
// The do-not-recreate rule: unknown/invalid config falls back WITH a
// console.warn — never to silence, and (for permissions) never to open.

type WarnOnce = (key: string, message: string) => void;

/** Warn once per (instance, problem) — loud, but not once per render. */
function useWarnOnce(): WarnOnce {
    const seen = useRef<Set<string>>(new Set());
    return (key, message) => {
        if (seen.current.has(key)) return;
        seen.current.add(key);
        console.warn(message);
    };
}

/**
 * Validate a `permissions` value into what `hasPermission` accepts.
 * Invalid shapes warn and yield `[]` — any-of over nothing, which DENIES
 * for everyone except superusers/`admin` holders (who pass every gate in
 * this framework). Fail-closed, matching View#checkPermissions.
 */
function normalizePermissions(raw: string | string[], where: string, warnOnce: WarnOnce): string | string[] {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
        const strings = raw.filter((p): p is string => typeof p === 'string');
        if (strings.length !== raw.length) {
            warnOnce(`perm-shape:${where}`,
                `DetailView: ${where} has non-string entries in its permissions array — ignoring them (fail-closed).`);
        }
        return strings;
    }
    warnOnce(`perm-shape:${where}`,
        `DetailView: ${where} has an invalid permissions value (expected string or string[]) — treating as denied (fail-closed).`);
    return [];
}

/**
 * The `useCan` resolution path (signed-in user + active-group member),
 * returned as a plain checker so a dynamic schema can be gated without
 * running hooks in a loop. Fail-closed by construction: anonymous or
 * still-loading `me` ⇒ every check is false.
 */
function useCanChecker(): (permission: string | string[]) => boolean {
    const { data } = useMe();
    const member = useContext(GroupContext)?.member ?? null;
    const me = data ?? null;
    return (permission) => hasPermission(me, permission, member);
}

// ── Menu filtering (ContextMenu.visibleItems port) ────────────────────

function isMenuDivider<TCtx>(entry: DetailMenuEntry<TCtx>): entry is { divider: true } {
    return 'divider' in entry && Boolean(entry.divider);
}

/**
 * The entries the current user/context may see, in order. Two gates,
 * matching the source: `permissions` (any-of, fail-closed) and
 * `when(menuContext)` — then separators that end up leading, trailing, or
 * doubled are dropped so the menu never shows an orphaned rule.
 */
function visibleMenuEntries<TCtx>(
    entries: DetailMenuEntry<TCtx>[],
    can: (permission: string | string[]) => boolean,
    ctx: TCtx | undefined,
    warnOnce: WarnOnce,
): DetailMenuEntry<TCtx>[] {
    const kept = entries.filter((entry, i) => {
        if (isMenuDivider(entry)) return true;
        const item = entry as DetailMenuItem<TCtx>;
        if (typeof item.label !== 'string' || typeof item.onSelect !== 'function') {
            warnOnce(`menu-entry:${i}`,
                `DetailView: contextMenu entry #${i} needs { label, onSelect } (or { divider: true }) — dropped.`);
            return false;
        }
        if (item.permissions !== undefined
            && !can(normalizePermissions(item.permissions, `contextMenu "${item.label}"`, warnOnce))) {
            return false;
        }
        if (item.when !== undefined) {
            if (typeof item.when !== 'function') {
                warnOnce(`menu-when:${item.label}`,
                    `DetailView: contextMenu "${item.label}" has a non-function \`when\` — ignoring the predicate.`);
            } else if (!item.when(ctx)) {
                return false;
            }
        }
        return true;
    });
    return kept.filter((entry, i) => {
        if (!isMenuDivider(entry)) return true;
        if (i === 0) return false;
        const next = kept[i + 1];
        return next !== undefined && !isMenuDivider(next);
    });
}

// ── Rail badges ───────────────────────────────────────────────────────

/**
 * Controlled-badge renderer. Primitive values get the source's default
 * muted pill (`_normalizeBadge` normalized numbers/strings to the muted
 * variant); element values render as given, so `<Badge tone>` / dots /
 * custom nodes own their look. Falsy-but-renderable values (`0` excepted)
 * render nothing, like the source.
 */
function railBadge(value: ReactNode): ReactNode {
    if (value === null || value === undefined || value === false || value === true || value === '') return null;
    const pill = typeof value === 'string' || typeof value === 'number';
    return <span className="rail-badge">{pill ? <span className="chip chip-muted">{value}</span> : value}</span>;
}

// ── The component ─────────────────────────────────────────────────────

export function DetailView<TCtx = unknown>({
    avatarName, icon, title, subtitle, chips = [], active,
    sections, initialSection, badges, contextMenu, menuContext, onClose,
}: DetailViewProps<TCtx>) {
    const can = useCanChecker();
    const warnOnce = useWarnOnce();

    // One-time schema lint: duplicate keys break activation + keep-alive
    // keying; badge keys must name a section; a never-matching
    // initialSection is a typo (a merely GATED one heals silently — that
    // is normal permission behavior, not misconfig).
    const realAll = sections.filter((s): s is Section => !('divider' in s));
    {
        const seen = new Set<string>();
        for (const s of realAll) {
            if (seen.has(s.key)) warnOnce(`dup:${s.key}`, `DetailView: duplicate section key "${s.key}" — activation and keep-alive key on it.`);
            seen.add(s.key);
        }
    }
    if (badges) {
        for (const key of Object.keys(badges)) {
            if (!realAll.some((s) => s.key === key)) {
                warnOnce(`badge:${key}`, `DetailView: badges key "${key}" matches no section — ignored.`);
            }
        }
    }
    if (initialSection != null && realAll.length > 0 && !realAll.some((s) => s.key === initialSection)) {
        warnOnce(`initial:${initialSection}`,
            `DetailView: initialSection "${initialSection}" matches no section — falling back to the first visible one.`);
    }

    // Fail-closed visibility, then SideNavView's divider rule: a divider
    // survives only when the next visible entry is a section (trailing and
    // doubled dividers drop; a leading one with content below stays).
    const sectionAllowed = (s: Section): boolean =>
        s.permissions === undefined || can(normalizePermissions(s.permissions, `section "${s.key}"`, warnOnce));
    const allowed = sections.filter((e) => 'divider' in e || sectionAllowed(e));
    const visibleEntries = allowed.filter((e, i) => {
        if (!('divider' in e)) return true;
        const next = allowed[i + 1];
        return next !== undefined && !('divider' in next);
    });
    const visibleSections = visibleEntries.filter((e): e is Section => !('divider' in e));

    // Active selection + self-heal (source _reconcileActiveSection): when
    // the selected key is missing or gated, fall back to the first visible
    // section — and WRITE the heal back so it sticks (guarded render-time
    // setState; converges in one extra pass).
    const [activeKey, setActiveKey] = useState<string | null>(initialSection ?? null);
    const effectiveKey = activeKey !== null && visibleSections.some((s) => s.key === activeKey)
        ? activeKey
        : visibleSections[0]?.key ?? null;
    if (effectiveKey !== activeKey) setActiveKey(effectiveKey);

    // Lazy mount + keep-alive: a section joins `activated` on first
    // activation and stays mounted-but-hidden from then on. Only VISIBLE
    // sections mount at all — losing a permission unmounts (and drops the
    // local state of) the revoked section.
    const [activated, setActivated] = useState<ReadonlySet<string>>(() => new Set());
    if (effectiveKey !== null && !activated.has(effectiveKey)) {
        setActivated(new Set(activated).add(effectiveKey));
    }
    const mountedSections = visibleSections.filter((s) => activated.has(s.key));

    // Header kebab (ContextMenu port) — no surviving entries, no button.
    const kebabRef = useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuEntries = contextMenu ? visibleMenuEntries(contextMenu, can, menuContext, warnOnce) : [];
    // If every entry filters away WHILE the menu is open (live `when()` /
    // permission flip), the kebab unmounts — reset `open` so the menu can't
    // spring back uninvited when entries return.
    if (menuOpen && menuEntries.length === 0) setMenuOpen(false);

    return (
        <div className="detail">
            <header className="detail-header">
                <div className="detail-avatar">
                    {avatarName ? initials(avatarName) : <i className={`bi ${icon ?? 'bi-file-earmark'}`} />}
                </div>
                <div className="detail-id">
                    <h2 className="detail-title">{title}</h2>
                    <div className="detail-sub">
                        {subtitle}
                        {chips.map((chip, i) => (
                            <span key={i} className={`chip chip-${chip.tone ?? 'muted'}`}>
                                {chip.icon && <i className={`bi ${chip.icon}`} />} {chip.text}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="detail-gutter">
                    {active && (
                        <label className="switch-inline" title={active.value ? 'Active' : 'Inactive'}>
                            <input
                                type="checkbox"
                                role="switch"
                                className="switch"
                                checked={active.value}
                                onChange={(e) => active.onChange(e.target.checked)}
                            />
                        </label>
                    )}
                    {menuEntries.length > 0 && (
                        <>
                            <button
                                ref={kebabRef}
                                className="btn-icon dv-kebab"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                title="More actions"
                                aria-label="More actions"
                                onClick={() => setMenuOpen((v) => !v)}
                            >
                                <i className="bi bi-three-dots-vertical" />
                            </button>
                            <Popover
                                anchorRef={kebabRef}
                                open={menuOpen}
                                onClose={() => setMenuOpen(false)}
                                placement="bottom-end"
                                role="menu"
                                aria-label="More actions"
                            >
                                <div className="dv-menu">
                                    {menuEntries.map((entry, i) => isMenuDivider(entry) ? (
                                        <div key={`d${i}`} className="dv-menu-sep" role="separator" />
                                    ) : (
                                        <button
                                            key={`${entry.label}${i}`}
                                            className={`dv-menu-item${entry.danger ? ' dv-danger' : ''}`}
                                            role="menuitem"
                                            // Source order: run the handler, then close.
                                            onClick={() => { entry.onSelect(); setMenuOpen(false); }}
                                        >
                                            {entry.icon && <i className={`bi ${entry.icon}`} />}
                                            <span>{entry.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </Popover>
                        </>
                    )}
                    <button className="btn-icon" onClick={onClose} title="Close" aria-label="Close">
                        <i className="bi bi-x-lg" />
                    </button>
                </div>
            </header>
            <div className="detail-body">
                <nav className="detail-rail" aria-label={`${title} sections`}>
                    {visibleEntries.map((entry, i) => 'divider' in entry ? (
                        <div key={`d${i}`} className="rail-divider">{entry.divider}</div>
                    ) : (
                        <button
                            key={entry.key}
                            className={`rail-item${entry.key === effectiveKey ? ' rail-active' : ''}`}
                            onClick={() => setActiveKey(entry.key)}
                        >
                            <i className={`bi ${entry.icon}`} /> {entry.label}
                            {railBadge(badges?.[entry.key])}
                        </button>
                    ))}
                </nav>
                <div className="detail-content">
                    {mountedSections.map((s) => (
                        <div key={s.key} className="dv-keep" hidden={s.key !== effectiveKey}>
                            {s.render()}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Uppercase group heading inside a section (CONTACT / ACCOUNT / …). */
export function Eyebrow({ children }: { children: ReactNode }) {
    return <div className="eyebrow section-eyebrow">{children}</div>;
}

/** The canonical label / value / action row. */
export function FlatRow({ label, children, action, actionIcon = 'bi-pencil', actionTitle }: {
    label: string;
    children: ReactNode;
    action?: () => void;
    actionIcon?: string;
    actionTitle?: string;
}) {
    return (
        <div className="flat-row">
            <div className="flat-label">{label}</div>
            <div className="flat-value">{children}</div>
            <div className="flat-action">
                {action && (
                    <button className="btn-icon btn-icon-sm" onClick={action} title={actionTitle ?? `Edit ${label.toLowerCase()}`}>
                        <i className={`bi ${actionIcon}`} />
                    </button>
                )}
            </div>
        </div>
    );
}

/** Richer icon row: icon / title + description / trailing content. */
export function SecurityItem({ icon, title, desc, children }: {
    icon: string;
    title: string;
    desc: string;
    children?: ReactNode;
}) {
    return (
        <div className="sec-item">
            <div className="sec-icon"><i className={`bi ${icon}`} /></div>
            <div className="sec-info">
                <div className="sec-title">{title}</div>
                <div className="sec-desc">{desc}</div>
            </div>
            <div className="sec-right">{children}</div>
        </div>
    );
}
