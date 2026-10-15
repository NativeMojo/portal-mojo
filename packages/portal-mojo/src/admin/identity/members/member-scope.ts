import { useLayoutEffect, useMemo, useRef } from 'react';
import { getAuthSessionRevision, getAuthSnapshot, subscribeAuth } from '../../../client/auth';
import { mojoCall } from '../../../client/client';
import { MemberModel, type MemberRow } from './models';
import { getActiveGroupId, subscribeActiveGroup } from '../../../client/active-group';

/** A one-way fence: switching away and back never revives an old operation. */
export function captureMemberScope(owner?: AbortSignal) {
    const controller = new AbortController();
    const actor = getAuthSnapshot();
    const revision = getAuthSessionRevision();
    const group = getActiveGroupId();
    const abort = () => controller.abort();
    const current = () => !controller.signal.aborted
        && getAuthSessionRevision() === revision
        && getAuthSnapshot().uid === actor.uid
        && getAuthSnapshot().authenticated === actor.authenticated
        && getActiveGroupId() === group;
    const observe = () => { if (!current()) abort(); };
    const offAuth = subscribeAuth(observe);
    const offGroup = subscribeActiveGroup(observe);
    owner?.addEventListener('abort', abort, { once: true });
    if (owner?.aborted) abort();
    return {
        signal: controller.signal,
        current,
        assert() { if (!current()) throw new DOMException('Membership context ended', 'AbortError'); },
        dispose() { offAuth(); offGroup(); owner?.removeEventListener('abort', abort); abort(); },
    };
}

export type MemberScope = ReturnType<typeof captureMemberScope>;

/** Mounted owner lifetime, also replaced when its record or authority changes. */
export function useMemberScope(owner: string, onInvalidated?: () => void) {
    // A new reference per owner keeps old async callbacks attached to the disposed
    // scope even if authority changes away and back to the same values.
    const scope = useMemo<{ current: (MemberScope & { owner: string }) | null }>(
        () => ({ current: null }), [owner]);
    const callback = useRef(onInvalidated);
    callback.current = onInvalidated;
    useLayoutEffect(() => {
        const next = { ...captureMemberScope(), owner };
        scope.current = next;
        const invalidated = () => callback.current?.();
        next.signal.addEventListener('abort', invalidated, { once: true });
        return () => {
            next.signal.removeEventListener('abort', invalidated);
            next.dispose();
        };
    }, [owner, scope]);
    return scope;
}

/** Keep the final pre-send check after the transport's asynchronous auth refresh. */
export async function saveMemberInScope(id: number | string | null, changes: Record<string, unknown>, beforeSend: () => void): Promise<MemberRow> {
    const response = await mojoCall(id == null ? MemberModel.endpoint : `${MemberModel.endpoint}/${id}`, {
        method: 'POST', body: changes, unscoped: id != null, beforeSend,
    });
    return response.data as MemberRow;
}
