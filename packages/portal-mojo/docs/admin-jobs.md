# Admin: jobs engine

```ts
import {
    // section (registered in ADMIN_SECTIONS — no app wiring needed)
    JOBS_ADMIN_SECTION,
    // pages
    JobDashboardPage, JobRunnersPage, JobsTablePage, ScheduledTasksPage,
    // dashboard sections
    JobRunnersStrip, JobChannelsPanel, JobThroughputSection, JobOperationsSection,
    // KISS detail modals (#1425)
    JobDetail, showJobDetail,
    RunnerDetail, showRunnerDetail,
    ScheduledTaskDetail, showScheduledTaskDetail,
    openScheduledTaskEditor,
    // models — ONE defineModel per endpoint
    JobModel, JobEventModel, JobLogModel, ScheduledTaskModel, TaskResultModel,
    // permission clauses
    JOBS_VIEW_PERMS, JOBS_MANAGE_PERMS,
    SCHEDULED_TASK_VIEW_PERMS, SCHEDULED_TASK_MANAGE_PERMS,
    // control plane (one typed function per route)
    fetchJobStats, fetchRunners, fetchAllRunnerSysinfo, fetchRunnerSysinfo,
    fetchChannels, fetchQueueSizes, fetchJobsConfig,
    pingRunner, shutdownRunner, broadcastCommand, BROADCAST_COMMANDS,
    clearStuck, manualReclaim, purgeJobs, isPurgeDryRun, resetFailed,
    clearQueue, cleanupConsumers, rebuildScheduled, forceSchedulerLead,
    publishTestJob, publishTestSuite,
    forEachChannel, summarizeChannelOutcomes,
    // query hooks (every one `enabled`-gated on the matching useCan)
    jobsKeys, useJobStats, useRunners, useDiscoveredChannels, useChannelOptions,
    useQueueSizes, useJobsConfig, useRunnerSysinfo,
    useJobTimeline, useJobLogs, useRunnerActiveJobs, useRunnerJobHistory, useRunnerJobLogs,
    useTaskResults,
    // derived helpers
    jobStatusTone, jobStatusIcon, isTerminalJob, isScheduledJob, isOverdueJob,
    canCancelJob, canRetryJob,
    runnerHealth, heartbeatAgeSeconds, formatHeartbeatAge, formatUptime, formatUptimeShort,
    runnerUptimeSeconds, runnerFailureRate,
    channelSeverity, channelSeverityTone,
    formatRunDays, formatRunTimes, formatSchedule, taskTypeTone,
    // scheduled-task form helpers (the client mirror of the model's _validate)
    emptyScheduledTaskDraft, scheduledTaskDraft,
    validateScheduledTaskDraft, scheduledTaskChanges,
    // table pieces
    JOB_SEGMENTS, jobSegmentOf, jobColumns, JOB_EXPORTER, sanitizeJobRowForExport,
} from 'portal-mojo/admin';
```

Queue operations: is the runner fleet alive, which channel is backed up and
why, what is this job doing and why did it fail, retry or cancel it, clear
stuck work, purge history — plus the cron-style scheduled tasks whose backend
django-mojo has always shipped and whose admin page web-mojo never wired up.

Demo: showcase → Admin → **Jobs engine**. Styles:
`apps/{portal,showcase}/src/theme/admin-jobs.css` (byte-identical).
Verifier: `npm run verify:admin-jobs`.

