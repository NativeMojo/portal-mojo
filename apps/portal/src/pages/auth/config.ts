// Auth-mode config + return-route stash for the in-app auth pages (C3).
//
// The switch follows the app's env idiom (client.ts reads VITE_MOJO_API the
// same way): VITE_MOJO_AUTH ∈ 'inapp' | 'hosted'.
//   · 'inapp'  — unauthenticated users route to the in-app #/auth/login pages
//   · 'hosted' — unauthenticated users bounce to the django-mojo hosted
//     /auth pages (the bouncer pages, incl. their bot-check interstitial)
//   · unset    — hosted when a real backend is configured (VITE_MOJO_API
//     set), in-app under the mock (there IS no hosted page to bounce to).
// Unknown values fall back to that same default WITH a console.warn — never
// to "no auth at all" (house rule 4).
import { apiOrigin, usingMockTransport } from 'portal-mojo/client';

export type AuthMode = 'inapp' | 'hosted';

const RAW_MODE: string = import.meta.env.VITE_MOJO_AUTH ?? '';

function defaultMode(): AuthMode {
    return apiOrigin() ? 'hosted' : 'inapp';
}

/** The resolved auth mode for this deployment. */
export function authMode(): AuthMode {
    if (RAW_MODE === 'inapp') return 'inapp';
    if (RAW_MODE === 'hosted') {
        if (usingMockTransport()) {
            console.warn('VITE_MOJO_AUTH=hosted with no VITE_MOJO_API: there is no hosted auth page under the mock — falling back to in-app pages');
            return 'inapp';
        }
        return 'hosted';
    }
    if (RAW_MODE !== '') {
        console.warn(`Unknown VITE_MOJO_AUTH value ${JSON.stringify(RAW_MODE)} (expected 'inapp' | 'hosted') — falling back to '${defaultMode()}'`);
    }
    return defaultMode();
}

/** True when the in-app auth pages are the active sign-in surface. */
export function inAppAuthEnabled(): boolean {
    return authMode() === 'inapp';
}

// ── Return-route stash ────────────────────────────────────────────────
// The guard remembers where an unauthenticated visit was headed so the
// login/reset/magic pages can put the user back there. sessionStorage (not
// router state) because reset/magic land from an EMAIL — a fresh document
// with no in-app navigation history. Key is portal-namespaced; the hosted
// path keeps its own auth.ts-private stash ('mojo:auth-return-route').

const RETURN_KEY = 'portal:auth-return';

export function stashReturnRoute(route: string): void {
    try {
        if (route && route !== '/' && !route.startsWith('/auth')) sessionStorage.setItem(RETURN_KEY, route);
    } catch { /* storage denied — land on the default route */ }
}

/** Read AND clear the stashed route; '/' when none. */
export function consumeReturnRoute(): string {
    try {
        const route = sessionStorage.getItem(RETURN_KEY);
        if (route) {
            sessionStorage.removeItem(RETURN_KEY);
            return route;
        }
    } catch { /* storage denied */ }
    return '/';
}

// ── Reset-email carry (forgot → reset code step) ──────────────────────
// web-mojo parity ('reset_email' in mountAuth), portal-namespaced. Written
// when a code is requested so the reset page can prefill the email — and so
// a full page reload mid-flow doesn't lose it.

const RESET_EMAIL_KEY = 'portal:reset-email';

export function stashResetEmail(email: string): void {
    try { sessionStorage.setItem(RESET_EMAIL_KEY, email); } catch { /* storage denied */ }
}

export function peekResetEmail(): string {
    try { return sessionStorage.getItem(RESET_EMAIL_KEY) ?? ''; } catch { return ''; }
}

export function clearResetEmail(): void {
    try { sessionStorage.removeItem(RESET_EMAIL_KEY); } catch { /* storage denied */ }
}
