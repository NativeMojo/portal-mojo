// Guardrail — the "are you sure, and here is WHY" stop in front of a change
// that takes a tenant dark, moves money, or cannot be undone if made by
// accident. One shape for every breaking knob so the operator learns to read
// it: what happens the moment it lands, why that is dangerous (concrete
// consequences, not adjectives), how to get back — and, for the sharpest
// knobs, a typed literal before the button arms.
//
// Promoted from wmx-admin-v2 `src/lib/guardrail.tsx` (bc3e900) verbatim in
// contract and markup so the app's copy keeps working when it swaps the
// import. Built on the native-<dialog> `modal.open` stack, so it stacks
// correctly over a formModal that is still open.
//
// Which stop to reach for:
//   · `modal.confirm`    — reversible / low blast radius; a yes-no.
//   · `ArmedButton`      — irreversible, needs no input, inline (row actions).
//   · `confirmGuardrail` — anything that takes a tenant dark, moves money, or
//                          can't be undone — the operator must read WHY.
//
// Usage — `if (!(await confirmGuardrail({...}))) return;` before the mutation.
// The dialog resolves false on Escape / backdrop / Cancel, true only on the
// armed confirm button.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { modal } from './modal';

export interface Guardrail {
    /** Question form, naming the target: "Disable Alea for Club Axo?" */
    title: string;
    /** What happens the moment this lands — present tense, one or two sentences. */
    effect: ReactNode;
    /** Why it is dangerous — each item one concrete consequence. */
    why: ReactNode[];
    /** How to get back, or that you can't. */
    undo?: ReactNode;
    confirmText: string;
    cancelText?: string;
    /**
     * Highest tier: the operator must type this literal (the brand name, a
     * count, "DISABLE") before the confirm button arms. Compared trimmed and
     * case-insensitively.
     */
    typeToConfirm?: string;
    /** false = primary button + warn tint for a stop that is not destructive. Default true. */
    danger?: boolean;
}

function GuardrailBody({ g, close }: { g: Guardrail; close: (v: boolean) => void }) {
    const [typed, setTyped] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const needsTyping = Boolean(g.typeToConfirm);
    const armed = !needsTyping || typed.trim().toLowerCase() === g.typeToConfirm!.trim().toLowerCase();
    const danger = g.danger !== false;

    useEffect(() => {
        if (needsTyping) inputRef.current?.focus();
    }, [needsTyping]);

    return (
        <div className={danger ? 'modal-pad guardrail' : 'modal-pad guardrail guardrail-warn'}>
            <h2 className="modal-title">
                <i className={`bi ${danger ? 'bi-exclamation-octagon-fill' : 'bi-exclamation-triangle-fill'} guardrail-icon`} /> {g.title}
            </h2>
            <div className="modal-message">
                <p className="guardrail-effect">{g.effect}</p>
                <div className="guardrail-why">
                    <div className="guardrail-why-head">Why this is dangerous</div>
                    <ul>
                        {g.why.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                </div>
                {g.undo && (
                    <p className="guardrail-undo"><i className="bi bi-arrow-counterclockwise" /> {g.undo}</p>
                )}
                {needsTyping && (
                    <label className="guardrail-type">
                        <span>Type <b>{g.typeToConfirm}</b> to confirm</span>
                        <input
                            ref={inputRef}
                            className="input"
                            value={typed}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => setTyped(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && armed) close(true); }}
                        />
                    </label>
                )}
            </div>
            <div className="modal-actions">
                <button type="button" className="btn" onClick={() => close(false)}>{g.cancelText ?? 'Cancel'}</button>
                <button
                    type="button"
                    className={danger ? 'btn btn-danger' : 'btn btn-primary'}
                    disabled={!armed}
                    onClick={() => close(true)}
                >
                    {g.confirmText}
                </button>
            </div>
        </div>
    );
}

/** Open the guardrail and resolve true only when the operator confirms. */
export function confirmGuardrail(g: Guardrail): Promise<boolean> {
    return modal.open<boolean>((close) => <GuardrailBody g={g} close={close} />, { size: 'sm' })
        .then((v) => v === true);
}

/**
 * Diff helper for config-form saves: which of the watched keys changed
 * between what the form was seeded with and what came back. Lets a save
 * confirm ONLY the fields that break things (environment, currency codes…)
 * and pass silently otherwise.
 */
export function changedKeys(
    initial: Record<string, unknown>,
    next: Record<string, unknown>,
    watch: readonly string[],
): string[] {
    return watch.filter((k) => {
        const a = initial[k]; const b = next[k];
        const norm = (v: unknown) => (v == null || v === '' ? '' : String(v));
        return norm(a) !== norm(b);
    });
}
