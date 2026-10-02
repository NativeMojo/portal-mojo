// Error types for the mojo client, and the one reader for inside-the-200
// refusals. Own module so client.ts, auth.ts and action-result.ts can all
// import them without a dependency cycle: client.ts's unwrap builds its
// refusal error from readActionResult (#5922).

export class MojoError extends Error {
    status: number;
    /** Semantic django-mojo error code (`s3_operation_incomplete`, etc.). */
    errorCode: string | number | undefined;
    /** Structured, server-sanitized failure evidence. Never log indiscriminately. */
    data: unknown;
    constructor(message: string, status = 0, errorCode?: string | number, data?: unknown) {
        super(message);
        this.name = 'MojoError';
        this.status = status;
        this.errorCode = errorCode;
        this.data = data;
    }
}

/**
 * Thrown by the pre-request auth gate when the access token is expired and
 * cannot be refreshed. The transport recognizes it and short-circuits the
 * request WITHOUT calling fetch — web-mojo's "synthetic 401". web-mojo
 * resolved a 401-shaped response object (its Rest never rejects); here the
 * same short-circuit REJECTS, per the failure-is-unmissable rule.
 */
export class AuthRequiredError extends MojoError {
    reason: 'unauthorized';
    constructor(message = 'Authentication required') {
        super(message, 401);
        this.name = 'AuthRequiredError';
        this.reason = 'unauthorized';
    }
}

export interface ActionResult {
    /** False when the handler refused inside the 200. */
    ok: boolean;
    /** Semantic refusal code (`WRONG_STATUS`, `MISSING_DETAILS`, …). */
    code?: string;
    /** Server-provided human error text. */
    error?: string;
    /** Envelope ⊕ action dict (action fields win) — one-shot secrets,
     *  counts etc. read from here regardless of wire shape. */
    payload: Record<string, unknown>;
}

/**
 * The one reader for django-mojo refusals inside an HTTP 200: flat
 * `{success:false}`, wrapped `{data:{success:false}}`, and the payload
 * `status:false` spelling (`revoke_sessions`). A refusal with no string
 * `error` falls back to a string `message` — diagnostics and provider
 * refusals put the human text there.
 */
export function readActionResult(out: unknown): ActionResult {
    const env = (typeof out === 'object' && out !== null ? out : {}) as Record<string, unknown>;
    const data = (typeof env.data === 'object' && env.data !== null ? env.data : {}) as Record<string, unknown>;
    const payload = { ...env, ...data };
    const refused = env.success === false
        || data.success === false
        || data.status === false; // the `status`-spelling oddball (revoke_sessions)
    const code = typeof payload.code === 'string' && payload.code ? payload.code : undefined;
    const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    const error = text(payload.error) ?? (refused ? text(payload.message) : undefined);
    return { ok: !refused, code, error, payload };
}

/**
 * A refused action or call. `status` is 200 on purpose — the HTTP layer
 * succeeded; the HANDLER said no. `errorCode` carries the refusal code,
 * `data` the merged payload (may hold evidence like the current row status).
 * `action` labels the message: the action name from the action layer, the
 * request path from unwrap.
 */
export class ActionRefusedError extends MojoError {
    result: ActionResult;
    constructor(action: string, result: ActionResult) {
        super(
            result.error ?? (result.code ? `${action} refused (${result.code})` : `${action} was refused by the server`),
            200,
            result.code,
            result.payload,
        );
        this.name = 'ActionRefusedError';
        this.result = result;
    }
}
