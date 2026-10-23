# Admin Assistant

Import from `portal-mojo/admin`.

`ASSISTANT_ADMIN_SECTION` registers Setup, Conversations, Skills, and Memory beneath the Assistant navigation group. Its section clause is global-only ANY-of `sys.view_admin` or `sys.assistant`; Memory narrows its route to `sys.assistant`, matching the backend. Active-group grants never reveal it. `AssistantLauncher` uses the section gate. `AssistantContextLauncher` additionally requires `sys.view_security` or `sys.security` and only accepts `incident.Incident` or `incident.Ticket`.

## AI Assistant setup

`AssistantSetupPage` is a dedicated global owner page at `/assistant/setup`, or
`/system/assistant/setup` when the Admin helpers receive `mount: '/system'`.
The literal `me.is_superuser === true` requirement applies before lazy loading,
in grouped and ordinary menu entries, landing selection, direct component
mounting and every action. Permission-driven `admin`, `manage_settings`,
Assistant permissions and member/group grants cannot satisfy it. The server
also rejects confined ApiKey/GroupScopedToken sessions and enforces person
ownership; the client does not invent a broader per-user-key ban.

The page separates **AI Assistant** from **MCP connections** with two task
tabs. AI Assistant is the built-in provider-backed chat and incident processing;
MCP serves tools to external agents that bring their own AI. MCP does not
require an Assistant provider key, model selection, policy acknowledgement or
enabled chat switch. The MCP tab shows its address, independent access switch,
public discovery check and connections directly; AI readiness warnings remain
in the AI tab. Ordinary reads probe neither provider nor public discovery.

The AI tab starts with a compact status overview: the enabled switch, current
provider/model and selected connection, followed by Safety & usage and Incident
triage. Configure model and Manage keys open focused native dialogs. The API
keys dialog separates Assistant and Platform keys with two task tabs; Safety &
usage separates Policy & stops from Usage & recovery. Incident triage is a
direct dialog. Keyboard-accessible info icons hold catalogue metadata,
credential explanations, policy/admission diagnostics, connection dates and
the triage watermark. Errors, failed checks, emergency stops and operation
consequences stay visible beside their actions. No expandable sections or
single-item side navigation are used.

A configured key and enabled switch do not prove readiness. `route.ready`
describes configuration, not current provider health. Unknown routes remain
unknown: a missing credential can cause the backend to omit the entire route.
A handler route opens Manage keys on Platform key. Bedrock uses deployment AWS
identity; the key dialog explains that browser keys cannot configure it.
Assistant, Platform and AWS credentials never substitute for one another.
Missing Assistant/realtime applications are reported. Runtime model identifiers
preserve provider punctuation, including Bedrock colons; only a manual pin uses
the backend's restricted pin syntax.

Policy activation acknowledges the deployed policy on this node, does not edit
it and never establishes fleet-wide agreement. Static, database and effective
emergency stops are separate; only the database switch is writable. Activation
and breaker reset cannot release a stop. Destructive and consequential actions
use a nested confirmation, initially focused on Cancel. During an operation,
repeat submission, task tabs and native Escape/backdrop/close are locked. Cancel
returns to the task without making a request. Closing a task or changing key
types clears unsaved secret drafts; reopening model selection restores the
saved value. All dialogs unmount with the owner/session boundary.

Model selection controls the protected runtime selection only when the backend
returns a valid capability for the explicit Anthropic `auto:sonnet` policy.
Fixed Anthropic policies, Bedrock and unavailable policies remain read-only.
A deployment pin permits an owner manual override, but Automatic remains
unavailable until deployment removes that pin. Mode is authoritative even when
a fixed route retains an inert legacy `selected` value.

The exact resolved runtime identifier (`model.effective`) and source are
separate from the selection draft and `route.ready`. Safety & usage → Policy & stops → the Deployed policy info icon contains the raw policy model and admission diagnostic. The additive
`route.can_invoke` reports admission to the guarded request path: a cold
automatic catalogue can admit a request while configuration readiness remains
false. It does not prove that a usable model or healthy provider is ready.

Refresh catalogue is an explicit backend request; only the backend contacts the
provider. The browser never decides which model is newest. A refresh announces
success only for `model.refresh.ok === true`, including when a manual pin
remains selected. Failed/throttled/in-flight attempts may retain a fresh or
stale cached resolution; the page reports its exact freshness, last successful
fetch and attempt without claiming a newer model. Passive reads neither refresh
the catalogue nor repeat the preceding explicit refresh outcome.

Check public discovery explicitly probes this installation's public address
(server cache: 60 seconds). Ordinary page reads trigger neither probe.

Both credential drafts and all setup operations stay imperative and page-local.
There is no autosave, model definition, Query/Mutation entry, browser
persistence, export, URL value or secret-bearing mock history. The backend
checks a replacement before encrypted storage; a candidate-only verification
never updates the stored-key check record. Successful credential saves and
clears empty the relevant draft. Clearing protected storage may reveal a
deployment fallback, so the returned source remains authoritative. Fixed
backend pre-write rejection/unreachable messages map to safe actionable copy;
unknown failures refresh authoritative state and report an uncertain outcome
without replaying the operation.

One operation/confirmation lock, AbortSignal and live owner/session guard cover
loads, confirmations, auth waits and late responses. Leaving the page,
revocation, logout or explicit session replacement discards drafts and pending
work. Ordinary same-tab token renewal preserves a draft. Cross-tab auth-storage
changes conservatively discard it: the shared auth API cannot distinguish
renewal from same-person replacement across tabs. A 440 uses the existing
fresh-auth UI after clearing credential drafts; even successful reauthentication
requires explicit re-entry/retry. No secret is silently replayed. Confirmation
is a page-owned native dialog, focuses Cancel, and ends with the page/session scope.

