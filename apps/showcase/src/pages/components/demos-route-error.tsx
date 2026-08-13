// RouteError gallery — the route-level last-resort card, rendered directly
// via RouteErrorCard (the showcase is a plain <HashRouter>, and
// useRouteError throws outside a data router — which is exactly why the
// presentational/hook split exists). onReload is stubbed on every sample so
// demo clicks never hard-reload the showcase.
import { RouteErrorCard, toast } from 'portal-mojo/ui';

const withStack = (() => {
    const err = new Error('Cannot read properties of undefined (reading \'currency\')');
    err.stack = `TypeError: Cannot read properties of undefined (reading 'currency')
    at PromoCodesPage (PromoCodesPage.tsx:63:41)
    at renderWithHooks (react-dom.development.js:15486:18)
    at mountIndeterminateComponent (react-dom.development.js:20103:13)`;
    return err;
})();

const mojoThrow = {
    status: 500,
    error: 'Envelope rejected: permission denied for group 7',
    code: 'permission_denied',
};

const notFound = {
    status: 404,
    statusText: 'Not Found',
    data: 'No route matches URL "/definitely-not-a-route"',
    internal: true,
};

export function RouteErrorDemo() {
    const stub = () => toast.info('reload suppressed (demo)');
    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">The error-handling ladder</div>
                <p className="dim" style={{ margin: '4px 0 0', maxWidth: 700 }}>
                    Per-site guards catch first (<code>safeNode</code>/<code>RenderGuard</code> — cells, sections),
                    then the chunk-only <code>LazyPageBoundary</code> (Retry card for stale deploys), and whatever
                    is left reaches the router: <code>errorElement: &lt;RouteError /&gt;</code> renders one of the
                    cards below. A pathless child wrapper keeps the app shell alive for page crashes; the root
                    level catches 404s and shell crashes and renders the card standalone.
                </p>
            </div>
            <div className="eyebrow" style={{ marginTop: 16 }}>Thrown Error (message + stack)</div>
            <RouteErrorCard error={withStack} onReload={stub} />
            <div className="eyebrow" style={{ marginTop: 16 }}>Object throw (mojo envelope — never "[object Object]")</div>
            <RouteErrorCard error={mojoThrow} onReload={stub} />
            <div className="eyebrow" style={{ marginTop: 16 }}>404 (unmatched route)</div>
            <RouteErrorCard error={notFound} onReload={stub} />
        </>
    );
}
