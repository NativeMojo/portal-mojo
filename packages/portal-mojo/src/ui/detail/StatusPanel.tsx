// StatusPanel — the hero "current state" banner that opens a record's
// Overview section (incident triage, job lifecycle, runner alive/dead).
// Port of web-mojo src/core/views/data/StatusPanel.js.
//
//   ┌───────────────────────────────────────────────────────────┐
//   │  ● STATE                             [ primary ] [ alt ]  │
//   │  Headline line                                            │
//   │  Optional supporting meta line · with <code>fragments</code>
//   └───────────────────────────────────────────────────────────┘
//
// Deviation from source (architecture rule 6): `meta` was a TRUSTED-HTML
// string with a "caller must escape" contract, and `actions` was a
// {label, icon, variant, action} array dispatched through the global action
// pipeline. Both are ReactNode slots here — the caller composes `<code>` /
// `<button onClick>` directly, so the escaping contract cannot be broken.
import type { ReactNode } from 'react';
import type { Tone } from '../format';

/**
 * The tone vocabulary shared by the detail primitives. web-mojo's set was
 * {default, primary, success, info, warning, danger, secondary}; portal-mojo's
 * `Tone` folds default/secondary into `muted`, so Badge, StatusPanel, FlowStrip
 * and Timeline all speak one vocabulary.
 */
export const DETAIL_TONES = new Set<string>(['success', 'warning', 'danger', 'info', 'muted', 'primary']);

/**
 * Runtime guard for tones that arrive as wire data (`tone: row.status_tone`)
 * rather than literals. Unknown values fall back to `muted` WITH a warn —
 * never to rendering nothing (architecture rule 4).
 */
export function normalizeTone(tone: Tone | string | null | undefined, where: string): Tone {
    if (tone == null || tone === '') return 'muted';
    if (DETAIL_TONES.has(tone)) return tone as Tone;
    console.warn(`[${where}] unknown tone ${JSON.stringify(tone)} — falling back to "muted". Valid: ${[...DETAIL_TONES].join(', ')}`);
    return 'muted';
}

export interface StatusPanelProps {
    /** Tints the panel surface and colors the state eyebrow + dot. */
    tone?: Tone;
    /** Small uppercase eyebrow beside the dot ("RUNNING", "ACKNOWLEDGED"). */
    state?: string;
    /** The dominant line — what the operator reads first. */
    headline?: ReactNode;
    /** Supporting line; a slot, so `<code>`/`<strong>` compose safely. */
    meta?: ReactNode;
    /** bootstrap-icons name; replaces the tone dot when given. */
    icon?: string;
    /** Buttons row. A slot — the caller owns the handlers. */
    actions?: ReactNode;
}

export function StatusPanel({ tone, state, headline, meta, icon, actions }: StatusPanelProps) {
    const t = normalizeTone(tone, 'StatusPanel');
    return (
        <div className={`detail-status-panel tone-${t}`}>
            <div className="detail-status-headline">
                {state && (
                    <div className="detail-status-state">
                        {icon
                            ? <i className={`bi ${icon} detail-status-icon`} />
                            : <span className="detail-status-dot" />}
                        {state}
                    </div>
                )}
                {headline != null && headline !== '' && <div className="detail-status-line">{headline}</div>}
                {meta != null && meta !== '' && <div className="detail-status-meta">{meta}</div>}
            </div>
            {actions && <div className="detail-status-actions">{actions}</div>}
        </div>
    );
}
