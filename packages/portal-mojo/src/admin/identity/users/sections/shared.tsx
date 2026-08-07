// user-sections/shared — the helpers every UserDetail section leans on:
// the disable-lifecycle maps, tone maps, presence math, the admin-caller
// gate, day-grouped list rendering, and the compact pager/search idiom the
// section lists share (web-mojo ListView's searchable + paginationMode
// 'pages' pageSize 5, expressed as server params).
//
// Ported from admin/account/users/UserView.js helpers (isOnline,
// DISABLE_REASON_BADGES, _statusBadge, _inactivityWarning, LOG_LEVEL_*,
// LOGIN_TONE, PROVIDER_ICONS) — read in full 2026-08-05.
import { useState, type ReactNode } from 'react';
import { dateFns, fmt, type Tone } from '../../../../ui';
import { useCan, type Params } from '../../../../client/runtime';
import { USER_MANAGE_PERMISSIONS, type UserRow } from '../models';

// ── Disable lifecycle (metadata.protected.disable.*) ──────────────────
// Truth field is `is_active`; the block carries reason/by/note/warning/
// history (services/disable.py schema — `at` values are ISO strings, not
// epochs). Reason → badge map per the admin-users spec alignment.

export interface DisableHistoryEntry {
    at?: string | null;
    reason?: string | null;
    by_user_id?: number | null;
    by_username?: string | null;
    note?: string | null;
    reactivated_at?: string | null;
    reactivated_by_user_id?: number | null;
    reactivated_by_username?: string | null;
    reactivated_note?: string | null;
}

export interface DisableBlock {
    reason?: string | null;
    at?: string | null;
    by_user_id?: number | null;
    by_username?: string | null;
    note?: string | null;
    exempt_from_auto_disable?: boolean;
    warning?: { sent_at?: string | null; days_until_disable_at_send?: number | null };
    history?: DisableHistoryEntry[];
}

export const DISABLE_REASON_BADGES: Record<string, { label: string; tone: Tone }> = {
    admin: { label: 'Blocked', tone: 'danger' },
    abuse: { label: 'Banned', tone: 'danger' },
    inactive: { label: 'Auto-disabled', tone: 'warning' },
    anonymized: { label: 'Anonymized', tone: 'muted' },
    self: { label: 'Self-deactivated', tone: 'muted' },
};

export function disableBlock(user: UserRow): DisableBlock | null {
    const meta = user.metadata as Record<string, unknown> | null | undefined;
    const protectedNs = meta?.protected as Record<string, unknown> | undefined;
    const block = protectedNs?.disable;
    return block && typeof block === 'object' ? (block as DisableBlock) : null;
}

export function disableReason(user: UserRow): string | null {
    return disableBlock(user)?.reason ?? null;
}

/** Anonymization is irreversible per backend — the active toggle hides. */
export function isAnonymized(user: UserRow): boolean {
    return disableReason(user) === 'anonymized';
}

/** Reason-keyed status badge; null while active (the toggle already says so). */
export function statusBadge(user: UserRow): { label: string; tone: Tone } | null {
    if (user.is_active) return null;
    const reason = disableReason(user);
    return (reason && DISABLE_REASON_BADGES[reason]) || { label: 'Inactive', tone: 'muted' };
}

/** In-flight inactivity warning — only meaningful while still active. */
export function inactivityWarning(user: UserRow): { sent_at: string; days: number | null } | null {
    if (!user.is_active) return null;
    const w = disableBlock(user)?.warning;
    if (!w?.sent_at) return null;
    return { sent_at: w.sent_at, days: w.days_until_disable_at_send ?? null };
}

// ── Presence ──────────────────────────────────────────────────────────

/** Online if `last_activity` is within 5 minutes (UserView.isOnline). */
export function isOnline(user: UserRow): boolean {
    const ms = toMs(user.last_activity);
    if (ms == null) return false;
    return Date.now() - ms < 5 * 60 * 1000;
}

/** Superuser / Staff / User — `is_staff` is in no live graph, so "Staff" is
 *  derived from held permissions (any grant ⇒ staff-equivalent tier). */
export function accountType(user: UserRow): string {
    if (user.is_superuser) return 'Superuser';
    const grants = Object.values(user.permissions ?? {}).filter((v) => v === true || v === 1);
    return grants.length > 0 ? 'Staff' : 'User';
}

// ── Tone maps ─────────────────────────────────────────────────────────

export const LOG_LEVEL_TONE: Record<string, Tone> = {
    error: 'danger',
    critical: 'danger',
    warning: 'warning',
    warn: 'warning',
    info: 'info',
};

export const LOG_LEVEL_ICON: Record<string, string> = {
    error: 'bi-shield-x',
    critical: 'bi-shield-x',
    warning: 'bi-exclamation-triangle',
    warn: 'bi-exclamation-triangle',
    info: 'bi-pencil-square',
};

// `LOGIN_TONE` / `loginTone(event_type)` were DELETED in #1291. They keyed on
// a field `UserLoginEvent` has never had, so every dot fell through to muted;
// their one consumer (LoginsSection) now uses `loginRiskTone(row)` from
// admin/security/devices/models, which reads `is_new_country` /
// `is_new_region` — fields the wire actually sends.

