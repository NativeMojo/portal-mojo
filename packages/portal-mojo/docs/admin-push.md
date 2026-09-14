# Push Notifications admin (#1296)

Import `PushPage`, its individual panels/pages, the canonical push models, API helpers, and `PUSH_ADMIN_SECTION` from `portal-mojo/admin`. The section contributes one global/no-group Communications route at `/push`; there are no record routes. KISS detail modals own record inspection.

## Tabs and URL state

The page has six possible tabs: Your stats, Global metrics, Devices, Deliveries, Templates, and Config. Stats are authenticated caller data. Every other tab is independently filtered by its exact permission clause, and only the active authorized panel mounts, so hidden/inactive surfaces issue no requests.

`push_surface` is registered with `registerNonFilterParams` at module load. It survives table writes but never becomes a Django lookup or filter pill. Changing tabs retains only `push_surface` and the showcase host's `demo` selector, clearing search, sort, paging, and filters belonging to the prior model. Showcase registers `demo` as a non-filter param at boot, so table writes keep the selected demo without sending it as a model lookup.

## Exact permissions

All UI clauses carry the `sys.` namespace. Alternatives within a clause are ANY-of:

- Devices view: `view_devices | manage_devices | comms | owner | manage_users`; save: `manage_devices | comms | owner`.
- Deliveries view: `view_notifications | manage_notifications | comms | owner | manage_users`; save: `manage_notifications | comms`.
- Templates view: `manage_notifications | manage_groups | comms | owner | manage_users`; save: `manage_notifications | manage_groups | comms`.
- Config view/save: `manage_push_config | manage_groups | comms`.
- Config connection test: `manage_push_config | comms`.
- Device test: `send_notifications | comms` **AND** the Devices view clause above.
- Global metrics: `view_metrics | metrics`, with `account="global"`.

`sys.users` is deliberately absent: it is not in `RegisteredDevice.RestMeta.VIEW_PERMS`. The Stats endpoint requires authentication only and always scopes all five keys to `request.user`.

Device inspection or config management alone never enables a test send. The backend separately enforces global `send_notifications | comms` and visibility of the selected registration; invisible and missing devices both return 404. Config checks require global `manage_push_config | comms`, independently of config editing. Group/member grants, API keys, and key-backed sessions cannot satisfy these test-action gates.

## Projection and ownership boundaries

Every model pins a `basic` or `default` graph, allowlists list params, and positively projects rows before Query or Mutation cache reconciliation. RegisteredDevice never retains `device_token`; Delivery never retains `platform_data`, and its arbitrary `data_payload` is not retained by the UI projection. Related users are reduced to id plus a short display label—never email, phone, metadata, or an expanded user graph. Template JSON objects accept only a bounded shallow scalar projection on reads.

The additional evidence retained by the UI is:

| Model / result | Retained fields and fallback |
|---|---|
| `PushDeviceRow` | `is_active` is boolean or null; an older backend with no field shows “Activity unknown”. |
| `PushConfigRow` | `fcm_project_id` (max 200 characters), `fcm_client_email` (max 254), and boolean/null `has_fcm_credentials`. Missing metadata is “Not reported” / “Presence not reported”; credential presence is not verification. |
| `PushDeliveryRow` | `push_outcome` allowlists `accepted`, `delivered`, `simulated`, `rejected`, `blocked`, `unknown`, `pending`, `sent`, and `failed`; otherwise null, with display falling back to stored `status`. |
| `PushTestConfig` | Positive safe-integer `id`, `name` (max 100), `group` (safe-integer id/name up to 120 characters, or explicit null for system default), `fcm_project_id` (max 200), `test_mode`, `is_active`, `has_fcm_credentials`. No service-account email or secret material. |
| `PushTestResult` | `success`, `outcome`, local `message`, allowlisted/null `error_code`, success-only `message_id` (max 500), positive safe-integer/null `delivery_id` and `device_id`, and projected/null `config`. |

Test results live in the open dialog, outside Query and Mutation caches. Provider messages and raw error bodies are replaced by local copy; unknown error codes are discarded. `PushReadiness` retains only `ready`, local `message`, `device_id`, and projected `config`.

`PushDeviceModel` now lives canonically in `admin/messaging/push`. The former `admin/identity/users/models.ts` definition is a compatibility re-export of the same object, so User Detail and the global Push page share one endpoint definition and Query key.

## FCM credentials and actions

FCM writes are imperative and cache-free. A service account textarea is an uncontrolled DOM ref and never prefills. Blank means untouched and is omitted. Replacement must parse to an object with `type="service_account"`, `project_id`, `client_email`, and a PEM `private_key`. Clear sends `null` only after explicit confirmation. Empty replacement is impossible, and server responses are sanitized before cache reconciliation.

### Saved configuration check

`testPushConfigConnection(id)` calls `POST /api/account/devices/push/config/<id>/test` with `{}`. The backend authenticates with FCM and submits a validation-only message, including when `test_mode=true` or the selected config is inactive. It sends no device notification and does not activate the config. The portal never accepts a raw device token.

The adapter accepts success only when the envelope has not failed, `success === true`, `outcome === "validated"`, `validation_only === true`, and `message_id` matches `projects/<project>/messages/<reference>`. Missing/malformed verdicts, simulated legacy responses, and provider rejections cannot display a verified connection. Backend HTTP 400 failures retain safe diagnostic data; the adapter returns a failed `PushTestResult` for the dialog to display.

