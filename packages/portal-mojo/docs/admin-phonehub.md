# Phone Hub admin (#1295)

Import `PhoneHubPage`, the three individual pages, models, permission clauses, and API helpers from `portal-mojo/admin`. `PHONE_HUB_ADMIN_SECTION` registers one global `/phonehub` route in Communications; the page exposes only the Phone Numbers, SMS, and Provider Config tabs the caller may view. Admin global scope masks any outer product group.

## Wire contracts

- `POST /api/phonehub/number/normalize` is public. `normalizePhoneNumber()` accepts the backend result only when it is strict E.164.
- `POST /api/phonehub/number/lookup` requires authentication and is offered only under `PHONE_LOOKUP_UI_PERMISSIONS`. The helper always normalizes first. For a new or expired record it omits `force_refresh` so the backend's normal lookup path refreshes once. For a known-fresh record it requires confirmation, then sends `force_refresh: true`. A successful response must provide a first lookup timestamp/count or advance one of them relative to the prior row; a 2xx stale row is rejected as provider failure evidence.
- `PhoneNumberModel` requests the default graph but positively sanitizes every row before Query. Raw `lookup_data` is never retained or exported.
- `SmsModel` is an audit-only surface. It requests the default graph and positively projects known display fields before Query; raw metadata, provider payloads, and provider message ids are discarded. Its client exporter is bounded and omits message bodies, errors, user/group details, and raw fields. There is no send UI.
- `PhoneConfigModel` reads sanitized scalar/default-graph rows. Saves and `test_connection` use imperative, cache-free calls. Secret inputs are DOM refs, not React or Query state: blank means untouched and is omitted; replacement must be non-empty; clear sends `null` only after a separate confirmation. Responses are allowlisted before cache reconciliation. This surface edits existing provider credentials; it does not provision Django user/group API keys.

## Exact permissions

Every exported array is an ANY-of clause and retains the `sys.` UI namespace. Number view is `view_phone_numbers | manage_phone_numbers | comms | manage_users`; save is `manage_phone_numbers | comms | manage_users`; delete is only `manage_phone_numbers`. SMS view is `view_sms | manage_sms | comms | owner | manage_notifications`; save is `manage_sms | comms | manage_notifications`; delete is `manage_sms | manage_notifications`. Config view/save is `manage_phone_config | manage_groups | comms`; delete is `manage_phone_config | manage_groups`. The server remains authoritative.

Group choices are fetched only with a separate global group-directory clause and are capped at 100 basic rows. Without that grant the editor does not issue a group-directory request and preserves the existing scope (or creates a system default).

## Provider and deletion reality

Phone lookup is always the global Twilio Lookup integration; it is not group-configured. Stored Twilio and AWS credentials can be tested, but the current SMS send implementation only consults a per-group configuration for `provider="mojo"`. Twilio/AWS configurations otherwise fall through to global Twilio send settings, and AWS sending is not wired. `test_mode` only short-circuits connection testing; it does not block sending.

An active group config wins; otherwise `PhoneConfig.get_for_group` falls back to the first active system default. Deleting or deactivating a group config restores that fallback. Deleting a group cascades its config and SMS rows. Deleting a user cascades their SMS rows. Deleting a config does not delete SMS audit rows. Deleting an SMS row affects only local audit storage and cannot recall provider delivery.

## Reuse rules

Use KISS detail modals, not `:id` routes. Never add provider payloads to a model graph, cache, error, export, or request history. Never reuse `PhoneConfigModel.useSave()` for credentials. Do not add SMS sending or API-key provisioning to this admin area without a new reviewed contract.
