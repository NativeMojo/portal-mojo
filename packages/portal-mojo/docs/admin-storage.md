# Storage Admin

```ts
import {
    STORAGE_ADMIN_SECTION, BucketsPage, BackendsPage, FilesPage, FileView,
    FileUploadSurface, FileManagerModel, FileManagerUploadPolicyModel, FileModel,
} from 'portal-mojo/admin';
```

`STORAGE_ADMIN_SECTION` contributes global/no-group Infrastructure routes at
`storage/buckets`, `storage/backends`, and `storage/files` (or the same paths
under an embedded `/system` mount). There are no record routes: buckets,
backends, nested files, and files use `modal.detail`.

## Permissions

- Buckets: `sys.manage_aws | sys.files`.
- Backends/Files view: `sys.view_fileman | sys.manage_files | sys.files`.
- Backend/File mutations: `sys.manage_files | sys.files`.
- Add File, its whole-page drop surface, and upload destination requests mount
  only with the File mutation grant.
- Group and user selectors mount only with their respective system-pinned
  directory grants. Admin never reads an active group.

The section audience is the union of child audiences; each route retains its
exact clause. A member-only grant cannot satisfy any Storage route.

## Buckets

`GET /api/aws/s3/bucket` is one complete account inventory, rendered with
explicitly local name search/order and no paging claims. Failed inventory is
an Error/Retry state, never “No buckets.”

All writes are `POST /api/aws/s3/bucket/<encoded-name>`:

- create: `{}` → `{id,name,created_new:true|false|null}`;
- access: `{set_public:boolean}` → verified `is_public`, `complete:true`,
  `mutation_state:'complete'`;
- empty: `{empty:{confirm_name:name}}` under `withFreshAuth`, after an
  `ArmedButton` and exact case-sensitive UI confirmation.

Every POST invalidates and actively refetches in `finally`. A primary failure
is preserved if refresh also fails. HTTP 409
`s3_operation_incomplete` retains finite `none|partial|unknown` evidence,
acknowledged counts, classified failures, nullable remaining values, and the
access safety-lock posture without fabricating zeros or atomic completion.
Bucket DELETE is absent.

## Backends

`FileManagerModel` forces `graph=list` and allowlists graph fields before any
cache write. Readable credentials are masks only. Credential inputs begin
blank; blank means preserve. `saveFileManagerAtomic` runs imperatively outside
MutationCache, strips masks and blank secrets, fresh-auth retries the same
closure, refetches authoritatively, and compares requested owner FKs.

Creation supports runtime backends `file` and `s3`, explicitly starts private,
and requires an authorized group/user owner unless the caller is superuser and
chooses System. Supported payload actions are `test_connection`, `check_cors`,
`fix_cors`, and `clone`; inner `{status:false}` rejects. CORS is S3-only.
FileManager DELETE and `check_public_access` are absent.

## Files and capability URLs

`FileModel` forces the list graph and normal saves to `filename`, `is_public`,
and explicit `group`. Group moves refetch and compare the authoritative FK.
Selection supports public/private, explicit prepared group move, safe
same-gesture download, and all-settled confirmed delete. Authorized operators
also get **Add File** and a drag-only whole-page drop overlay. Both open one
configuration modal; the bounded queue lives above it, so closing the modal
does not cancel work or discard outcomes.

Every batch chooses an explicit manager. System choices request only active
`graph=upload_policy` rows with null group/user owners. Group choices first use
the independently gated active-group directory, then request null-user policy
rows for that exact group. User-owned and dual-owned managers never enter these
Admin lists. The safe policy projection contains only name/use, size,
extension/MIME guidance, and transfer-route support. A false
`supports_direct_upload` means a local API target, not an unavailable manager.

The queue caps at six files and three concurrent transfers. It reports actual
byte progress, truthful cancel/retry/recovery, partial acceptance, and uncertain
remote state. Permission loss closes the destination modal, stops its queries,
and best-effort cancels queued transfers. Completion compares authoritative
scalar `file_manager_id`/`group_id` with the immutable destination. Terminal
changes coalesce into one authoritative active Files refetch plus one trailing
pass; refresh failure remains visible and current filters may hide the new row.

Each task owns a private strict `idempotency_key`. A lost initiation response
reuses it to recover the same File. A server-proven failed/expired lifecycle
rotates it and creates a fresh attempt on the same Retry click. Keys, browser
`File` objects, targets/tokens, and completion payloads never enter Query or
persistent storage.

File, thumbnail, rendition, and share URLs are bearer capabilities. The shared
validator accepts ordinary relative paths or explicit `http:`/`https:` URLs
without userinfo, and rejects protocol-relative, malformed, `javascript:`, and
`data:` values. Open/Download uses an anchor with `rel=noreferrer`. Safe exports
omit every URL, storage path, mask, metadata object, token, and transient.

`FileView` sections are Overview, Preview, Details, Renditions, Shares, and
Metadata. Category precedes MIME fallback: image inline; native audio/video;
PDF open; office-like documents use the best safe image rendition; archive
downloads; text/CSV/unknown remain generic. No returned HTML is embedded.
`StableMediaPreview` captures its safe source for the mounted File id so normal
query refreshes do not replace the media node; reopening refreshes policy.

## Renditions and shares

Role-keyed rendition objects normalize to stable rows. Signatures include
role, rendition id, status, modified, width, height, and size. Recursive
non-overlapping polling waits five seconds, makes at most 12 fetch attempts,
and stops on signature change/arrival, failed or expired upload, close/id
change, or timeout. Timeout leaves manual Refresh.

Regeneration sends `{regenerate_renditions:true|string[]}` with deduped roles
capped at 20. Share creation sends `{share:true|options}` imperatively; options
and the newly returned capability URL stay in one modal-local result and never
enter Query/Mutation caches. The response parser uses the collision-safe
`shortlink_code` key and validates the ISO `expires_at`. Separately authorized
rows are labeled “Visible shares”; the backend owner fallback remains available
without granting global Shortlinks Admin. Safe `track_clicks` and bounded note
values are retained, and operators can use the live active toggle or permanent
DELETE contract.

## Mock and verification

The central mock owns bucket, FileManager, File, upload attempts/byte sessions,
canonical rendition, and shortlink rows. It implements the safe policy graph,
flat lifecycle/target response, idempotent replay, terminal retry, and local or
provider paths. Credential writes derive masks and discard raw values. Stable
personas are `storage.viewer@nativemojo.com`,
`storage.manager@nativemojo.com`, `bucket.manager@nativemojo.com`, and
`storage.member@nativemojo.com` (password `mojo`); the showcase operator has
the broad demo grants.

Run `npm run verify:admin-storage`, `npm run verify:file-upload`, and
`npm run verify:upload-ux` for the focused route, permission, upload,
cache-safety, URL, FK-reconciliation, and bounded-polling contracts. Browser
evidence belongs in the Portal mock for viewer/member gates and in Showcase
for the exported surface, in both themes.
