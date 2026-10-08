// NotificationPreferences — the caller's notification settings over
// /api/account/notification/preferences (django-mojo notification_prefs):
//
//   CHANNELS      three master cards (Email / Push / In app), one switch
//                 each, writing the reserved all-kinds entry `"*"`:
//                 `{"*": {email: false}}` silences every kind on email,
//                 including kinds registered later.
//   WHAT TO SEND  one row per kind × channel checkbox grid (partial update
//                 `{kind: {channel: bool}}`; absent = on). A channel whose
//                 master is off renders its column disabled; a kind that is
//                 not delivered on a channel shows "—".
//
// Kinds: the `kinds` prop, else the server's registered catalogue (GET
// `kinds`), plus any kind already stored in the caller's preferences; with
// none at all, one "General" row. Every toggle is optimistic and reverts +
// toasts the server's message on failure. Caller-only: the server reads
// request.user and ignores any user param.
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../client/runtime';
import { toast } from '../ui';
import {
    ALL_KINDS, NOTIFICATION_CHANNELS, setNotificationPreferences,
    type NotificationChannel, type NotificationKind, type NotificationPrefsMap as Prefs,
    type NotificationPreferencesResponse,
} from './api';
import { accountKeys, useNotificationPreferences } from './models';

const CHANNEL_LABEL: Record<NotificationChannel, string> = { email: 'Email', push: 'Push', in_app: 'In app' };

export const DEFAULT_NOTIFICATION_KINDS: NotificationKind[] = [{ kind: 'general', label: 'General' }];

function titleCase(kind: string): string {
    return kind.replace(/[_.-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** prop kinds ▸ server catalogue ▸ stored kinds ▸ "General". */
export function resolveNotificationKinds(
    kinds: NotificationKind[] | undefined,
    serverKinds: NotificationKind[] | null | undefined,
    preferences: Prefs | undefined,
): NotificationKind[] {
    const base = (kinds ?? serverKinds ?? []).filter((k) => k.kind !== ALL_KINDS);
    const listed = new Set(base.map((k) => k.kind));
    const stored = Object.keys(preferences ?? {})
        .filter((kind) => kind !== ALL_KINDS && !listed.has(kind))
        .sort()
        .map((kind) => ({ kind, label: titleCase(kind) }));
    const all = [...base, ...stored];
    return all.length ? all : DEFAULT_NOTIFICATION_KINDS;
}

export interface NotificationPreferencesProps {
    /** The kinds this app sends (label/description/channels). Overrides the server catalogue. */
    kinds?: NotificationKind[];
    /** Sub-lines under the channel cards; defaults describe each channel. */
    channelHints?: Partial<Record<NotificationChannel, string>>;
}

export function NotificationPreferences({ kinds, channelHints }: NotificationPreferencesProps) {
    const qc = useQueryClient();
    const { data: me } = useMe();
    const uid = me?.id ?? null;
    const key = accountKeys.notificationPreferences(uid);
    const { data, isPending, isError, error } = useNotificationPreferences(uid);
    const prefs = data?.preferences ?? {};
    const rows = resolveNotificationKinds(kinds, data?.kinds, prefs);
    const masterOn = (channel: NotificationChannel) => prefs[ALL_KINDS]?.[channel] !== false;

    const write = async (kind: string, channel: NotificationChannel, next: boolean) => {
        const prev = qc.getQueryData<NotificationPreferencesResponse>(key);
        const current = prev?.preferences ?? {};
        qc.setQueryData<NotificationPreferencesResponse>(key, {
            kinds: prev?.kinds ?? null,
            preferences: { ...current, [kind]: { ...(current[kind] ?? {}), [channel]: next } },
        });
        try {
            const merged = await setNotificationPreferences({ [kind]: { [channel]: next } });
            qc.setQueryData<NotificationPreferencesResponse>(key, (now) => ({ kinds: now?.kinds ?? prev?.kinds ?? null, preferences: merged }));
        } catch (err) {
            if (prev) qc.setQueryData(key, prev);
            toast.error(err instanceof Error ? err.message : 'Failed to update notification settings');
        }
    };

    const hints: Record<NotificationChannel, string> = {
        email: channelHints?.email ?? (typeof me?.email === 'string' && me.email ? me.email : 'Your email address'),
        push: channelHints?.push ?? 'Phones and apps',
        in_app: channelHints?.in_app ?? 'Portal bell',
    };

    if (isPending) return <div className="acct-skel" aria-busy="true"><span className="skel skel-block" /></div>;
    if (isError) return <p className="dim" role="alert">{error instanceof Error ? error.message : 'Failed to load notification settings.'}</p>;

    return (
        <div className="acct-notify">
            <div className="acct-label">Channels</div>
            <div className="acct-channels">
                {NOTIFICATION_CHANNELS.map((channel) => (
                    <label key={channel} className={`acct-channel${masterOn(channel) ? '' : ' is-off'}`}>
                        <span className="acct-channel-text">
                            <span className="acct-channel-name">{CHANNEL_LABEL[channel]}</span>
                            <span className="acct-channel-hint" title={hints[channel]}>{hints[channel]}</span>
                        </span>
                        <input
                            type="checkbox"
                            role="switch"
                            className="switch"
                            checked={masterOn(channel)}
                            aria-label={`${CHANNEL_LABEL[channel]} notifications`}
                            onChange={(e) => void write(ALL_KINDS, channel, e.target.checked)}
                        />
                    </label>
                ))}
            </div>
            <p className="acct-note">Turning a channel off silences everything below on that channel, including kinds added later.</p>

            <div className="acct-grid" role="table" aria-label="What to send">
                <div className="acct-grid-head" role="row">
                    <span className="acct-label" role="columnheader">What to send</span>
                    {NOTIFICATION_CHANNELS.map((channel) => (
                        <span key={channel} className="acct-grid-col" role="columnheader">{CHANNEL_LABEL[channel]}</span>
                    ))}
                </div>
                {rows.map((row) => (
                    <div key={row.kind} className="acct-grid-row" role="row">
                        <span className="acct-grid-kind" role="rowheader">
                            <span className="acct-grid-label">{row.label}</span>
                            {row.description && <span className="acct-grid-desc">{row.description}</span>}
                        </span>
                        {NOTIFICATION_CHANNELS.map((channel) => {
                            const delivered = !row.channels || row.channels.includes(channel);
                            if (!delivered) return <span key={channel} className="acct-grid-cell acct-grid-na" role="cell" aria-label={`${row.label} is not sent by ${CHANNEL_LABEL[channel]}`}>—</span>;
                            const on = prefs[row.kind]?.[channel] !== false;
                            return (
                                <span key={channel} className="acct-grid-cell" role="cell">
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        disabled={!masterOn(channel)}
                                        title={masterOn(channel) ? undefined : `${CHANNEL_LABEL[channel]} is off for everything`}
                                        aria-label={`${row.label} by ${CHANNEL_LABEL[channel].toLowerCase()}`}
                                        onChange={(e) => void write(row.kind, channel, e.target.checked)}
                                    />
                                </span>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
