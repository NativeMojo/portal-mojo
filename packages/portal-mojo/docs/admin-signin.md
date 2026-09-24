# Sign-in admin (#5547)

Import `SigninPage`, `SIGNIN_ADMIN_SECTION`, the permission clause and the API
helpers from `portal-mojo/admin` (or `portal-mojo/admin/identity`). The section
registers one global route, `/system/sign-in`, under **Identity & Access**,
gated by `SIGNIN_ADMIN_PERMISSIONS` = `['sys.manage_settings', 'sys.admin']`
(superusers pass). Admin global scope masks any outer product group.

The page has two parts:

- **Look & feel** — the SYSTEM hosted login/registration page: branding,
  layout/appearance/accent color, hero panel, sign-in heading/copy/methods,
  registration, custom CSS. It edits the same keys a group admin edits in the
  group **Configure Auth** dialog; a group's own settings still override these.
- **Providers** — one card each for Google, Apple and GitHub: an Enabled
  switch, a read-only callback URL with a Copy button, the credential fields,
  a Ready / Needs setup badge, and a link to the provider's console.

KISS by design: trusted admins, no step-up auth, no confirmation beyond a
browser `confirm()` before clearing a stored value.

## Wire contract

One endpoint, both methods, django-mojo envelope.

`GET /api/account/admin/signin` → `{schema_version, auth, editable, options, providers}`

- `auth` is `public_auth_config` of the resolved system config
  (`{theme, login, registration}`).
- `editable` lists the flat dotted paths the POST accepts. The page renders
  only fields whose path is listed, so the backend can narrow it.
- `options` carries the allowed tokens for methods, layouts, appearances,
  hero image positions and passkey prompts. Legacy layouts `card` /
  `fullscreen` display as `compact` / `branded-panel`; any other unknown select
  value falls back to the first option with a `console.warn`.
- `providers[]`: `{name, label, enabled, ready, missing, callback_url,
  console_url, help, fields[]}`; each field is `{key, label, secret,
  multiline, configured, source, value, hint}`. `source` is `admin`,
  `deployment` (shown as "Set in server config") or `none`. Secret fields
  never carry `value`; `hint` (e.g. `…a1b2`) is shown when present.

`POST /api/account/admin/signin` returns the same full payload, which the page
writes straight into its query cache (`SIGNIN_QUERY_KEY`).

- Look & feel: `{auth: {"theme.app_title": "…", "login.methods": […]}}` —
  only the paths whose value differs from the loaded payload, sent by the
  explicit **Save** button. Password is locked on in the sign-in methods picker;
  the server rejects a list without it (400).
- Provider: `{provider, values, enabled}`. In `values`, an omitted key or
  `""` keeps the stored value and `null` clears it. The card's **Save** sends
  only fields the admin typed into; **Clear…** (shown for `source: "admin"`)
  confirms, then sends `null` at once. The **Enabled** switch saves
  immediately with `{provider, enabled}`, which adds/removes the provider from
  both `login.methods` and `registration.methods`.
- Errors are `{status: false, error}` (HTTP 400). The client rejects them; the
  page shows the message inline and as a toast and keeps the unsaved edits.

Secrets are entered in password inputs (the Apple `.p8` key in a textarea)
and cleared from local state after a successful save.

## Mock

`src/client/mock.ts` implements the endpoint: global `manage_settings` /
`admin` gate (401 anonymous, 403 otherwise), `editable`-only writes with the
option and password rules, and credential storage. Seed: Apple has Team ID and
Services ID stored in the Admin (missing Key ID and private key), Google has
nothing, GitHub is configured by the deployment. Saved look & feel lands in a
system override that `/api/auth/config` layers between the deployment config
and group overrides, so the public config reflects saves. An Admin-stored
credential wins over the deployment value; clearing it falls back to the
deployment value.

Verify with `npm run verify:admin-signin`.
