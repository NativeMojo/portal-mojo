# Phone Hub admin (#1295)

Import `PhoneHubPage`, the three individual pages, models, permission clauses, and API helpers from `portal-mojo/admin`. `PHONE_HUB_ADMIN_SECTION` registers one global `/phonehub` route in Communications; the page exposes only the Phone Numbers, SMS, and Provider Config tabs the caller may view. Admin global scope masks any outer product group.

## Wire contracts

- `POST /api/phonehub/number/normalize` is public. `normalizePhoneNumber()` accepts the backend result only when it is strict E.164.
- `POST /api/phonehub/number/lookup` requires authentication and is offered only under `PHONE_LOOKUP_UI_PERMISSIONS`. The helper always normalizes first. For a new or expired record it omits `force_refresh` so the backend's normal lookup path refreshes once. For a known-fresh record it requires confirmation, then sends `force_refresh: true`. A successful response must provide a first lookup timestamp/count or advance one of them relative to the prior row; a 2xx stale row is rejected as provider failure evidence.
- `PhoneNumberModel` requests the default graph but positively sanitizes every row before Query. Raw `lookup_data` is never retained or exported.
- `SmsModel` reads SMS audit records. It requests the default graph and positively projects known display fields before Query; raw metadata, provider payloads, and provider message ids are discarded. Its client exporter is bounded and omits message bodies, errors, user/group details, and raw fields.
- The SMS table's **Send SMS** action opens a focused composer for one recipient and a custom message. It normalizes the recipient through the existing public endpoint, then calls `POST /api/phonehub/sms/send` with exactly `{to_number, body}`. The message body is preserved verbatim. This is global sending through the effective system configuration/default sender: no ambient group, provider override, metadata, or audit-creation call. Drafts and allowlisted receipts stay local to the dialog, outside MutationCache. Sending rechecks the original actor and current permissions after normalization and immediately before transport. A synchronous guard blocks repeat clicks; native Escape/backdrop and Cancel are locked while pending.
- A successful HTTP envelope can contain a `failed` or `undelivered` SMS record: render that status as failure. Other returned statuses remain literal; only `delivered` confirms delivery. The default graph does not expose `is_test`, so a `sent` receipt does not claim a real delivery. Transport/malformed-receipt failures retain the draft and ask the operator to check SMS Audit before retrying. Every attempted send invalidates the audit list; refresh failure cannot turn a completed send into a retry. Provider refusal is demonstrated in the mock with a recipient ending in `0000`; no mock request contacts a provider.
- `PhoneConfigModel` reads sanitized scalar/default-graph rows. Saves and `test_connection` use imperative, cache-free calls. The editor follows web-mojo's provider-conditional layout: selecting Twilio, AWS SNS, or Mojo Remote shows and submits only that provider's connection fields. Mojo Remote uses `https://api.mojoverify.com` when the saved URL is unset or the editor is switched to Mojo; an explicitly configured custom URL is preserved. Secret inputs are DOM refs, not React or Query state: blank means untouched and is omitted; replacement must be non-empty; clear sends `null` only after a separate confirmation. Switching providers resets pending clears, and hidden provider credentials remain untouched. Responses are allowlisted before cache reconciliation. This surface edits existing provider credentials; it does not provision Django user/group API keys.

Connection tests read the provider's `success` verdict, not the outer REST
`status`. A failed or missing verdict is an error; `test_mode` is a warning
that the provider was not contacted. Results persist inside the detail modal
on both sections, alongside a toast. Scope is labeled in the header and
Connection section. Saving new credentials clears the previous test result.
The stored URL is shown literally; a saved URL plus `missing_credentials` for
Mojo means the API key is absent. Re-enter it in Edit configuration and save;
blank password inputs preserve existing values and do not prove a key exists.

## Exact permissions

Every exported array is an ANY-of clause and retains the `sys.` UI namespace. Number view is `view_phone_numbers | manage_phone_numbers | comms | manage_users`; save is `manage_phone_numbers | comms | manage_users`; delete is only `manage_phone_numbers`. SMS view is `view_sms | manage_sms | comms | owner | manage_notifications`; save is `manage_sms | comms | manage_notifications`; delete is `manage_sms | manage_notifications`. Config view/save is `manage_phone_config | manage_groups | comms`; delete is `manage_phone_config | manage_groups`. These delete clauses describe low-level API compatibility; built-in number,
SMS and config Delete controls are absent. The composer additionally requires
`sys.send_sms | sys.comms`; audit read/manage grants alone never allow sending.
It remains inside the existing SMS-view audience. Config deactivation uses the
credential-safe imperative save path. The server remains authoritative.

Group choices are fetched only with a separate global group-directory clause and are capped at 100 basic rows. Without that grant the editor does not issue a group-directory request and preserves the existing scope (or creates a system default).

## Provider and deletion reality

Phone lookup is always the global Twilio Lookup integration; it is not group-configured. Stored Twilio and AWS credentials can be tested, but the current SMS send implementation only consults a per-group configuration for `provider="mojo"`. Twilio/AWS configurations otherwise fall through to global Twilio send settings, and AWS sending is not wired. `test_mode` only short-circuits connection testing; it does not block sending.

An active group config wins; otherwise `PhoneConfig.get_for_group` falls back to the first active system default. Deactivating a group config restores that fallback; Admin exposes this reversible lifecycle. Deleting a group cascades its config and SMS rows. Deleting a user cascades their SMS rows. Deleting a config does not delete SMS audit rows. Deleting an SMS row affects only local audit storage and cannot recall provider delivery.

## Reuse rules

Use KISS detail modals, not `:id` routes. Never add provider payloads to a model graph, cache, error, export, or request history. Never reuse `PhoneConfigModel.useSave()` for credentials or `SmsModel.useSave()` to deliver messages. Sending follows the contract above; API-key provisioning remains separate.

Verify with `npm run verify:admin-sms-compose`, `npm run verify:admin-phonehub`, and the Admin modal inventory check. The mounted composer regression covers permissions, concurrent clicks, permission revocation, exact global payloads, uncertain results, failed receipts, cache isolation and audit refresh. Use the Phone Hub showcase to click the composer in both themes and at narrow widths.
