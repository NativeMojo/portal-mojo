# auth — session client + hosted-auth bridge

```ts
import {
    initAuth, login, logout, onAuth, useAuthSnapshot,
    handleAuthCodeFromURL, hostedAuthUrl, redirectToHostedAuth,
    sendMagicLink, loginWithMagicToken, handleMagicTokenFromURL,
    forgotPassword, resetPasswordWithCode, resetPasswordWithToken,
    loginWithPasskey, isPasskeySupported,
    // self-service, signed in (the AccountModal's wire — see account.md)
    registerPasskey, isPasskeyRegistrationSupported, suggestPasskeyName,
    passkeyErrorMessage, confirmEmailChange, revokeOtherSessions,
} from 'portal-mojo/client';
```

## Boot (once, before render)

```ts
initAuth();                       // installs the pre-request gate + Authorization header + refresh watcher
void handleAuthCodeFromURL();     // returning from the hosted /auth pages (no-op otherwise)
onAuth('login',  () => queryClient.invalidateQueries());   // identity changed →
onAuth('logout', () => queryClient.invalidateQueries());   // every cached answer is suspect
```

## Session mechanics

- JWT pair (`access_token`/`refresh_token`); single-flight refresh (3
  concurrent 401s → ONE refresh POST); pre-request gate throws a synthetic
  `AuthRequiredError` instead of firing doomed requests.
- `useAuthSnapshot()` → `{authenticated, uid, email}` — live, cross-tab.
- `logout()` is client-side (django-mojo has no logout endpoint) and emits
  `'logout'`.
- Events for `onAuth`: `'login' | 'logout' | 'refreshed' | 'refresh-failed'
  | 'unauthorized'`.

Both localStorage and sessionStorage keep the existing token keys. Refresh
preserves the chosen storage, including sessions with only a valid refresh token
at boot. Password login can replace malformed/expired credentials without the
old dead session blocking its own recovery request.

## Packaged Django Admin

The generic auth client has no Admin side effects. The packaged app installs
its app-local source coordinator before `initAuth`, awaits hosted exchange and
source readiness before creating its router, and wraps all lazy loaders.
It uses the page's own API origin and hosted auth. Source grants renew at 70%
of their effective lifetime, independently of access-token refresh; focus and
suspended-tab recovery recheck the grant. Eager recovery preserves the route.

The app's `revokeAdminSourceSession()` first persists a nonsecret logout
tombstone, clears credentials, then waits for the shared exclusive Web Lock and
the completed `DELETE <admin>/_session` response. It must be awaited by app
sign-out callers; generic `logout()` retains its existing synchronous semantics
for ordinary toolkit consumers. All legacy/gate/Portal participants share
`mojo:admin-source-session:v1` (lock and channel) and
`mojo:admin-source-generation:v1` (authoritative localStorage record and per-tab
sessionStorage binding). No credentials appear in coordination messages/storage.

The complete app contract is in the producer repository's
`docs/admin-artifact.md`; the frozen source fixture is
`scripts/fixtures/admin-source-session-v1.json`. Django owns real cookie race
and protected-browser acceptance against the exact artifact manifest digest.

## Hosted auth pages (the django-mojo "bouncer" pages)

The backend serves themed login/register pages at `<origin>/auth` (behind
its bot-check interstitial). Flow:

1. `redirectToHostedAuth()` — stashes the current hash route in
   sessionStorage, then navigates to
   `<origin>/auth?redirect=<HASH-FREE current url>`. Hash-free is
   load-bearing: the page string-appends `?auth_code=<code>` to the
   redirect, and a `#` in it would swallow the code.
2. User signs in on the hosted page; it mints a single-use 60s handoff code
   (`POST /api/auth/handoff`) and navigates back with `?auth_code=`.
3. `handleAuthCodeFromURL()` (boot) exchanges it (`POST /api/auth/exchange`),
   scrubs the code from the URL synchronously, restores the stashed route.
   Handles a hash-embedded `#/route?auth_code=` landing too.

`hostedAuthUrl()` returns null under the mock transport — there is no page
to host; the UI should fall back to a dev affordance (`__mojo.login(...)`).

## Direct flows (for in-app auth pages)

`login(username, password)` → `{kind: 'authenticated', user}` or an MFA challenge;
magic-link (`sendMagicLink` → `loginWithMagicToken`), password reset (code
and token variants), passkeys (`loginWithPasskey`; ceremony fully ported,
mock validates shape only). All reject with the server's message on
failure.

## Self-service credential changes (signed in)

- `isPasskeyRegistrationSupported()` — `PublicKeyCredential` **and**
  `navigator.credentials.create` (`isPasskeySupported()` only checks `get`).
- `registerPasskey(name?)` — fresh-auth `POST /api/account/passkeys/register/begin`
  → `navigator.credentials.create` → fresh-auth `…/register/complete
  {challenge_id, credential, friendly_name}`. `transports` rides at the
  credential's top level; `id === rawId`. Returns the saved row; callers
  refresh `PasskeyModel` and `me`. Default name `suggestPasskeyName()`.
- `passkeyErrorMessage(err)` — one copy for every passkey ceremony (login,
  step-up, registration): NotAllowedError → "Passkey prompt was dismissed",
  InvalidStateError → already registered, SecurityError → wrong domain/HTTPS,
  AbortError → cancelled; anything else (server text) as written.
- `confirmEmailChange(code)` — `POST /api/auth/email/change/confirm`; the
  server rotates `auth_key` and answers a new login, adopted into the
  storage this session already uses (`sessionIsPersistent()`).
- `revokeOtherSessions()` — fresh-auth `POST /api/auth/sessions/revoke`;
  every other session dies, the returned login is adopted so this one stays.

Registration ceremony built; real-authenticator check pending. The rest of
the account wire (TOTP, recovery codes, phone, verify, preferences) is in
[account.md](account.md).
