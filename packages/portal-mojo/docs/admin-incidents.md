# Admin incidents and events

`IncidentsPage` and `EventsPage` extend the shared Security Operations section
at `security/incidents` and `security/events`; Tickets remain at
`security/tickets`.

## Permissions and contracts

Routes are global and system-pinned. View is `sys.view_security | sys.security`;
incident save, merge, protection, and history create use
`sys.manage_security | sys.security`; delete uses `sys.manage_security`.
Events remain immutable in this forensic UI, and event/history deletes are
denied by Django.

Lists allowlist parameters and force `graph=default`; graph-qualified detail
keys request `graph=detailed`. Both models search only `details`, hence “Search
incident details” and “Search event details.” Incident lifecycle is `pending`,
`new`, `open`, `investigating`, `resolved`, `closed`, `ignored`; `state` remains
separate and legacy `qa` is omitted. Events stay sorted by created time for
contiguous day groups and use the backend severity bands (8+ danger, 4+ warning).

## Merge and sanitization

Merge is one selection-wide call: choose one selected target and send every
other ID once. Django moves source events/tickets, writes target history, and
deletes sources. Source history is not reparented. Conflicting Maestro links
surface Django's 409 unchanged, and every non-cancelled attempt refetches.

Rows, history, optimistic notes, mutation variables, curated copy surfaces, and
exports pass through a recursive non-mutating sanitizer. It redacts normalized
secret keys, auth/header blocks, JWT/Bearer values, sensitive URL/form params,
and parsed bodies; evidence/traces are explicitly bounded. Heuristic redaction
cannot guarantee arbitrary opaque prose, so raw JSON is not rendered or
exported. `createSafeExporter` sanitizes before accumulation and projects only
declared fields.

Incident and event rows open the shared KISS `modal.detail` surface, composing
DetailView, StatusPanel, KnownFieldsCard, StackTraceView, and RecordFeed.
Incident→event and event→incident drill-ins stack a child detail modal; closing
the child reveals the parent. Ticket/rule/AI/network-response/dashboard controls
remain excluded. Bouncer discovery stays category-prefix plus MUID search
because its reporter writes MUID into incident details.

## Backend evidence

The contract was checked against django-mojo source rather than inferred from
the mock:

- `mojo/apps/incident/models/incident.py`: `Incident.RestMeta` search,
  permissions and graphs; `POST_SAVE_ACTIONS`; `Incident.on_action_merge`.
- `mojo/apps/incident/models/event.py`: `Event.RestMeta` search, permissions,
  graph, severity definition, and unsafe CSV metadata fields.
- `mojo/apps/incident/models/history.py`: `IncidentHistory.RestMeta`, including
  view/save clauses, JSON replacement and `CAN_DELETE = False`.
- `mojo/apps/incident/rest/event.py`: incident, history and event route mounts.

No disposable live Django records were available during this batch build, so
mutation evidence is source contract plus the focused mock verifier. A closing
live pass should remain read-only unless disposable incidents exist.
