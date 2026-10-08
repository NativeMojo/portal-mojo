// Notifications — AdminNotificationsSection port (read in full 2026-08-05),
// now rendered by the shared portal-mojo/account NotificationPreferences:
// three master channel cards (the reserved `"*"` all-kinds entry) over the
// per-kind × channel grid on /api/account/notification/preferences. A
// toggle POSTs the PARTIAL update {preferences: {kind: {channel: bool}}}
// optimistically and reverts on failure (absent channels read as ON).
//
// LIVE-SCOPE NOTE (django-mojo notification_prefs.py, read 2026-08-05): the
// real handler reads request.user and IGNORES the user param — the
// admin-views-another-user path is not a backend surface. Other-user detail
// therefore stays explicitly unavailable and never issues this query.
import { useMe } from '../../../../client/runtime';
import { Eyebrow } from '../../../../ui';
import type { NotificationKind } from '../../../../account/api';
import { NotificationPreferences } from '../../../../account/NotificationPreferences';
import type { UserRow } from '../models';

export function NotificationsSection({ user, kinds }: {
    user: UserRow;
    /** The kinds this app sends; defaults to the server catalogue + stored kinds. */
    kinds?: NotificationKind[];
}) {
    const { data: me } = useMe();
    const isSelf = me?.id === user.id;
    return (
        <>
            <Eyebrow>Notification preferences</Eyebrow>
            {isSelf
                ? <NotificationPreferences kinds={kinds} />
                : (
                    <div className="us-empty">
                        <i className="bi bi-lock" />
                        <div>Notification preferences are caller-only and cannot be administered for another user.</div>
                    </div>
                )}
        </>
    );
}
