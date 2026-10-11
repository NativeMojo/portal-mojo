// GroupProvider — the active-group spine, ported from web-mojo
// PortalApp.checkActiveGroup / setActiveGroup (PortalApp.js:230-348):
//   · resolution order: `?group=` URL param BEATS the stored id
//   · the param rides the REAL search string (before the hash) —
//     `/?group=5#/users` — so it survives every hash navigation and never
//     fights the per-route params store
//   · storage key `active_group_id` (web-mojo parity)
//   · on activation the user's member record for that group is fetched
//     (`/api/group/<id>/member`) — group-context permissions flow from it
//   · URL-group failure falls back to the stored group, then to none
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mojoCall, mojoQueryDefaults, MojoError } from './client';
import { getAuthSnapshot } from './auth';
import { useAuthSnapshot } from './me';
import type { MemberLike } from './me';
import { GroupContext, type Group, type GroupContextValue } from './group-context';
import { setActiveGroupSignal } from './active-group';

const STORAGE_KEY = 'active_group_id';
const denied = (error: unknown) => error instanceof MojoError && [401, 403, 404].includes(error.status);
const temporary = (error: unknown) => !(error instanceof MojoError) || error.status === 0 || error.status >= 500 || [408, 429].includes(error.status);

function readUrlGroupParam(): string | null {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('group');
}

function writeUrlGroupParam(id: number | null): void {
    const params = new URLSearchParams(window.location.search);
    if (id == null) params.delete('group');
    else params.set('group', String(id));
    const qs = params.toString();
    // Keep the entry's state: react-router's {usr, key, idx} lives there and
    // useBlocker needs it on Back (#5925).
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + (window.location.hash || ''));
}

function loadStoredGroupId(): number | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const id = raw == null ? NaN : Number(raw);
        return Number.isFinite(id) && id > 0 ? id : null;
    } catch {
        return null;
    }
}

function saveStoredGroupId(id: number): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(id));
    } catch { /* storage unavailable — context stays session-only */ }
}

function clearStoredGroupId(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
}

export function GroupProvider({ children }: { children: ReactNode }) {
    const auth = useAuthSnapshot();
    const queryClient = useQueryClient();
    const [groupId, setGroupId] = useState<number | null>(() => {
        const urlRaw = readUrlGroupParam();
        const urlId = urlRaw == null ? NaN : Number(urlRaw);
        if (Number.isFinite(urlId) && urlId > 0) return urlId;
        return loadStoredGroupId();
    });
    const current = useRef({ groupId, uid: auth.uid });
    current.current = { groupId, uid: auth.uid };
    const assert = (id: number, uid: typeof auth.uid, signal: AbortSignal) => {
        signal.throwIfAborted();
        const actor = getAuthSnapshot();
        if (!actor.authenticated || actor.uid !== uid || current.current.uid !== uid || current.current.groupId !== id)
            throw new DOMException('Group or account changed', 'AbortError');
    };

    const groupQuery = useQuery({
        queryKey: ['group', groupId, auth.uid],
        queryFn: async ({ signal }) => {
            const id = groupId!, uid = auth.uid;
            const check = () => assert(id, uid, signal);
            check();
            const result = await mojoCall(`/api/group/${id}`, { signal, beforeSend: check });
            check();
            return result.data as Group;
        },
        enabled: auth.authenticated && groupId != null,
        staleTime: 5 * 60_000,
        retry: mojoQueryDefaults().queries.retry,
    });

    // web-mojo's fallback chain: a failing URL/stored group falls back to the
    // stored one (when different), else the context clears entirely.
    useEffect(() => {
        if (!groupQuery.isError || groupId == null || (groupQuery.data && temporary(groupQuery.error))) return;
        const stored = loadStoredGroupId();
        if (stored != null && stored !== groupId) {
            console.warn(`[portal-mojo] active group ${groupId} failed to load; falling back to stored group ${stored}`);
            writeUrlGroupParam(stored);
            setGroupId(stored);
        } else {
            console.warn(`[portal-mojo] active group ${groupId} failed to load; clearing group context`);
            clearStoredGroupId();
            writeUrlGroupParam(null);
            setGroupId(null);
        }
    }, [groupQuery.isError, groupQuery.data, groupQuery.error, groupId]);

    const group = auth.authenticated && groupId != null && !denied(groupQuery.error) ? (groupQuery.data ?? null) : null;

    // Mirror the RESOLVED group into the module signal (scoped.ts's plain-fn
    // consumers). The loaded id, not the candidate — a failing/loading group
    // must not scope requests. Cleared on unmount.
    //
    // LAYOUT timing is load-bearing (#5918). A child's query starts its fetch
    // from a passive effect, and React runs child passive effects before this
    // provider's, so a passive write here left the first request after a
    // switch carrying the previous group. A layout effect runs for committed
    // trees only and before every passive effect.
    useLayoutEffect(() => {
        setActiveGroupSignal(group?.id ?? null);
    }, [group?.id]);
    useLayoutEffect(() => () => setActiveGroupSignal(null), []);

    const memberQuery = useQuery({
        queryKey: ['group-member', group?.id, auth.uid],
        queryFn: async ({ signal }) => {
            const id = group!.id, uid = auth.uid;
            const check = () => assert(id, uid, signal);
            check();
            const result = await mojoCall(`/api/group/${id}/member`, { signal, beforeSend: check });
            check();
            return result.data as MemberLike;
        },
        enabled: auth.authenticated && group != null,
        staleTime: 5 * 60_000,
        retry: mojoQueryDefaults().queries.retry,
    });

    const value = useMemo<GroupContextValue>(() => ({
        group,
        member: (group != null && !denied(memberQuery.error) ? memberQuery.data : null) ?? null,
        accessDenied: denied(groupQuery.error) || (group != null && denied(memberQuery.error)),
        loading: auth.authenticated && groupId != null
            && (groupQuery.isLoading || (group != null && memberQuery.isLoading)),
        setActiveGroup(next: Group) {
            // Seed the cache with the row the switcher already holds — no
            // refetch flash on switch.
            queryClient.setQueryData(['group', next.id, auth.uid], next);
            saveStoredGroupId(next.id);
            writeUrlGroupParam(next.id);
            setGroupId(next.id);
        },
        clearActiveGroup() {
            clearStoredGroupId();
            writeUrlGroupParam(null);
            setGroupId(null);
        },
    }), [group, memberQuery.data, memberQuery.error, memberQuery.isLoading, groupQuery.error, groupQuery.isLoading, groupId, auth.authenticated, auth.uid, queryClient]);

    return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

/** Active-group context. Throws outside <GroupProvider> — mount it app-wide. */
export function useActiveGroup(): GroupContextValue {
    const ctx = useContext(GroupContext);
    if (!ctx) throw new Error('useActiveGroup requires a <GroupProvider> above it');
    return ctx;
}
