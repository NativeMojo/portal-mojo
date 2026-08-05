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
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mojoCall, mojoGet } from './client';
import { useAuthSnapshot } from './me';
import type { MemberLike } from './me';
import { GroupContext, type Group, type GroupContextValue } from './group-context';

const STORAGE_KEY = 'active_group_id';

function readUrlGroupParam(): string | null {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('group');
}

function writeUrlGroupParam(id: number | null): void {
    const params = new URLSearchParams(window.location.search);
    if (id == null) params.delete('group');
    else params.set('group', String(id));
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + (window.location.hash || ''));
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

    const groupQuery = useQuery({
        queryKey: ['group', groupId, auth.uid],
        queryFn: () => mojoGet<Group>('/api/group', groupId!),
        enabled: auth.authenticated && groupId != null,
        staleTime: 5 * 60_000,
    });

    // web-mojo's fallback chain: a failing URL/stored group falls back to the
    // stored one (when different), else the context clears entirely.
    useEffect(() => {
        if (!groupQuery.isError || groupId == null) return;
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
    }, [groupQuery.isError, groupId]);

    const group = groupId != null ? (groupQuery.data ?? null) : null;

    const memberQuery = useQuery({
        queryKey: ['group-member', group?.id, auth.uid],
        queryFn: async () => (await mojoCall(`/api/group/${group!.id}/member`)).data as MemberLike,
        enabled: auth.authenticated && group != null,
        staleTime: 5 * 60_000,
    });

    const value = useMemo<GroupContextValue>(() => ({
        group,
        member: (group != null ? memberQuery.data : null) ?? null,
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
    }), [group, memberQuery.data, memberQuery.isLoading, groupQuery.isLoading, groupId, auth.authenticated, auth.uid, queryClient]);

    return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

/** Active-group context. Throws outside <GroupProvider> — mount it app-wide. */
export function useActiveGroup(): GroupContextValue {
    const ctx = useContext(GroupContext);
    if (!ctx) throw new Error('useActiveGroup requires a <GroupProvider> above it');
    return ctx;
}
