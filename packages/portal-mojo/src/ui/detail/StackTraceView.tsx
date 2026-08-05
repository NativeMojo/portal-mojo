// StackTraceView — colorized stack traces, JavaScript AND Python.
// Port of web-mojo src/core/views/data/StackTraceView.js.
//
//   TypeError: Cannot read properties of undefined      ← error line
//     at handleSubmit (app/views/JobDetails.js:214:19)  ← function + location
//     File "mojo/jobs/runner.py", line 412, in _execute ← python frame
//
// Deviations from source:
//   · RE-THEMED. The source shipped a hardcoded light-only <style> block
//     (#f8f9fa surface, #dc3545/#0d6efd/#6610f2 text) that was unreadable in
//     dark mode. This renders semantic classes over theme tokens, correct in
//     BOTH themes.
//   · Long traces COLLAPSE to `collapseAfter` lines behind a toggle instead of
//     only being capped by a scroll box.
//   · The source only colored an exception on line 0, so every Python
//     traceback — which opens with "Traceback (most recent call last):" and
//     puts the exception LAST — rendered its most important line as plain
//     context. An anchored exception-line pattern now catches it anywhere.
import { useMemo, useState } from 'react';

// Ported verbatim from the source, in the source's match order.
const JS_CALL = /(.+?)\s*\(([^:]+):(\d+):(\d+)\)/;      // at fn (file.js:123:45)
const JS_AT = /^\s*at\s+([^:]+):(\d+):(\d+)/;           // at file.js:123:45
const PY_FRAME = /File\s+"([^"]+)",\s+line\s+(\d+),\s+in\s+(.+)/;
// Extension: `ValueError: …`, `django.db.utils.IntegrityError: …`, bare
// `KeyboardInterrupt`. The trailing `(?::|$)` is what keeps ordinary prose
// ("Error handling request") out of the error style.
const EXCEPTION = /^[A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit)(?::|$)/;

type Line =
    | { kind: 'blank' }
    | { kind: 'error'; text: string }
    | { kind: 'js-call'; indent: string; lead: string; fn: string; file: string; line: string; col: string }
    | { kind: 'js-at'; indent: string; file: string; line: string; col: string }
    | { kind: 'py'; indent: string; file: string; line: string; fn: string }
    | { kind: 'frame'; text: string }
    | { kind: 'context'; text: string };

function parseLine(raw: string, index: number): Line {
    if (!raw.trim()) return { kind: 'blank' };

    // Error message: the source's first-line rule, plus any anchored
    // exception line (where Python puts it).
    const trimmed = raw.trim();
    if ((index === 0 && (raw.includes('Error:') || raw.includes('Exception:'))) || EXCEPTION.test(trimmed)) {
        return { kind: 'error', text: raw };
    }
    // Matched frames are re-composed from their captures, so the original
    // indentation is carried explicitly — it is what keeps a Python frame
    // aligned with the source line under it, terminal-style.
    const indent = raw.match(/^\s*/)![0];

    const call = raw.match(JS_CALL);
    if (call) {
        // The capture greedily includes the frame keyword ("at handleSubmit").
        // Split it off so only the identifier reads as an identifier.
        const captured = call[1]!.trim();
        const lead = captured.startsWith('at ') ? 'at ' : '';
        return { kind: 'js-call', indent, lead, fn: captured.slice(lead.length), file: call[2]!, line: call[3]!, col: call[4]! };
    }

    const at = raw.match(JS_AT);
    if (at) return { kind: 'js-at', indent, file: at[1]!, line: at[2]!, col: at[3]! };

    const py = raw.match(PY_FRAME);
    if (py) return { kind: 'py', indent, file: py[1]!, line: py[2]!, fn: py[3]! };

    if (trimmed.startsWith('at ')) return { kind: 'frame', text: raw };
    return { kind: 'context', text: raw };
}

/** Non-string traces (an error payload object) are pretty-printed first. */
function toText(trace: unknown): string {
    if (typeof trace === 'string') return trace;
    if (trace == null) return '';
    try {
        return JSON.stringify(trace, null, 2);
    } catch {
        return String(trace);
    }
}

export function StackTraceView({ trace, collapseAfter = 24, emptyText = 'No stack trace available' }: {
    /** The raw trace; objects are JSON-pretty-printed. */
    trace: unknown;
    /** Lines shown before the "show all" toggle. 0 disables collapsing. */
    collapseAfter?: number;
    emptyText?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const text = toText(trace);
    const lines = useMemo(() => text.split('\n').map(parseLine), [text]);

    if (!text) return <div className="stack-trace-empty dim">{emptyText}</div>;

    const collapsible = collapseAfter > 0 && lines.length > collapseAfter;
    const shown = collapsible && !expanded ? lines.slice(0, collapseAfter) : lines;

    return (
        <div className="stack-trace-view">
            <div className="stack-trace-body">
                {shown.map((line, i) => {
                    switch (line.kind) {
                        case 'blank':
                            return <div key={i} className="stack-trace-line">&nbsp;</div>;
                        case 'error':
                            return <div key={i} className="stack-trace-line stack-trace-error">{line.text}</div>;
                        case 'js-call':
                            return (
                                <div key={i} className="stack-trace-line stack-trace-frame">
                                    <span className="stack-trace-loc">{line.indent}{line.lead}</span>
                                    <span className="stack-trace-fn">{line.fn}</span>
                                    <span className="stack-trace-loc">
                                        {' ('}{line.file}:<span className="stack-trace-lineno">{line.line}</span>:{line.col}{')'}
                                    </span>
                                </div>
                            );
                        case 'js-at':
                            return (
                                <div key={i} className="stack-trace-line stack-trace-frame">
                                    <span className="stack-trace-loc">
                                        {line.indent}at {line.file}:<span className="stack-trace-lineno">{line.line}</span>:{line.col}
                                    </span>
                                </div>
                            );
                        case 'py':
                            return (
                                <div key={i} className="stack-trace-line stack-trace-frame">
                                    <span className="stack-trace-loc">
                                        {line.indent}File "{line.file}", line <span className="stack-trace-lineno">{line.line}</span>, in{' '}
                                    </span>
                                    <span className="stack-trace-fn">{line.fn}</span>
                                </div>
                            );
                        case 'frame':
                            return <div key={i} className="stack-trace-line stack-trace-frame">{line.text}</div>;
                        default:
                            return <div key={i} className="stack-trace-line stack-trace-context">{line.text}</div>;
                    }
                })}
            </div>
            {collapsible && (
                <button type="button" className="stack-trace-toggle" onClick={() => setExpanded((v) => !v)}>
                    <i className={`bi ${expanded ? 'bi-chevron-up' : 'bi-chevron-down'}`} />
                    {expanded ? `Show first ${collapseAfter} lines` : `Show all ${lines.length} lines`}
                </button>
            )}
        </div>
    );
}
