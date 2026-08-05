// Group context plumbing — types + the React context object, in their own
// module so me.ts (useCan reads the active member) and group.tsx (the
// provider needs useAuthSnapshot from me.ts) never import each other.
import { createContext } from 'react';
import type { MemberLike } from './me';

export interface Group {
    id: number;
    name: string;
    kind: string;
    uuid?: string | null;
    parent?: { id: number; name: string; kind?: string } | null;
    [field: string]: unknown;
}

export interface GroupContextValue {
    /** The active group, or null when operating in global context. */
    group: Group | null;
    /** The signed-in user's membership in the active group (permissions dict). */
    member: MemberLike | null;
    /** True while boot resolution or a switch is in flight. */
    loading: boolean;
    setActiveGroup(group: Group): void;
    clearActiveGroup(): void;
}

/** Null outside a <GroupProvider> — consumers must handle both. */
export const GroupContext = createContext<GroupContextValue | null>(null);
