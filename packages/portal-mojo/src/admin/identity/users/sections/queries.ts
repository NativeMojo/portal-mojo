// The shared query set UserDetail owns — the port of UserView's shared
// Collections (devicesCollection, pushDevicesCollection, membersCollection,
// loginsCollection, eventsCollection, activityCollection,
// objectLogsCollection + the fire-and-forget throttle GET). Overview KPIs,
// the rail count badges, and the header chips all read from here; section
// lists with their own paging/search run their own param'd queries and
// dedupe through the TanStack cache.
import { useQuery } from '@tanstack/react-query';
import { mojoCall } from '../../../../client';
import { LogModel } from '../../../monitoring';
import { EventModel } from '../../../incidents';
import { MemberModel } from '../../members';
import {
    DeviceModel, LoginEventModel, PushDeviceModel,
    ApiKeyModel,
} from '../models';

export interface ThrottleState {
    count: number;
    limit: number;
    window: number;
    retry_after_seconds: number;
}

export interface SharedUserQueryAccess {
    devices: boolean;
    pushDevices: boolean;
    members: boolean;
    logins: boolean;
    events: boolean;
    logs: boolean;
    apiKeys: boolean;
    throttle: boolean;
}

export function useSharedUserQueries(userId: number, access: SharedUserQueryAccess) {
    // Sizes mirror the source's shared collections (25/25/10/10/25/25/25).
    const devices = DeviceModel.useList({ user: userId, size: 25 }, { enabled: access.devices });
    const pushDevices = PushDeviceModel.useList({ user: userId, size: 25 }, { enabled: access.pushDevices });
    const members = MemberModel.useList({ user: userId, size: 10 }, { enabled: access.members });
    const logins = LoginEventModel.useList({ user: userId, size: 10, sort: '-created' }, { enabled: access.logins });
    const events = EventModel.useList(
        { size: 25, model_name: 'account.User', model_id: userId, sort: '-created' },
        { enabled: access.events },
    );
    const activity = LogModel.useList({ size: 25, uid: userId, sort: '-created' }, { enabled: access.logs });
    const objectLogs = LogModel.useList(
        { size: 25, model_name: 'account.User', model_id: userId, sort: '-created' },
        { enabled: access.logs },
    );
    const apiKeys = ApiKeyModel.useList({ user: userId, size: 25, sort: '-id' }, { enabled: access.apiKeys });

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
        enabled: access.throttle,
        staleTime: 30_000,
        retry: false,
    });

    return { devices, pushDevices, members, logins, events, activity, objectLogs, apiKeys, throttle };
}

export type SharedUserQueries = ReturnType<typeof useSharedUserQueries>;
