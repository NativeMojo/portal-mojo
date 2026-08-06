# Storage Admin

```ts
import {
    STORAGE_ADMIN_SECTION, BucketsPage, BackendsPage, FilesPage, FileView,
    FileManagerModel, FileModel,
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
same-gesture download, and all-settled confirmed delete. There is no Add File,
file input, drop/paste target, upload endpoint, or progress UI; upload remains
parked in #1264.

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
enter Query/Mutation caches. Separately authorized rows are labeled “Visible
shares” and revoke only through `{is_active:false}` so the audit row survives.

## Mock and verification

The central mock owns bucket, FileManager, File, canonical rendition, and
shortlink rows. Credential writes derive masks and discard raw values. Stable
personas are `storage.viewer@nativemojo.com`,
`storage.manager@nativemojo.com`, `bucket.manager@nativemojo.com`, and
`storage.member@nativemojo.com` (password `mojo`); the showcase operator has
the broad demo grants.

Run `npm run verify:admin-storage` for the focused route, permission, wire,
cache-safety, URL, FK-reconciliation, and bounded-polling contract. Browser
evidence belongs in the Portal mock for viewer/member gates and in Showcase
for the exported surface, in both themes.
