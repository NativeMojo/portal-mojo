# Packaged Django Admin contract (schema 1)

`npm ci && npm run build:admin -- --canonical` produces `dist/admin` using
Node **24.21.0** and npm **11.19.0**. This is a separate artifact from the
`portal-mojo` npm toolkit. Django vendors the static bytes; its deployment
requires no Node, npm, frontend build, or environment-specific API origin.
Ordinary `npm run dev` remains mock-backed, `VITE_MOJO_API` remains the
explicit standalone live override, and the showcase remains mock-only.

## Producer and identity

The dedicated `django-admin` mode ignores all dotenv files, rejects inherited
nonempty `VITE_*` values and a conflicting `NODE_ENV`, and explicitly defines
the complete Vite runtime environment. Build tools receive only PATH, HOME,
TMPDIR/SystemRoot and fixed production/UTC/C locale values. The lockfile and
exact Node/npm pair are required inputs. No timestamps enter the artifact.

The producer stages a fresh build, verifies it, then replaces only `dist/admin`
through a recoverable rename. A dirty checkout can produce a clearly marked
draft with `npm run build:admin`; `--canonical` refuses dirty source. Drafts
are useful for development and **must not be vendored**. Canonical provenance
records the full source commit, application version, lockfile SHA-256, and
exact toolchain. The reproducibility claim is bounded to that source, committed
lockfile, toolchain, controlled environment, and platform; it is proven with two
fresh byte-identical builds by `npm run verify:admin-artifact`. It does not claim
different Node releases or platforms produce identical bytes.

`scripts/admin-artifact-schema.json` freezes schema 1. `admin-artifact.json`
contains exactly these top-level fields:

| Field | Meaning |
|---|---|
| `schema_version`, `artifact` | `1`, `portal-mojo-admin` |
| `version` | Stable SemVer from `packages/portal-mojo/package.json` |
| `source_revision`, `source_dirty` | Full 40-character Git revision; truthful boolean |
| `toolchain` | Exactly `{ "node": "24.21.0", "npm": "11.19.0" }` |
| `lockfile_sha256` | Lowercase SHA-256 of committed `package-lock.json` bytes |
| `entrypoint`, `asset_base` | `index.html`, `./` |
| `api_mode`, `source_session_contract` | `same-origin`, `1` |
| `vite_manifest` | `.vite/manifest.json` |
| `files` | Every file except `admin-artifact.json`, sorted by path, each `{path,size,sha256}` |

Paths are ASCII relative POSIX paths with nonempty segments; no `.` or `..`
segments, backslashes, query strings, fragments, URL escapes or absolute paths.
Only letters, digits, `_`, `-`, `.`, `@`, `/` occur. Files are regular files;
symlinks and other file kinds are rejected. The inventory includes the hidden
Vite manifest, all lazy chunks, stylesheets, fonts, and any emitted licenses.
Missing, duplicate, unordered, extra/stale, altered, undeclared or unresolved
dependencies fail verification. Sourcemaps and mock chunks are forbidden.

The artifact's identity is the SHA-256 of the **final manifest bytes**, including
formatting and its terminating newline. Every downstream copy uses that exact
digest and inventory. Verify without rebuilding:

```sh
node scripts/verify-admin-artifact.mjs --check dist/admin EXPECTED_MANIFEST_SHA256
```

CI and release workflows retain the **complete** directory, including `.vite`,
as `portal-mojo-admin-<version>-<full-revision>` for 90 days. Download that
workflow artifact or use the verified local `dist/admin`; preserve the whole
directory during transfer. Django's committed vendor tree is the durable
release copy after workflow retention expires. Record the workflow/run or local
absolute retrieval path and manifest digest on both paired work items. No
publish, tag, or push is part of building this artifact.

## Same-origin runtime and protected lazy loading

The packaged predicate makes `apiOrigin()` return `window.location.origin`.
Calls, exports, hosted auth, upload initiation/completion, realtime, and
Shortlinks share that accessor. API requests always use `/api/...`; they are
never relative to the source mount. Signed provider transfers retain capability
validation and separate credentials. Assets use `./` and routes use hashes, so
identical bytes work at `/admin/v2/` or a configured `/operations/v2/` mount.
The sidebar reports Live API and the artifact's application version.

Coordination installs before auth startup. Auth-code scrubbing and reset/magic
landing translation stay synchronous; boot awaits the exchange and source grant
before constructing the router. The eager gate handles checking, expiry, denial,
unavailability and unsupported browsers without private lazy imports or automatic
reload/navigation loops. Retry preserves the intended hash route; Sign in uses
the deployment's hosted auth. Genuine stale-chunk recovery remains explicit.

The app copies package section descriptors before wrapping `loadComponent`, and
also wraps Groups/API Keys and all four auth router loaders. Embedded toolkit
consumers receive no Admin session side effects. Source grant failures prevent
lazy loading and replace the app with eager recovery. The current route survives.

## Source-session response (version 1)

`scripts/fixtures/admin-source-session-v1.json` is the shared wire fixture.
Issue `POST /api/account/admin/session` with the current bearer token and
same-origin cookies. A successful envelope carries only:

```json
{"status":true,"data":{"path":"/admin/","source_session_expires_in":300,"source_session_expires_at":2000000300}}
```

`path` is the root-relative **Admin root**, including both slashes, and must
match the current document's `<path>v2/` (or `v2/index.html`) mount. It uses
nonempty letter/digit/underscore/hyphen segments; it cannot redirect to another
origin or mount. The positive integer lifetime and integer UTC epoch seconds
come from one server deadline bounded by configured TTL and access-token expiry.
No source-session identifier is returned. The browser uses the earlier of
receipt time plus lifetime and absolute expiry; already-expired/malformed grants
never become ready. Renewal is scheduled at 70% of the effective remaining
lifetime, independently of JWT refresh. Focus, visibility and pageshow recheck
it; all concurrent renewals share one promise. Transport failures retry at most
twice with bounded backoff; denied or malformed grants require user recovery.

