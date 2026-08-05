// Client-side JWT inspection — decode only, NO signature verification (the
// server is the authority; the client only needs expiry/identity hints).
// Ported from web-mojo TokenManager's Token class.

export interface JwtPayload {
    uid?: string | number;
    sub?: string | number;
    user_id?: string | number;
    email?: string;
    name?: string;
    username?: string;
    exp?: number;
    iat?: number;
    [claim: string]: unknown;
}

/** Decode a JWT payload (URL-safe base64, padded). Null on any malformation. */
export function decodeJwt(token: string | null | undefined): JwtPayload | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
        let base64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
        const padding = 4 - (base64.length % 4);
        if (padding !== 4) base64 += '='.repeat(padding);
        return JSON.parse(atob(base64)) as JwtPayload;
    } catch {
        return null;
    }
}

export interface JwtInfo {
    raw: string;
    payload: JwtPayload;
    uid: string | null;
    email: string | null;
    name: string | null;
    exp: Date | null;
    iat: Date | null;
    /** Decodable and (when an exp claim exists) not past it. No exp ⇒ valid. */
    isValid: boolean;
    isExpired: boolean;
    expiringSoon(thresholdMinutes?: number): boolean;
    /** Minutes since iat, or null when the claim is absent. */
    ageMinutes(): number | null;
}

/** Inspect a token. Null when the token is missing or undecodable. */
export function tokenInfo(token: string | null | undefined): JwtInfo | null {
    const payload = decodeJwt(token);
    if (!payload || !token) return null;
    const nowSec = () => Math.floor(Date.now() / 1000);
    const isExpired = payload.exp != null ? nowSec() >= payload.exp : false;
    return {
        raw: token,
        payload,
        uid: payload.uid != null ? String(payload.uid)
            : payload.sub != null ? String(payload.sub)
            : payload.user_id != null ? String(payload.user_id) : null,
        email: payload.email ?? null,
        name: payload.name ?? payload.username ?? null,
        exp: payload.exp ? new Date(payload.exp * 1000) : null,
        iat: payload.iat ? new Date(payload.iat * 1000) : null,
        isValid: !isExpired,
        isExpired,
        expiringSoon(thresholdMinutes = 5) {
            if (payload.exp == null) return false;
            return payload.exp - nowSec() <= thresholdMinutes * 60;
        },
        ageMinutes() {
            if (payload.iat == null) return null;
            return Math.floor((nowSec() - payload.iat) / 60);
        },
    };
}
