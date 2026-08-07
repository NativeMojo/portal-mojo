# File upload UX

```tsx
import {
    FileDropZone, FilePicker, UploadQueue, useUploadQueue,
    validateFileSelection,
} from 'portal-mojo/ui';
```

The UI layer composes the imperative transport documented in
[`client.md`](client.md). It does not replace the server contract: browser
validation is convenience only, and every accepted file still passes through
django-mojo's initiate → byte transfer → authoritative reconciliation flow.

Live examples: portal → Develop → Components → **File upload**. The Showcase
transport and progress fixture live only in its demo module; package consumers
use the real client by default.

## Selection controls

```tsx
const selected = ({ accepted, rejected }: FileSelectionResult) => {
    queue.add(accepted);
    rejected.forEach((item) => toast.warning(item.message));
};

<FileDropZone
    accept={['image/*', '.pdf']}
    maxFileSize={10_000_000}
    maxFiles={4}
    onSelection={selected}
/>

<FilePicker accept=".csv,text/csv" multiple onSelection={selected}>
    Import CSV
</FilePicker>
```

`validateFileSelection(files, rules)` is pure. It returns ordered `accepted`
and `rejected` arrays and never uploads. `accept` supports exact MIME types,
MIME wildcards, and extensions. `maxFileSize` is bytes; `maxFiles` applies to
one picker/drop gesture.

Both controls are native buttons. The hidden input is a sibling, so the DOM
does not nest interactive controls. The picker clears its input after every
change, allowing the same file to be chosen twice in separate gestures.
`FileDropZone` also installs a reference-counted window guard while mounted:
file drags cannot navigate the tab when dropped outside the zone, while text,
links, and other non-file drags retain normal browser behavior.

`useFileDrop(options)` exposes the same behavior for a custom native control:

```tsx
const { isDragActive, dropProps } = useFileDrop({ onSelection: selected });
return <button type="button" {...dropProps}>{isDragActive ? 'Drop' : 'Attach'}</button>;
```

## Queue

```tsx
const queue = useUploadQueue({
    consumerKey: 'ticket-attachments',
    destination: { use: 'support', groupId },
    async onComplete(file, { signal }) {
        await attachFileToTicket(file.id, { signal });
    },
});

<FileDropZone onSelection={({ accepted }) => queue.add(accepted)} />
<UploadQueue queue={queue} />
```

Defaults are concurrency **3** and capacity **6**. Files enter a FIFO and the
transport task is not created until a slot opens; selecting six files never
starts six initiate requests. The queue belongs to the mounted component—no
local/session persistence and no TanStack Query cache. StrictMode's probe
unmount is tolerated, but a real unmount aborts tasks and callbacks, removes
progress cards, unsubscribes observers, and drops retained `File` references.
An authenticated queue also disposes immediately if its auth UID changes or
the session signs out.

The queue deduplicates on consumer + normalized destination + file metadata.
Use a stable `consumerKey` for the owning form/view. `destination` accepts
`fileManagerId`, `groupId`, and the django-mojo `use` selector. Two consumers
or two destinations may intentionally queue the same local file.

The public snapshot is stable between transitions and deliberately inert. It
contains safe filename/type/size, byte counts, status, sanitized failures, and
safe completed File references. It never contains browser `File` objects,
transport tasks, callbacks, capabilities, abort controllers, toast handles,
raw errors, or auth data.

Admin Files composes this primitive in `FileUploadSurface`: Add File and a
drag-only whole-page overlay share an explicit policy-backed destination modal,
while the queue remains mounted outside it. The surface fabricates neither
progress nor reconciliation timers.

## Outcome truth and actions

- **Cancel** is a request. An active item becomes `cancelling`; it becomes
  `uncertain` if django-mojo cannot prove the remote state. The UI never calls
  an initiated transfer “cancelled” merely because `AbortController` fired.
- **Retry** explicitly replays a retryable failed/id-less-uncertain task.
- **Recover** appears only when the task has a known File id and invokes the
  transport's reconciliation-only recovery—no duplicate byte transfer.
- **Finalizing** begins after upload truth is `completed` and while
  `onComplete` runs. It is non-cancellable and releases the transfer slot.
- A rejected `onComplete` is `completed-warning`, not upload failure. “Retry
  follow-up” reruns only the callback using the already-completed safe File
  reference; it never replays the bytes.
- Remove is immediate for queued/settled items. Removing an active item first
  requests cancellation and only forgets it after transport truth settles.

Every active attempt owns exactly one `toast.progress` card. Its displayed
percentage changes only when real byte events cross an integer percentage.
Reconciliation/callback work uses the additive non-cancellable `finalizing`
state, then settles to success, failure, or completed-with-warning.

## Headless use and verification

`createUploadQueue()` exposes the same external-store controller for code that
does not need the hook. `UploadQueue` is presentational and accepts any
controller with the documented snapshot/actions, which also keeps Showcase
fixtures out of production transport code.

Run the focused executable contract:

```bash
npm run verify:upload-ux
npm run verify:form-uploads
```

It covers pure validation, lazy concurrency, capacity, stable/safe snapshots,
consumer/destination dedupe, real progress updates, callback-only retry,
truthful cancellation, known-id recovery, and byte-identical Portal/Showcase
token CSS. The form contract adds strict relation normalization, explicit
attach states, owner-response reconciliation, orphan retention, safe previews,
avatar #1488 semantics, and cache-boundary sanitization.