Existing `access_token` and `refresh_token` keys require no migration. Both
storage choices survive refresh, including refresh-only boot. The dead-session
password-login recovery clears only unusable old credentials. Generic auth stays
Admin-agnostic; the app's sign-out action awaits source revocation.

## Cross-client cookie coordination (version 1)

**All** Portal, legacy Admin and public gate issue/revoke requests participate.
The origin-scoped exclusive Web Lock is `mojo:admin-source-session:v1`.
The BroadcastChannel has that identical name. The authoritative nonsecret
localStorage key is `mojo:admin-source-generation:v1` and contains exactly:

```json
{"version":1,"generation":"00000000-0000-4000-8000-000000000001","state":"revoked"}
```

`generation` is a fresh UUID for each transition; `state` is `active` or
`revoked`. A missing key represents `{version:1,generation:"initial",state:"active"}`.
Never initialize by blindly writing that default over concurrent changes.
Each tab binds its accepted generation under the **same key in sessionStorage**
so a stale sessionStorage session stays stale across reload. This binding never
overrides the authoritative localStorage record. Messages contain exactly
`{type:"generation",version:1,generation,state}`; they are advisory wakeups.
Recipients reread localStorage. Neither storage record nor messages contain
tokens, user data, source-session identifiers, or credential-derived hashes.

Issuers acquire the lock, reread generation and current auth, refresh if needed,
and check both again immediately before sending. Hold the lock through the entire
HTTP response/body processing, including the browser's Set-Cookie processing.
Recheck generation and the actual sent access token before declaring readiness.
Refresh/token notifications never activate a revoked generation.

Logout persists a fresh revoked generation and broadcasts **before waiting for
the lock**, stops renewal, and clears local credentials. Once it acquires the
lock it may reassert only its still-current tombstone; it **must not overwrite
a newer explicit-login generation**. It then sends `DELETE <path>_session`
with same-origin credentials and holds the lock until the response body finishes.
Only then does logout complete. Failure remains visibly incomplete and retryable.
A JavaScript generation guard or abort alone cannot undo a late Set-Cookie.

Only a completed **explicit fresh login**, begun with a captured generation that
still matches localStorage, may transition a tombstone to a new active UUID under
the lock. Bind that new generation to the tab. An old pending login whose captured
generation was invalidated cannot activate it. A new login's source issuance
waits behind pending revocation on the same lock. Existing and suspended tabs
must compare their bindings before every issuance; stale sessions cannot resurrect
the cookie. A tab can adopt a new binding after an explicit fresh login.

Missing Web Locks, BroadcastChannel, cryptographic UUIDs or usable browser storage
fails packaged initialization visibly. There is no uncoordinated fallback.
Unit fixtures prove JS ordering; Django owns real multi-document Set-Cookie race
proof with delayed responses, including legacy/gate participants.

## CSP compatibility matrix

This matrix is a test plan, **not authorization to relax policy**. Django tests
its current policy first; only observed failures justify narrow v2-specific
changes. v1 and the gate retain their own policies. External origins require
validated exact deployment allowlists, never response-supplied policy, broad
schemes or wildcards. Keep strict script execution (no inline scripts/eval),
privacy/no-store headers, URL capability validation and credential isolation.

| Feature / actual mechanism | Expected authorized behavior | Directive(s) to observe | Negative check |
|---|---|---|---|
| Vite entry, preload and lazy ES modules | Protected same-origin module loads after readiness | `script-src`, `script-src-elem` | Inline script, eval and foreign script stay denied |
| Extracted Tailwind/theme/icon CSS and local fonts | Both themes and icons display | `style-src`, `font-src` | Foreign stylesheet/font denied |
| React style property updates | Dialog/layout/chart positioning works | `style-src-attr` | Test actual DOM property behavior; do not assume unsafe-inline is needed |
| API, exports, auth and source grants | Same-origin fetch works; expired auth refuses | `connect-src` | Foreign fetch remains denied |
| Realtime native WebSocket | Same-origin wss authenticated handshake | `connect-src` | Foreign websocket denied; no bearer in URL |
| Signed provider PUT/multipart via XHR | Approved exact provider receives bytes without API credentials | `connect-src` | Unlisted origin and credential forwarding fail |
| File/image/audio/video delivery | Valid capabilities at approved delivery origins render/play | `img-src`, `media-src` | Unsafe URL scheme or unlisted origin blocked |
| Local data/blob image and media previews | Existing validated preview paths work | `img-src`, `media-src` | No expansion of script/connect permission from preview support |
| Blob downloads and chart PNG export | Browser download works | download/navigation behavior, `img-src` as applicable | Foreign redirect/HTML execution not enabled |
| Sanitized email `iframe srcdoc`, empty sandbox | HTML layout preview without execution | parent `frame-src`; document's restrictive CSP | Script, forms, navigation, external fetch and sandbox escape fail |

## Handoff and acceptance ownership

Portal item #1263 closes on full producer verification plus one clean artifact's
revision/version/toolchain/retrieval location/manifest hash. Django #4060 consumes
that exact digest and owns protected browser acceptance: default/custom mounts,
storage choices, both themes, reload/lazy routes, short TTL renewal, delayed
two-tab issue/logout races, suspended tabs, anonymous denial after logout,
uploads/blob/media/email/realtime, and negative CSP checks. Upstream defects
reopen #1263 and require a newly verified artifact and updated pinned digest.
There is no scaffolder or capabilities-handshake prerequisite for this artifact;
those are independent future product work. Embedded section architecture remains.
