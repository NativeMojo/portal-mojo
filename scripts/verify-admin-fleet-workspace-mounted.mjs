// Synthetic transport, real mounted React components. Native focus/pixels are browser QA.
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'location', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLDialogElement', 'Event', 'MouseEvent', 'Node', 'localStorage', 'sessionStorage', 'CustomEvent']) globalThis[name] = dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react'), { act } = React;
const { createRoot } = await import('react-dom/client');
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const router = await import('react-router-dom');
const server = await createServer({ root: process.cwd(), appType: 'custom', logLevel: 'silent', define: { 'import.meta.env.VITE_MOJO_API': JSON.stringify('http://fleet-workspace.invalid') }, server: { middlewareMode: true } });
let root, qc, actor, history = [], transformInventory = null, transformPlan = null, transformBatch = null, failInventory = false, pausePlan = null, pauseApply = null, checks = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (fn, label) => {
    for (let i = 0; i < 180; i++) {
        await act(async () => sleep(15));
        if (fn()) return;
    }
    assert.fail(`Timed out: ${label}; ${document.body.textContent.slice(-2200)}`);
};
const text = () => document.body.textContent;
const disabled = node => !node || node.matches(':disabled');
const buttons = label => [...document.querySelectorAll('button')].filter(node => typeof label === 'string' ? node.textContent.trim() === label : label.test(node.textContent.trim()));
const button = label => buttons(label).find(node => !disabled(node)) ?? buttons(label)[0];
const click = async label => {
    await wait(() => button(label) && !disabled(button(label)), `${label} enabled`);
    await act(async () => button(label).click());
};
const input = label => {
    const wrapper = [...document.querySelectorAll('label')].find(node => (node.querySelector('.field-label')?.textContent.trim() ?? node.textContent.trim()) === label);
    return wrapper?.querySelector('input,select,textarea') ?? [...document.querySelectorAll('input,select,textarea')].find(node => node.getAttribute('aria-label') === label);
};
const field = async (label, value) => {
    const node = input(label);
    assert(node, `Field exists: ${label}`);
    assert(!disabled(node), `Field is editable: ${label}`);
    const prototype = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, String(value));
        node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
};
const checkInput = label => [...document.querySelectorAll('label')].find(node => node.textContent.includes(label))?.querySelector('input[type="checkbox"]');
const check = async label => {
    const node = checkInput(label);
    assert(node && !disabled(node), `Checkbox is available: ${label}`);
    await act(async () => node.click());
};
const posts = suffix => history.filter(row => row.method === 'POST' && row.path.endsWith(suffix));
const applies = () => posts('/plan/apply');
const plans = () => posts('/plan');
const review = () => document.querySelector('[aria-label="Review capacity plan"]');
const jsonResponse = answer => new Response(JSON.stringify(answer), { status: 200 });

