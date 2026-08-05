// Error types for the mojo client. Own module so client.ts and auth.ts can
// both import them without a dependency cycle.

export class MojoError extends Error {
    status: number;
    constructor(message: string, status = 0) {
        super(message);
        this.name = 'MojoError';
        this.status = status;
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
