# RecordFeed — record notes, assistant replies, and system history

```tsx
import {
    createTicketNoteAdapter,
    createIncidentHistoryAdapter,
    normalizeRecordFeedItem,
    recordFeedQueryKey,
    type RecordFeedAdapter,
    type RecordFeedItem,
    type RecordFeedPage,
} from 'portal-mojo/client';
import { RecordFeed } from 'portal-mojo/ui';
```

`RecordFeed` is the shared display and cache substrate for ticket comments,
incident history, assistant-authored notes, status changes, and plain system
activity. It has two deliberately separate ownership modes:

- **Adapter mode** owns a TanStack list query, POST mutation, and exact
  optimistic cache lifecycle.
- **Controlled mode** accepts `items` + `onSend`; a future streaming assistant
  can own its own state without pretending a stream is a django-mojo list.

Adapter mode supports one optional completed File reference. Controlled mode
keeps its existing `items`/`onSend(text)` contract and has no attachment policy;
specialized owners may place the shared `AttachmentQueue` in `composerAddon`.

## Adapter mode

```tsx
const adapter = useMemo(
    () => createTicketNoteAdapter(ticket.id, { groupId: ticket.group.id }),
    [ticket.id, ticket.group.id],
);

<RecordFeed
    adapter={adapter}
    currentUser={{ id: me.id, name: me.display_name ?? me.username }}
    currentUserId={me.id}
    variant="compact"
    attachmentUpload={{
        destination: { groupId: ticket.group.id, use: 'uploads' },
        expectedGroupId: ticket.group.id,
    }}
/>
```

Use `createIncidentHistoryAdapter(incidentId, {groupId})` for incident
history. Memoize the adapter for ordinary React hygiene; its query key is
structural and remains stable either way.

### Wire contract

Both adapters request only the latest window:

```text
GET /api/incident/ticket/note
GET /api/incident/incident/history

parent=<record id>
group=<optional active group id>
graph=default
sort=-created
start=0
size=100
```

django-mojo returns newest-first. The adapter normalizes those rows and
reverses the returned window for chronological display. Its result is:

```ts
interface RecordFeedPage {
    items: RecordFeedItem[]; // chronological
    count: number;           // full server count
    hasEarlier: boolean;     // count > returned rows
}
```

POST uses the same collection endpoint and `{parent, group, note, media?}` when the
adapter has a group (`group` is the bare ForeignKey primary key django-mojo's
generic REST saver consumes). Incident posts also carry `kind: 'comment'`.
`media` is a single positive completed File id and never replaces required note
text. Failed saves reject at the shared client boundary.

Every incoming `media` value is positively rebuilt to exactly
`{id, filename, content_type, category}` before domain sanitization,
normalization, optimistic cache replacement, or rendering. Unknown fields,
URLs, tokens, manager/provider details, transfer state, and browser `File`
objects cannot enter RecordFeed state.

The attachment queue has capacity/concurrency one. It is record-local,
deduplicated, and exposes real progress/cancel/retry/recover/remove actions.
Only a completed reference may be sent. Removal detaches queue state; it never
deletes the File. Permission loss, logout, or any parent/group/destination
change cancels and disposes the old queue.

Grouped records use the authoritative parent group and immutable
`{groupId, use:'uploads'}` initiation selectors. Groupless records send no
selector. Parent payloads currently expose no exact FileManager upload
capability, so the server resolves its authorized manager; the client then
requires the completed lifecycle response to carry a positive manager id and
the exact expected group before enabling association. A future parent contract
may expose an explicit manager/readiness capability without changing the safe
File-reference shape.

The cache key is always:

```ts
['record-feed', 'ticket-note' | 'incident-history', parentId, groupId ?? null]
```

That final group slot is not cosmetic. Two group contexts viewing the same
numeric record ID must never share a cache entry. Changing any adapter key
slot also remounts adapter mode so its composer draft, mutation/error state,
scroll position, and bottom-pin refs cannot leak into the next record.

## Author/type normalization

`normalizeRecordFeedItem(raw)` applies one strict precedence:

1. A **structured status change** with `metadata.type='status_change'` (or a
   `metadata.status_change` object) and a structured old/new value becomes
   `kind:'status'`.
2. `[LLM Agent]`, `kind:'handler:llm'`, or an explicit LLM handler/origin
   becomes `kind:'assistant'` — even if a modern row also embeds a user.
3. Legacy null-user action/context records become assistant notes.
4. Any remaining row with a user becomes `kind:'comment'`.
5. Everything else becomes `kind:'system'`.

Two negative rules matter:

- A null user alone **never means assistant**. Most automated history has no
  user and remains System.
- Prose is never regexed into a status transition. If old/new status is not
  structured, the row follows the remaining precedence.

