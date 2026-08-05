# auth-pages — in-app sign-in surfaces, step-up challenges, password tools

The C3 layer over [auth.md](auth.md)'s client: the portal's own login /
forgot / reset / magic-link pages (for deployments serving the portal
same-origin with the API), the fresh-auth (step-up) modal, and the password
strength/generator pieces. Board #1259.

```ts
// The package pieces
import {
    // MFA completion (consumes the mfa_token from login()'s 'mfa' result)
    completeMfaTotp, completeMfaRecovery, sendMfaSms, completeMfaSms,
    // Fresh-auth (step-up) challenge surface
    REAUTH_STATUS, isReauthRequired, setFreshAuthHandler, requestFreshAuth,
    withFreshAuth, sessionIsPersistent,
    type MfaChallenge, type FreshAuthHandler, type MfaCompletionOptions,
} from 'portal-mojo/client';

import {
    checkPasswordStrength, generatePassword, PasswordStrengthMeter,
    type PasswordStrength, type PasswordStrengthClass, type GeneratePasswordOptions,
} from 'portal-mojo/ui';
```

The pages themselves are APP surfaces (`apps/portal/src/pages/auth/`):
`LoginPage`, `ForgotPage`, `ResetPage`, `MagicPage`, `MfaPanel`,
`FreshAuthHost`, `AuthLayout` — wired through `routes.tsx`, which exports
`authRoutes`, `RequireAuth`, and `handleAuthTokenLanding()`.

## Config switch

`VITE_MOJO_AUTH` (env, same idiom as `VITE_MOJO_API`):

| Value | Behavior |
|---|---|
| `inapp` | Unauthenticated visits route to `#/auth/login` (these pages) |
| `hosted` | Unauthenticated visits bounce to the django-mojo hosted `/auth` pages (bouncer pages, incl. the bot-check interstitial — which exists on the hosted path ONLY) |
| unset | **hosted when `VITE_MOJO_API` is set** (the default for real deployments), in-app under the mock (there is no hosted page to bounce to) |

Unknown values fall back to the unset default WITH a `console.warn`.
`hosted` + mock also warns and falls back to in-app. Resolution lives in
`pages/auth/config.ts` (`authMode()` / `inAppAuthEnabled()`).

## Route guard

`RequireAuth` wraps the App route element (`<RequireAuth><App/></RequireAuth>`;
`authRoutes` mount as top-level SIBLINGS — auth pages are full-screen, no app
chrome). Unauthenticated (per the A1 snapshot: no valid access OR refresh
token) → in-app login (intended route stashed in
`sessionStorage['portal:auth-return']`, restored after any successful flow)
or the hosted redirect (which keeps auth.ts's own stash). Authenticated →
children plus `<FreshAuthHost/>`. A signed-in visit to `#/auth/login`
bounces to `/` (web-mojo AuthApp guard parity); the forgot/reset/magic pages
stay reachable signed-in — completing them re-logs-in by design (the server
answers with a full TokenGrant).

## Flows (all on the A1 client — no new wire code in pages)

- **Password**: `login()` → tokens stored, or `{kind:'mfa'}` → `MfaPanel`.
  Remember-me checkbox maps to `LoginOptions.remember` (localStorage vs
  sessionStorage).
- **MFA step** (`MfaPanel`, shared with the fresh-auth modal). Methods from
  the server: `totp` (code → `completeMfaTotp`; recovery-code toggle →
  `completeMfaRecovery`), `sms` (`sendMfaSms` **consumes and re-issues the
  mfa_token — always replace your stored token with the returned one**, then
  `completeMfaSms`), `passkey` (a full `loginWithPasskey()` ceremony IS the
  second factor — django-mojo's passkey login never routes through the MFA
  gate). Unknown methods are dropped with a `console.warn`. The challenge
  expiry (`expiresIn`, default 300s) is counted down visibly.
- **Forgot/reset**: `forgotPassword(email, 'code'|'link')`; code → ResetPage
  code mode (email carried via router state + a sessionStorage stash so
  reloads survive); link → lands on ResetPage token mode. Both resets log
  the user in on success. The reset form carries the live
  `PasswordStrengthMeter` + a generator affordance (fills both fields,
  reveals the value). Strength is ADVISORY — submission is never blocked on
  it; the server owns password policy.
- **Magic link**: request via `sendMagicLink`; the landing auto-exchanges
  `loginWithMagicToken` ONCE (StrictMode-proof ref guard — `ml:` tokens are
  single-use) with progress/error UI.
- **Passkey**: `loginWithPasskey(username?)` behind `isPasskeySupported()`;
  no username → discoverable-credential prompt. The ceremony is fully built;
  REAL-authenticator verification is deferred (mock validates shape only).

## Token-landing URL shapes

django-mojo's `build_token_url` produces
`{WEBAPP_BASE_URL}{WEBAPP_AUTH_PATH}?flow=<flow>&token=<tok>` with `pr:`
(password_reset) / `ml:` (magic_login) token prefixes. Both landing shapes
work:

- **Real search** (`/?flow=password_reset&token=pr:…` — WEBAPP_AUTH_PATH
  points at the portal root): `handleAuthTokenLanding()` at boot scrubs
  flow/token from the real URL **synchronously, before any network call**
  (the auth_code discipline) and hash-routes to the landing page.
- **Hash query** (`/#/auth?flow=…&token=…` — WEBAPP_AUTH_PATH points at
  `/#/auth`): the `/auth` index route dispatches by token prefix, then flow.

The landing pages capture the token once at mount and scrub it from the
hash query before exchanging.

## Fresh-auth (step-up) challenges

django-mojo's freshness gate (`account/services/fresh_auth.py`,
`FRESH_AUTH_WINDOW`, default off): sensitive operations answer **HTTP 440 /
`reauth_required`** when the JWT's `auth_time` is too old. A token refresh
can NEVER satisfy it — refreshes carry `auth_time` forward unchanged; only
a genuine re-login mints a new one. That is why 440 is not 401: it must not
trigger the refresh path.

