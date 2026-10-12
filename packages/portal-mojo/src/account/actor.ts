// A pending profile action belongs to the account that started it, including
// time spent waiting for auth refresh or a fresh-auth dialog. Same-account
// token rotation remains valid; leaving that account invalidates the action
// permanently, even if the operator switches back before the response arrives.
import { getAuthSnapshot, subscribeAuth } from '../client/auth';

export interface AccountActor {
    uid: string | null;
    check: () => void;
    dispose: () => void;
}

export function captureAccountActor(expectedUid: string | number | null = getAuthSnapshot().uid): AccountActor {
    const uid = expectedUid == null ? null : String(expectedUid);
    const matches = () => {
        const current = getAuthSnapshot();
        return uid !== null && current.authenticated && current.uid === uid;
    };
    let invalid = !matches();
    const off = subscribeAuth(() => { if (!matches()) invalid = true; });
    return {
        uid,
        check: () => {
            if (invalid || !matches()) throw new Error('Your account changed. Reopen your profile to make this change.');
        },
        dispose: () => { invalid = true; off(); },
    };
}

export async function withAccountActor<T>(run: (actor: AccountActor) => Promise<T>, expectedUid?: string | number | null): Promise<T> {
    const actor = captureAccountActor(expectedUid);
    try {
        actor.check();
        const value = await run(actor);
        actor.check();
        return value;
    } finally {
        actor.dispose();
    }
}
