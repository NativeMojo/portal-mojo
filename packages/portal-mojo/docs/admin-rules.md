# Rule Engine admin

Import models, routes, transforms, and the builder from `portal-mojo/admin`:

```tsx
import {
  RuleSetModel, RuleModel, HandlerChainBuilder,
  parseHandlerChain, runtimeEffectiveHandlerChain,
} from 'portal-mojo/admin';
```

The shared Security Operations section mounts the `rules` table after Tickets,
Incidents, and Events. Selecting a RuleSet opens its DetailView through the
shared KISS `modal.detail` surface; there is no `rules/:id` child route, so the
table URL and query state remain unchanged. The mount-relative table works at
`#/security/rules` in the standalone Admin and `#/system/security/rules` when
embedded. Reads require
`sys.view_security|sys.security`; mutations require
`sys.manage_security|sys.security`. These are system-pinned clauses: active
group grants do not satisfy them, and the server remains authoritative.

## Wire models and safety boundary

`RuleSetModel` uses `/api/incident/event/ruleset`; `RuleModel` uses
`/api/incident/event/ruleset/rule`. Row types intentionally remain open and
fetched rows are not reconstructed, so future top-level fields, metadata,
enum values, comparators, and value types remain in TanStack Query unchanged.

Rule-set creation always sends `is_active:false`, regardless of form input.
An empty active RuleSet is a category catch-all and can preempt later
priorities, so enabling a zero-condition set is a separate warning that names
its category and priority. The create defaults are priority 10, ALL matching,
SOURCE_IP bundling for 30 minutes, and an empty handler. `bundle_minutes=0`
disables time bundling; `null` means the current backend's unbounded window.
Count thresholds require effective bundling, trigger/retrigger windows require
a count, and a finite trigger window cannot exceed the finite bundle window.

Rule transforms reject leading-underscore fields and validate integer/float
comparison values. Existing `bool` rules are visible and preservable, but
creating or changing a bool comparison is blocked: the backend currently
applies Python `bool()` to stored strings, so the string `"false"` is true.

## Handler grammar and preservation

Supported runtime schemes are `job`, `email`, `sms`, `notify`, `block`,
`ticket`, `maestro`, `llm`, and `resolve`. Notification targets may contain
commas (`perm@…`, `protected@…`, usernames). The editor recognizes a chain
boundary only at comma + URI scheme, preserving target commas.

There are deliberately two projections:

- The editor projection exposes any URI scheme so unsupported content is
  visible and movable/removable only by explicit operator action.
- The runtime-effective projection exactly mirrors django-mojo's split:
  comma immediately followed by a *known* scheme. Leading unknown segments
  are skipped; unknown or whitespace-prefixed segments after a known handler
  can be swallowed into that handler's spec. The builder warns about both.

Every step retains its raw bytes and preceding separator. Parsing then
serializing an untouched chain is byte-for-byte exact. Structured changes are
surgical: ordered query entries and unknown parameters remain, duplicate keys
remain, and the first duplicate is the runtime-effective value that edits
target. Moving/editing/removing skipped or swallowed content requires an
explicit high-severity behavior-change confirmation. An empty string is valid:
the incident is recorded and no action is dispatched.

Handler order is publication/dispatch order. Jobs run asynchronously, so the
UI does not promise completion order. Structural validation covers URI shape,
percent encoding, required targets/module paths, integer/range values, blank
parameter keys, and resolve statuses. It cannot prove target or permission
existence, job importability, Maestro board existence, runtime settings, or
Python regex semantics; failed server mutations reject visibly and leave the
editor open.

## Reordering limits

The whole handler chain is one RuleSet text field, so a chain edit/reorder is
one atomic save. RuleSet priorities and child Rule indexes are separate rows;
django-mojo exposes no atomic multi-row reorder action and `CAN_BATCH` is
false. Drag reorder is therefore absent. Operators edit one numeric value at
a time, and duplicate priorities/indexes are flagged because tie order is
undefined.

The showcase demo is under **Admin → Rule Engine** and includes supported
steps, notification target commas, duplicate/extra parameters, unsupported
content, structural errors, move/remove actions, exact raw serialization, and
the empty-chain case.
