// Device Unique ID — a per-browser UUID django-mojo uses for device tracking
// and rate limiting. Sent on every request as the X-Mojo-UID header (web-mojo
// Rest parity, storage key included).

export const DUID_HEADER = 'X-Mojo-UID';
const DUID_KEY = 'mojo_device_uid';

let duid: string | null = null;

function generate(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/** Stable per-browser DUID; falls back to per-session when storage is blocked. */
export function getDuid(): string {
    if (duid) return duid;
    try {
        duid = localStorage.getItem(DUID_KEY);
        if (!duid) {
            duid = generate();
            localStorage.setItem(DUID_KEY, duid);
        }
    } catch {
        duid = generate();
    }
    return duid;
}
