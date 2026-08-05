// Permission-gated slot. Fail-closed: renders the fallback (default nothing)
// while `me` loads, while anonymous, and when the check fails. UX gating
// only — the server stays authoritative on every request it receives.
import type { ReactNode } from 'react';
import { useCan } from '../client/me';

export function Guarded({ permission, fallback = null, children }: {
    /** Permission name(s); an array means ANY-of. `admin` and superuser always pass. */
    permission: string | string[];
    /** Rendered when the check fails (default: nothing). */
    fallback?: ReactNode;
    children: ReactNode;
}) {
    const { can } = useCan(permission);
    return <>{can ? children : fallback}</>;
}
