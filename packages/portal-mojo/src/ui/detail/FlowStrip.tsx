// FlowStrip — the horizontal "STEP 1 → STEP 2 → STEP 3" strip for records
// that describe a process (RuleSet triggering: Match → Bundle → Threshold →
// Re-trigger; incident triage; job lifecycle).
// Port of web-mojo src/core/views/data/FlowStrip.js.
//
//   ┌──────────┬──────────┬───────────┬────────────┐
//   │ STEP 1   │ STEP 2   │ STEP 3    │ STEP 4     │
//   │ Match  ✎ │ Bundle   │ Threshold │ Re-trigger │
//   │ value    │ value    │ value     │ value      │
//   │ hint     │ hint     │ hint      │ hint       │
//   └──────────┴──────────┴───────────┴────────────┘
//
// Deviations from source: `value`/`hint` were TRUSTED-HTML strings — they are
// ReactNode slots here (architecture rule 6); the per-step `action`/`actionData`
// pair that dispatched through the global action pipeline becomes one
// `onEditStep(step, index)` callback.
import type { CSSProperties, ReactNode } from 'react';
import type { Tone } from '../format';
import { normalizeTone } from './StatusPanel';

export interface FlowStep {
    /** Small uppercase eyebrow. Defaults to `STEP <n>`. */
    num?: string;
    title: string;
    /** Primary value line — a slot, so `<code>`/`<strong>` compose safely. */
    value?: ReactNode;
    /** Small descriptor under the value. */
    hint?: ReactNode;
    /** Renders the value in the muted-italic "not configured" style. */
    empty?: boolean;
    /** Colors the step's eyebrow + rail (per-step signal: which stage failed). */
    tone?: Tone;
    /** Opt a step OUT of the edit affordance when `onEditStep` is wired. */
    editable?: boolean;
    /** Tooltip on the edit button; defaults to `Edit <title>`. */
    editTitle?: string;
}

export function FlowStrip({ steps, onEditStep, editIcon = 'bi-pencil' }: {
    steps: FlowStep[];
    /** Wiring this renders a pencil on every step except `editable: false` ones. */
    onEditStep?: (step: FlowStep, index: number) => void;
    editIcon?: string;
}) {
    if (!steps.length) return null;
    // Column count rides a custom property so the container queries in CSS can
    // reflow it (4 → 2 → 1) off the strip's OWN width, not the viewport — it is
    // routinely nested inside an `lg` modal.
    const style = { '--flow-strip-cols': steps.length } as CSSProperties;

    return (
        <div className="detail-flow-strip" style={style}>
            {steps.map((step, i) => {
                const tone = normalizeTone(step.tone, 'FlowStrip');
                const canEdit = !!onEditStep && step.editable !== false;
                return (
                    <div key={`${step.title}-${i}`} className={`flow-strip-step tone-${tone}`}>
                        <div className="flow-strip-num">{step.num ?? `STEP ${i + 1}`}</div>
                        <div className="flow-strip-title">
                            {step.title}
                            {canEdit && (
                                <button
                                    type="button"
                                    className="btn-icon btn-icon-sm flow-strip-action"
                                    title={step.editTitle ?? `Edit ${step.title.toLowerCase()}`}
                                    aria-label={step.editTitle ?? `Edit ${step.title.toLowerCase()}`}
                                    onClick={() => onEditStep!(step, i)}
                                >
                                    <i className={`bi ${editIcon}`} />
                                </button>
                            )}
                        </div>
                        <div className={`flow-strip-value${step.empty ? ' flow-strip-empty' : ''}`}>{step.value}</div>
                        {step.hint != null && step.hint !== '' && <div className="flow-strip-hint">{step.hint}</div>}
                    </div>
                );
            })}
        </div>
    );
}
