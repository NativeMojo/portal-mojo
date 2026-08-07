# Admin Assistant

Import from `portal-mojo/admin`.

`ASSISTANT_ADMIN_SECTION` registers Conversations, Skills, and Memory beneath the Assistant navigation group. Its section clause is global-only ANY-of `sys.view_admin` or `sys.assistant`; Memory narrows its route to `sys.assistant`, matching the backend. Active-group grants never reveal it. `AssistantLauncher` uses the section gate. `AssistantContextLauncher` additionally requires `sys.view_security` or `sys.security` and only accepts `incident.Incident` or `incident.Ticket`.

## Conversation transport

- An owned, text-only conversation uses realtime only when the shared transport
  is authenticated and the caller locally has `sys.view_admin`, matching the
  WebSocket handler's narrower server check. The client sends exactly
  `{type:'assistant_message',message,request_id,conversation_id?}`, with a fresh
  canonical UUID per turn. A caller with only
  `sys.assistant`, any send with attachments, an unavailable socket, and a
  foreign inspect-only conversation stay on REST. Messages are never
  auto-resubmitted across paths.
- `POST /api/assistant` sends `{message, conversation_id?, attachments?}`.
  `attachments` is omitted for text-only sends or contains 1–5 unique positive
  ids from completed authoritative queue references.
- Realtime accepts these Assistant event shapes only as exact direct frames;
  topic-wrapped or broadcast Assistant-shaped traffic is ignored. It positively
  projects only `assistant_thinking`, `assistant_text`,
  `assistant_tool_call`, `assistant_plan`, `assistant_plan_update`,
  `assistant_response`, and `assistant_error`. Thinking, text, tool, plan,
  update, response, and error events require the exact `request_id` sent for
  the active turn. Non-error events also require a positive `conversation_id`;
  an error may omit only the conversation id. Tool state retains
  bounded name/status/count only; raw input and the terminal `tool_calls_made`
  list never enter UI state, caches, logs, or mock observations. Plans omit
  tool inputs. Terminal duplication is checked only with the backend's
  authoritative `message_id` (never a guessed local id).
- A disconnect for a known conversation waits for reauthentication, then
  reconciles from `/api/assistant/conversation/<id>?graph=detail`. A disconnect
  during the first send before `assistant_thinking` supplies a conversation id
  is explicitly **outcome unknown**: the conversation list is refreshed, the
  optimistic message remains visibly uncertain, and the client never resends
  or guesses a conversation. Server-side permission revocation remains
  authoritative but can only be observed by the socket on a handled request or
  reconnect; locally observed permission loss immediately clears this
  consumer's transient stream/subscriptions without disabling the shared
  provider.
- Direct-source binding and the echoed `request_id` jointly isolate concurrent
  turns, including turns in the same conversation. Missing or mismatched IDs
  are ignored; if no correlated acknowledgement arrives within ten seconds,
  the outcome is marked unknown, the list is refreshed, and the send is never
  retried automatically.
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

The production Admin and showcase auth roots each mount one generic
`RealtimeProvider`; it is auth-owned, not `sys.view_admin`-owned. The production
Admin shell still mounts exactly one `RightPanelProvider` and one
`RightPanelSlot`. Permission loss or logout closes and unmounts Assistant
content. Incident and Ticket record details remain KISS modals; their Assistant
buttons only create the separate Assistant panel session.