Client surface (`portal-mojo/client`):

- `isReauthRequired(error)` — MojoError with status/`error_code` 440 or
  message `reauth_required`.
- `setFreshAuthHandler(handler)` — the app registers ONE UI handler;
  `FreshAuthHost` (mounted by `RequireAuth`) does this.
- `requestFreshAuth()` — single-flight prompt: a burst of gated calls
  shares one modal. No handler → `console.warn` + resolve false.
- `withFreshAuth(fn)` — run fn; on a 440 prompt, then retry **once** after a
  successful re-login; a dismissed prompt rejects with the ORIGINAL error.

The modal re-prompts credentials OVER the current screen — page state
survives. It pins the identity to the current session's email (step-up is
"prove you are still you"), offers password + passkey + the MFA step, and
keeps the session in its original storage (`sessionIsPersistent()` →
`remember`). Dev affordance: `__mojo.requestFreshAuth()` in the console
exercises the modal without a 440.

Call-site pattern:

```ts
await withFreshAuth(() => save(changes));   // a 440 prompts + retries once
```

Nothing auto-wraps yet — `useSave`/`useAction` call sites opt in (a later
pass may wrap the model hooks' mutationFns).

Deployment note: a deployment enforcing `BOUNCER_REQUIRE_TOKEN` gates
`/api/login` behind the bouncer token, which in-app surfaces do not carry
(`LoginOptions.extra.bouncer_token` is the seam) — the modal will surface
the server's 403 verbatim there; hosted mode is the supported posture for
bouncer-enforcing deployments.

## Password tools (`portal-mojo/ui`)

- `checkPasswordStrength(password)` → `{score, strength, feedback, details}`
  — web-mojo MOJOUtils scoring, EXACT: length bands (+1/+3/+4), variety
  (+1 lower, +1 upper, +1 digits, +2 special), one -1 common-pattern
  penalty, common-password `max(0, score-3)`, thresholds <2/<4/<6/<8 →
  very-weak/weak/fair/good/strong, same feedback strings. 22 headless
  assertion groups verified the port (entropy classes, floors, praise
  lines, edge inputs).
- `generatePassword(options?)` — same option surface and guarantees
  (defaults incl. length 12, one char per included class, `customChars`
  override skips the guarantee, `excludeAmbiguous` strips i/l · I/O/L ·
  0/1 · |, length < 4 throws, empty pool throws). ONE documented deviation:
  crypto.getRandomValues + Fisher–Yates replaces web-mojo's Math.random and
  biased sort-shuffle — a non-crypto RNG in a password generator is a trap,
  not a feature.
- `<PasswordStrengthMeter password showFeedback? />` — 5-segment bar +
  label + feedback, colored via tokens through `data-strength`
  (bad/warn/info/ok), both themes free. Empty input renders an idle unlit
  state instead of the scorer's non-empty-string complaint.

## Mock affordances

Under the mock transport the pages show inline dev hints: password `mojo`
for any seeded user (e.g. `ian@mojoverify.com`); reset code `123456`; token
formats `pr:mock-<id>` / `ml:mock-<id>` for landing-page runs. The mock has
NO MFA endpoints and no 440 trigger — see MERGE-WIRE(mock) notes in the C3
report for the proposed additions.

## Deferred (explicitly)

- **OAuth redirect flows** — re-deferred with a code-level seam
  (`TODO(C3-deferred)` in auth.ts documents the full verified wire:
  `GET /api/auth/oauth/<provider>/begin` → `{auth_url, state}` → provider →
  backend callback → 302 to the frontend with `?code=&state=` →
  `POST …/complete`). Blocked on: server-side redirect-uri allowlisting,
  deployment-specific providers (`GET /api/auth/config` → `login.methods`),
  and no way to exercise the round-trip against the mock or without real
  provider credentials. Hosted pages cover OAuth deployments today.
- **Passkey real-authenticator verification** — the ceremony is fully
  built on auth.ts; verifying against a real authenticator + a live
  django-mojo passkey registration is Ian's post-merge pass.

## Pitfalls

- `auth/sms/send` BURNS the mfa_token it received and returns a new one —
  verifying with the old token fails. MfaPanel handles this; any new UI
  must too.
- Never route a 440 into the token-refresh path; the server chose 440
  precisely so 401-refresh machinery ignores it.
- `ml:`/`pr:` tokens are single-use: exchange exactly once (StrictMode
  double-effects will burn them — use a ref guard, as MagicPage does).
- The auth pages must stay OUTSIDE `RequireAuth` and OUTSIDE the App shell
  (they are route siblings, not children).
- Keep the `?auth_code=` scrub-before-network behavior in auth.ts intact —
  `handleAuthTokenLanding()` follows the same discipline for `?token=`.
