// FK-object crash barrier (board #1602). django-mojo graphs expand FK fields
// per-graph, so a wire field that was a string yesterday is a row object
// today — and React throws "Objects are not valid as a React child" the
// moment one reaches JSX. Two layers, because no single check covers the
// class:
//
//   · safeNode()   — shallow value guard. Catches a plain object handed
//     directly to a render slot and degrades it to readable text
//     (fmt.code first, so `{code:'GC',…}` renders "GC", not a marker).
//     It CANNOT see an object nested inside a returned element
//     (`<code>{row.currency}</code>` is a valid element), nor a callback
//     that throws on the new shape (`row.currency.toUpperCase()`).
//   · RenderGuard  — a per-site error boundary that invokes the render
//     thunk inside its own subtree, so both of those land in
//     getDerivedStateFromError instead of white-screening the page.
//
// Both run in dev AND prod — the incident this ports from was production.
// Degrade visibly + warn once, never crash, never render nothing (rule 4).
import { Component, isValidElement, type ReactNode } from 'react';
import { code } from './format';
import { warnOnce } from './warn-once';

/**
 * Is this value safe to hand to React as a child? Shallow: primitives,
 * elements (anything carrying $$typeof — fragments, portals, lazy, memo),
 * and arrays of renderable values. Plain objects are not. Non-array
 * iterables (Set, Map, generators) are DELIBERATELY rejected even though
 * React can render some of them — as a wire value they are near-certainly
 * garbage, and degrading beats guessing.
 */
export function isRenderableNode(node: unknown): boolean {
    if (node == null || typeof node !== 'object') return true;
    if (isValidElement(node)) return true;
    if (Array.isArray(node)) return node.every(isRenderableNode);
    return false;
}

/**
 * Value-level guard for render slots fed raw wire data. Renderable input is
 * returned as-is (no allocation); a plain object degrades to
 * `fmt.code(value)` — the FK display string when the object carries one —
 * or a visible `[object]` marker, plus ONE console.warn naming the site.
 */
export function safeNode(node: ReactNode, context: string): ReactNode {
    if (isRenderableNode(node)) return node;
    warnOnce(`[portal-mojo] ${context} received a non-renderable object — render FK fields through fmt.code()`);
    return <span className="dim-italic">{code(node) || '[object]'}</span>;
}

function GuardedThunk({ label, children }: { label: string; children: () => ReactNode }) {
    return <>{safeNode(children(), label)}</>;
}

interface RenderGuardProps {
    /** Names the site in the console.warn ("ModelTable column \"currency\""). */
    label: string;
    /** Rendered on a caught error; defaults to a dim `[render error]` marker. */
    fallback?: ReactNode;
    /** The render thunk — invoked INSIDE the boundary so its throws are caught. */
    children: () => ReactNode;
}

/**
 * Per-site error boundary for app render callbacks. The thunk runs inside
 * the boundary's subtree, so a callback that throws on an unexpected wire
 * shape AND an object nested inside a returned element both degrade to the
 * fallback instead of unmounting the page. Resets on remount, so a re-render
 * of fresh data retries instead of sticking on the fallback.
 */
export class RenderGuard extends Component<RenderGuardProps, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        warnOnce(`[portal-mojo] ${this.props.label} failed to render — ${message}`);
    }

    render(): ReactNode {
        if (this.state.failed) {
            return this.props.fallback ?? <span className="dim-italic">[render error]</span>;
        }
        return <GuardedThunk label={this.props.label}>{this.props.children}</GuardedThunk>;
    }
}
