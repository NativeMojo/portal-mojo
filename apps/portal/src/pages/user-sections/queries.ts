// The shared query set UserDetail owns — the port of UserView's shared
// Collections (devicesCollection, pushDevicesCollection, membersCollection,
// loginsCollection, eventsCollection, activityCollection,
// objectLogsCollection + the fire-and-forget throttle GET). Overview KPIs,
// the rail count badges, and the header chips all read from here; section
// lists with their own paging/search run their own param'd queries and
// dedupe through the TanStack cache.
import { useQuery } from '@tanstack/react-query';
import { mojoCall } from 'portal-mojo/client';
import {
    DeviceModel, IncidentEventModel, LoginEventModel, MemberModel, PushDeviceModel,
    ApiKeyModel, LogModel,
} from '../../models';

export interface ThrottleState {
    count: number;
    limit: number;
    window: number;
    retry_after_seconds: number;
}

export function useSharedUserQueries(userId: number, isAdminCaller: boolean) {
    // Sizes mirror the source's shared collections (25/25/10/10/25/25/25).
    const devices = DeviceModel.useList({ user: userId, size: 25 });
    const pushDevices = PushDeviceModel.useList({ user: userId, size: 25 });
    const members = MemberModel.useList({ user: userId, size: 10 });
    const logins = LoginEventModel.useList({ user: userId, size: 10, sort: '-created' });
    const events = IncidentEventModel.useList({ size: 25, model_name: 'account.User', model_id: userId, sort: '-created' });
    const activity = LogModel.useList({ size: 25, uid: userId, sort: '-created' });
    const objectLogs = LogModel.useList({ size: 25, model_name: 'account.User', model_id: userId, sort: '-created' });
    const apiKeys = ApiKeyModel.useList({ user: userId, size: 25, sort: '-id' });

    // Login-throttle state for the header "Login locked Xs" badge.
    // Admin-tier endpoint; failure (or a non-admin viewer) is non-fatal —
    // the badge just stays hidden (source _refreshThrottle).
    const throttle = useQuery<ThrottleState | null>({
        queryKey: ['/api/auth/manage/throttle', userId],
        queryFn: async () => {
            try {
                const body = await mojoCall('/api/auth/manage/throttle', { params: { user_id: userId, key: 'login' } });
                return (body.data ?? null) as ThrottleState | null;
            } catch {
                return null;
            }
        },
        enabled: isAdminCaller,
        staleTime: 30_000,
        retry: false,
    });

    return { devices, pushDevices, members, logins, events, activity, objectLogs, apiKeys, throttle };
}

export type SharedUserQueries = ReturnType<typeof useSharedUserQueries>;
