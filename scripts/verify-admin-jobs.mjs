// verify-admin-jobs — headless contract assertions for board #1288
// (Admin: Jobs engine — dashboard, runners, queue ops, scheduled tasks).
//
// Covers what a browser pass cannot cheaply prove: that the permission clauses
// are system-pinned AND that the scheduled-tasks gate is deliberately a
// DIFFERENT clause from the other three routes; that the section's generated
// routes land where the docs say at both mounts; that every jobs surface is a
// modal.detail with no RightPanel anywhere; that the normalizers can never let
// an unsorted job list reach the wire; and that the mock still speaks the
// exact django-mojo wire — the required-param 400s, the confirm token, Python
// truthiness on `cancel_request`, the republishing retry, the purge key split,
// the three different outcomes of a "wrong" filter key, the unpaged runner
// list, and the owner fallback the scheduled-tasks page exists to close.
//
// Mutating assertions run LAST and are scoped (purge is filtered to a single
// status) so earlier fixtures stay intact.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

globalThis.window = {
    addEventListener() {}, removeEventListener() {}, confirm: () => true,
    location: { hash: '', pathname: '/', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
/** Comments deliberately NAME what was dropped, so "must not appear"
 *  assertions run against code only. */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

try {
    const me = await server.ssrLoadModule('/packages/portal-mojo/src/client/me.ts');
    const mock = await server.ssrLoadModule('/packages/portal-mojo/src/client/mock.ts');
    const models = await server.ssrLoadModule('/packages/portal-mojo/src/admin/jobs/models.ts');
    const columns = await server.ssrLoadModule('/packages/portal-mojo/src/admin/jobs/columns.tsx');
    const form = await server.ssrLoadModule('/packages/portal-mojo/src/admin/jobs/scheduled-task-form.tsx');
    const admin = await server.ssrLoadModule('/packages/portal-mojo/src/admin/index.ts');
    const menus = await server.ssrLoadModule('/packages/portal-mojo/src/ui/menu-registry.ts');

    // ── 1. Permission clauses: exact, sys.-pinned, fail-closed ────────
    assert.deepEqual(models.JOBS_VIEW_PERMS, ['sys.manage_jobs', 'sys.view_jobs', 'sys.jobs']);
    assert.deepEqual(models.JOBS_MANAGE_PERMS, ['sys.manage_jobs', 'sys.jobs']);
    assert.deepEqual(models.SCHEDULED_TASK_VIEW_PERMS, ['sys.jobs', 'sys.view_scheduled_tasks']);
    assert.deepEqual(models.SCHEDULED_TASK_MANAGE_PERMS, ['sys.jobs', 'sys.manage_scheduled_tasks']);

    const CLAUSES = {
        JOBS_VIEW_PERMS: models.JOBS_VIEW_PERMS,
        JOBS_MANAGE_PERMS: models.JOBS_MANAGE_PERMS,
        SCHEDULED_TASK_VIEW_PERMS: models.SCHEDULED_TASK_VIEW_PERMS,
        SCHEDULED_TASK_MANAGE_PERMS: models.SCHEDULED_TASK_MANAGE_PERMS,
    };
    // A member holding every name in every clause — prefixed AND unprefixed —
    // must satisfy none of them: the whole domain is `requires_global_perms`.
    const memberGrants = { permissions: {} };
    for (const clause of Object.values(CLAUSES)) {
        for (const permission of clause) {
            memberGrants.permissions[permission] = true;
            memberGrants.permissions[permission.replace(/^sys\./, '')] = true;
        }
    }
    for (const [name, clause] of Object.entries(CLAUSES)) {
        assert(Array.isArray(clause) && clause.length > 0, `${name} is a non-empty clause`);
        assert(clause.every((permission) => permission.startsWith('sys.')), `${name} is system-pinned`);
        assert.equal(me.hasPermission({ id: 1, permissions: {} }, clause, memberGrants), false,
            `member grants cannot satisfy ${name}`);
        assert.equal(me.hasPermission(null, clause, null), false, `${name} is fail-closed while anonymous`);
        // `owner` is a BACKEND clause member; carrying it client-side would
        // turn a personal list into an "admin" page (see docs correction 10).
        assert(!clause.includes('sys.owner') && !clause.includes('owner'), `${name} drops the owner clause`);
    }
    // The scheduled-task clauses are genuinely DIFFERENT sets — not aliases.
    assert(!models.SCHEDULED_TASK_VIEW_PERMS.includes('sys.view_jobs'),
        'ScheduledTask.VIEW_PERMS does not contain view_jobs');
    assert(!models.SCHEDULED_TASK_VIEW_PERMS.includes('sys.manage_jobs'));
    assert(!models.SCHEDULED_TASK_VIEW_PERMS.includes('sys.manage_scheduled_tasks'),
        'manage_scheduled_tasks does NOT imply view (docs correction 13)');

    // ── 2. Section registration, routes and the gate difference ───────
    const section = admin.JOBS_ADMIN_SECTION;
    assert(admin.ADMIN_SECTIONS.includes(section), 'JOBS_ADMIN_SECTION is registered in ADMIN_SECTIONS');
    assert.equal(section.id, 'jobs');
    assert.equal(section.basePath ?? section.id, 'jobs');
    assert.equal(section.navigationGroup, 'operations');
    assert.deepEqual(section.routes.map((route) => route.path), ['', 'runners', 'list', 'scheduled-tasks']);
    assert.deepEqual(section.routes.map((route) => route.label),
        ['Dashboard', 'Runners', 'Jobs', 'Scheduled Tasks']);
    // Route gates are NOT uniform — that is the point.
    const gateOf = (path) => section.routes.find((route) => route.path === path).permissions;
    for (const path of ['', 'runners', 'list']) {
        assert.deepEqual(gateOf(path), models.JOBS_VIEW_PERMS, `route '${path}' gates on JOBS_VIEW_PERMS`);
    }
    assert.deepEqual(gateOf('scheduled-tasks'), models.SCHEDULED_TASK_VIEW_PERMS,
        'the scheduled-tasks route gates on SCHEDULED_TASK_VIEW_PERMS, not JOBS_VIEW_PERMS');
    // The section gate is the ANY-OF UNION of the route gates, deduped.
    assert.deepEqual(
        [...section.permissions].sort(),
        [...new Set([...models.JOBS_VIEW_PERMS, ...models.SCHEDULED_TASK_VIEW_PERMS])].sort(),
        'section permissions are the union of the route gates',
    );
    assert(section.permissions.includes('sys.view_scheduled_tasks'),
        'a scheduled-tasks-only operator can still reach the section');

    const standalone = admin.adminSectionRoutes([section]).map((route) => route.path);
    const embedded = admin.adminSectionRoutes([section], { mount: '/system' }).map((route) => route.path);
    for (const path of ['jobs', 'jobs/runners', 'jobs/list', 'jobs/scheduled-tasks']) {
        assert(standalone.includes(path), `standalone route ${path}`);
        assert(embedded.includes(`system/${path}`), `embedded route system/${path}`);
    }
    // `path: ''` means the dashboard IS #/jobs — no generated landing redirect.
    assert.equal(standalone.filter((path) => path === 'jobs').length, 1,
        'the index route and the landing redirect do not both claim /jobs');
    assert(section.routes.every((route) => !route.path.includes(':')),
        'record details are modal-owned — no child routes');

    // The sidenav entry must agree with the page gate, or a jobs.viewer gets a
    // menu item that opens a permission notice.
    const menu = admin.adminSectionsMenu([section], { grouped: true });
    const operations = menu.items.find((item) => item.id === admin.ADMIN_NAVIGATION_GROUPS.operations.id);
    assert(operations, 'the section lands under the Operations navigation group');
    const itemFor = (label) => operations.children.find((child) => child.label === label);
    const ctx = (permissions) => ({ me: { id: 1, permissions }, member: null, group: null });
    const viewerCtx = ctx({ view_jobs: true });          // the mock's jobs.viewer
    const tasksCtx = ctx({ view_scheduled_tasks: true });
    const catchAllCtx = ctx({ jobs: true });             // the mock's showcase.operator
    for (const label of ['Dashboard', 'Runners', 'Jobs']) {
        assert.equal(menus.itemVisible(itemFor(label), viewerCtx), true, `view_jobs reveals ${label}`);
        assert.equal(menus.itemVisible(itemFor(label), tasksCtx), false,
            `view_scheduled_tasks alone does not reveal ${label}`);
    }
    assert.equal(menus.itemVisible(itemFor('Scheduled Tasks'), viewerCtx), false,
        'view_jobs must NOT reveal Scheduled Tasks — it cannot read the system list');
    assert.equal(menus.itemVisible(itemFor('Scheduled Tasks'), tasksCtx), true);
    for (const label of ['Dashboard', 'Runners', 'Jobs', 'Scheduled Tasks']) {
        assert.equal(menus.itemVisible(itemFor(label), catchAllCtx), true, `the jobs catch-all reveals ${label}`);
        assert.equal(menus.itemVisible(itemFor(label), { me: null, member: null, group: null }), false,
            `${label} is fail-closed while anonymous`);
    }

    // ── 3. KISS modals: modal.detail everywhere, RightPanel nowhere ───
    const jobsDir = new URL('../packages/portal-mojo/src/admin/jobs/', import.meta.url);
    const jobsFiles = [];
    for (const entry of await readdir(jobsDir, { withFileTypes: true, recursive: true })) {
        if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
            jobsFiles.push(`${entry.parentPath ?? entry.path}/${entry.name}`.replace(`${root}`, ''));
        }
    }
    assert(jobsFiles.length >= 17, `the jobs package is fully scanned (found ${jobsFiles.length} files)`);
    const jobsSources = Object.fromEntries(await Promise.all(
        jobsFiles.map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')]),
    ));
    const allJobsSource = Object.values(jobsSources).join('\n');
    for (const opener of ['showJobDetail', 'showRunnerDetail', 'showScheduledTaskDetail']) {
        assert.match(allJobsSource, new RegExp(`export function ${opener}\\b`), `${opener} is exported`);
    }
    assert.equal((allJobsSource.match(/modal\.detail\(/g) ?? []).length >= 3, true,
        'each inspector opens through modal.detail');
    for (const [file, source] of Object.entries(jobsSources)) {
        assert.doesNotMatch(stripComments(source), /RightPanel|useRightPanel/, `${file} must not touch the RightPanel`);
        assert.doesNotMatch(stripComments(source), /dangerouslySetInnerHTML|innerHTML/,
            `${file} uses ReactNode slots, never HTML strings`);
    }
    // Operations that do not exist stay ABSENT, not disabled.
    assert.doesNotMatch(stripComments(allJobsSource), /Run now|run_now|runNow/i, 'no Run Now control ships (django-mojo #1309)');
    assert.doesNotMatch(stripComments(allJobsSource), /\bDrain\b|Restart runner/, 'no Drain/Restart runner buttons');
    assert.doesNotMatch(stripComments(allJobsSource), /jobs\/health|api\/jobs\/publish/, 'the dead endpoints are never called');
    assert.doesNotMatch(stripComments(allJobsSource), /runner\.version|\bversion\b:/, 'there is no runner version field');
    assert.doesNotMatch(stripComments(allJobsSource), /ordering:/, 'the backend never reads an `ordering` param');

    // ── 4. Normalizers: a sort ALWAYS reaches the wire ────────────────
    const NORMALIZERS = {
        normalizeJobListParams: '-created',
        normalizeJobEventListParams: '-at',
        normalizeJobLogListParams: '-created',
        normalizeScheduledTaskListParams: '-created',
        normalizeTaskResultListParams: '-created',
    };
    for (const [name, fallback] of Object.entries(NORMALIZERS)) {
        const normalize = models[name];
        assert.equal(normalize({}).sort, fallback, `${name} defaults to ${fallback}`);
        assert.equal(normalize({ sort: 'created' }).sort, 'created', `${name} preserves an explicit sort`);
        // An empty sort must not survive as an empty string — that would reach
        // the wire and reinstate the model's `-id` uuid ordering.
        assert.equal(normalize({ sort: '' }).sort, fallback, `${name} rejects an empty sort`);
        const stripped = normalize({ graph: 'admin', download_format: 'csv', nonsense_key: 1, sort: '-created' });
        assert.equal('graph' in stripped, false, `${name} strips graph overrides`);
        assert.equal('download_format' in stripped, false, `${name} strips download_format`);
        assert.equal('nonsense_key' in stripped, false, `${name} drops unknown filter keys client-side`);
    }
    // The segment presets are the params store, not component state.
    const segmentParams = Object.fromEntries(models.JOB_STATUSES.map((status) => [status, status]));
    assert(segmentParams.pending, 'job statuses are seeded');
    const segments = Object.fromEntries(columns.JOB_SEGMENTS.map((preset) => [preset.key, preset.params]));
    assert.deepEqual(Object.keys(segments), ['running', 'queued', 'scheduled', 'failed', 'all']);
    assert.equal(segments.running.status, 'running');
    assert.equal(segments.queued.status, 'pending');
    assert.equal(String(segments.queued.run_at__isnull), 'true');
    assert.equal(segments.scheduled.status, 'pending');
    assert.equal(String(segments.scheduled.run_at__isnull), 'false');
    assert.equal(segments.failed.status, 'failed');
    assert.equal(columns.jobSegmentOf('pending', 'false'), 'scheduled');
    assert.equal(columns.jobSegmentOf('pending', 'true'), 'queued');
    assert.equal(columns.jobSegmentOf(null, null), 'all');
    // The export is a bounded CLIENT projection — never the server's.
    const sanitized = columns.sanitizeJobRowForExport({
        id: 'x', channel: 'default', func: 'f', status: 'failed',
        payload: { secret: 1 }, metadata: { secret: 1 }, last_error: 'boom',
    });
    assert.deepEqual(sanitized.payload, {}, 'the scrubber blanks the payload');
    assert.deepEqual(sanitized.metadata, {}, 'the scrubber blanks the metadata');
    assert.equal(sanitized.last_error, '', 'the scrubber blanks the raw exception string');
    assert.equal(sanitized.id, 'x', 'and keeps the identifying fields');
    const exportedFields = new Set(
        (await read('packages/portal-mojo/src/admin/jobs/columns.tsx'))
            .split('JOB_EXPORTER')[1]
            .match(/key: '([^']+)'/g)
            ?.map((entry) => entry.slice(6, -1)) ?? [],
    );
    assert(exportedFields.has('id') && exportedFields.has('status'), 'the safe exporter declares a projection');
    for (const forbidden of ['payload', 'metadata', 'last_error']) {
        assert.equal(exportedFields.has(forbidden), false, `the export projection excludes ${forbidden}`);
    }

    // ── 5. Derived rules match the SERVICE, not the model property ────
    assert.equal(models.canRetryJob({ status: 'canceled' }), true, 'retry is allowed on canceled (service rule)');
    assert.equal(models.canRetryJob({ status: 'expired' }), true);
    assert.equal(models.canRetryJob({ status: 'failed' }), true);
    assert.equal(models.canRetryJob({ status: 'running' }), false);
    assert.equal(models.canCancelJob({ status: 'running' }), true);
    assert.equal(models.canCancelJob({ status: 'completed' }), false);
    assert.equal(models.channelSeverity({ queued_count: 0, inflight_count: 0, runners: 0 }), 'critical',
        'zero runners is critical regardless of depth');
    assert.equal(models.channelSeverity({ queued_count: 60, inflight_count: 0, runners: 1 }), 'warning');
    assert.equal(models.channelSeverity({ queued_count: 101, inflight_count: 0, runners: 1 }), 'critical');
    assert.equal(models.jobStatusTone('nonsense'), 'muted', 'an unknown status falls back, never to nothing');

    // ── 6. Scheduled-task validation mirrors the model's _validate ────
    const base = {
        ...form.emptyScheduledTaskDraft(),
        name: 'x', task_type: 'llm', run_times: ['09:00'], job_config: { user_prompt: 'hi' },
    };
    assert.deepEqual(form.validateScheduledTaskDraft(base), []);
    assert(form.validateScheduledTaskDraft({ ...base, run_times: ['09:00', '10:00', '11:00'] })
        .includes('run_times cannot have more than 2 entries'));
    assert(form.validateScheduledTaskDraft({ ...base, run_times: ['9:00'] })
        .includes('Invalid time format: 9:00. Use HH:MM'));
    assert(form.validateScheduledTaskDraft({ ...base, run_times: ['29:00'] })
        .includes('Invalid time value: 29:00'));
    assert(form.validateScheduledTaskDraft({ ...base, run_days: [7] })
        .includes('Invalid weekday: 7. Must be 0-6 (Mon=0)'));
    assert(form.validateScheduledTaskDraft({ ...base, notify: ['pager'] })
        .includes('Invalid notify channel: pager'));
    assert(form.validateScheduledTaskDraft({ ...base, channel: '' }).some((m) => m.includes('non-empty string')));
    assert(form.validateScheduledTaskDraft({ ...base, channel: 'bad:name' }).some((m) => m.includes('Invalid job channel')));
    assert(form.validateScheduledTaskDraft({ ...base, task_type: 'nope' }).includes('Invalid task_type: nope'));
    assert(form.validateScheduledTaskDraft({ ...base, job_config: {} })
        .includes('LLM task requires a user_prompt in job_config'));
    assert(form.validateScheduledTaskDraft({ ...base, task_type: 'webhook', job_config: {} })
        .includes('Webhook task requires a url in job_config'));
    assert(form.validateScheduledTaskDraft({ ...base, task_type: 'job', job_config: {} })
        .includes('Job task requires a func in job_config'));
    // The save body never carries a server-owned field.
    const changes = form.scheduledTaskChanges({ ...base, run_days: [4, 0] });
    assert.deepEqual(changes.run_days, [0, 4], 'run_days are sorted before they reach the wire');
    for (const key of ['id', 'user', 'run_count', 'last_run', 'last_error', 'created', 'modified']) {
        assert.equal(key in changes, false, `the changes body must not carry ${key}`);
    }
    // task_type is immutable once created (the JSONField merge would strand
    // the previous type's keys inside job_config).
    assert.match(await read('packages/portal-mojo/src/admin/jobs/scheduled-task-form.tsx'),
        /value=\{draft\.task_type\} disabled=\{editing\}/, 'the task type select is disabled while editing');

    // ── 7. The wire, as three different identities ────────────────────
    const login = async (email) => {
        const response = await mock.mockFetch('/api/login', { method: 'POST', body: { username: email, password: 'mojo' } });
        assert.equal(response.status, true, `login failed for ${email}`);
        return { Authorization: `Bearer ${response.data.access_token}` };
    };
    const viewer = await login('jobs.viewer@nativemojo.com');      // view_jobs only
    const operator = await login('jobs.operator@nativemojo.com');  // manage_jobs + both task grants
    const ordinary = await login('ian@mojoverify.com');            // no global jobs grant

    // Anonymous is denied everywhere.
    for (const path of ['/api/jobs/stats', '/api/jobs/runners', '/api/jobs/job', '/api/jobs/scheduled_task']) {
        assert.equal((await mock.mockFetch(path, {})).error_code, 401, `${path} denies anonymous callers`);
    }

    // Reads: the viewer sees everything except the manage-gated config.
    const VIEWER_READS = [
        '/api/jobs/stats', '/api/jobs/runners', '/api/jobs/runners/sysinfo',
        '/api/jobs/control/channels', '/api/jobs/control/queue-sizes',
        '/api/jobs/job', '/api/jobs/event', '/api/jobs/logs',
    ];
    for (const path of VIEWER_READS) {
        assert.equal((await mock.mockFetch(path, { headers: viewer })).status, true, `viewer may read ${path}`);
        assert.equal((await mock.mockFetch(path, { headers: ordinary })).error_code, 403,
            `${path} needs a global jobs grant`);
    }
    assert.equal((await mock.mockFetch('/api/jobs/control/config', { headers: viewer })).error_code, 403,
        'control/config is the one read gated on MANAGE');
    assert.equal((await mock.mockFetch('/api/jobs/control/config', { headers: operator })).status, true);

    // Writes: every control-plane mutation 403s for the viewer.
    const WRITES = [
        ['/api/jobs/runners/ping', { runner_id: 'runner-mojo-web-01-engine' }],
        ['/api/jobs/runners/shutdown', { runner_id: 'runner-mojo-web-01-engine' }],
        ['/api/jobs/runners/broadcast', { command: 'status' }],
        ['/api/jobs/control/clear-stuck', { channel: 'default' }],
        ['/api/jobs/control/manual-reclaim', { channel: 'default' }],
        ['/api/jobs/control/purge', { days_old: 30, dry_run: true }],
        ['/api/jobs/control/reset-failed', {}],
        ['/api/jobs/control/clear-queue', { channel: 'default', confirm: 'yes' }],
        ['/api/jobs/control/cleanup-consumers', {}],
        ['/api/jobs/control/rebuild-scheduled', {}],
        ['/api/jobs/control/force-scheduler-lead', {}],
        ['/api/jobs/control/test', { channel: 'default' }],
        ['/api/jobs/tests', {}],
    ];
    for (const [path, body] of WRITES) {
        assert.equal((await mock.mockFetch(path, { method: 'POST', headers: viewer, body })).error_code, 403,
            `${path} refuses a view-only operator`);
    }

    // ── 8. Runner list, sysinfo states and top-level result keys ──────
    const runnersPaged = await mock.mockFetch('/api/jobs/runners', {
        headers: operator, params: { start: 0, size: 1, sort: '-runner_id', search: 'nope' },
    });
    const runnersAll = await mock.mockFetch('/api/jobs/runners', { headers: operator });
    // Compare identity and ordering, not the heartbeat timestamps — those are
    // recomputed per call because they are live Redis JSON.
    assert.deepEqual(
        runnersPaged.data.map((runner) => runner.runner_id),
        runnersAll.data.map((runner) => runner.runner_id),
        'GET runners ignores start/size/sort/search — it is not a paged model endpoint',
    );
    assert.equal(runnersPaged.count, runnersAll.count, 'and its count is the whole fleet');
    assert(runnersAll.count >= 3);
    for (const runner of runnersAll.data) {
        assert.equal(runner.id, runner.runner_id, 'the view stamps id = runner_id');
        assert.equal('version' in runner, false, 'there is no version field in the heartbeat');
        assert.equal(typeof runner.last_heartbeat, 'string', 'heartbeats are ISO strings, not epochs');
        assert.equal(typeof runner.alive, 'boolean');
    }
    const dead = runnersAll.data.find((runner) => runner.alive === false);
    assert(dead, 'the fixture keeps a dead runner');
    assert.equal(models.runnerHealth(dead).key, 'down');
    // Three distinct sysinfo states.
    const healthy = await mock.mockFetch('/api/jobs/runners/sysinfo/runner-mojo-web-01-engine', { headers: operator });
    assert.equal(healthy.data.status, 'success');
    assert(healthy.data.result.memory && healthy.data.result.disk && healthy.data.result.network);
    const errored = await mock.mockFetch('/api/jobs/runners/sysinfo/runner-mojo-web-02-engine', { headers: operator });
    assert.equal(errored.status, true, 'an inner failure still rides a SUCCESSFUL envelope');
    assert.equal(errored.data.status, 'error');
    const silent = await mock.mockFetch('/api/jobs/runners/sysinfo/runner-mojo-batch-01-engine', { headers: operator });
    assert.equal(silent.error_code, 404, 'a runner that never answers is a 404 envelope');
    // Top-level (not `data`) result keys.
    const ping = await mock.mockFetch('/api/jobs/runners/ping', {
        method: 'POST', headers: operator, body: { runner_id: 'runner-mojo-web-01-engine' },
    });
    assert.equal(ping.runner_id, 'runner-mojo-web-01-engine');
    assert.equal(ping.responsive, true);
    assert.equal('data' in ping, false, 'ping answers with TOP-LEVEL fields');
    const broadcast = await mock.mockFetch('/api/jobs/runners/broadcast', {
        method: 'POST', headers: operator, body: { command: 'status' },
    });
    assert.equal(broadcast.command, 'status');
    assert.equal(typeof broadcast.responses_count, 'number');
    assert.equal('data' in broadcast, false, 'broadcast answers with TOP-LEVEL fields');
    assert.equal((await mock.mockFetch('/api/jobs/runners/broadcast', {
        method: 'POST', headers: operator, body: { command: 'nope' },
    })).error_code, 400, 'an unsupported broadcast command is a 400');
    assert.equal((await mock.mockFetch('/api/jobs/runners/ping', { method: 'POST', headers: operator, body: {} })).error_code, 400);

    // ── 9. requires_params 400s and the confirm token ─────────────────
    assert.equal((await mock.mockFetch('/api/jobs/control/clear-stuck', { method: 'POST', headers: operator, body: {} })).error_code, 400,
        'clear-stuck without a channel is a 400 — there is NO all-channel form');
    assert.equal((await mock.mockFetch('/api/jobs/control/clear-stuck', {
        method: 'POST', headers: operator, body: { channel: null },
    })).error_code, 400, 'channel:null (web-mojo\'s "All Channels") is an instant 400');
    assert.equal((await mock.mockFetch('/api/jobs/control/manual-reclaim', { method: 'POST', headers: operator, body: {} })).error_code, 400);
    assert.equal((await mock.mockFetch('/api/jobs/control/purge', { method: 'POST', headers: operator, body: {} })).error_code, 400,
        'purge without days_old is a 400');
    assert.equal((await mock.mockFetch('/api/jobs/control/clear-queue', {
        method: 'POST', headers: operator, body: { channel: 'default' },
    })).error_code, 400, 'clear-queue without confirm:"yes" is a 400');
    assert.equal((await mock.mockFetch('/api/jobs/control/clear-queue', {
        method: 'POST', headers: operator, body: { channel: 'default', confirm: true },
    })).error_code, 400, 'the confirm token is the STRING "yes", not a boolean');
    // reset-failed DOES have an all-channel form, and answers top-level.
    const resetAll = await mock.mockFetch('/api/jobs/control/reset-failed', { method: 'POST', headers: operator, body: { limit: 2 } });
    assert.equal(typeof resetAll.reset_count, 'number');
    assert(Array.isArray(resetAll.requeue), 'reset-failed answers TOP-LEVEL {reset_count, requeue}');
    assert.equal('data' in resetAll, false);
    // clear-stuck's result key is `cleared` — there is no `count`.
    const cleared = await mock.mockFetch('/api/jobs/control/clear-stuck', {
        method: 'POST', headers: operator, body: { channel: 'priority', idle_threshold_ms: 0 },
    });
    assert.equal(typeof cleared.data.cleared, 'number');
    assert.equal('count' in cleared.data, false, 'clear-stuck has no `count` key (web-mojo read one and always showed 0)');
    assert(Array.isArray(cleared.data.details) && Array.isArray(cleared.data.errors));

    // ── 10. Filter-key resolution has THREE outcomes ──────────────────
    const someJob = (await mock.mockFetch('/api/jobs/job', {
        headers: operator, params: models.normalizeJobListParams({ status: 'failed', size: 5 }),
    })).data[0];
    assert(someJob, 'the fixture keeps failed jobs');
    const logsAll = await mock.mockFetch('/api/jobs/logs', { headers: operator, params: { sort: '-created', size: 500 } });
    const logsByRelation = await mock.mockFetch('/api/jobs/logs', {
        headers: operator, params: models.normalizeJobLogListParams({ job: someJob.id, size: 500 }),
    });
    assert.equal(logsByRelation.status, true);
    assert(logsByRelation.data.every((row) => row.job_id === someJob.id), '`job=` (the relation name) filters');
    assert(logsByRelation.count < logsAll.count, 'and it is a strict subset of the table');
    // The FK ATTNAME is accepted by hasattr and then dies in normalize_rest_value.
    const logsByAttname = await mock.mockFetch('/api/jobs/logs', { headers: operator, params: { job_id: someJob.id } });
    assert.equal(logsByAttname.status, false, '`job_id=` is a server ERROR, not a filter');
    assert.equal(logsByAttname.error_code, 500);
    // A name the model does not have in any form is SILENTLY DROPPED.
    const logsByRunner = await mock.mockFetch('/api/jobs/logs', {
        headers: operator, params: { runner_id: 'runner-mojo-web-01-engine', sort: '-created', size: 500 },
    });
    assert.equal(logsByRunner.status, true);
    assert.equal(logsByRunner.count, logsAll.count,
        '`runner_id=` on JobLog is silently dropped — the response is the UNFILTERED table');
    // Same split on task_result.
    assert.equal((await mock.mockFetch('/api/jobs/task_result', { headers: operator, params: { task_id: 'x' } })).error_code, 500);

    // ── 11. The timeline graph's exact field set ──────────────────────
    const timeline = await mock.mockFetch('/api/jobs/event', {
        headers: operator, params: { job: someJob.id, graph: 'timeline', sort: 'at', size: 200 },
    });
    assert.equal(timeline.status, true);
    assert.equal(timeline.graph, 'timeline');
    assert(timeline.data.length > 0, 'the failed job has a lifecycle');
    for (const entry of timeline.data) {
        assert.deepEqual(Object.keys(entry).sort(), ['at', 'details', 'event', 'runner_id'],
            'graph=timeline is exactly {event, at, runner_id, details} — no id');
    }
    // No graph carries recent_events / is_retriable / stack_trace.
    for (const graph of ['default', 'detail', 'admin']) {
        const one = await mock.mockFetch(`/api/jobs/job/${someJob.id}`, { headers: operator, params: { graph } });
        assert.equal(one.status, true, `graph=${graph} resolves`);
        for (const absent of ['recent_events', 'is_retriable', 'stack_trace']) {
            assert.equal(absent in one.data, false, `graph=${graph} carries no ${absent}`);
        }
    }

    // ── 12. Scheduled tasks: graphs, owner fallback, round trips ──────
    const taskList = await mock.mockFetch('/api/jobs/scheduled_task', {
        headers: operator, params: models.normalizeScheduledTaskListParams({ sort: '-created' }),
    });
    assert.equal(taskList.status, true);
    assert.equal(taskList.graph, 'list');
    assert(taskList.data.length >= 4, 'an operator with the view grant sees the whole system list');
    assert.equal('job_config' in taskList.data[0], false, 'the list graph carries no job_config');
    assert.equal('description' in taskList.data[0], false, 'the list graph carries no description');
    const llmTask = taskList.data.find((row) => row.task_type === 'llm');
    const oneTask = await mock.mockFetch(`/api/jobs/scheduled_task/${llmTask.id}`, { headers: operator });
    assert.equal(oneTask.graph, 'default');
    assert.equal(typeof oneTask.data.job_config, 'object');
    // Task results filter by the RELATION name and carry output/error only on default.
    const results = await mock.mockFetch('/api/jobs/task_result', {
        headers: operator, params: { task: llmTask.id, graph: 'default', sort: '-created', size: 10 },
    });
    assert(results.data.length > 0 && results.data.every((row) => row.task_id === llmTask.id));
    assert('output' in results.data[0] && 'error' in results.data[0]);
    const resultsList = await mock.mockFetch('/api/jobs/task_result', {
        headers: operator, params: { task: llmTask.id, graph: 'list', sort: '-created' },
    });
    assert.equal('output' in resultsList.data[0], false, 'the list graph drops output/error');
    // Enable/disable round trip, then back.
    const disabled = await mock.mockFetch(`/api/jobs/scheduled_task/${llmTask.id}`, {
        method: 'POST', headers: operator, body: { enabled: false },
    });
    assert.equal(disabled.data.enabled, false);
    await mock.mockFetch(`/api/jobs/scheduled_task/${llmTask.id}`, { method: 'POST', headers: operator, body: { enabled: true } });
    // A malformed save is rejected verbatim by the server.
    const rejected = await mock.mockFetch(`/api/jobs/scheduled_task/${llmTask.id}`, {
        method: 'POST', headers: operator, body: { run_times: ['9:00'] },
    });
    assert.equal(rejected.status, false);
    assert.equal(rejected.error, 'Invalid time format: 9:00. Use HH:MM');
    // Create is ALWAYS caller-owned; delete cleans up.
    const created = await mock.mockFetch('/api/jobs/scheduled_task', {
        method: 'POST', headers: operator, body: form.scheduledTaskChanges({ ...base, name: 'verifier task' }),
    });
    assert.equal(created.status, true);
    assert.equal(created.data.name, 'verifier task');
    assert.equal((await mock.mockFetch(`/api/jobs/scheduled_task/${created.data.id}`, {
        method: 'DELETE', headers: operator,
    })).status, 'deleted');
    // THE HOLE THIS PAGE CLOSES: no global grant still answers HTTP 200, with
    // only the caller's own rows.
    const ownTasks = await mock.mockFetch('/api/jobs/scheduled_task', { headers: ordinary });
    assert.equal(ownTasks.status, true, 'the owner fallback answers 200, not 403');
    assert(ownTasks.data.length < taskList.data.length, 'and it is a PERSONAL list, not the system list');
    // jobs.viewer holds view_jobs, which is in NEITHER ScheduledTask clause —
    // so it falls through to the owner branch and sees zero rows.
    const viewerTasks = await mock.mockFetch('/api/jobs/scheduled_task', { headers: viewer });
    assert.equal(viewerTasks.status, true);
    assert.equal(viewerTasks.data.length, 0,
        'view_jobs alone yields the personal (empty) list at HTTP 200 — the client gate is what rejects it');

    // ── 13. Job actions: Python truthiness, and retry ALWAYS republishes ──
    const running = (await mock.mockFetch('/api/jobs/job', {
        headers: operator, params: models.normalizeJobListParams({ status: 'running', size: 10 }),
    })).data.find((row) => row.runner_id === 'runner-mojo-web-01-engine');
    assert(running, 'the fixture keeps a job running on a LIVE runner');
    const emptyCancel = await mock.mockFetch(`/api/jobs/job/${running.id}`, {
        method: 'POST', headers: operator, body: { cancel_request: {} },
    });
    assert.equal(emptyCancel.status, false, '`{}` is falsy in Python — cancel_request must be true');
    assert.equal(emptyCancel.error, 'cancel_request must be true');
    assert.equal('data' in emptyCancel, false, 'the handler dict IS the response body, not a nested payload');
    const okCancel = await mock.mockFetch(`/api/jobs/job/${running.id}`, {
        method: 'POST', headers: operator, body: { cancel_request: true },
    });
    assert.equal(okCancel.status, true);
    assert.equal(okCancel.job_id, running.id);
    assert.equal(okCancel.forced, false, 'a live runner cancels COOPERATIVELY — not forced');
    // A running job on a DEAD runner is force-canceled instead.
    const stale = (await mock.mockFetch('/api/jobs/job', {
        headers: operator, params: models.normalizeJobListParams({ status: 'running', size: 10 }),
    })).data.find((row) => row.runner_id === 'runner-mojo-batch-01-engine');
    if (stale) {
        const forced = await mock.mockFetch(`/api/jobs/job/${stale.id}`, {
            method: 'POST', headers: operator, body: { cancel_request: true },
        });
        assert.equal(forced.forced, true, 'a dead runner means the cancel is FORCED server-side');
    }
    // Retry: a NEW job id, every time.
    const failed = (await mock.mockFetch('/api/jobs/job', {
        headers: operator, params: models.normalizeJobListParams({ status: 'failed', size: 10 }),
    })).data[0];
    const retried = await mock.mockFetch(`/api/jobs/job/${failed.id}`, {
        method: 'POST', headers: operator, body: { retry_request: true },
    });
    assert.equal(retried.status, true);
    assert.equal(retried.original_job_id, failed.id);
    assert(retried.new_job_id && retried.new_job_id !== failed.id, 'retry_request returns a NEW job id');
    assert.equal(retried.delayed, false);
    const original = await mock.mockFetch(`/api/jobs/job/${failed.id}`, { headers: operator });
    assert.equal(original.data.status, 'pending', 'the original row is reset to pending');
    const replacement = await mock.mockFetch(`/api/jobs/job/${retried.new_job_id}`, { headers: operator });
    assert.equal(replacement.data.status, 'pending');
    assert.equal(replacement.data.metadata.retry_of, failed.id, 'the new job records what it replaced');
    // The original is now PENDING, and the service refuses to retry that.
    assert.equal((await mock.mockFetch(`/api/jobs/job/${failed.id}`, {
        method: 'POST', headers: operator, body: { retry_request: true },
    })).status, false, 'a pending job cannot be retried');
    // The delay form, on an EXPIRED job — retriable by the service rule even
    // though the model's `is_retriable` property would say no.
    const expired = (await mock.mockFetch('/api/jobs/job', {
        headers: operator, params: models.normalizeJobListParams({ status: 'expired', size: 5 }),
    })).data[0];
    assert(expired, 'the fixture keeps an expired job');
    assert.equal(models.canRetryJob(expired), true);
    const delayed = await mock.mockFetch(`/api/jobs/job/${expired.id}`, {
        method: 'POST', headers: operator, body: { retry_request: { retry: true, delay: 60 } },
    });
    assert.equal(delayed.status, true, '{retry:true, delay:N} is the second accepted form');
    assert.equal(delayed.delayed, true);
    assert(delayed.new_job_id && delayed.new_job_id !== expired.id, 'a delayed retry still mints a NEW id');
    assert.equal((await mock.mockFetch(`/api/jobs/job/${expired.id}`, {
        method: 'POST', headers: operator, body: { retry_request: { retry: false, delay: 60 } },
    })).status, false, 'retry:false inside the dict is refused');
    // Actions are manage-gated.
    assert.equal((await mock.mockFetch(`/api/jobs/job/${failed.id}`, {
        method: 'POST', headers: viewer, body: { cancel_request: true },
    })).error_code, 403, 'a viewer cannot act on a job');

    // ── 14. Purge: dry run reports `count`, a real run reports `deleted` ──
    // Scoped to canceled jobs so the rest of the fixture survives.
    const dryRun = await mock.mockFetch('/api/jobs/control/purge', {
        method: 'POST', headers: operator, body: { days_old: 0, status: 'canceled', dry_run: true },
    });
    assert.equal(dryRun.data.dry_run, true);
    assert.equal(typeof dryRun.data.count, 'number', 'a DRY RUN reports `count`');
    assert.equal('deleted' in dryRun.data, false);
    assert(dryRun.data.count > 0, 'the canceled fixtures are purgeable');
    assert.equal(typeof dryRun.data.cutoff, 'string');
    const realRun = await mock.mockFetch('/api/jobs/control/purge', {
        method: 'POST', headers: operator, body: { days_old: 0, status: 'canceled' },
    });
    assert.equal(typeof realRun.data.deleted, 'number', 'a REAL run reports `deleted` — a different key');
    assert.equal('count' in realRun.data, false, 'reading `count` off a real run always shows 0 (web-mojo\'s bug)');
    assert(realRun.data.deleted >= dryRun.data.count, 'deleted covers the cascaded events and logs too');
    assert.equal((await mock.mockFetch('/api/jobs/control/purge', {
        method: 'POST', headers: operator, body: { days_old: 0, status: 'canceled', dry_run: true },
    })).data.count, 0, 'and the rows are gone afterwards');

    // ── 15. Theme discipline ──────────────────────────────────────────
    const [themePortal, themeShowcase] = await Promise.all([
        read('apps/portal/src/theme/admin-jobs.css'),
        read('apps/showcase/src/theme/admin-jobs.css'),
    ]);
    assert.equal(themePortal, themeShowcase, 'the two theme dirs keep admin-jobs.css byte-identical');
    assert.doesNotMatch(stripComments(themePortal), /#[0-9a-fA-F]{3,6}\b/, 'the stylesheet is tokens-only');
    for (const app of ['apps/portal/src/theme.css', 'apps/showcase/src/theme.css']) {
        assert.match(await read(app), /@import "\.\/theme\/admin-jobs\.css";/, `${app} imports the stylesheet`);
    }
    // Docs + showcase are part of the deliverable, not optional.
    const docs = await read('packages/portal-mojo/docs/admin-jobs.md');
    assert.match(docs, /django-mojo #1309/, 'the run-now gap names its django-mojo item');
    assert.match(await read('packages/portal-mojo/docs/README.md'), /\[admin-jobs\.md\]\(admin-jobs\.md\)/,
        'the docs index carries a row');
    const demo = await read('apps/showcase/src/pages/components/demos-admin-jobs.tsx');
    assert.match(await read('apps/showcase/src/pages/components/ComponentsPage.tsx'), /AdminJobsDemo/,
        'the showcase rail mounts the demo');
    assert.match(demo, /JobDashboardPage|JobRunnersPage|JobsTablePage|ScheduledTasksPage/);
    // ONE defineModel per endpoint, package-wide.
    const modelSource = await read('packages/portal-mojo/src/admin/jobs/models.ts');
    for (const endpoint of ['/api/jobs/job', '/api/jobs/event', '/api/jobs/logs', '/api/jobs/scheduled_task', '/api/jobs/task_result']) {
        assert.equal(modelSource.split(`endpoint: '${endpoint}'`).length - 1, 1, `exactly one defineModel for ${endpoint}`);
    }

    console.log('admin jobs engine contract verified');
} finally {
    await server.close();
}
