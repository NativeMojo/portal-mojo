// Route-level error card (board #1604) — the LAST-RESORT backstop behind
// the per-site guards (#1602 safeNode/RenderGuard) and the chunk-only
// LazyPageBoundary (#1557, narrowed by this item): 404s, shell crashes,
// auth chunk failures, and page render crashes rethrown by the boundary.
// Wire it as `errorElement` at two levels (see docs/route-error.md): a
// pathless wrapper keeps the app shell alive for page crashes; the root
// level catches 404s + shell crashes and renders bare, so the card is
// styled to stand alone. Token classes only — no CSS file of its own.
import { Link, useRouteError } from 'react-router-dom';
import { describeRouteError, isNotFoundError } from './route-error';

export interface RouteErrorCardProps {
    error: unknown;
    /** Back-to-home target (default '/'). */
    homeTo?: string;
    /**
     * Replaces the hard `window.location.reload()` on both actions — the
     * showcase demo stubs this so live clicks never reload the app.
     */
    onReload?: () => void;
}

/**
 * Presentational card — takes the error as a prop so hosts outside a data
 * router (the showcase's plain <HashRouter>) can render it. Inside a data
 * router use `RouteError`, which reads `useRouteError()` for you.
 */
export function RouteErrorCard({ error, homeTo = '/', onReload }: RouteErrorCardProps) {
    const reload = onReload ?? (() => window.location.reload());
    // Belt and braces on Back-to-home: navigating clears router error state,
    // and the delayed reload flushes any wedged module state. Suppressed when
    // onReload is injected (demo hosts must not hard-reload themselves).
    const homeSideEffect = onReload ? undefined : () => setTimeout(() => window.location.reload(), 50);

    if (isNotFoundError(error)) {
        return (
            <div className="panel panel-pad" role="alert" style={{ maxWidth: 640, margin: '48px auto' }}>
                <h3><i className="bi bi-signpost-split" /> Page not found</h3>
                <p className="dim">
                    Nothing lives at <code>{typeof location !== 'undefined' ? location.hash || location.pathname : ''}</code>.
                    The link may be stale, or the page may have moved.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <Link className="btn btn-primary" to={homeTo} onClick={homeSideEffect}>
                        <i className="bi bi-house" /> Back to home
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="panel panel-pad" role="alert" style={{ maxWidth: 720, margin: '48px auto' }}>
            <h3><i className="bi bi-bug" /> This page hit a rendering error</h3>
            <p className="dim">The rest of the portal is fine — this one view crashed. The details below are what a developer needs:</p>
            <pre style={{ whiteSpace: 'pre-wrap' }}><code>{describeRouteError(error)}</code></pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-primary" onClick={reload}>
                    <i className="bi bi-arrow-clockwise" /> Reload
                </button>
                <Link className="btn" to={homeTo} onClick={homeSideEffect}>
                    <i className="bi bi-house" /> Back to home
                </Link>
            </div>
        </div>
    );
}

/** Data-router wrapper: `errorElement: <RouteError />`. */
export function RouteError({ homeTo }: { homeTo?: string }) {
    const error = useRouteError();
    return <RouteErrorCard error={error} homeTo={homeTo} />;
}
