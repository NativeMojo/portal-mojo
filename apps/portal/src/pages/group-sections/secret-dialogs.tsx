// group-sections/secret-dialogs.tsx — the show-once secret reveal dialog,
// shared by the API-key token echo and the webhook signing secret
// (GroupView.js _showApiKeyTokenDialog / _showWebhookSecretDialog).
//
// Deviation from source, documented: web-mojo used `backdrop:'static'` +
// `keyboard:false` so the dialog could not be dismissed accidentally. The
// portal's ModalManager always allows Escape/backdrop dismissal — mitigated
// by putting the copy affordance directly on the secret and confirming the
// copy with a state flash, so capturing the value is one obvious click.
import { useState, type ReactNode } from 'react';
import { modal } from 'portal-mojo/ui';

/** Copy helper with an execCommand fallback for insecure contexts. */
async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through to the legacy path
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

/** The monospace secret box with its inline copy button. */
export function SecretBox({ secret, ariaLabel }: { secret: string; ariaLabel: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <div className="ga-secret-box">
            <code className="ga-secret-value" aria-label={ariaLabel}>{secret}</code>
            <button
                type="button"
                className="btn btn-compact"
                title="Copy to clipboard"
                aria-label="Copy to clipboard"
                onClick={() => {
                    void copyText(secret).then((ok) => {
                        if (ok) {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1600);
                        }
                    });
                }}
            >
                <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'}`} /> {copied ? 'Copied' : 'Copy'}
            </button>
        </div>
    );
}

export interface SecretDialogOptions {
    title: string;
    /** The warning banner line ("Save this token now — …"). */
    warning: ReactNode;
    /** Lead line above the banner (e.g. "API key <b>x</b> created."). */
    intro?: ReactNode;
    secret: string;
    ariaLabel: string;
    /** Extra content under the box (permission chips, footnote). */
    footer?: ReactNode;
}

/** Awaitable show-once reveal dialog. Resolves when the operator closes it. */
export function showSecretDialog(opts: SecretDialogOptions): Promise<unknown> {
    return modal.open((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">{opts.title}</h2>
            {opts.intro && <div className="ga-secret-intro">{opts.intro}</div>}
            <div className="ga-secret-warning" role="alert">
                <i className="bi bi-exclamation-triangle-fill" />
                <span>{opts.warning}</span>
            </div>
            <SecretBox secret={opts.secret} ariaLabel={opts.ariaLabel} />
            {opts.footer}
            <div className="modal-actions">
                <button className="btn" onClick={() => close(null)}>Close</button>
            </div>
        </div>
    ), { size: 'lg' });
}
