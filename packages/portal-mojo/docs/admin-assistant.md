# Admin Assistant

Import from `portal-mojo/admin`.

`ASSISTANT_ADMIN_SECTION` registers Conversations, Skills, and Memory beneath the Assistant navigation group. Its section clause is global-only ANY-of `sys.view_admin` or `sys.assistant`; Memory narrows its route to `sys.assistant`, matching the backend. Active-group grants never reveal it. `AssistantLauncher` uses the section gate. `AssistantContextLauncher` additionally requires `sys.view_security` or `sys.security` and only accepts `incident.Incident` or `incident.Ticket`.

## REST contract

- `POST /api/assistant` sends `{message, conversation_id?, attachments?}`. `attachments` is omitted for text-only sends or contains 1–5 unique positive ids from completed authoritative queue references. The controlled `AssistantFeed` permits one request at a time, shows only the generic “Responding…” state, and consumes the final response. There is no polling, tool trace, websocket, or streaming path.
- `POST /api/assistant/context` sends only `{model, pk}`. The returned conversation id is immediately fetched from `/api/assistant/conversation/<id>?graph=detail`; the client never synthesizes or reposts context text.
- Conversation and Skill lists/details/deletes are imperative and component-local. They do not use `defineModel`, Query cache, `ModelTable`, a `RecordFeed` adapter, persistence, or exports.
- A foreign conversation visible to an administrator is inspect-only. Only `conversation.user.id === me.id` enables continuation.

`AssistantFeed` uses controlled `RecordFeed` plus the shared attachment queue at
capacity five. Its immutable groupless destination sends no manager/group/use
selector. Partial upload batches retain completed references alongside
failed/retryable rows; only completed ids are sent atomically with required
text. Cancel/retry/recover/remove are real queue actions, duplicate local files
collapse, and successful sends alone clear completed candidates. Permission
loss, logout, owner/conversation change, or unmount disposes outstanding work.

User history accepts only `type:'attachment'` blocks and positively rebuilds
each File to `{id,filename,content_type,category}` before state/render. These
chips have no URL or download action: they are metadata references and do not
auto-ingest File contents. Assistant-generated `type:'file'` blocks remain a
separate URL-bearing download-card schema. Other structured blocks retain their
per-type schemas/caps; unknown/malformed blocks drop. Context references are
inert and allowlisted. Action choices require confirmation, then their bounded
value is sent attachment-free through the ordinary REST POST.

## Memory

Global and user tiers require the global Assistant grant. Group memory first chooses from a bounded normal `/api/group` request and supplies that id as normal request context (`?group=<id>`). A group id is never put in the memory body and ambient group state is never consulted. Keys are limited to 64 lowercase alphanumeric/colon/underscore/hyphen characters; values are limited to 500 characters.

## Shell ownership

The production Admin shell mounts exactly one `RightPanelProvider` and one `RightPanelSlot`. Permission loss or logout closes and unmounts Assistant content. Incident and Ticket record details remain KISS modals; their Assistant buttons only create the separate Assistant panel session.