“Check FCM connection” lives in the config header menu. The result and check time remain visible in Overview and Connection for that saved record/revision. Checks lock duplicate checks, editing, and active-state changes while pending. Editing or changing active state clears the result; record revision, permission, caller, or mount changes invalidate late completions. This is evidence from the current view, not a persisted credential-verification flag.

### One registered device

The device header's “Send test push” opens a focused dialog. The API helpers use the existing test endpoint:

| Helper | Request | Purpose |
|---|---|---|
| `fetchPushDeviceReadiness(42)` | `GET /api/account/devices/push/test?device_id=42` | Local readiness; no FCM traffic. |
| `sendPushDeviceTest(42, title, message)` | `POST /api/account/devices/push/test` with `{"device_id":42,"title":"Push test","message":"This is a test notification."}` | One real notification to the selected registration. |

`device_id` here is the numeric database `id`, not the app-provided string `device_id` used for registration. The portal never calls the caller-wide POST variant without a selector. The backend resolves the device owner's active org config, falling back to the active system default; the dialog shows the device, user, config ID/name, scope, and FCM project actually reported by readiness or the send result.

Readiness must explicitly match the requested device and include an active config with credentials present and simulation disabled. Inactive registration, push disabled, an opted-out `test` category, missing token/config/credentials, or simulation prevents sending. Readiness does not verify provider credentials or device reachability. Unknown/malformed readiness disables Send rather than guessing.

The dialog defaults to title `Push test` and message `This is a test notification.`; inputs must be nonblank and fit 200/1000 characters. A single pending guard prevents duplicate submissions and locks fields, Cancel, Escape, and backdrop dismissal during sending. Each dialog permits one completed attempt; reopen it to obtain fresh readiness before another. Permission loss hides stale results; settled requests still unlock dismissal. Every attempt invalidates device, delivery, and caller-stat queries in `finally`.

Device results require explicit `success === true`, `outcome === "accepted"`, a provider message reference, and the requested `device_id`. Handled backend failures may be HTTP 200 with `data.success=false`; inspect the projected result. A failed envelope cannot establish success. Uncertain transport/malformed responses become `unknown`, and known HTTP 400/401/403/404 refusals without structured evidence become blocked. There is no automatic resend.

The portal exposes no general `/send`, caller-wide test, delivery retry, device registration/unregistration, or delete action.

All four REST models have live `CAN_DELETE = false`; the mock returns 403 without removing or cascading anything. Templates/configs can be created and edited under their save clauses. Device record editing and delivery mutation remain absent from this page.

## Outcomes and delivery evidence

Test dialogs keep a visible result label, local explanation, check time, and delivery record ID when available:

| Outcome | Meaning |
|---|---|
| `validated` | FCM connection verified; no notification delivered. |
| `accepted` | FCM accepted the notification; the operator must check the selected device for receipt. |
| `rejected` | FCM refused the request; show the safe diagnostic. |
| `blocked` | Readiness, credentials, authentication, or request refusal prevented a successful test. |
| `unknown` | Acceptance is uncertain. Check the device and delivery history before another test; do not label it failed or retry automatically. |

Delivery lists/details prefer `push_outcome` over `status`. `simulated` is explicitly shown as no FCM send, even though the stored status is `sent`. `unknown` remains pending; provider acceptance alone does not mark a record delivered. Older `sent` records are described as lacking acceptance/receipt evidence. Status filtering and sorting still use the stored status field, not the derived outcome. The caller-stat tile is “Recorded sent” because its count may include simulations.

## Modal lifecycle convention

See [Admin modal policy](admin-modals.md) for header actions, content-only
sections, supported lifecycle fields and retained irreversible exceptions.
Config/template active-state controls live in the detail header. Device details
use Overview/Preferences with active and push-state chips; delivery details use
Notification/Delivery with outcome explanations. Templates use
Overview/Notification/Variables; configs use Overview/Connection with scope,
send-mode, credential-presence, and service-account metadata.

Config/template editors keep one pending save guard and protect Escape/backdrop
dismissal as well as Cancel. Config saves retain write-only credential handling;
device test sends use their separate permission AND and dismissal lock.

## Showcase and verification

Open `#/?demo=admin-push` in Showcase. Its banner explicitly identifies
local fixtures: connection checks and test pushes there never contact FCM or
deliver notifications. Fixtures exercise system/org config selection, disabled
push, simulation blockers, safe metadata, and a selected-device accepted result
with a delivery row and no delivered timestamp. Switching Push tabs preserves
`demo=admin-push`; model filtering never consumes that host selector.

`npm run verify:admin-push` runs both `scripts/verify-admin-push.mjs` (mock wire,
permissions, projections, credentials, and target selection) and
`scripts/verify-push-tests.mjs` (mounted dialog/adapters). The latter covers strict
provider verdicts, malformed/mismatched responses, revision/permission ownership,
persistent results, duplicate-send prevention, pending dismissal, and cache
isolation. JSDOM assertions do not prove native dialog layout or stacking;
complete browser verification in both themes and a narrow viewport, including
the device test, configuration check, and nested editors.
