# Admin Assistant

Import from `portal-mojo/admin`.

`ASSISTANT_ADMIN_SECTION` registers Conversations, Skills, and Memory beneath the Assistant navigation group. Its section clause is global-only ANY-of `sys.view_admin` or `sys.assistant`; Memory narrows its route to `sys.assistant`, matching the backend. Active-group grants never reveal it. `AssistantLauncher` uses the section gate. `AssistantContextLauncher` additionally requires `sys.view_security` or `sys.security` and only accepts `incident.Incident` or `incident.Ticket`.

## REST contract

- `POST /api/assistant` sends `{message, conversation_id?}`. The controlled `AssistantFeed` permits one request at a time, shows only the generic “Responding…” state, and consumes the final response. There is no polling, cancellation, progress, tool trace, websocket, or streaming path.
- `POST /api/assistant/context` sends only `{model, pk}`. The returned conversation id is immediately fetched from `/api/assistant/conversation/<id>?graph=detail`; the client never synthesizes or reposts context text.
- Conversation and Skill lists/details/deletes are imperative and component-local. They do not use `defineModel`, Query cache, `ModelTable`, a `RecordFeed` adapter, persistence, or exports.
- A foreign conversation visible to an administrator is inspect-only. Only `conversation.user.id === me.id` enables continuation.

`AssistantFeed` uses controlled `RecordFeed`. It positively projects only user and final assistant messages. Structured blocks have per-type schemas and caps; unknown/malformed blocks drop. File buttons reuse Storage's capability-URL policy. Context references are inert and allowlisted. Action choices require confirmation, then their bounded `value` is sent once through the ordinary chat POST.

## Memory

Global and user tiers require the global Assistant grant. Group memory first chooses from a bounded normal `/api/group` request and supplies that id as normal request context (`?group=<id>`). A group id is never put in the memory body and ambient group state is never consulted. Keys are limited to 64 lowercase alphanumeric/colon/underscore/hyphen characters; values are limited to 500 characters.

## Shell ownership

The production Admin shell mounts exactly one `RightPanelProvider` and one `RightPanelSlot`. Permission loss or logout closes and unmounts Assistant content. Incident and Ticket record details remain KISS modals; their Assistant buttons only create the separate Assistant panel session.