try {
    const auth = await server.ssrLoadModule('/packages/portal-mojo/src/client/auth.ts');
    auth.initAuth();
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/operational-fleet-mock.ts');
    const { FleetPage } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/fleet/FleetPage.tsx');
    const { FleetOverview } = await server.ssrLoadModule('/packages/portal-mojo/src/admin/fleet/FleetOverview.tsx');
    const { ModalHost, modal } = await server.ssrLoadModule('/packages/portal-mojo/src/ui/modal.tsx');
    const ops = await server.ssrLoadModule('/packages/portal-mojo/src/admin/fleet/operations.ts');
    const jwt = id => `e30.${Buffer.from(JSON.stringify({ uid: id, exp: Date.now() / 1000 + 3600, iat: Date.now() / 1000, auth_time: Date.now() / 1000, ...(actor.credential_kind ? { credential_kind: actor.credential_kind } : {}) })).toString('base64url')}.mock`;
    const signIn = async next => {
        actor = next;
        await act(async () => auth.setTokens(jwt(actor.id), jwt(actor.id)));
    };
    globalThis.fetch = async (request, options = {}) => {
        const url = new URL(String(request));
        assert.equal(url.origin, 'http://fleet-workspace.invalid', 'Mounted verification must never contact a real host');
        const path = url.pathname, method = options.method ?? 'GET', body = options.body ? JSON.parse(options.body) : undefined, params = Object.fromEntries(url.searchParams);
        history.push({ path, method, body, params });
        if (path === '/api/user/me') return jsonResponse({ status: true, data: actor });
        if (path === '/api/aws/capacity' && failInventory) return jsonResponse({ status: false, code: 503, error_code: 'inventory_unavailable', error: 'Synthetic inventory unavailable' });
        const pause = path.endsWith('/plan/apply') ? pauseApply : path.endsWith('/plan') ? pausePlan : null;
        if (path.endsWith('/plan/apply')) pauseApply = null;
        if (path.endsWith('/plan')) pausePlan = null;
        let answer = mock.handleOperationalFleetMock(path, method, body, params, actor, Date.now() / 1000);
        assert.notEqual(answer, undefined, `Unexpected mock request: ${path}`);
        if (answer.status === true) {
            if (path === '/api/aws/capacity' && transformInventory) answer = { ...answer, data: transformInventory(answer.data) };
            if (path.endsWith('/plan') && transformPlan) answer = { ...answer, data: transformPlan(answer.data) };
            if (path.endsWith('/status') && transformBatch) answer = { ...answer, data: transformBatch(answer.data) };
        }
        if (pause) await pause();
        return jsonResponse(answer);
    };
    function App() {
        const location = router.useLocation();
        return React.createElement(React.Fragment, null,
            React.createElement(router.Link, { to: '/embedded/control' }, 'Dashboard route'),
            React.createElement(router.Link, { to: '/embedded/control/fleet' }, 'Fleet route'),
            location.pathname.endsWith('/fleet') ? React.createElement(FleetPage) : React.createElement(FleetOverview),
            React.createElement(ModalHost));
    }
    const mount = async (path = '/embedded/control/fleet') => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        qc.setQueryData(['me', String(actor.id)], actor);
        root = createRoot(document.getElementById('root'));
        await act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(router.MemoryRouter, { initialEntries: [path] }, React.createElement(React.StrictMode, null, React.createElement(App))))));
    };
    const unmount = async () => {
        await act(async () => { root?.unmount(); root = null; modal.closeAll(); });
        qc?.clear();
    };
    const reset = async (scenario = 'healthy', overrides = {}) => {
        await unmount();
        transformInventory = null; transformPlan = null; transformBatch = null; failInventory = false; pausePlan = null; pauseApply = null;
        mock.setMockOperationalFleetScenario(scenario);
        history = [];
        // Every case owns a distinct synthetic actor, so an unresolved prior batch cannot leak.
        await signIn({ id: 100 + checks, is_superuser: true, permissions: {}, ...overrides });
        await mount();
        await wait(() => document.querySelector('.fp-workspace') && !qc.isFetching(), 'Fleet workspace access resolved');
    };
    const openEditor = async () => {
        await click('Change capacity');
        await wait(() => input('Add app nodes') && !disabled(input('Add app nodes')), 'fresh editor inventory');
    };
    const stageNode = async () => {
        await field('Add app nodes', 1);
        await field('Healthy source', 'i-mockb');
    };
    const prepare = async () => {
        await openEditor();
        await stageNode();
        await click(/^Review changes/);
        await wait(() => review(), 'explicit server review');
    };
    const route = async label => {
        const link = [...document.querySelectorAll('a')].find(node => node.textContent === label);
        assert(link, `Embedded route exists: ${label}`);
        await act(async () => link.click());
    };

    await reset();
    assert.equal(document.querySelector('h1')?.textContent, 'Fleet', 'Standalone route owns the Fleet workspace heading');
    assert(!text().includes('203.0.113.10'), 'Detailed addressing stays in the inspector');
    await click('Inspect capacity');
    await click('Addresses');
    assert(document.querySelector('dialog')?.textContent.includes('203.0.113.10'), 'Inspector preserves synthetic address evidence');
    await click('Database');
    assert(document.querySelector('dialog')?.textContent.includes('db-reader-a') && document.querySelector('dialog')?.textContent.includes('db.t4g.medium'), 'Inspector keeps exact database members and current classes');
    assert(document.querySelector('dialog')?.textContent.includes('This process’s reader routing'), 'Reader routing remains serving-process evidence');
    await click('Close');
    checks++;

    await reset('aged-observations');
    const nodeEvidence = [...document.querySelectorAll('.fp-source')].find(node => node.querySelector('strong')?.textContent === 'App nodes');
    const sourceTime = nodeEvidence?.querySelector('time');
    assert(sourceTime && Math.abs(Date.now() - Date.parse(sourceTime.dateTime) - 15 * 60_000) < 5000, 'Source retains its actual fifteen-minute-old observation timestamp');
    // The render clock is captured before the async mock creates its timestamp, so a
    // few milliseconds can place this fixture on either side of the minute boundary.
    assert(/^Observed 1[45]m ago$/.test(sourceTime.textContent), 'Observation age is displayed beside its source');
    assert(nodeEvidence?.textContent.includes('healthy · stale'), 'Old observation age marks staleness without inventing a new source verdict');
    assert(document.querySelector('.fp-health')?.textContent.includes('Available'), 'Server availability remains authoritative when source observations are old');
    checks++;

    await reset('inventory-unavailable');
    assert(text().includes('Capacity observation unavailable'), 'Unavailable inventory is explicit');
    assert(document.querySelector('.fp-health')?.textContent.includes('Available'), 'Capacity inventory failure does not erase independent health evidence');
    assert(!button('Change capacity') && disabled(button('Inspect capacity')), 'Missing inventory offers no mutation editor or fabricated inspector');
    checks++;

    await reset();
    await openEditor();
    const capacityReads = history.filter(row => row.path === '/api/aws/capacity').length;
    assert(capacityReads >= 2, 'Opening an editor obtains inventory beyond workspace summary inventory');
    await field('Add app nodes', 1);
    assert.equal(input('Healthy source').value, '', 'A source is not silently chosen from inventory');
    assert(button(/^Review changes/).disabled, 'App additions require an explicit healthy source');
    assert.equal(plans().length, 0, 'Drafting does not auto-request a server plan');
    await field('Healthy source', 'i-mockb');
    await click('Placement');
    await field('Subnet override', 'invalid-placement');
    await click('Use placement');
    assert(text().includes('Enter a subnet-'), 'Invalid placement stays in its focused editor');
    await field('Subnet override', 'subnet-9244');
    await click('Use placement');
    await click('Database');
    await field('Size for db-reader-b', 'medium');
    await click('Redis');
    await field('Replicas for mock-redis', 2);
    await click('App nodes');
    assert.equal(input('Add app nodes').value, '1', 'Task navigation preserves app additions');
    assert.equal(input('Healthy source').value, 'i-mockb', 'Task navigation preserves explicit source');
    assert.equal(plans().length, 0, 'Task switching does not auto-request review');
    await click(/^Review changes/);
    await wait(() => review(), 'multi-task review');
    assert.deepEqual(plans().at(-1).body, { steps: [
        { action: 'add_node', source_instance: 'i-mockb', subnet_id: 'subnet-9244' },
        { action: 'resize_database', resource: 'db-reader-b', size: 'medium', apply_immediately: true },
        { action: 'set_cache_replicas', resource: 'mock-redis', count: 2, apply_immediately: true },
    ] }, 'One retained draft emits exact resources from all three tasks');
    checks++;

    await reset();
    transformInventory = report => ({ ...report, databases: report.databases.map(db => ({ ...db, members: db.members.map(member => member.id === 'db-reader-a' ? { ...member, can_resize: false, can_remove: true } : member.id === 'db-reader-b' ? { ...member, can_resize: true, can_remove: false } : member) })) });
    await openEditor();
    await click('Database');
    assert(input('Size for db-reader-a').disabled, 'Reader A resize follows its own capability');
    assert(checkInput('Remove reader db-reader-b').disabled, 'Reader B removal follows its own capability');
    await field('Size for db-reader-b', 'medium');
    await check('Remove reader db-reader-a');
    await click(/^Review changes/);
    await wait(() => review(), 'asymmetric database review');
    assert.deepEqual(plans().at(-1).body.steps, [
        { action: 'remove_reader', resource: 'db-reader-a' },
        { action: 'resize_database', resource: 'db-reader-b', size: 'medium', apply_immediately: true },
    ], 'Reader removal and resize target the exact independently selected IDs');
    assert(!plans().at(-1).body.steps.some(step => step.resource === 'db-writer'), 'Reader sizing never sweeps the writer');
    checks++;

    await reset();
    await openEditor();
    await click('Redis');
    await field('Replicas for mock-redis', 2);
    // The opposite control may be disabled, or a selected conflict may be rejected before review.
    if (!input('Size for mock-redis').disabled) {
        await field('Size for mock-redis', 'medium');
        assert(button(/^Review changes/).disabled, 'One group cannot stage resize and replica-count changes together');
        assert.equal(plans().length, 0, 'Conflicting Redis tasks never reach plan transport');
    } else assert(input('Size for mock-redis').disabled, 'Replica editing disables same-group resize');
    checks++;

    await reset();
    transformPlan = plan => ({ ...plan, order_note: 'Synthetic server order is authoritative', estimate_complete: false, total_monthly_delta_usd: null, steps: [...plan.steps].reverse().map((step, index) => ({ ...step, index, description: `Server step ${index + 1}: ${step.action}`, monthly_delta_usd: null, warnings: ['Synthetic interruption warning'] })) });
    await openEditor();
    await stageNode();
    await click('Remove nodes');
    await check('i-mockc');
    await click(/^Review changes/);
    await wait(() => review(), 'server-ordered review');
    const descriptions = [...review().querySelectorAll('li')].map(node => node.textContent);
    assert(descriptions[0].includes('Server step 1: terminate_node'), 'Review uses the server order rather than draft order');
    assert(review().textContent.includes('Synthetic server order is authoritative'), 'Review shows server order evidence');
    assert(review().textContent.includes('Price unknown') && review().textContent.includes('Synthetic interruption warning'), 'Unknown prices and server interruption evidence stay visible');
    assert(button('Apply reviewed plan').disabled, 'Review requires deliberate exact-plan consent');
    await check('I reviewed this exact plan');
    assert(!button('Apply reviewed plan').disabled, 'Current consent enables reviewed apply');
    const reviewedId = review().textContent;
    await click('Back to changes');
    assert(!review(), 'Back returns to the retained draft');
    await click(/^Review changes/);
    await wait(() => review(), 'review after Back');
    assert(button('Apply reviewed plan').disabled, 'Back invalidates consent even for an unchanged draft');
    assert.notEqual(review().textContent, reviewedId, 'Returning to review asks the server for a fresh stored plan');
    checks++;

    await reset('expired-plan');
    await prepare();
    await wait(() => review().textContent.toLowerCase().includes('expired'), 'server expiry is evaluated');
    assert(review().textContent.toLowerCase().includes('expired'), 'An already expired server plan is explained');
    assert(button('Apply reviewed plan').disabled, 'Expired plans cannot be submitted');
    assert.equal(applies().length, 0, 'Expired review has no apply side effect');
    checks++;

    await reset('reauth');
    let freshAuthCalls = 0;
    auth.setFreshAuthHandler(async () => { freshAuthCalls++; return true; });
    await openEditor();
    await stageNode();
    await click(/^Review changes/);
    await wait(() => freshAuthCalls === 1, 'fresh authentication requested for explicit review');
    assert.equal(plans().length, 1, 'Fresh-auth refusal never replays the plan request');
    assert(!review() && button(/^Review changes/).disabled, 'Fresh authentication requires another inventory observation and deliberate review');
    assert.equal(applies().length, 0, 'Authentication does not apply an unsent plan');
    auth.setFreshAuthHandler(null);
    checks++;

    await reset();
    await openEditor();
    await stageNode();
    await click('Database');
    await field('Add readers for mock-database', 1);
    await click('App nodes');
    // A deliberate query refresh must not silently replace a retained editor draft.
    await act(async () => qc.invalidateQueries());
    await wait(() => !qc.isFetching(), 'background inventory refresh');
    assert.equal(input('Add app nodes').value, '1', 'Background inventory refresh preserves unsent draft');
    failInventory = true;
    await click('Refresh and clear changes');
    await wait(() => text().includes('Synthetic inventory unavailable'), 'failed deliberate refresh is visible');
    assert.equal(input('Add app nodes').value, '0', 'The explicitly requested clear takes effect even if its new observation fails');
    assert(button(/^Review changes/).disabled, 'Failed refresh cannot review using stale inventory');
    failInventory = false;
    await click('Refresh and clear changes');
    await wait(() => input('Add app nodes')?.value === '0', 'explicit refresh clears draft');
    assert.equal(input('Healthy source').value, '', 'Explicit refresh also clears source and consent');
    await click('Database');
    assert.equal(input('Add readers for mock-database').value, '0', 'Explicit clear resets hidden task changes too');
    assert.equal(plans().length, 0, 'Refresh never submits a draft');
    checks++;

    await reset();
    await prepare();
    await check('I reviewed this exact plan');
    history = [];
    let releaseApply;
    pauseApply = () => new Promise(resolve => { releaseApply = resolve; });
    await act(async () => { button('Apply reviewed plan').click(); button('Apply reviewed plan')?.click(); });
    await wait(() => releaseApply, 'single apply in flight');
    assert.equal(applies().length, 1, 'Rapid apply clicks share one coordinator submission');
    assert.deepEqual(Object.keys(applies()[0].body), ['plan_id'], 'Apply transports only the reviewed stored plan ID');
    const planId = applies()[0].body.plan_id;
    await act(async () => releaseApply());
    await wait(() => text().includes('Capacity change in progress'), 'workspace batch receipt');
    await click('Close progress');
    await route('Dashboard route');
    await wait(() => button('View capacity progress'), 'Dashboard sees standalone submission');
    await click('View capacity progress');
    await wait(() => document.querySelector('[aria-label="Capacity progress"]'), 'shared Dashboard progress');
    assert(text().includes(planId), 'Dashboard observes the same stored plan');
    assert.equal(applies().length, 1, 'Route transitions never replay apply');
    for (let i = 0; i < 3; i++) await click('Refresh observation');
    await wait(() => text().includes('Batch completed'), 'shared batch reaches terminal evidence');
    checks++;

    await reset('uncertain-apply');
    await prepare();
    await check('I reviewed this exact plan');
    await click('Apply reviewed plan');
    await wait(() => text().includes('Apply outcome unknown'), 'lost apply response remains unresolved');
    assert.equal(applies().length, 1, 'Lost response was submitted once');
    await click('Close progress');
    failInventory = true;
    // Losing superuser mutation eligibility still leaves manage_aws status observation usable.
    actor = { ...actor, is_superuser: false, permissions: { manage_aws: true } };
    await act(async () => qc.setQueryData(['me', String(actor.id)], actor));
    await act(async () => qc.invalidateQueries());
    await wait(() => !qc.isFetching(), 'failed inventory observation settles');
    await wait(() => button('View capacity progress'), 'status-only action survives mutation eligibility loss');
    await click('View capacity progress');
    await wait(() => input('Batch ID from server logs'), 'ID-less recovery available without inventory');
    await field('Batch ID from server logs', mock.getMockOperationalFleetBatchIds()[0]);
    transformBatch = batch => ({ ...batch, plan_id: 'wrong-synthetic-plan' });
    await click('Refresh observation');
    await wait(() => text().includes('Batch identity does not match'), 'mismatched batch is rejected');
    assert.equal(ops.fleetOperations.get(ops.fleetSessionScope()).batchId, null, 'Wrong-plan observation cannot claim the outstanding operation');
    transformBatch = null;
    for (let i = 0; i < 3; i++) await click('Refresh observation');
    await wait(() => text().includes('Batch completed'), 'matching batch reconciles uncertainty without inventory');
    assert.equal(applies().length, 1, 'Reconciliation, eligibility loss, and inventory failure never replay a mutation');
    assert(history.some(row => row.path.endsWith('/status')), 'Status-only recovery uses the observation endpoint');
    checks++;

    await reset();
    await openEditor();
    await stageNode();
    let releasePlan;
    pausePlan = () => new Promise(resolve => { releasePlan = resolve; });
    await click(/^Review changes/);
    await wait(() => releasePlan, 'old actor plan pending');
    const replacement = { id: actor.id + 1000, is_superuser: false, permissions: { view_admin: true } };
    await signIn(replacement);
    await wait(() => !document.querySelector('dialog'), 'session replacement closes owned workspace editor');
    await act(async () => releasePlan());
    assert(!review(), 'Late plan cannot populate the replacement actor editor');
    assert.equal(ops.fleetOperations.get(ops.fleetSessionScope()).status, 'idle', 'Replacement actor inherits no operation');
    assert.equal(applies().length, 0, 'Actor change never submits the old review');
    checks++;

    await unmount();
    history = [];
    await signIn({ id: 9001, is_superuser: false, permissions: { view_admin: true } });
    await mount();
    await wait(() => text().includes('Restricted') || text().includes('capacity access') || text().includes('manage_aws'), 'read permission explanation');
    assert(!history.some(row => row.path.startsWith('/api/aws/capacity')), 'Denied capacity reader emits zero capacity requests');
    assert(!button('Change capacity'), 'Dashboard-only grant cannot open capacity changes');
    checks++;
    console.log(`PASS mounted standalone Fleet workspace: ${checks} behavior groups (explicit tasks/review, exact IDs, server order, retained draft, single-flight, shared progress and no-replay recovery)`);
    ops.fleetOperations.dispose();
} finally {
    if (root) await act(async () => root.unmount());
    await server.close();
    dom.window.close();
}