Wire facts below come from django-mojo `mojo/apps/jobs/` (`models/job.py`,
`models/scheduled_task.py`, `models/task_result.py`, `rest/jobs.py`,
`rest/control.py`, `manager.py`, `job_engine.py`), which is authoritative
wherever web-mojo disagreed — and it disagreed a lot. See
[Backend corrections](#backend-corrections).

## Registration

`JOBS_ADMIN_SECTION` is in `ADMIN_SECTIONS`, so routes and the sidebar entry
are generated. **A mounting app edits nothing** — neither
`apps/portal/src/menus.ts` nor `apps/portal/src/pages/admin-routes.tsx`.

| | |
|---|---|
| `id` / `basePath` | `jobs` / `jobs` (basePath defaults to id) |
| `navigationGroup` | `operations` |
| `icon` | `bi-cpu` |
| `permissions` | `['sys.manage_jobs', 'sys.view_jobs', 'sys.jobs', 'sys.view_scheduled_tasks']` — the ANY-OF union of the route gates |

Standalone mount → `#/jobs`, `#/jobs/runners`, `#/jobs/list`,
`#/jobs/scheduled-tasks`. Embedded (`mount: '/system'`) → the same paths under
`#/system/…`. The dashboard registers `path: ''`, so the section gets no
generated landing redirect: `#/jobs` **is** the dashboard.

## Permissions — and why the gates are NOT uniform

Every clause is `sys.`-pinned, so an identically named ACTIVE-GROUP member
grant can never light an operator-global surface, and every clause is
fail-closed while `me` is loading.

| Route | Page | Route gate | Backend source |
|---|---|---|---|
| `jobs` | `JobDashboardPage` | `JOBS_VIEW_PERMS` | control plane `requires_global_perms('view_jobs','manage_jobs','jobs')` |
| `jobs/runners` | `JobRunnersPage` (+ `RunnerDetail`) | `JOBS_VIEW_PERMS` | same |
| `jobs/list` | `JobsTablePage` (+ `JobDetail`) | `JOBS_VIEW_PERMS` | `Job.VIEW_PERMS = ["view_jobs","manage_jobs","jobs"]` |
| `jobs/scheduled-tasks` | `ScheduledTasksPage` (+ detail + editor) | **`SCHEDULED_TASK_VIEW_PERMS`** | `ScheduledTask.VIEW_PERMS = ["jobs","view_scheduled_tasks","owner"]` |

```ts
JOBS_VIEW_PERMS            = ['sys.manage_jobs', 'sys.view_jobs', 'sys.jobs'];
JOBS_MANAGE_PERMS          = ['sys.manage_jobs', 'sys.jobs'];
SCHEDULED_TASK_VIEW_PERMS  = ['sys.jobs', 'sys.view_scheduled_tasks'];
SCHEDULED_TASK_MANAGE_PERMS= ['sys.jobs', 'sys.manage_scheduled_tasks'];
```

**The scheduled-tasks difference is load-bearing, not tidiness.**
`ScheduledTask.VIEW_PERMS` contains *neither* manage grant and *not*
`view_jobs`. Three consequences:

1. A `jobs.viewer` (holding only `view_jobs`) **cannot** read the system task
   list. If the sidenav entry and the route reused `JOBS_VIEW_PERMS`, that
   operator would get a menu entry that opens a page rendering a permission
   notice. The route gate matches the page's own gate, so the entry is simply
   absent for them.
2. `manage_scheduled_tasks` does **not** imply view (correction 13 below), so
   `SCHEDULED_TASK_MANAGE_PERMS` alone opens nothing either — the page checks
   view first and says so explicitly.
3. `owner` is deliberately **dropped** from both clauses. Keeping it would be
   worse than useless: see correction 10.

Mutations gate separately — `JOBS_MANAGE_PERMS` for the jobs control plane and
job actions, `SCHEDULED_TASK_MANAGE_PERMS` for task writes. Every
permission-disabled query is `enabled: false`, so a view-only operator issues
**zero** denied requests rather than firing and catching 403s.

## The wire

### Model endpoints

`uses_model_security`, global-only — Job/JobEvent/JobLog have no group field.

| Endpoint | Verbs | Request params this module sends | Response |
|---|---|---|---|
| `/api/jobs/job` | GET list | `status`, `status__in`, `channel`, `func__icontains`, `runner_id`, `run_at__isnull`, `dr_field/dr_start/dr_end`, `search`, `start`, `size`, **always `sort`** | `{status, count, start, size, data: JobRow[], graph}` |
| `/api/jobs/job/<id>` | GET | `graph` (`default` · `detail` · `admin` · `status`) | `{status, data: JobRow, graph}` |
| `/api/jobs/job/<id>` | POST | `{cancel_request: true}` / `{retry_request: true}` / `{retry_request:{retry:true, delay:N}}` | the handler dict **verbatim** — see correction 4 |
| `/api/jobs/job/<id>` | DELETE | — | `{status:'deleted'}` (gate `manage_jobs\|jobs`) |
| `/api/jobs/event` | GET list | `job`, `job__in`, `event`, `graph=timeline`, `sort=at`, `size` | `{status, count, data: JobTimelineEntry[]}` |
| `/api/jobs/logs` | GET list | `job`, `job__in`, `kind`, `sort=-created`, `size` | `{status, count, data: JobLogRow[]}` |
| `/api/jobs/scheduled_task` | GET/POST/DELETE | `enabled`, `task_type`, `name__icontains`, `search`, paging, `sort=-created`; `graph` `list` \| `default` | `{status, count, data: ScheduledTaskRow[]}` |
| `/api/jobs/task_result` | GET (read-only), DELETE | `task`, `sort=-created`, `size` | `{status, count, data: TaskResultRow[]}` |

`JobEvent`/`JobLog` `SAVE_PERMS` is empty — rows are system-created; POST is a
403. `TaskResult` is read-only over REST; its DELETE_PERMS drops `owner`
(`jobs|manage_scheduled_tasks` only).

Graph field sets that matter:

- `event?graph=timeline` → exactly `{event, at, runner_id, details}` — **no
  `id`**. That is why `JobTimelineEntry` is a separate type from
  `JobEventRow`: a timeline entry cannot be fed to anything that keys on a row
  id.
- `job?graph=admin` → `__all__` **minus** `stack_trace`, and no `duration_ms`
  (the admin graph declares no `extra`).
- `scheduled_task?graph=list` carries neither `description` nor `job_config`;
  the table must not read them.
- `task_result?graph=list` is `{id, task_id, status, created}` — `output` and
  `error` only exist on `default`.

### Control plane

`requires_global_perms` — member grants never satisfy it. Read gate
`view_jobs|manage_jobs|jobs`; **every write** gate `manage_jobs|jobs`.

| Route | Body / params | Response shape |
|---|---|---|
| `GET stats` | — | `{status, data:{channels, runners, totals, scheduler}}` |
| `GET runners` | `channel?` **only** | `{status, count, data:[…]}` — complete list, paging ignored |
| `GET runners/sysinfo` | `timeout` | `{status, count, data: RunnerSysinfo[]}` |
| `GET runners/sysinfo/<id>` | `timeout` | `{status, data: RunnerSysinfo}`; no reply → **404 envelope** |
| `GET control/channels` | — | `{status, data: string[]}` (Redis stream scan) |
| `GET control/queue-sizes` | — | `{status, data:{<channel>: {stream, scheduled, db_*}}}` |
| `GET control/config` | — | `{status, data: JobsConfig}` — **manage-gated**, unlike every other read |
| `POST runners/ping` | `{runner_id, timeout}` | **top-level** `{status, runner_id, responsive}` |
| `POST runners/shutdown` | `{runner_id, graceful}` | `{status, message}` — fire-and-forget |
| `POST runners/broadcast` | `{command, data, timeout}` | **top-level** `{status, command, responses_count, responses}` |
| `POST control/clear-stuck` | `{channel*, idle_threshold_ms}` | `{status, message, data:{channel, cleared, details[], errors[]}}` |
| `POST control/manual-reclaim` | `{channel*}` | same shape (`idle_threshold_ms: 0` — reclaims everything in flight) |
| `POST control/purge` | `{days_old*, status?, dry_run?}` | dry run `{dry_run:true, count, cutoff, status_filter}` · real run `{deleted, details, cutoff, status_filter}` |
| `POST control/reset-failed` | `{channel?, since?, limit}` | **top-level** `{status, message, reset_count, requeue[]}` |
| `POST control/clear-queue` | `{channel*, confirm:"yes"*}` | `{status, message, data:{channel, deleted{}, db_pending_canceled, errors[]}}` |
| `POST control/cleanup-consumers` | `{channel?, destroy_empty_groups}` | `{status, data}` |
| `POST control/rebuild-scheduled` | `{channel?, limit?}` | `{status, data}` |
| `POST control/force-scheduler-lead` | `{}` | **top-level** `{status, message, previous_holder}` |
| `POST control/test` | `{channel, delay?}` | **top-level** `{status, message, job_id, channel, delayed}` |
| `POST tests` | `{}` | `{status, message}` — publishes a whole sample suite (load-generating; armed) |

`*` = enforced server-side; omitting it is an HTTP 400.

Result keys are **not uniform**: some handlers nest under `data`, others answer
with top-level fields. `mojoCall` returns the unwrapped envelope and each
`control.ts` function reads from whichever level its endpoint actually uses —
never a `data ?? body` heuristic.

### Metrics slugs

`jobs.published`, `jobs.completed`, `jobs.failed`, `jobs.retried`,
`jobs.expired`, `jobs.local.completed|failed|duration_ms`.

Per-channel slugs are **asymmetric**, and the throughput switch honours it:

```
jobs.published.<channel>          # publishes
jobs.channel.<channel>.completed  # terminal outcomes
jobs.channel.<channel>.failed
```

## Backend corrections

Thirteen places where the backend does not do what web-mojo (or a reasonable
reading of the model) assumes. The backend wins in all of them; the mock
encodes every one, which is why they are testable.

1. **`GET /api/jobs/health` and `health/<channel>` are DEAD at runtime.**
   `JobManager.get_channel_health` reads `state['stream_length']` and
   `state['pending_count']`, which the Plan-B `get_queue_state` no longer
   returns → `KeyError` → HTTP 400 `{status:false,error:"'stream_length'"}`.
   Nothing here calls them; every dashboard number comes from
   `GET /api/jobs/stats`, which uses `.get()` fallbacks throughout and already
   carries `channels`, `runners`, `totals` and `scheduler`.
2. **`clear-stuck` and `manual-reclaim` are `@requires_params('channel')`** —
   there is **no** all-channel form. `purge` requires `days_old`.
   `clear-queue` requires `channel` **and** `confirm:"yes"`. Sending
   `channel: null` (web-mojo's "All Channels") is an instant 400.
3. **Result keys are the backend's, not the obvious ones.** `clear-stuck` →
   `data:{cleared, details[], errors[], message}` — there is **no `count`**
   (web-mojo read one and always reported 0). `purge` real run → `deleted`;
   dry run → `count`. `reset-failed` → top-level `{reset_count, requeue[]}`.
   `ping` → top-level `{runner_id, responsive}`. `broadcast` → top-level
   `{command, responses_count, responses}`.
4. **`POST_SAVE_ACTIONS` return the handler dict VERBATIM as the response
   body** (`rest.py on_rest_save_and_respond → JsonResponse(resp)`) — not the
   row, not nested under `data`, and at **HTTP 200 even on failure**. The
   client's `status === false` unwrap is what turns a refusal into a rejection,
   so both actions declare `response: 'payload'`.
   `cancel_request` must be sent as `true`: Python treats `{}` as falsy, so an
   argument-less call answers `"cancel_request must be true"`.
   `retry_request` is `true` or `{retry:true, delay:N}` and **always
   republishes**: `{original_job_id, new_job_id, delayed}`. The UI must never
   imply the same row resumed.
5. **Job has no `recent_events` in any graph** (only inside the `get_status`
   action payload) and no `is_retriable`/`stack_trace` in any graph. The
   lifecycle timeline is `/api/jobs/event?job=<id>&graph=timeline`;
   retriability is computed client-side from the *service* rule
   (`status ∈ {failed, canceled, expired}`), which is deliberately wider than
   the model's `is_retriable` property.
6. **Unknown filter keys are silently dropped** by `build_rest_filters`
   (`hasattr(cls, field_name)`), so a bad key returns the **unfiltered** list
   rather than an error. JobLog has no `runner_id` field at all — web-mojo
   shipped `/api/jobs/logs?runner_id=…` and presented the whole log table as
   one runner's logs. Always filter by the **relation** name (`job=`,
   `job__in=`). See correction 12 for the sharper version of this.
7. **The default list sort is `-id`**, and Job ids are 32-char uuid hex, so an
   unsorted job list is lexicographic noise. `normalizeJobListParams` (and its
   four siblings) therefore **always** emit an explicit `sort`. The `ordering`
   param web-mojo sent is not read by the backend at all.
8. **The runner heartbeat payload is
   `{runner_id, hostname, channels[], jobs_processed, jobs_failed, started,
   last_heartbeat}`** plus `alive` and `id` injected by the view. There is **no
   `version` field** (web-mojo rendered a chip for one). `GET runners` ignores
   `start/size/sort/search` and returns the complete list — it is not a paged
   model endpoint, which is why `JobRunnersPage` is a bespoke panel table.
   Heartbeat/sysinfo timestamps are **ISO strings** while model rows carry
   **epoch seconds**: a real asymmetry, preserved in the types.
9. **`/api/jobs/publish` does not exist.** web-mojo's `Job.publish` was dead
   code. Republishing happens through `retry_request` (or `control/test` for a
   sample job).
10. **ScheduledTask/TaskResult are not globally pinned.** `VIEW_PERMS`
    includes `owner`, so a caller with **no** global jobs grant gets HTTP 200
    with only their **own** tasks. An admin page that did not gate on the
    global grant would silently render a personal list as if it were the
    system's. Gating fail-closed on `sys.jobs | sys.view_scheduled_tasks`
    closes that hole; `owner` is dropped from the client clause on purpose.
11. **ScheduledTask has no REST "run now"** — only the owner-scoped assistant
    tool `_tool_run_scheduled_task_now`. See [The run-now gap](#the-run-now-gap).

Two more corrections found while building, refining 6 and the gate table:

12. **`/api/jobs/logs?job_id=` is an HTTP 500, not an unfiltered list.**
    Django installs a descriptor for a FK's *attname*, so `hasattr(cls,
    'job_id')` is `True` and `build_rest_filters` accepts the key — then
    `get_model_field('job_id')` returns `None` and `normalize_rest_value`
    dereferences it: `AttributeError` → 500
    (`"'NoneType' object has no attribute 'get_internal_type'"`). By contrast
    `?runner_id=` (a name JobLog does not have in any form) **is** silently
    dropped and returns the whole table. Same-looking mistake, two completely
    different failures — the mock reproduces both, and the same split applies
    to `task_result?task_id=` vs the relation name `task=`.
13. **`manage_scheduled_tasks` does not imply view.**
    `ScheduledTask.VIEW_PERMS` is `["jobs","view_scheduled_tasks","owner"]` and
    `SAVE_PERMS` is `["jobs","manage_scheduled_tasks","owner"]` — the manage
    grant appears in **neither** view clause. An operator holding only
    `manage_scheduled_tasks` falls through to the `owner` branch and sees just
    their own tasks. A real jobs operator needs the `jobs` catch-all, or
    `view_scheduled_tasks` alongside the manage grant (the mock's
    `jobs.operator` identity is seeded exactly that way, deliberately).

## Design decisions

- **Stats, not health.** Correction 1. web-mojo's `JobHealthView` — the only
  consumer of `/health` — was never mounted, so nothing is lost.
- **Runners is not a ModelTable.** The endpoint has no paging/sort/search
  contract; rendering a pager and sort headers that silently do nothing would
  lie about the wire. Client-side sort/filter over the full list, the same
  precedent as `MetricsPermissionsPage`.
- **Queued vs Scheduled by `run_at__isnull`,** not by comparing a datetime on
  the wire. `__isnull` is an explicitly supported operator and needs no date
  coercion. A pending job with a *past* `run_at` shows up under Scheduled
  flagged **overdue**, which is its true state.
- **All-channel operations fan out client-side** (`forEachChannel` →
  `Promise.allSettled`), because correction 2 leaves no server-side form.
  Partial failures are reported per channel with a `warning` toast — never a
  blanket success.
- **Purge is dry-run first.** The dialog runs `dry_run:true` and reports
  "N jobs would be deleted before `<cutoff>`"; only the armed confirm performs
  the real run, which is read from `deleted`. Fixes the source's wrong
  `data.count` read.
- **Armed confirmations** for purge, clear-queue, clear-stuck,
  cleanup-consumers, shutdown, broadcast `shutdown`, force-scheduler-lead and
  task delete. `clear-queue` sends `confirm:"yes"` **only after** arming: the
  token is a server-side safety gate, and pre-satisfying it (as web-mojo did on
  every call) removes the safety rather than honouring it.
- **KISS modals.** Job, runner, scheduled-task and task-result inspection are
  `modal.detail`; the editor and confirmations are stacked native `<dialog>`s.
  No RightPanel, no record-detail routes — the jobs package imports neither.
- **Bounded export.** `JOB_EXPORTER` is a *client* projection (id, channel,
  func, status, timing, attempt, runner). The server's `download_format` would
  ship `payload`, `metadata` and `last_error`.

### ScheduledTask: PORT (decision recorded)

The backend is complete and live — model, REST, hourly cron dispatcher,
`TaskResult`, three task types including LLM. The only reason the page never
shipped is that web-mojo's `ScheduledTaskTablePage` was imported by
`src/admin.js` and then never `registerPage`d.

It is also the one jobs surface with a real security subtlety worth owning:
the `owner` fallback (correction 10) means an ungated page degrades into a
personal task list wearing an admin page's chrome. Porting it *with a
global-only gate* turns a dead page into a first-class admin feature and closes
that hole in one move — which is why the gate difference is called out at the
top of this page rather than buried.

### The run-now gap (django-mojo #1309)

There is **no REST route** to run a scheduled task immediately. The capability
exists only as the owner-scoped assistant tool `_tool_run_scheduled_task_now`,
and there is no `/api/jobs/publish` (correction 9) to synthesize one from.

Per the wave-7A precedent, an unsupported operation stays **absent** rather
than shipping disabled, so **no "Run now" control ships** — not greyed out, not
hidden behind a permission. When django-mojo **#1309** lands a REST route, the
control belongs in `ScheduledTaskDetail`'s action kebab and in the editor's
footer; nothing else needs to change.

### Immutable task type / the JSONField merge

`task_type` is **fixed after creation** — the select is disabled while editing.
django-mojo merges a JSON body into an existing `JSONField` rather than
replacing it, so switching a task's type would leave the previous type's keys
behind inside `job_config` (an LLM task carrying a stale `url`, a webhook task
carrying a stale `user_prompt`). The dispatcher reads by type and would ignore
them, but the record would be quietly wrong and the editor would show a config
the server does not use. Creating a new task is the honest operation; the field
help says so in place.

For the same reason the config editor is keyed on `task_type`
(`<ConfigEditor key={draft.task_type} …>`) and a type change on a *new* task
resets `job_config` to `{}`.

### Deliberately absent

Carried over from web-mojo only as *decisions not to carry*:

| Not shipped | Why |
|---|---|
| Per-runner **Drain** and **Restart** | The source's buttons only toasted "backend integration pending". No endpoint exists. |
| The runner **`version` chip** | No such field in the heartbeat payload (correction 8). |
| **`Job.publish`** | `/api/jobs/publish` does not exist (correction 9). |
| **`JobHealthView`** | Reads a broken endpoint (correction 1) and was never mounted anyway. |
| **Batch task delete** | Delete cascades over `TaskResult`; arming once for a whole selection is not a safety story. Enable/disable *is* offered as a batch — reversible, one field. |
| **Run Now** | django-mojo #1309, above. |
| `data.count` reads, `ordering=` params, `job_id=`/`runner_id=` log filters | Corrections 3, 7, 6/12. |
| HTML-string interpolation | ReactNode slots only (architecture rule 6). |

## Edge cases the pages handle

- Zero runners with queued work → critical strip **and** critical channel rows.
- Heartbeat tiers computed from the ISO `last_heartbeat`: ≥30s slow, ≥120s
  stale. The roster row and the detail header always agree.
- Running job whose runner is dead → cancel force-cancels server-side and
  returns `forced:true`; the toast says "canceled", not "cancellation
  requested".
- Terminal job → the service refuses cancel, so the control is **not offered**.
- Retry of a canceled/expired job is allowed and always produces a new id.
- Sysinfo has three distinct states: a healthy host, a successful envelope with
  an inner `status:'error'` (psutil missing), and a runner that never answers
  (404 envelope). None of them renders blank.
- Empty/absent channel list → operations needing a channel are disabled with an
  explanation, not a broken select.
- Huge `payload`/`last_error` → bounded rendering (`JsonBlock` + truncation with
  full text on demand). Stack traces are unavailable by graph and are not
  implied.
- Scheduled task at the per-user cap, or with a `run_times` value that slipped
  past client validation → the server's message surfaces **verbatim** through
  the rejecting save path.
- A viewer-only operator sees every read surface, zero mutation controls, and
  issues no denied request.

## Showcase & styling

`apps/showcase/src/pages/components/demos-admin-jobs.tsx` reaches every state
the browser pass must see, in both themes: the dashboard (dead runner, a
channel with zero alive runners), the runner roster and its three sysinfo
states, the jobs table across all five segments, the job inspector (failed with
a multi-line error, running on a dead runner, overdue, canceled, expired), the
operations panel including a purge dry run, the scheduled-task table + detail +
editor, and the permission-gate story.

Two states cannot be produced by calling the mock, because the seeded fixture
is a *populated* deployment: **no runners registered at all** and **no channels
configured**. The demo's "Fleet edge cases" tab drives the shipped components
from hand-built `JobsStats` objects (and, for `JobRunnersStrip`, a demo-only
`QueryClient` pinned to an empty fleet). Nothing in the package is mocked or
branched for the demo.

Styles are semantic `jobs-*` classes, tokens only, both themes:
`apps/{portal,showcase}/src/theme/admin-jobs.css`, imported from each app's
`theme.css`. The verifier asserts the two copies stay byte-identical and that
neither contains a raw hex colour.
