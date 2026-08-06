import { useEffect, useMemo, useState } from 'react';
import { registerFieldType, type RegistryFieldProps } from '../../ui/field-registry';
import {
    HANDLER_DEFINITIONS, addHandlerStep, moveHandlerStep, parseHandlerChain, removeHandlerStep,
    serializeHandlerChain, updateHandlerStep, validateHandlerChain, type HandlerChain, type HandlerScheme,
} from './handler-dsl';

export interface HandlerChainBuilderProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    onValidationChange?: (valid: boolean, messages: string[]) => void;
}

function confirmLegacy(message: string): boolean {
    return typeof window !== 'undefined' && window.confirm(`${message}\n\nThis can change which handlers django-mojo dispatches. Continue?`);
}

export function HandlerChainBuilder({ value, onChange, disabled = false, onValidationChange }: HandlerChainBuilderProps) {
    const [chain, setChain] = useState<HandlerChain>(() => parseHandlerChain(value));
    useEffect(() => { if (serializeHandlerChain(chain) !== value) setChain(parseHandlerChain(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
    const issues = useMemo(() => validateHandlerChain(chain), [chain]);
    useEffect(() => onValidationChange?.(!issues.some((issue) => issue.level === 'error'), issues.map((issue) => issue.message)), [issues, onValidationChange]);
    const commit = (next: HandlerChain) => { setChain(next); onChange(serializeHandlerChain(next)); };
    const guarded = (indexes: number[], operation: (confirm: boolean) => HandlerChain, message: string) => {
        const legacy = indexes.some((index) => chain.steps[index]?.runtime !== 'effective');
        if (!legacy) return commit(operation(false));
        if (confirmLegacy(message)) commit(operation(true));
    };
    return <div className="handler-chain-builder">
        <div className="handler-chain-heading"><div><strong>Dispatch chain</strong><small>Order controls publication order; async completion may differ.</small></div><select className="input input-compact" aria-label="Add handler" disabled={disabled} value="" onChange={(event) => { if (event.target.value) commit(addHandlerStep(chain, event.target.value as HandlerScheme)); }}><option value="">Add handler…</option>{HANDLER_DEFINITIONS.map((definition) => <option key={definition.scheme} value={definition.scheme}>{definition.label}</option>)}</select></div>
        {!chain.steps.length && <div className="handler-chain-empty">No handler: matching events are recorded without dispatching an action.</div>}
        {chain.steps.map((step, index) => {
            const definition = HANDLER_DEFINITIONS.find((item) => item.scheme === step.scheme);
            const stepIssues = issues.filter((issue) => issue.step === index);
            return <section className={`handler-step${step.runtime !== 'effective' ? ' handler-step-warning' : ''}`} key={`${index}:${step.raw}`}>
                <header><span className="handler-order">{index + 1}</span><div><strong>{definition?.label ?? `${step.scheme ?? 'Malformed'} handler`}</strong><small>{step.runtime === 'effective' ? 'Runtime effective' : step.runtime === 'swallowed' ? `Swallowed into step ${(step.runtimeOwner ?? 0) + 1}` : 'Skipped by runtime'}</small></div><div className="handler-order-controls"><button type="button" className="btn btn-compact" disabled={disabled || index === 0} aria-label={`Move handler ${index + 1} up`} onClick={() => guarded([index, index - 1], (confirmed) => moveHandlerStep(chain, index, index - 1, { confirmBehaviorChange: confirmed }), 'Move legacy content?')}>↑</button><button type="button" className="btn btn-compact" disabled={disabled || index === chain.steps.length - 1} aria-label={`Move handler ${index + 1} down`} onClick={() => guarded([index, index + 1], (confirmed) => moveHandlerStep(chain, index, index + 1, { confirmBehaviorChange: confirmed }), 'Move legacy content?')}>↓</button><button type="button" className="btn btn-compact btn-danger" disabled={disabled} onClick={() => guarded([index], (confirmed) => removeHandlerStep(chain, index, { confirmBehaviorChange: confirmed }), 'Remove legacy content?')}>Remove</button></div></header>
                {step.supported && <div className="handler-step-fields"><label className="field"><span className="field-label">Type</span><select className="input" disabled={disabled} value={step.scheme ?? ''} onChange={(event) => commit(updateHandlerStep(chain, index, { scheme: event.target.value as HandlerScheme }))}>{HANDLER_DEFINITIONS.map((item) => <option key={item.scheme} value={item.scheme}>{item.label}</option>)}</select></label>{definition?.target !== 'none' && <label className="field"><span className="field-label">{definition?.target === 'targets' ? 'Targets (comma separated)' : 'Module path'}</span><input className="input" disabled={disabled} defaultValue={step.target} onBlur={(event) => { if (event.target.value !== step.target) commit(updateHandlerStep(chain, index, { target: event.target.value })); }} /></label>}</div>}
                {step.supported && <details className="handler-advanced"><summary>Advanced ordered parameters</summary>{step.params.length ? step.params.map((param, paramIndex) => <div className="handler-param" key={`${paramIndex}:${param.key}`}><code>{param.key || '(blank key)'}</code><input className="input input-compact" disabled={disabled} defaultValue={param.value} onBlur={(event) => { if (event.target.value !== param.value) commit(updateHandlerStep(chain, index, { param: { key: param.key, value: event.target.value } })); }} /><button type="button" className="btn btn-compact" disabled={disabled} onClick={() => commit(updateHandlerStep(chain, index, { removeParam: param.key }))}>Remove</button></div>) : <p className="dim">No query parameters.</p>}<button type="button" className="btn btn-compact" disabled={disabled} onClick={() => { const key = window.prompt('Parameter name'); if (key != null) commit(updateHandlerStep(chain, index, { param: { key, value: '' } })); }}>Add parameter</button></details>}
                <pre className="handler-raw">{step.raw}</pre>
                {stepIssues.map((issue, issueIndex) => <div className={`handler-issue handler-issue-${issue.level}`} key={issueIndex}>{issue.message}</div>)}
            </section>;
        })}
    </div>;
}

export function IncidentHandlerChainField({ value, disabled, commit }: RegistryFieldProps) {
    return <HandlerChainBuilder value={typeof value === 'string' ? value : ''} disabled={disabled} onChange={commit} />;
}

registerFieldType('incident-handler-chain', IncidentHandlerChainField);
