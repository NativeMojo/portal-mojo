# Fleet Configuration

The Operations → Fleet Configuration page uses `/api/account/admin/fleet`.
Only literal superusers see the section. An empty permission any-of array uses
the existing superuser bypass and refuses even the global `admin` grant; the
page checks `is_superuser === true` before fetching. Backend authority remains
mandatory, including rejection of diagnostic/key-backed sessions and fresh auth.

Applications register their schema in django-mojo. The page renders the returned
section, label, description, default, type and restart requirement; no application
setting names are hardcoded. Each field defaults to Keep current value. Set value
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
