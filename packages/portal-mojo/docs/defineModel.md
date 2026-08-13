# defineModel — typed model definitions + hooks

```ts
import { defineModel, type ModelDef, type ActionOutcome } from 'portal-mojo/client';
```

A model is a **stateless definition** — endpoint + permissions + forms +
actions — plus hooks bound to it. TanStack Query owns all data; there are
no model instances (web-mojo's `Model`/`Collection` classes end here).

```ts
export const UserModel = defineModel<User>({
    name: 'user',
    endpoint: '/api/user',
    permissions: { view: ['users', 'view_users'], manage: ['users', 'manage_users'] },
    forms: { create: { title: 'Add user', submitText: 'Create', fields: [/* Field[] */] } },
    actions: {
        disable: { permissions: ['users', 'manage_users'] },   // response: 'row' (default)
        revoke_sessions: { response: 'payload' },              // action-specific body
    },
});
```

`T` must extend `{ id: number | string }`.

## Hooks & helpers on the returned def

| Member | Behavior |
|---|---|
| `useList(params?, {enabled?})` | `useQuery` list under key `[endpoint, params]` with `keepPreviousData`; `enabled:false` suppresses permission-hidden background reads |
| `useOne(id \| null)` | one record, key `[endpoint, 'one', id]`; disabled while `id` is null |
| `useSave()` | mutation `{id, changes}`; `id: null` creates. Handles one fresh-auth 440/retry, then writes the returned row into the one-record cache and invalidates `[endpoint]`. REJECTS on failure |
| `useDelete()` | mutation `{id}`; removes the one-record cache entry + invalidates |
| `useAction(name)` | mutation for ONE declared POST_SAVE_ACTION (below), with one fresh-auth 440/retry. THROWS at render time for an undeclared name |
| `fetchOne(queryClient, id)` | imperative fetch through the same cache key — dedupes with mounted `useOne`s (prefetch pattern) |
| `invalidate(queryClient)` | invalidate everything under `[endpoint]` |
| `keys.root / keys.list(params) / keys.one(id)` | key builders for targeted cache surgery |

Cache keys are shared with the generic hooks (`useModelList`, `useModel`),
so `ModelTable` and model hooks read/invalidate one cache.

Save/action mutation functions use `withFreshAuth` globally. Their original
variables and declared response mode survive the retry, and cache updates run
only on final success. Delete remains unwrapped, as do direct `mojoCall`
mutations; callers opt those in only when the endpoint is both sensitive and
safe to retry once.

## POST_SAVE_ACTIONS

Backend contract (`mojo/models/rest.py on_rest_save`): an action is a key
in the save body — `POST endpoint/<id>` `{disable: {reason, note}}`. Plain
fields in the same body save first, then `on_action_<key>(value)` runs.
The response is either the refreshed row (handler returned nothing) or an
action-specific payload. **Which one is DECLARED, never sniffed:**

- `response: 'row'` (default) → `ActionOutcome.row` is the refreshed record
  (written through to the cache).
- `response: 'payload'` → `row` is null; read `outcome.result.payload`
  (e.g. `result.payload.message` for `revoke_sessions` — toast the
  server's text). `outcome.body` remains the raw unwrapped envelope.

Invoke: `await disableAction.mutateAsync({ id, payload: { reason: 'abuse' } })`.
`payload` defaults to `{}`; handlers treat the value as a dict. Errors
(e.g. `"reason must be one of: abuse, admin"`) REJECT with the server's
message.

## Action refusals

django-mojo action handlers can refuse **inside an HTTP 200**. The reply
reaches the client in one of two wire shapes:

```jsonc
{"success": false, "code": "ALREADY_DISABLED", "error": "…"}          // flat (JsonResponse verbatim)
{"status": true, "data": {"success": false, "code": "…", "error": "…"}} // wrapped (save-and-respond)
```

This is NOT the envelope failure: envelope-level `status:false` already
rejects at the unwrap boundary (`MojoError`). The action-refusal layer sits
above it and is handled by `useAction` automatically:

- **`refusal: 'reject'` (default)** — a `success:false` (or payload
  `status:false`) reply REJECTS with **`ActionRefusedError`**, so a refusal
  can never read as done. The error extends `MojoError` with `status: 200`
  (the HTTP layer succeeded — the HANDLER said no), `message` = the server's
  `error` text, `errorCode` = the semantic refusal `code`, and
  `result`/`data` = the merged payload (may hold evidence such as the
  current row state). Call sites need only their ordinary
  `catch (err) { toast.error(err.message) }`.
- **`refusal: 'return'`** — declare this when the flag is a DIAGNOSTIC
  RESULT, not a refusal (e.g. a connection test answering
  `{success, key_count}`). The mutation resolves either way; read
  `outcome.result` (`{ok, code, error, payload}`). Declared, never sniffed.

`ActionOutcome.result` is the normalized reply for every action:
`result.payload` merges the envelope with the action dict (action fields
win), so one-shot secrets and counters read from one place regardless of
which wire shape arrived. For `refusal:'reject'` actions `result.ok` is
always `true` on the resolved path — a refusal already rejected.

Oddball: `User.revoke_sessions` spells the flag `status` inside its payload
(`{status: true, message}` on success). Only `status === false` refuses, so
its truthy success value — and payloads with no flag at all — resolve
normally.

## Pitfalls

**FK fields are graph-shaped.** The backend controls graph definitions, so
an FK field your UI reads as a scalar (`row.currency === "GC"`) can start
arriving expanded (`{id, code, name, …}`) — or as the bare pk — when a
graph changes. Render such fields through `fmt.code(value)` or a `render`
callback that handles all three shapes; never hand the raw field to JSX.
The shared primitives degrade instead of crashing (`safeNode`/`RenderGuard`),
but app JSX outside them is unguarded.

- Don't build a second store around these hooks — pages read query state.
- The action-name union isn't typed; an undeclared name throws in dev the
  first time the hook renders (fail loud, not a 404 later).
- UI `permissions` on the def are affordance gates for `useCan`; the server
  re-checks every request.
