// POST_SAVE_ACTION result normalization — the one reader for django-mojo
// action replies, and the typed rejection that makes a refused action
// unmissable (architecture rule 3).
//
// The wire (verified against django-mojo rest.py + consumer measurement,
// wmx-admin-v2 annex): an action handler's return dict reaches the client in
// one of two shapes, always inside an HTTP 200 —
//   flat      {success: false, code, error, ...}            (JsonResponse verbatim)
//   wrapped   {status: true, data: {success: false, ...}}   (save-and-respond)
// unwrap rejects the FLAT shape for every call (#5922); a wrapped
// `success:false` can be ordinary data on a successful POST, so only this
// layer, which knows it posted an action, reads it as a refusal. One oddball
// spells the flag `status` instead of `success` inside the action payload
// (`revoke_sessions`); envelope-level `status: false` is a different thing
// entirely and already rejects in unwrap. One-shot secrets differ by
// direction: top-level on create, inside the action payload on rotate —
// `payload` merges both so callers read one place. The reader and the error
// live in errors.ts (cycle-free, so unwrap can use them) and are re-exported
// here unchanged.
import { mojoCall } from './client';
import { withFreshAuth } from './auth';
import { ActionRefusedError, readActionResult, type ActionResult } from './errors';

export { readActionResult, ActionRefusedError, type ActionResult } from './errors';

/**
 * The raw-path action primitive: POST `{[action]: payload}` to
 * `<endpoint>/<id>` under fresh auth, normalize the reply, REJECT with
 * ActionRefusedError on an inside-the-200 refusal. Argument-less actions
 * send `true` (django-mojo dispatches on the key's presence; handlers
 * treat a non-dict value as flag-only).
 *
 * Sends NO scope key, on any family (#5923): this is a REST record route, so
 * the server binds the row's own group, and a `group` in the body would be
 * saved as the row's `group` field. The call is declared `unscoped: true`, so
 * a registered-required family does not trip the dev tripwire.
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
        unscoped: true,
        // Read the refusal here, so the error names the action, not the path.
        refusal: 'return',
    }));
    const result = readActionResult(body);
    if (!result.ok) throw new ActionRefusedError(action, result);
    return result;
}
