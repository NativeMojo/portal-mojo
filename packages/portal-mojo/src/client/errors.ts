// Error types for the mojo client. Own module so client.ts and auth.ts can
// both import them without a dependency cycle.

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
