# auth — session client + hosted-auth bridge

```ts
import {
    initAuth, login, logout, onAuth, useAuthSnapshot,
    handleAuthCodeFromURL, hostedAuthUrl, redirectToHostedAuth,
    sendMagicLink, loginWithMagicToken, handleMagicTokenFromURL,
    forgotPassword, resetPasswordWithCode, resetPasswordWithToken,
    loginWithPasskey, isPasskeySupported,
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
