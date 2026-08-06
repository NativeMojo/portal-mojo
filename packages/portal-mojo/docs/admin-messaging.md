# Communications Admin

```ts
import {
  EMAIL_ADMIN_SECTION, PUBLIC_MESSAGES_ADMIN_SECTION,
  EmailDomainModel, MailboxModel, SentMessageModel,
  EmailTemplateModel, PublicMessageModel,
} from 'portal-mojo/admin';
```

The global, no-group Communications workspace mounts at `email/domains`,
`email/mailboxes`, `email/sent`, `email/templates`, and
`messaging/public-messages` (or under `/system` in an embedded portal). Every
record opens in a native KISS detail modal; there are no record-detail routes
or drawers.

Email uses global `sys.manage_aws | sys.comms` for both view and mutation,
matching django-mojo's current single tier. Contact-message view uses
`sys.view_support | sys.security | sys.support`, status mutation uses
`sys.manage_support | sys.security | sys.support`, and delete uses only
`sys.manage_support`. A granular manager must also hold a view grant to open
the page. Active-group membership never satisfies a global Admin gate.

Domain credentials are write-only. Secret-bearing saves, onboarding, audit,
reconcile, and send are imperative and never use MutationCache. Audit is POST,
has no automatic retry, and always refreshes because it persists readiness.
Create reports only that the row was created: django-mojo's best-effort
create-time audit/reconcile can fail after the row exists. Delete warns that
local mailboxes and sent audit history disappear while SES/SNS/S3/DNS
resources may remain.

Onboarding composes the shared `FormWizard`. Managed mode is available only
when the optional DNS Admin integration resolves the normalized domain and
uses its one record store; no provider key is submitted. Manual mode always
shows the complete returned verification, DKIM, and MAIL-FROM records. Managed
failure never silently retries manually because SES-side work may already
have occurred.

Sent-message and template HTML is untrusted. `SandboxedEmailPreview` uses a
bare iframe sandbox, `referrerPolicy="no-referrer"`, an offline CSP, removed
meta refresh, and neutralized links. Safe exports are explicit projections:
template bodies, message bodies, BCC, template context, provider metadata,
contact-message body/IP/user-agent/metadata, and credential masks never leave.

Stable mock identities (password `mojo`):

- `email.operator@nativemojo.com` — email only (`comms`).
- `support.viewer@nativemojo.com` — contact read only.
- `support.manager@nativemojo.com` — contact read/update/delete.
- `support.manage-only@nativemojo.com` — delete authority but intentionally no page view.
- `showcase.operator@nativemojo.com` — executable showcase coverage.

Live verification is read-only by default. Never create/edit/delete a domain,
replace credentials, audit, onboard, reconcile, or send without explicit
authorization for that exact live action. SES quota is intentionally absent;
django-mojo #1310 tracks the missing backend endpoint.