export const PROVIDER_ICONS: Record<string, string> = {
    google: 'bi-google',
    github: 'bi-github',
    microsoft: 'bi-microsoft',
    apple: 'bi-apple',
    facebook: 'bi-facebook',
    twitter: 'bi-twitter-x',
    linkedin: 'bi-linkedin',
};

export function providerIcon(provider: string | null | undefined): string {
    return PROVIDER_ICONS[String(provider ?? '').toLowerCase()] ?? 'bi-link-45deg';
}

// ── Admin tier ────────────────────────────────────────────────────────

/**
 * System-pinned User mutation tier. Active-member grants cannot satisfy it;
 * superusers retain their normal override. Gates credential writes,
 * force-verify, the active toggle, and the destructive kebab items.
 */
export function useAdminCaller(): boolean {
    return useCan(USER_MANAGE_PERMISSIONS).can;
}

// ── Cross-record nav ──────────────────────────────────────────────────

/** Invoke the consuming app's optional Group-detail seam. */
export function openGroupDetail(id: number, onOpenGroup?: (groupId: number) => void) {
    onOpenGroup?.(id);
}

// ── Time helpers ──────────────────────────────────────────────────────

/** Any stored temporal shape → ms for merge-feed sorting (UserView._toMs).
 *  Delegates to the toolkit's sniffer so epoch seconds, epoch millis,
 *  numeric strings and ISO all sort against each other correctly. */
export function toMs(value: number | string | null | undefined): number | null {
    return dateFns.detectTemporal(value)?.ms ?? null;
}

/** Day-relative header label: Today / Yesterday / Mon, Jun 3. */
export function dayLabel(value: number | string | null | undefined): string {
    const ms = toMs(value);
    if (ms == null) return 'Unknown date';
    const d = new Date(ms);
    const today = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(today) - startOf(d)) / 864e5);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * groupByDay over already-paged rows (web-mojo groupByDay('created') on the
 * section ListViews): consecutive rows sharing a calendar day render under
 * one header. Grouping is display-only — order stays the server's.
 */
export function groupRowsByDay<T>(rows: T[], created: (row: T) => number | string | null | undefined): { label: string; rows: T[] }[] {
    const out: { label: string; rows: T[] }[] = [];
    for (const row of rows) {
        const label = dayLabel(created(row));
        const last = out[out.length - 1];
        if (last && last.label === label) last.rows.push(row);
        else out.push({ label, rows: [row] });
    }
    return out;
}

// ── Section list state (server search + pages) ────────────────────────

export interface SectionListState {
    /** Wire params: search + start/size (server-driven, rule 1). */
    params: Params;
    search: string;
    setSearch: (next: string) => void;
    page: number;
    setPage: (next: number) => void;
    pageSize: number;
}

/**
 * ListView-parity list state: pageSize 5, numbered paging via start/size,
 * search resets to page 1. All of it lands on the wire — nothing filters
 * client-side.
 */
export function useSectionList(pageSize = 5, extra?: Params): SectionListState {
    const [search, setSearchRaw] = useState('');
    const [page, setPage] = useState(1);
    const params: Params = {
        ...extra,
        start: (page - 1) * pageSize,
        size: pageSize,
    };
    if (search) params.search = search;
    return {
        params,
        search,
        setSearch: (next) => { setSearchRaw(next); setPage(1); },
        page,
        setPage,
        pageSize,
    };
}

/** The search box the section lists share. */
export function SectionSearch({ state, placeholder }: { state: SectionListState; placeholder: string }) {
    return (
        <input
            className="input us-search"
            type="search"
            placeholder={placeholder}
            value={state.search}
            onChange={(e) => state.setSearch(e.target.value)}
        />
    );
}

/** Compact pager: ‹ page/pages › + "n of count" readout. */
export function Pager({ state, count }: { state: SectionListState; count: number }) {
    const pages = Math.max(1, Math.ceil(count / state.pageSize));
    if (pages <= 1) return null;
    return (
        <div className="us-pager">
            <button
                className="btn btn-compact"
                disabled={state.page <= 1}
                onClick={() => state.setPage(state.page - 1)}
                aria-label="Previous page"
            >
                <i className="bi bi-chevron-left" />
            </button>
            <span className="dim">{state.page} / {pages}</span>
            <button
                className="btn btn-compact"
                disabled={state.page >= pages}
                onClick={() => state.setPage(state.page + 1)}
                aria-label="Next page"
            >
                <i className="bi bi-chevron-right" />
            </button>
            <span className="dim us-pager-count">{count} total</span>
        </div>
    );
}

// ── Section tabs (TabView port for in-section tab rows) ───────────────

export function SectionTabs({ tabs, active, onSelect }: {
    tabs: { key: string; label: string; badge?: ReactNode }[];
    active: string;
    onSelect: (key: string) => void;
}) {
    return (
        <div className="us-tabs" role="tablist">
            {tabs.map((t) => (
                <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={t.key === active}
                    className={`us-tab${t.key === active ? ' us-tab-active' : ''}`}
                    onClick={() => onSelect(t.key)}
                >
                    {t.label}
                    {t.badge != null && t.badge !== 0 && <span className="us-tab-badge">{t.badge}</span>}
                </button>
            ))}
        </div>
    );
}

/** Relative "last seen" that reads day-relative for device rows. */
export function lastSeenLabel(value: number | null | undefined): string {
    return fmt.relative(value ?? null, 'never');
}
