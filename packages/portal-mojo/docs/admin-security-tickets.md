# Admin Security Tickets

`SECURITY_OPERATIONS_ADMIN_SECTION` adds the mount-relative `security/tickets` route to the shared admin registry. Consumers normally mount it through `ADMIN_SECTIONS`; direct imports are available from `portal-mojo/admin`.

## Permissions

The section and route use `sys.view_security` or `sys.security`. Mutating controls require `sys.manage_security` or `sys.security`; delete uses `sys.manage_security`. Assignee lookup is offered only with `sys.view_users`, `sys.manage_users`, or `sys.users`. These are UI gates only—the server remains authoritative for every request.

## Wire contracts

- Ticket collection/detail: `/api/incident/ticket`. List state uses the standard Django lookups, graph relations, paging, sorting, search, and `download_format=csv|json`. Saves accept title, description, arbitrary status/category strings, integer priority 1–10, and a nullable assignee ID.
- Notes: `/api/incident/ticket/note`, always scoped with the ticket `parent` and, for grouped tickets, the ticket's own `group`. A status save creates a structured note with `metadata.type=status_change`, `old_status`, and `new_status`.
- Ticket actions: detail POST bodies use `enable_llm`, `disable_llm`, or `push_to_maestro`. Push success means queued, not linked.
- Maestro links: `/api/incident/maestro/item-link?ticket=<id>`. The panel polls for at most 30 seconds after a queued push and always offers a manual check.

Unknown status/category values are appended to the known UI options and are never coerced away. Relation values may be a graph object, a bare ID, or null.

## Cache and approval boundaries

Every ticket mutation invalidates the Ticket model root, the record-scoped TicketNote feed prefix, and Maestro link lists. Approval and denial are new TicketNote rows with `metadata.action_response`. The response copies the pending action's `handler` and `context` without reconstructing or exposing editable JSON. Unknown handlers render a generic informational action card; the client never executes handler-specific navigation or code.

Resolved actions, terminal tickets, missing manage permission, and in-flight responses disable approval controls. The server still owns replay protection and handler authorization.

## Panel behavior

Ticket titles are real buttons and open the shared non-modal `RightPanel` without changing the current route or table params. The panel fetches the authoritative detail row, restores focus on close, and remains mounted during route-like shell rerenders. `RecordFeed` uses compact mode and receives `showInput={canManage}`.

Attachments/media, Assistant chat, and incident-detail navigation remain deferred. Raw feed media is not rendered, and a remote Maestro URL becomes a link only when it parses as HTTP or HTTPS.
