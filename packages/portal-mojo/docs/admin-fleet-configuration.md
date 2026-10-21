# Fleet Configuration

The Operations → Fleet Configuration page uses `/api/account/admin/fleet`.
Only literal superusers see the section. An empty permission any-of array uses
the existing superuser bypass and refuses even the global `admin` grant; the
page checks `is_superuser === true` before fetching. Backend authority remains
mandatory, including rejection of diagnostic/key-backed sessions and fresh auth.

Applications register their schema in django-mojo. The page renders the returned
section, label, description, default, type and restart requirement; application schemas remain server-owned. The three managed shared-validation
connection fields route to the dedicated topic below, rather than appearing as
independently editable generic fields. Each field defaults to Keep current value. Set value
and Remove published override are explicit actions. Clearing falls back to base
configuration/default; it does not promise erasure of a bootstrap secret.

Secret inputs start blank, never hold masked placeholders, and blank replacement
preserves the existing secret. Values stay in the form until an imperative POST;
secret-bearing writes bypass TanStack MutationCache. Secret current/default fields
are removed before Query cache storage. The revision-bound publish/restore/apply
POSTs use `withFreshAuth` and show failures without claiming success. Schema/type
validation is repeated by the server; browser validation is only feedback.

Publication means published to S3, never applied. Apply now starts a fixed
asynchronous sync operation and polls its ID until terminal operation status. The
short job completes after dispatching sync; completed job status does not stop
polling. Each operation read freshly observes activation until healthy or timed
out; failed, expired or canceled jobs also stop polling. The expected
node roster includes missing nodes. Installed, restart requested, restarted and
healthy remain separate evidence. Only positive installed + restarted + health
results from every expected node with the explicit
`request_service_jobs_and_dependencies` health scope justify fleet completion.
Missing or older health scopes remain unconfirmed, including per-node health and
restart confirmation, and prompt a backend upgrade. Health covers the
request service and dependencies where enabled, plus the job engine and scheduler
with their startup-loaded revision. Worker-only nodes need no request service.
Draining an old engine is not proof that its replacement has loaded the revision.
Timed-out, failed, superseded and unknown results stay visible. Refresh status observes the
normal timer workflow even when Apply now was not used.

History contains only version IDs and timestamps. Restore publishes the selected
version as a new revision using the current expected revision. Secrets are neither
shown nor compared. Concurrent publication rejects the stale revision; refresh
before retrying. Settings edits are tied to their loaded publication revision.

Verify with `npm run verify:admin-fleet`, `npm run typecheck`, `npm run build`, and
browser checks of both themes. The Settings showcase includes a partial-convergence
example. Mock Portal uses representative registered settings and an offline node.

Django receives this page only after a canonical Portal artifact is built and
vendored; follow `docs/admin-artifact.md` and the Django vendor tool. Ordinary
Vite build output is not the canonical artifact.

## Shared validation connection

Operations → Fleet Configuration → Shared validation connection is a private, lazy
route. It requires a current literal superuser; the server additionally requires
an active interactive session, same-origin writes and fresh authentication.
Key-backed sessions are rejected by the server even when their user is an owner.

On the validation hub, update every expected node using the existing Deployments
controls, then use **Enable shared validation** once. The compact hub section is
independent of consumer connection configuration and uses the same Portal login,
fresh authentication and native confirmation as the existing page. No separate
operator service, login or wizard is required. Missing or incompatible deployment
proof shows the ordinary prerequisite instead of an enabled action. Each issuer
keeps its own ACME account, certificates and private keys; allocation trust still
requires explicit approval in the DNS setup screen. Renewal remains automatic.

`GET /api/account/admin/fleet/shared-validation/hub` returns
`{version:1, enabled, configured, deployment_uuid, can_enable, reason}`.
The deployment UUID is canonical lowercase with hyphens, unlike consumer project
UUIDs. `POST` takes only `{deployment_uuid}` after confirmation. The backend
rechecks the complete deployed roster and framework version atomically before
enabling. A stale deployment, failed read or fresh-auth refusal requires Refresh
and another deliberate review; mutations are never replayed. Keep the compatible
framework on every node after enabling sharing.

The panel consumes the private `/api/account/admin/fleet/shared-validation`
contract. Choose a named approved hub profile, inspect its exact origin and
original project UUID, then Keep, Replace or Disable the connection. Replacement
is a normal write-only password field; blank preserves the existing credential.
The approved catalog fixes the origin. Arbitrary URLs and raw JSON are not inputs.

Preview probes the candidate without saving it. Publication has a separate
confirmation, frozen against the preview and auth session. Publishing revalidates
the catalog and expected revision; it does not Apply. Apply has another
confirmation and targets the exact current revision. Every expected node must
report installed, restarted and combined request-service/job-engine/scheduler
health at that revision and the expected topic profile/project identity. Offline,
draining, stale, partial and missing-node results remain unconfirmed. The UI
polls at most120 observations and offers deliberate Refresh afterward. Verified
connection identity with `sharing_ready=false` still needs sharing enabled on the
approved hub. Refresh the connection after enabling it there.

Create the replacement on the approved hub with the named **ACME validation
consumer** key form. Preview/Publish, Apply, verify every expected node, then
explicitly review and deactivate the old key in the hub inventory. Issuance,
publication and successful dispatch never retire keys. Disable masks the whole
connection tuple and base credential without deleting base settings or revoking
remote trust; retained/shared identities can make disabling ineligible.

Secrets remain in an uncontrolled mounted password input and a short-lived
imperative request draft. They never enter Query/Mutation caches, URL/history,
storage, receipts or logs. These new writes call `requestFreshAuth` without
replaying the attempted action; the existing generic Fleet helpers keep their
prior behavior. Auth/session change or unmount invalidates drafts and closes
owned confirmations. Double activation is single-flight. A409 revision/catalog
conflict or `configuration_busy` requires Refresh and a deliberate retry. An
uncertain publication or issuance may have persisted; read authoritative status
or exact Group inventory before another attempt.

Unavailable APIs, missing DNSMan/publisher/delegation/schema/enrollment or an empty
approved catalog render a concrete blocked state. Bootstrap supplies `admin_path`
and permission facts for existing legacy System Setup, Deployments, topology and
Fleet Scaling links. Links are same-origin and capability-gated. The backend's
semantic `capacity` hint maps to the actual registered `#/fleet` route. These
legacy destinations retain their protected confirmations, policy, release holds
and IaC restrictions. This React topic reuses those controls without a new
deployment or root authority service.

The Runtime settings showcase mounts the actual connection panel with central
mock scenarios and operator/ordinary-manager identities. The named
`verify:admin-shared-validation-config` gate includes private DTO/API and mounted
StrictMode contracts, and is included once by `verify:admin-contracts`. Browser
proof remains necessary for real native dialogs, keyboard/focus and390px in both
themes. Mock receipts are fixtures, never live configuration evidence.

The private form uses an inline-size container: fact labels stack above UUIDs and
revision values below420px of available content, including a narrow embedded
Admin host. The existing Admin sidebar's Collapse control supplies its normal
compact host at390px; the topic does not change global navigation behavior.

Every successful authoritative refresh invalidates a preview when revision,
catalog, profile, identity or credential facts change. Late preview/operation
responses cannot restore spent consent or overwrite a newer observation. After
the automatic observation limit, explicit Refresh re-observes the tracked exact
operation and resets the read budget; it never dispatches another Apply. Only
known healthy report/node statuses with no top-level or node error can turn the
combined proof green. Apply/read replies remain bound to their exact operation
ID and requested/tracked revision.
