// POST_SAVE_ACTION result normalization — the one reader for django-mojo
// action replies, and the typed rejection that makes a refused action
// unmissable (architecture rule 3).
//
// The wire (verified against django-mojo rest.py + consumer measurement,
// wmx-admin-v2 annex): an action handler's return dict reaches the client in
// one of two shapes —
//   flat      {success: false, code, error, ...}            (JsonResponse verbatim)
//   wrapped   {status: true, data: {success: false, ...}}   (save-and-respond)
// — always inside an HTTP 200, so the transport's unwrap does NOT reject.
// One oddball spells the flag `status` instead of `success` inside the
// action payload (`revoke_sessions`); envelope-level `status: false` is a
// different thing entirely and already rejects in unwrap. One-shot secrets
// differ by direction: top-level on create, inside the action payload on
// rotate — `payload` below merges both so callers read one place.
import { mojoCall } from './client';
import { withFreshAuth } from './auth';
import { MojoError } from './errors';

export interface ActionResult {
    /** False when the handler refused inside the 200. */
    ok: boolean;
    /** Semantic refusal code (`WRONG_STATUS`, `MISSING_DETAILS`, …). */
    code?: string;
    /** Server-provided human error text. */
    error?: string;
    /** Envelope ⊕ action dict (action fields win) — one-shot secrets,
     *  counts etc. read from here regardless of wire shape. */
    payload: Record<string, unknown>;
}

export function readActionResult(out: unknown): ActionResult {
    const env = (typeof out === 'object' && out !== null ? out : {}) as Record<string, unknown>;
    const data = (typeof env.data === 'object' && env.data !== null ? env.data : {}) as Record<string, unknown>;
    const payload = { ...env, ...data };
    const refused = env.success === false
        || data.success === false
        || data.status === false; // the `status`-spelling oddball (revoke_sessions)
    const code = typeof payload.code === 'string' && payload.code ? payload.code : undefined;
    const error = typeof payload.error === 'string' && payload.error ? payload.error : undefined;
    return { ok: !refused, code, error, payload };
}

/**
 * A refused action. `status` is 200 on purpose — the HTTP layer succeeded;
 * the HANDLER said no. `errorCode` carries the refusal code, `data` the
 * merged payload (may hold evidence like the current row status).
 */
export class ActionRefusedError extends MojoError {
    result: ActionResult;
    constructor(action: string, result: ActionResult) {
        super(
            result.error ?? (result.code ? `${action} refused (${result.code})` : `${action} was refused by the server`),
            200,
            result.code,
            result.payload,
        );
        this.name = 'ActionRefusedError';
        this.result = result;
    }
}

/**
 * The raw-path action primitive: POST `{[action]: payload}` to
 * `<endpoint>/<id>` under fresh auth, normalize the reply, REJECT with
 * ActionRefusedError on an inside-the-200 refusal. Argument-less actions
 * send `true` (django-mojo dispatches on the key's presence; handlers
 * treat a non-dict value as flag-only).
 *
 * For model-bound calls prefer `defineModel(...).useAction` — it rides the
 * same normalizer and additionally maintains the record caches.
 */
export async function mojoAction(
    endpoint: string,
    id: number | string,
    action: string,
    payload?: unknown,
): Promise<ActionResult> {
    const body = await withFreshAuth(() => mojoCall(`${endpoint}/${id}`, {
        method: 'POST',
        body: { [action]: payload ?? true },
    }));
    const result = readActionResult(body);
    if (!result.ok) throw new ActionRefusedError(action, result);
    return result;
}
