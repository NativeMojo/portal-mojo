# account — the self-service "My account" modal

```ts
import {
    AccountModal, openAccountModal, ACCOUNT_SECTIONS,
    type AccountModalProps, type AccountSectionKey, type AccountSectionDef,
    // the sections, mountable on their own (each takes { me })
    AccountProfileSection, AccountPasskeysSection, AccountSecuritySection,
    AccountSessionsSection, AccountNotificationsSection, AccountApiKeysSection,
    // shared pieces (admin re-exports these unchanged)
    PasskeyList, NotificationPreferences, ApiKeysSection,
    PasskeyModel, ApiKeyModel, useGenerateUserApiKey, OAuthConnectionModel, MeSaveModel,
    type NotificationKind,
} from 'portal-mojo/account';
```

The signed-in user's own account, in ONE modal opened from the avatar menu
(portal-mojo #7184). A short rail is the whole navigation; each entry is one
flat section (no drill-ins, no cross-links); Sign out sits at the rail's
foot; the header carries the section title and Close. ≈760×520 on desktop;
under **720px** a full-screen sheet whose rail becomes a row of tabs across
the top. Every focused flow (add passkey, authenticator, recovery codes,
password, email/phone, verify, photo) stacks its own dialog over the modal.

`portal-mojo/account` is a page bundle bound to django-mojo wire contracts,
like an admin domain — but it never imports the admin barrel and runs no
setup at import, so a product portal can mount it without the Admin.

```tsx
import { openAccountModal } from 'portal-mojo/account';

<UserMenu
    authMode={authMode()}
    onSignOut={signOut}
    items={[{
        label: 'My account', icon: 'bi-person-circle',
        onSelect: () => void openAccountModal({ onSignOut: signOut, authMode: authMode() }),
    }]}
/>
```

Live demo: showcase → Components → Account → **AccountModal**.

## Props

`openAccountModal(props?)` opens `AccountModal` on the toolkit modal stack
(`modal.open`, size `lg`) and resolves when it closes. It takes every prop
below except `onClose`.

| Prop | Type | Notes |
|---|---|---|
| `sections?` | `AccountSectionKey[]` | Built-ins to show, in order. Default all six (`ACCOUNT_SECTIONS`): `'profile' \| 'passkeys' \| 'security' \| 'sessions' \| 'notifications' \| 'api-keys'`. Unknown keys warn once and drop. |
| `extraSections?` | `AccountSectionDef[]` | App sections appended to the rail: `{key, label, icon, render({me, close})}`. A key that duplicates one already on the rail warns and drops. |
| `initialSection?` | `string` | Section open on mount (built-in or extra key). Unknown keys warn and fall back to the first. |
| `onSignOut?` | `() => void \| Promise<void>` | Replaces the default `logout()` on the rail's Sign out. Pending state ("Signing out…", spinner, `aria-busy`); a rejection toasts `Sign out failed: <message>` and keeps the modal open. Pass the SAME handler as the app's `UserMenu`. |
| `authMode?` | `'inapp' \| 'hosted'` | With the default sign out only: `'hosted'` → `redirectToHostedAuth()` (when `hostedAuthUrl()` resolves), `'inapp'` → `#/auth/login`, omitted → the app's auth gate routes. |
| `notificationKinds?` | `NotificationKind[]` | The kinds this app sends: `{kind, label, description?, channels?}` (`channels` null/absent = all three). Overrides the server's catalogue. |
| `onClose` | `() => void` | `AccountModal` only — Close, sign out, or the session ending underneath it. |

Signed out: the modal has no account to show — it closes itself as soon as
`useAuthSnapshot().authenticated` is false (sign-out elsewhere, refresh
failure), and an `openAccountModal()` call while signed out closes at once.
`UserMenu` renders its signed-out matrix instead of the menu, so the item is
unreachable there anyway.

## Sections

1. **Profile** — avatar (image or initials) with a camera button → photo
   dialog (`ImageField`, required square crop to 200×200); name, email and a
   "System admin" line for superusers. CONTACT: Email (Verified/Unverified
   chip; Verify → code dialog; Change → two-step email-change dialog), Phone
   (Not set → Add; Verify; Change — the two-step phone-change flow). PERSONAL:
   display name + timezone (`metadata.timezone`) through `FormView`
   autosave ("Saves as you type"). One row per linked Google/Apple/… sign-in
   with Unlink (confirm first; the server's 400 shown as written).
2. **Passkeys** — intro, one card per passkey (`PasskeyList`: icon, friendly
   name, "Added <date> · last used <relative>" / "never used"; Rename,
   Remove, and Enable on a disabled one), a dashed **Add a passkey on this
   device** button → dialog (suggested name, "works on <this host>",
   Continue → the WebAuthn create ceremony), footer "Removing a passkey signs
   out nothing. Keep at least one other way to sign in." Browsers without
   `navigator.credentials.create` see a note instead of the button.
3. **Security** — Authenticator app card (On/Off chip; Set up / "Set up a
   new app" → 3-step enrol dialog: QR or key → code → recovery codes; Turn
   off → confirm whose copy says two-step sign-in stays required when
   `requires_mfa`), Recovery codes card ("N of 8 left", warn tone at ≤2;
   View → masked hints; Regenerate → code → shown-once set), Password card
   (Change → current + new + confirm with `PasswordStrengthMeter`, then a
   `toast.action` offering **Sign out everywhere else** → `revokeOtherSessions()`
   — a password change does not rotate `auth_key`; a
   passwordless account gets "Email me a link" → `forgotPassword(email,
   'link')`).
4. **Sessions** — up to four device cards (browser on OS, place · "active
   now" or relative time; "This device" and "New location" chips), "And N
   more devices", then **Sign out everywhere else** (confirm → revoke; this
   session stays).
5. **Notifications** — `NotificationPreferences`: CHANNELS — three master
   cards Email / Push / In app, one switch each; WHAT TO SEND — one row per
   kind × channel checkbox grid. A channel whose master is off renders its
   column disabled; a kind not delivered on a channel shows "—". Every
   toggle is optimistic and reverts + toasts the server's message on failure.
6. **API keys** — the shared `ApiKeysSection` for self: list, Generate (show-
   once token via `showSecretDialog`), Revoke.

## Wire contract

Detail answers are `{status, data}`; lists add `count/start/size`. "Fresh
auth" = the call runs under `withFreshAuth` (a 440 prompts, then retries once).

| Flow | Request | Answer / notes |
|---|---|---|
| Identity | `GET /api/user/me` (`useMe`, key `['me', uid]`) | sanitized; `avatar` is `{id} \| null` |
| Personal autosave, photo | `POST /api/user/me {changed fields}` via `MeSaveModel` (fresh auth) | sanitized row → `['me', uid]`, every `/api/user` cache invalidated |
| Password | `POST /api/user/me {current_password, new_password}` | 400 on wrong/missing current; no fresh auth, no session rotation |
| Passkeys list | `GET /api/account/passkeys?user=<me.id>&sort=-created&size=25` | `?user=` is REQUIRED — a `users`/`manage_users` caller is otherwise served every user's rows |
| Rename / enable | `POST /api/account/passkeys/<id> {friendly_name}` / `{is_enabled}` | the only two editable fields |
| Remove passkey | `DELETE /api/account/passkeys/<id>` | `{status:"deleted"}`; no last-method guard |
| Register begin | `POST /api/account/passkeys/register/begin {}` (fresh auth) | `{challenge_id, publicKey, expiresAt}` |
| Register complete | `POST /api/account/passkeys/register/complete {challenge_id, credential, friendly_name}` (fresh auth) | the saved Passkey row |
| TOTP setup | `POST /api/account/totp/setup {}` (fresh auth) | `{secret, uri, qr_code:"data:image/…;base64,…"}`; calling it again replaces the secret and DISABLES an active authenticator until confirmed |
| TOTP confirm | `POST /api/account/totp/confirm {code}` (fresh auth) | `{is_enabled:true, recovery_codes:[8]}`; sets `requires_mfa` |
| TOTP off | `DELETE /api/account/totp` (fresh auth) | `{status:true}`; does NOT clear `requires_mfa` |
| Enrolled + count | `GET /api/account/totp/recovery-codes` | `{remaining, codes}` (masked hints) or **400 when not enrolled** — the only self-visible "authenticator is on" signal |
| Regenerate codes | `POST /api/account/totp/recovery-codes/regenerate {code}` (fresh auth) | `{recovery_codes}` |
| Email change | `POST /api/auth/email/change/request {email, method:'code'}` (fresh auth) → `POST /api/auth/email/change/confirm {code}` | confirm commits, rotates `auth_key` and answers a NEW login — adopted |
| Phone add/change | `POST /api/auth/phone/change/request {phone_number}` (fresh auth) → `POST /api/auth/phone/change/confirm {session_token, code}` | `session_token` rides at the envelope TOP level |
| Verify | `POST /api/auth/verify/{email\|phone}/send` (email sends `{method:'code'}`) → `…/confirm {code}` | |
| Linked sign-ins | `GET /api/account/oauth_connection?user=<me.id>`; `DELETE …/<id>` | 400 "Cannot unlink your only login method. Set a password first." shown as written |
| Devices | `GET /api/user/device?user=<me.id>&sort=-last_seen&size=4`; `GET /api/account/logins?user=<me.id>&sort=-created&size=50` | read-only; place + New-location chip from the device's latest login |
| Sign out others | `POST /api/auth/sessions/revoke {}` (fresh auth) | rotates `auth_key`, answers a NEW login — adopted, so this session stays |
| Notifications | `GET /api/account/notification/preferences`; `POST … {preferences:{kind:{email\|push\|in_app: bool}}}` | partial update, absent = on; caller-only |
| API keys | `GET /api/account/api_keys?user=<me.id>`; `POST /api/auth/generate_api_key {label, allowed_ips?, expire_days≤360}` (fresh auth); `POST /api/account/api_keys/<id> {revoke:{}}` (the POST_SAVE_ACTION) | no DELETE |

Never use the `revoke_sessions` user action for "sign out others" — it kills
the caller's own session too.

### Passkey registration ceremony (`registerPasskey(name?)`)

`publicKey.challenge`, `publicKey.user.id` and `excludeCredentials[].id` are
base64url-decoded before `navigator.credentials.create({publicKey})` (null →
"No credential received from authenticator"). The credential posts as
`{id, rawId, type, response:{clientDataJSON, attestationObject}, transports}`
— `transports` (`response.getTransports?.() ?? []`) at the credential's
**top level**, not inside `response`; the server rejects `id !== rawId`. The
name key is **`friendly_name`** (default `suggestPasskeyName()`, e.g. "Mac —
Chrome"). Complete is retry-safe (matched on `credential_id`; the challenge is
deleted only after success), so a 440 on complete replays the same body.
Errors map through `passkeyErrorMessage()` (dismissed, already registered,
wrong domain, cancelled; server text as written).

### `POST /api/user/me` — what a self save may carry

- **Allowed**: `first_name`, `last_name`, `display_name`, `metadata.*`
  (merged), `phone_number` only to set a first one or clear it, `dob` only
  when unset, `avatar` (a completed, groupless image File the caller
  uploaded, or null), `{new_password, current_password}`.
- **403**: `email`/`username` changed, `password`, admin-only fields
  (`is_email_verified`, `is_phone_verified`, `requires_mfa`, `is_active`,
  `org`) changed, `is_superuser`/`is_staff` **even unchanged**,
  `permissions`, `metadata.protected`, replacing an existing phone ("Use the
  phone change flow…"), changing a set `dob`.
- **Silently dropped** (NO_SAVE_FIELDS): `id`, `auth_key`, `last_activity`,
  `is_dob_verified`, `requires_password_change`, secrets, `has_password`,
  `has_passkey`, ….

So never post the `me` row back as-is — `MeSaveModel` posts only the changed
fields. `has_password` is in the `me` graph; passwordless users set a first
password through `/api/auth/forgot`.

### Notification preferences

The reserved kind **`"*"`** is the per-channel master switch:
`{"*": {email: false}}` silences every kind on email, including kinds
registered later; the UI reads `"*".<channel> === false` as master off. Kind
rows resolve: the `notificationKinds` prop ▸ the GET's `kinds` catalogue
(when the server ships the registry) ▸ any kind already stored in the
caller's preferences ▸ one "General" row.

## Invariants

- **One-time secrets never enter a cache.** TOTP secret/uri/QR, recovery
  codes, API tokens, the phone-change `session_token` and returned logins
  live in the dialog's component state (or a pending-mutation callback, the
  `useGenerateUserApiKey` pattern) and die with it. The recovery-code status
  cache holds only `{enrolled, remaining}` — the masked hints leak 4 of 12
  hex chars each and are fetched into the View dialog only.
- **Shown-once codes** cannot be dismissed (Escape/backdrop/Done) until "I
  saved these somewhere safe" is ticked; Copy + a local `recovery-codes.txt`
  download (object URL revoked). Copy: "Save these codes now. They will not
  be shown again. Old codes no longer work."
- **Dialogs die with the session.** Sign-out / `'unauthorized'` / a uid
  change closes the AccountModal and every dialog over it (the modal stack
  empties). Authenticator setup runs once per OPEN (never again on a host
  remount) and only for the uid the dialog was opened for — otherwise it
  closes with the sign-in copy.
- **Fresh auth**: every server-gated call is wrapped in `withFreshAuth`; a
  dismissed step-up reads "For your security, sign in again to make this
  change." The step-up is the app's FreshAuthHost — never an ad-hoc password
  prompt.
- **QR** renders only from a `data:image/(png|svg+xml);base64,` value inside
  `<img>` (`safeQrDataUrl`, re-checked at the sink); anything else falls back
  to the typed key.
- **Avatar URL in component state only** (`useAvatarUrl`, the
  [user-menu.md](user-menu.md) rule); the `me` cache holds `{id}`.
- **Orphaned passkeys are signalled.** When `navigator.credentials.create`
  succeeded but `register/complete` failed (or its step-up was dismissed),
  `registerPasskey` best-effort calls
  `PublicKeyCredential.signalUnknownCredential({rpId, credentialId})` so the
  authenticator can drop the unsaved credential, then rethrows the original
  error.
- **Passkeys are host-bound**: the Add dialog says which host the passkey
  will work on. Registration options carry no `authenticatorSelection` yet
  (django-mojo #7191).
- Server messages are shown as written; pending writes block dismissal.
- Turning the authenticator off keeps two-step sign-in required — only an
  administrator clears `requires_mfa`.

## Mounting in a product portal

1. Add the one-liner above to the app's `UserMenu` `items` (the same
   `onSignOut` both places). Lazy-load it if the shell entry is budgeted:
   `import('portal-mojo/account').then((m) => m.openAccountModal(props))`
   (apps/portal does this).
2. Import `portal-mojo/styles.css` from the app's Tailwind CSS entry and
   declare the colour tokens. `account.css`, `user-admin.css` (API-key rows)
   and `group-admin.css` (`.ga-secret-*` token reveal) ship in it; there is
   nothing to copy. The showcase still carries its own copies.
3. Mount `ModalHost` + `ToastHost`, and a fresh-auth handler (apps/portal's
   `FreshAuthHost`, registered through `setFreshAuthHandler`) inside the
   authenticated tree. Without a handler a 440 just fails with the
   fresh-auth copy.
4. Pass `notificationKinds` for the kinds the app sends until the server
   ships its registry (CamActive: alarms / security / controllers / digest).

## Mock

- Every emailed / texted / authenticator code is **`123456`** (TOTP confirm
  and regenerate, email change, phone change, verify); TOTP setup returns a
  fixed secret; confirm answers 8 recovery codes.
- Seeded users that already require MFA (Maya, user 2) start **enrolled**;
  everyone else gets the 400 not-enrolled answer until they set up.
- Passkey register begin/complete validate shape only (complete requires
  `credential.id === rawId` and upserts a row); non-admin passkey reads are
  owner-scoped.
- `sessions/revoke` and email-change confirm rotate `auth_key` (other mock
  tokens die) and answer a fresh token pair.
- `armMockReauth('POST', '/api/auth/sessions/revoke')` (from
  `portal-mojo/client`; any gated method + exact path) makes the next
  matching authenticated call answer 440 once — the showcase Account demo
  has a button for it.

## Pitfalls

- Needs the app's QueryClient, router, `ThemeProvider`, `ModalHost`,
  `ToastHost` and a fresh-auth handler (see Mounting).
- Don't add a second Sign out path that skips the app's `onSignOut` — Admin
  must revoke its source session.
- `?user=<me.id>` on every list is load-bearing for admins: drop it and an
  admin's own account shows everyone's passkeys / keys.
- Real-authenticator passkey registration is pending verification against a
  live django-mojo (the mock checks shape only).