`metadata` is normalized to a plain object. `raw` remains wire-shaped, but it
may be domain-sanitized. Sensitive domains pass `sanitizeRow` and
`sanitizeText`; the unsanitized failure-restoration draft remains only in a
component-local ref and never enters MutationCache.

## Exact optimistic lifecycle

Adapter mode permits one submit at a time and performs these operations on
the adapter's exact structural key:

1. Trim the draft; ignore empty/duplicate pending submits.
2. Clear the visible draft and cancel the exact in-flight query.
3. Snapshot the exact `RecordFeedPage`.
4. Append a client-only pending comment with a unique temporary ID.
5. On success, replace that exact temporary row with the normalized server
   row. The composer stays clear and regains focus.
6. On a deterministic failure, restore the snapshot. If no cache existed, remove the exact
   query instead of manufacturing stale state. Restore the exact submitted
   text, focus the composer, and surface the mutation error in `role=alert`.
7. On a lost/ambiguous response, retain the draft and completed candidate,
   mark delivery uncertain, and block blind replay while an authoritative
   refetch looks for a newly-created exact text/media row. A snapshot id can
   never satisfy reconciliation. If refetch also fails, changing the draft or
   detaching the candidate is the explicit escape.
8. In all cases, invalidate only that exact record/group key.

The input is disabled during the request, so no second draft can be lost or
silently overwritten by failure restoration.

## Controlled mode

```tsx
<RecordFeed
    items={messages}
    onSend={sendMessage}
    isSending={streamStarting}
    pending={streaming ? <Thinking /> : null}
    error={streamError?.message}
    variant="bubbles"
/>
```

The parent owns item append/replacement/streaming. `RecordFeed` still owns the
composer draft: it clears before awaiting `onSend`, restores the exact text on
rejection, focuses after either outcome, prevents concurrent submits, and
surfaces local rejection through the same alert region.

## Props

| Prop | Default | Meaning |
|---|---|---|
| `adapter` | — | Selects adapter mode. Mutually exclusive with `items/onSend`. |
| `items`, `onSend` | — | Select controlled mode. |
| `variant` | `'compact'` | `'compact'` admin activity or `'bubbles'` conversation layout. |
| `currentUserId` | — | Marks only matching **comments** as the current user's/right-side bubble. Assistant rows never become “mine.” |
| `currentUser` | `{id:currentUserId,name:'You'}` | Author stamped onto adapter-mode optimistic rows. |
| `renderAddon(item)` | — | ReactNode slot below a comment/assistant body for domain cards/actions. |
| `pending` | — | ReactNode after the list for thinking/streaming state. |
| `showInput` | `true` | Hide the composer for read-only history. |
| `disabled` | `false` | Disable sends while retaining history. |
| `attachmentUpload` | — | Adapter-only immutable destination and expected parent group; enables the singular queue. |
| `composerAddon` | — | Generic controlled-owner slot; RecordFeed itself assigns no attachment semantics. |
| `submitBlocked` | `false` | Blocks text submission while a specialized composer owner is not ready. |
| `placeholder` | `'Add a note…'` | Composer placeholder. |
| `sendLabel` | `'Send'` | Visible/accessibility send label. |
| `emptyLabel` | `'No activity yet.'` | Empty-state text. |
| `ariaLabel` | `'Record activity'` | Feed region label. |

## Rendering, keyboard, and scrolling

- Comment and assistant bodies use existing `<MarkdownView renderer="client">`.
  A feed never fans out one `/api/docit/render` request per row and never
  creates another HTML path.
- Status and system events are React nodes/plain text, not markdown.
- The scroll viewport is `role=log` with a semantic ordered list and polite
  addition/text announcements. Loading, pending, and failures have explicit
  status/alert semantics.
- Enter sends; Shift+Enter inserts a newline. Composition Enter is ignored via
  the native `isComposing` flag, so CJK/IME commits cannot accidentally send.
- The textarea grows to 144 px, then scrolls internally.
- The feed pins to bottom only on initial load, the viewer's own send, or an
  update received while already within 48 px of bottom. Reading older rows is
  never interrupted by background/streaming updates.

## Styling

Import `theme/record-feed.css` after the token declarations (the portal and
showcase theme aggregators already do). It uses only the mission-control
tokens and supports both `data-theme` values. Override the default bounded
height with `--record-feed-height` on a wrapper/component class.

## Pitfalls

- Do not use an endpoint-only query key; parent and group scope are required.
- Do not fetch ascending and take the first 100 — that returns the oldest
  window. Fetch descending, take 100, then reverse the returned window.
- Do not read attachment data from `raw.media`; use the positively rebuilt
  `item.attachment` reference.
- Do not classify every null-user row as assistant or parse status prose.
- Do not use server MarkdownView per row. Feeds use the secure React client
  renderer; richer domain UI belongs in `renderAddon` as ReactNode.
