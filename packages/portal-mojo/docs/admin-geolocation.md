# GeoLocation provider setup

`GeoLocationPage` (`portal-mojo/admin/operations`) is the global Operations →
GeoLocation surface. GeoIP Cache inspects IPs; Fleet Configuration applies
published settings. Dashboard is unchanged. Hosts may override the mount-derived Fleet link with
`fleetConfigurationPath`; Showcase targets its Runtime settings demo.

Admission requires literal `is_superuser === true` and a current interactive
session. The backend also rejects key-backed sessions, requires same-origin
POSTs and authentication within 600 seconds. Global/group grants do not replace
these checks. `usePrivateOperator` remounts on session change, aborts requests and
owned dialogs, and rechecks authority before sending and accepting responses.

## Tasks

**Provider** contains primary provider, MojoVerify key and threat sharing.
**Failover** contains fallback and ordered additional providers, with add,
remove and move controls. One retained draft spans both tabs. Page-local hidden
panels preserve the same uncontrolled password element; shared Tabs is unchanged.
Arrow/Home/End navigation and `aria-controls` connect task tabs to their panels.

MojoVerify always uses `https://api.mojoverify.com`; no URL control is shown.
Older origins remain readable, but this page stages the hosted URL and warns
that switching requires a replacement key. Provider names are human-readable;
unknown configured identifiers are retained. New additional rows exclude primary,
fallback and existing rows. Runtime deduplicates the chain; existing overlaps are
not silently rewritten. Non-Mojo credentials are configured outside this endpoint.
The server's values are authoritative: setup defaults differ from runtime defaults.

No key shows **Add key**; a configured key shows **Replace key** and **Remove
key**. Test key sits with the credential. Blank replacement preserves the stored
key; confirmed removal is staged until Save changes and does not revoke remotely.
Save/Discard reflect actual draft changes. Refresh confirms before discarding an
unsaved draft. Info popovers hold secondary explanations; Configuration information
opens a focused native dialog for revision and publication facts. No disclosure
sections or sidebar modal are used.

Last stored-key check shows its historical outcome and timestamp separately from
the draft result. Pending activation and Open Fleet Configuration remain visible.
A false pending flag concerns only this request node, never proves fleet health.

## Private protocol

`readGeoLocation()` positively projects only `provider_setup` from schema-v1
`/api/account/admin/settings`. Catalog, SMS, unknown fields and raw credentials
are discarded. Form state is imperative, outside Query/Mutation caches.

`buildGeoPayload(action, configuration_revision, draft, keyEdit)` sends exactly
`{action,topic:'geoip',providers:{expected_revision,geoip}}`. The revision is sent
even when null. The five static keys are primary, fallback, additional, Mojo URL
and sync. Untouched/blank replacement omits credentials; nonempty replacement
adds `GEOIP_API_KEY_MOJO`; confirmed removal adds `clear_api_key:true`.
Additional providers are unique and ordered, at most16. Identifiers match
`^[a-z][a-z0-9_-]{0,31}$`. HTTPS origins permit no credentials, path, query,
fragment or alternate port (443 allowed); keys are at most4096 characters.

Secrets stay only in the password DOM and short-lived request objects, whose
raw key is deleted in `finally`. They never enter React/Query/Mutation state,
URLs, storage, logs or mock observations. Tabs retain the element and candidate;
Save attempts, explicit discard, fresh-auth refusal, session change and unmount
clear it. Writes are single-flight. A440 invokes fresh authentication without
replaying; Refresh and a deliberate retry are required. Stale revisions
(400 “changed; reload before publishing”, or409), unreadable state and uncertain
saves require authoritative Refresh before another write.

Test verifies **only MojoVerify credentials**, regardless of primary. It requires
the five delegated descriptor keys but not Fleet bucket/object/KMS/restart
availability; Save requires the publishing plane. Sharing requires the remote
key's `geoip_sync` permission. The current backend also verifies Mojo on every
Save except explicit removal: selecting another primary does not enable an
independent no-Mojo setup. This page does not invent provider-chain testing,
other-provider key editing, provisioning, revocation or an Apply endpoint.

A draft-key test does not rewrite stored verification. The backend's stored-test
predicate is no replacement plus the node-loaded origin and sync value; chain
changes do not affect it. Tests reread stored evidence without rebasing the
draft's revision. Revision changes or lost normalization authority block retry;
publishing-only unavailability does not block diagnostics. Loaded/desired origin
drift can prevent stored-key reuse until Fleet apply or explicit replacement.

Save rereads authoritative configuration. `published:true` means static
publication with restart pending; `unchanged:true` can still mean the database
credential changed. Neither result proves activation. Failed, stale and uncertain
requests keep errors actionable and never become successful saves.

## Verification

`geo-provider-mock.ts` supplies isolated safe observations (action, key action,
stored-test predicate, expected revision), with no submitted key retained.
Scenarios include no-key setup, real registry names, unknown/empty registry,
publishing unavailable, stale/fresh-auth/uncertain outcomes and loaded-origin drift.
Showcase's GeoLocation demo mounts the actual page. Run
`npm run verify:admin-geolocation` and `npm run verify:admin-geolocation-mounted`;
JSDOM behavior does not establish native focus or layout. Inspect both apps,
light/dark, desktop/390px, opened dialogs and error recovery per
[Admin presentation](admin-presentation.md). The scoped stylesheet is included
through `portal-mojo/styles.css`.
