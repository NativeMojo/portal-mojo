// Notifications — AdminNotificationsSection port (read in full 2026-08-05):
// the per-kind × per-channel (In-App / Email / Push) toggle grid over
// /api/account/notification/preferences. A toggle POSTs the PARTIAL update
// {preferences: {kind: {channel: bool}}} optimistically and reverts on
// failure (source semantics; absent channels read as ON — `!== false`).
//
// LIVE-SCOPE NOTE (django-mojo notification_prefs.py, read 2026-08-05): the
// real handler reads request.user and IGNORES the user param — the
// admin-views-another-user path is not a backend surface. Other-user detail
// therefore stays explicitly unavailable and never issues this query.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mojoCall, useMe } from '../../../../client/runtime';
import { Eyebrow, toast } from '../../../../ui';
import type { UserRow } from '../models';

const CHANNELS = ['in_app', 'email', 'push'] as const;
const CHANNEL_LABELS: Record<string, string> = {
    in_app: 'In-App',
    email: 'Email',
    push: 'Push',
};

type Preferences = Record<string, Record<string, boolean>>;

const prefsKey = (userId: number) => ['/api/account/notification/preferences', userId] as const;

export function NotificationsSection({ user }: { user: UserRow }) {
    const qc = useQueryClient();
    const { data: me } = useMe();
    const isSelf = me?.id === user.id;
    const { data: prefs, isPending, isError, error } = useQuery<Preferences>({
        queryKey: prefsKey(user.id),
        queryFn: async () => {
            const body = await mojoCall('/api/account/notification/preferences');
            const data = body.data as { preferences?: Preferences } | undefined;
            return data?.preferences ?? {};
        },
        enabled: isSelf,
    });

    const toggle = async (kind: string, channel: string, next: boolean) => {
        // Optimistic write into the query cache; revert + toast on rejection.
        const prev = qc.getQueryData<Preferences>(prefsKey(user.id)) ?? {};
        qc.setQueryData<Preferences>(prefsKey(user.id), {
            ...prev,
            [kind]: { ...(prev[kind] ?? {}), [channel]: next },
        });
        try {
            await mojoCall('/api/account/notification/preferences', {
                method: 'POST',
                body: { preferences: { [kind]: { [channel]: next } } },
            });
        } catch (err) {
            qc.setQueryData(prefsKey(user.id), prev);
            toast.error(err instanceof Error ? err.message : 'Failed to update preference');
        }
    };

    const kinds = Object.keys(prefs ?? {}).sort();
    const kindLabel = (kind: string) =>
        kind.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    return (
        <>
            <Eyebrow>Notification preferences</Eyebrow>
            {!isSelf && (
                <div className="us-empty">
                    <i className="bi bi-lock" />
                    <div>Notification preferences are caller-only and cannot be administered for another user.</div>
                </div>
            )}
            {isSelf && <>
            {isPending && <p className="dim">Loading…</p>}
            {isError && <p className="dim">{error instanceof Error ? error.message : 'Failed to load preferences.'}</p>}
            {!isPending && !isError && kinds.length === 0 && (
                <div className="us-empty">
                    <i className="bi bi-bell" />
                    <div>No notification preferences configured</div>
                </div>
            )}
            {kinds.length > 0 && (
                <table className="us-prefs-table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            {CHANNELS.map((ch) => <th key={ch}>{CHANNEL_LABELS[ch]}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {kinds.map((kind) => (
                            <tr key={kind}>
                                <td>{kindLabel(kind)}</td>
                                {CHANNELS.map((ch) => {
                                    // Absent channel == enabled (source `!== false`).
                                    const checked = prefs?.[kind]?.[ch] !== false;
                                    return (
                                        <td key={ch}>
                                            <input
                                                type="checkbox"
                                                role="switch"
                                                className="switch"
                                                checked={checked}
                                                aria-label={`${kindLabel(kind)} via ${CHANNEL_LABELS[ch]}`}
                                                onChange={(e) => void toggle(kind, ch, e.target.checked)}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            </>}
        </>
    );
}
