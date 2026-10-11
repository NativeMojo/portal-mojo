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
import { useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { mojoCall, mojoQueryDefaults, MojoError } from './client';
import { getAuthSnapshot } from './auth';
import { useAuthSnapshot } from './me';
import type { MemberLike } from './me';
import { GroupContext, type Group, type GroupContextValue } from './group-context';
import { setActiveGroupSignal } from './active-group';

const STORAGE_KEY = 'active_group_id';
const denied = (error: unknown) => error instanceof MojoError && [401, 403, 404].includes(error.status);
const temporary = (error: unknown) => !(error instanceof MojoError) || error.status === 0 || error.status >= 500 || [408, 429].includes(error.status);
const retry = (count: number, error: unknown) => !(error instanceof Error && error.name === 'AbortError') && mojoQueryDefaults().queries.retry(count, error);
// Query keeps old data when a refetch fails, and its latest error can change
// from 403 to 503. A known denial outlives either that error or a switcher row.
// Share its lifetime with the cache, including provider remounts.
const denials = new WeakMap<QueryClient, Map<string, { group: boolean; member: boolean }>>();

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
    const current = useRef({ groupId, uid: auth.uid, authenticated: auth.authenticated, generation: 0 });
    const mounted = useRef(true);
    if (current.current.groupId !== groupId || current.current.uid !== auth.uid || current.current.authenticated !== auth.authenticated)
        current.current = { groupId, uid: auth.uid, authenticated: auth.authenticated, generation: current.current.generation + 1 };
    const deniedGroups = denials.get(queryClient) ?? new Map<string, { group: boolean; member: boolean }>();
    denials.set(queryClient, deniedGroups);
    const [, rerender] = useReducer((value: number) => value + 1, 0);
    const denialFor = (id: number, uid: typeof auth.uid) => {
        const key = JSON.stringify([uid, id]);
        let denial = deniedGroups.get(key);
        if (!denial) deniedGroups.set(key, denial = { group: false, member: false });
        return denial;
    };
    const select = (id: number | null) => {
        current.current = { ...current.current, groupId: id, generation: current.current.generation + 1 };
        setGroupId(id);
        rerender();
    };
    const assert = (id: number, uid: typeof auth.uid, generation: number, signal: AbortSignal) => {
        signal.throwIfAborted();
        const actor = getAuthSnapshot();
        if (!mounted.current || !actor.authenticated || actor.uid !== uid || current.current.uid !== uid || current.current.groupId !== id || current.current.generation !== generation)
            throw new DOMException('Group or account changed', 'AbortError');
    };

    const groupQuery = useQuery({
        queryKey: ['group', groupId, auth.uid],
        queryFn: async ({ signal }) => {
            const id = groupId!, uid = auth.uid, generation = current.current.generation;
            const check = () => assert(id, uid, generation, signal);
            check();
            try {
                const result = await mojoCall(`/api/group/${id}`, { signal, beforeSend: check });
                check();
                denialFor(id, uid).group = false;
                return result.data as Group;
            } catch (error) {
                check();
                if (denied(error)) Object.assign(denialFor(id, uid), { group: true, member: true });
                throw error;
            }
        },
        enabled: auth.authenticated && groupId != null,
        staleTime: 5 * 60_000,
        retry,
    });

    // web-mojo's fallback chain: a failing URL/stored group falls back to the
    // stored one (when different), else the context clears entirely.
    useEffect(() => {
        if (!groupQuery.isError || groupId == null || (groupQuery.data && temporary(groupQuery.error))) return;
        const stored = loadStoredGroupId();
        if (stored != null && stored !== groupId) {
            console.warn(`[portal-mojo] active group ${groupId} failed to load; falling back to stored group ${stored}`);
            writeUrlGroupParam(stored);
            select(stored);
        } else {
            console.warn(`[portal-mojo] active group ${groupId} failed to load; clearing group context`);
            clearStoredGroupId();
            writeUrlGroupParam(null);
            select(null);
        }
    }, [groupQuery.isError, groupQuery.data, groupQuery.error, groupId]);

    const groupDenied = groupId != null && (denialFor(groupId, auth.uid).group || denied(groupQuery.error));
    const group = auth.authenticated && groupId != null && !groupDenied ? (groupQuery.data ?? null) : null;

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
    useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            current.current.generation++;
            setActiveGroupSignal(null);
        };
    }, []);

    const memberQuery = useQuery({
        queryKey: ['group-member', group?.id, auth.uid],
        queryFn: async ({ signal }) => {
            const id = group!.id, uid = auth.uid, generation = current.current.generation;
            const check = () => assert(id, uid, generation, signal);
            check();
            try {
                const result = await mojoCall(`/api/group/${id}/member`, { signal, beforeSend: check });
                check();
                denialFor(id, uid).member = false;
                return result.data as MemberLike;
            } catch (error) {
                check();
                if (denied(error)) denialFor(id, uid).member = true;
                throw error;
            }
        },
        enabled: auth.authenticated && group != null,
        staleTime: 5 * 60_000,
        retry,
    });

    const memberDenied = groupId != null && (denialFor(groupId, auth.uid).member || denied(memberQuery.error));
    const value = useMemo<GroupContextValue>(() => ({
        group,
        member: (group != null && !memberDenied ? memberQuery.data : null) ?? null,
        accessDenied: groupDenied || memberDenied,
        loading: auth.authenticated && groupId != null
            && (groupQuery.isLoading || (group != null && memberQuery.isLoading)),
        setActiveGroup(next: Group) {
            const groupKey = ['group', next.id, auth.uid];
            const memberKey = ['group-member', next.id, auth.uid];
            const denial = denialFor(next.id, auth.uid);
            if (denial.group || denial.member || denied(queryClient.getQueryState(groupKey)?.error) || denied(queryClient.getQueryState(memberKey)?.error)) {
                // Selecting an old row cannot re-authorize a denied context.
                // Forget both cached reads; keep the latch until each actual
                // guarded request succeeds.
                void queryClient.cancelQueries({ queryKey: groupKey, exact: true });
                void queryClient.cancelQueries({ queryKey: memberKey, exact: true });
                queryClient.removeQueries({ queryKey: groupKey, exact: true });
                queryClient.removeQueries({ queryKey: memberKey, exact: true });
            } else {
                // An authorized switcher row avoids an ordinary refetch flash.
                queryClient.setQueryData(groupKey, next);
            }
            saveStoredGroupId(next.id);
            writeUrlGroupParam(next.id);
            select(next.id);
        },
        clearActiveGroup() {
            clearStoredGroupId();
            writeUrlGroupParam(null);
            select(null);
        },
    }), [group, memberQuery.data, memberDenied, memberQuery.isLoading, groupDenied, groupQuery.isLoading, groupId, auth.authenticated, auth.uid, queryClient]);

    return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

/** Active-group context. Throws outside <GroupProvider> — mount it app-wide. */
export function useActiveGroup(): GroupContextValue {
    const ctx = useContext(GroupContext);
    if (!ctx) throw new Error('useActiveGroup requires a <GroupProvider> above it');
    return ctx;
}
