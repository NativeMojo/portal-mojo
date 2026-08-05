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
| `useList(params?)` | `useQuery` list under key `[endpoint, params]` with `keepPreviousData` |
| `useOne(id \| null)` | one record, key `[endpoint, 'one', id]`; disabled while `id` is null |
| `useSave()` | mutation `{id, changes}`; `id: null` creates. On success writes the returned row into the one-record cache, then invalidates `[endpoint]`. REJECTS on failure |
| `useDelete()` | mutation `{id}`; removes the one-record cache entry + invalidates |
| `useAction(name)` | mutation for ONE declared POST_SAVE_ACTION (below). THROWS at render time for an undeclared name |
| `fetchOne(queryClient, id)` | imperative fetch through the same cache key — dedupes with mounted `useOne`s (prefetch pattern) |
| `invalidate(queryClient)` | invalidate everything under `[endpoint]` |
| `keys.root / keys.list(params) / keys.one(id)` | key builders for targeted cache surgery |

Cache keys are shared with the generic hooks (`useModelList`, `useModel`),
so `ModelTable` and model hooks read/invalidate one cache.

## POST_SAVE_ACTIONS

Backend contract (`mojo/models/rest.py on_rest_save`): an action is a key
in the save body — `POST endpoint/<id>` `{disable: {reason, note}}`. Plain
fields in the same body save first, then `on_action_<key>(value)` runs.
The response is either the refreshed row (handler returned nothing) or an
action-specific payload. **Which one is DECLARED, never sniffed:**

- `response: 'row'` (default) → `ActionOutcome.row` is the refreshed record
  (written through to the cache).
- `response: 'payload'` → `row` is null; read `outcome.body` (e.g.
  `body.message` for `revoke_sessions` — toast the server's text).

Invoke: `await disableAction.mutateAsync({ id, payload: { reason: 'abuse' } })`.
`payload` defaults to `{}`; handlers treat the value as a dict. Errors
(e.g. `"reason must be one of: abuse, admin"`) REJECT with the server's
message.

## Pitfalls

- Don't build a second store around these hooks — pages read query state.
- The action-name union isn't typed; an undeclared name throws in dev the
  first time the hook renders (fail loud, not a 404 later).
- UI `permissions` on the def are affordance gates for `useCan`; the server
  re-checks every request.
