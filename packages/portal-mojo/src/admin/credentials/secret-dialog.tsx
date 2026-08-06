import { useState, type ReactNode } from 'react';
import { modal } from '../../ui';

async function copyText(value: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch {
        // Fall through for insecure contexts.
    }
    try {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        return copied;
    } catch {
        return false;
    }
}

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
                        if (!ok) return;
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
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
    warning: ReactNode;
    intro?: ReactNode;
    secret: string;
    ariaLabel: string;
    footer?: ReactNode;
}

export function showSecretDialog(options: SecretDialogOptions): Promise<unknown> {
    return modal.open((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">{options.title}</h2>
            {options.intro && <div className="ga-secret-intro">{options.intro}</div>}
            <div className="ga-secret-warning" role="alert">
                <i className="bi bi-exclamation-triangle-fill" />
                <span>{options.warning}</span>
            </div>
            <SecretBox secret={options.secret} ariaLabel={options.ariaLabel} />
            {options.footer}
            <div className="modal-actions">
                <button className="btn" onClick={() => close(null)}>Close</button>
            </div>
        </div>
    ), { size: 'lg' });
}