Protocol helpers are exported from `portal-mojo/admin/assistant`:
`getAssistantSetup(options, probe?)`, `mutateAssistantSetup(action, options)`,
`assistantSetupSave(state, changes)`, `projectAssistantSetup`,
`assistantSetupReadiness`, and `assistantSetupCredentialRefusal`. Options accept
`signal` and a `beforeSend` validity guard; mutation helpers enforce same-origin
before and after auth preflight and use the existing `mojoCall` envelope boundary.
`schema_version: 2` responses are positively projected with bounds of 200
model choices/connections/request aggregates and 100 breaker rows. Runtime IDs
preserve provider punctuation; only manual pins use the backend's restricted
81-character lowercase alphanumeric/dot/hyphen syntax.

The additive wire fields live directly under `model`: `mode` (`auto`, `pinned`,
`fixed`), `editable`, `policy_model`, `restriction` (empty, `fixed_policy`,
`provider_unsupported`, `deployment_pin`, `policy_unavailable`), `discovery`
(`status`: `fresh`, `stale`, `unavailable`, `not_applicable`; nullable ISO
`fetched_at`, `attempted_at`, `expires_at`, `max_stale_at`; safe `error_code`),
and `refresh` (`attempted`, nullable boolean `ok`, safe `code`). The client
positively projects the complete valid set into optional `model.capability`.
Absent, malformed or unknown capabilities keep runtime facts visible, with
upgrade/read-only copy and no enabled selection action. No latest ID ships in
the production UI; returned bounded choices supply the datalist.

| Request | Exact body / query |
|---|---|
| Passive GET `/api/account/admin/assistant` | No probe parameters |
| Explicit catalogue / discovery GET | `refresh=models` / `check=discovery` |
| Save POST | `{action:'save',enabled:boolean,model?:string}` plus only intended optional `api_key`, `clear_api_key`, `handler_api_key`, `clear_handler_api_key`, `mcp_enabled`, `emergency_stop`, `autonomous_triage` |
| Model selection POST | Exactly `{action:'set_model_selection',mode:'auto'}` (no `model`) or `{action:'set_model_selection',mode:'pinned',model:ID}`; `saved:boolean` |
| Verify POST | `{action:'verify',target:'assistant'|'handler',api_key?}`; omitted candidate checks that exact stored credential |
| Policy POST | Exactly `{action:'activate_policy'}`; `activated:boolean` |
| Breaker POST | `{action:'reset_breaker',provider?:'anthropic'|'bedrock'}`; `reset:number` |
| Historical triage POST | Exactly `{action:'historical_triage',before:ISO,limit:1..100}`; `queued:number` |
| Disconnect POST | Exactly `{action:'revoke_grant',grant_id:positiveInteger}` or `{action:'revoke_all_grants'}`; `revoked:number` |

Every mutation returns fresh `state` plus the action result. Verification may
return `result.ok:false` in a successful envelope; that remains a failed check.
Save always sends authoritative `enabled`. With a valid capability it omits
`model` and cannot reset runtime selection; only the dedicated selection action
can change it. Capability-absent older schema-2 servers retain the required
`enabled`/legacy `model` baseline because they write both even when omitted.
On delegated `auto:sonnet` routes, new servers reject a differing legacy model
echo, preventing stale clients from reverting the active choice. Fixed policies,
Bedrock and unavailable-policy routes retain an inert legacy writer; these
values cannot change their deployed runtime model. Model actions carry no
enabled/key/stop/MCP/triage fields, and all selection drafts reset from each
authoritative response. Optional section switches are not
echoed during unrelated saves, and effective stop is never used as the database
stop. Replacement and clear are separate operations. The server retains its
600-second fresh-auth, protected settings, auditing and same-origin checks;
generic Settings still cannot write the Assistant-owned protected keys.

Remote access off pauses existing grants without revoking them. The connection
count remains the full server count when rows are capped at 200. Tools, Full API
and combined grants are labeled separately; Full API carries the signed-in
user's API authority. Disconnect all spans both resource paths for every user.
Returned addresses are inert text/read-only select-to-copy inputs. Triage
activation establishes the no-history watermark; historical processing requires
an explicit cutoff, bounded limit and confirmation.

The mock-only Assistant showcase adds Setup with explicit fake owner/denied
permission-admin buttons, a one-shot fresh-auth challenge button, and ready, missing policy/key, handler, Bedrock, static
stop, rejected key, discovery failure, bounded-grants and deployment-fallback
scenarios. Model scenarios include manual pins, fixed policy, deployment pin
(including an owner override), fresh/stale refresh failure, unavailable
resolution, throttled/in-flight refresh, old-server capability absence and
malformed capability. `fixture-sonnet-2099-01` and `fixture-sonnet-2099-02` are
visibly fake future IDs; explicit catalogue refresh advances the fake catalogue,
preserves manual pins, and returning to Automatic adopts the successor. Seeded `assistant.owner@nativemojo.com` is a literal superuser;
`assistant.wildcard@nativemojo.com` has permission-driven admin only. Both use
fake password `mojo`. No real credentials or deployment changes belong in demos.
`verify:admin-assistant-setup` covers wire contracts, owner navigation/admission,
projections and mounted auth/draft/confirmation/fresh-auth/transport/cache
lifecycle; it is wired into `verify:release`. Browser checks separately establish
both-theme layout, native dialogs, help popovers, keyboard controls and console behavior.

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
- Conversation and Skill lists/details are imperative and component-local.
  Built-in Delete controls are absent. Skill deactivation/reactivation requires
  `sys.view_admin` and reloads authoritative state; conversations retain history. They do not use `defineModel`, Query cache, `ModelTable`, a `RecordFeed` adapter, persistence, or exports.
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
