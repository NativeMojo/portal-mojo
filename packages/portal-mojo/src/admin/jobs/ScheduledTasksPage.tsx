// ScheduledTasksPage — the user-defined cron surface. Port of web-mojo
// ScheduledTaskTablePage.js (a page that was imported but never
// `registerPage`d, so its wiring was never exercised).
//
// THE SECURITY POINT OF THIS PAGE
//
// `ScheduledTask.RestMeta.VIEW_PERMS = ["jobs", "view_scheduled_tasks",
// "owner"]` — neither `manage_jobs` nor `manage_scheduled_tasks` appears in
// it. A caller holding only a manage grant therefore falls through to the
// OWNER branch and receives HTTP 200 with their OWN tasks, which an ungated
// admin page would render as if it were the system's task list. So the read
// is gated fail-closed on `SCHEDULED_TASK_VIEW_PERMS`
// (`sys.jobs | sys.view_scheduled_tasks`, `owner` deliberately dropped) and a
// manage grant alone never opens the page. When the gate fails nothing is
// rendered that queries — a denied caller issues zero requests.
import { useQueryClient } from '@tanstack/react-query';
import { useCan } from '../../client';
import {
    Badge,
    ModelTable,
    fmt,
    toast,
    type BatchAction,
    type Column,
    type FilterDef,
} from '../../ui';
import {
    SCHEDULED_TASK_MANAGE_PERMS,
    SCHEDULED_TASK_TYPE_OPTIONS,
    SCHEDULED_TASK_VIEW_PERMS,
    ScheduledTaskModel,
    formatRunDays,
    formatRunTimes,
    type ScheduledTaskRow,
} from './models';
import { showScheduledTaskDetail, taskTypeTone } from './ScheduledTaskDetail';
import { openScheduledTaskEditor } from './scheduled-task-form';

/**
 * Columns read ONLY the `list` graph's fields — `{id, name, enabled, run_once,
 * task_type, run_times, run_days, last_run, run_count, created}`. `description`,
 * `channel`, `job_config`, `notify` and `last_error` are `default`-graph only
 * and arrive when the detail modal fetches the record; rendering them here
 * would show a permanent blank. `run_times`/`run_days` are JSONFields and are
 * not sortable server-side.
 */
const COLUMNS: Column<ScheduledTaskRow>[] = [
    {
        key: 'name', label: 'Name', sortable: true, hideable: false,
        render: (row) => (
            <>
                <div className="jobs-runner-id">{row.name || <span className="dim-italic">Untitled</span>}</div>
                {row.run_once && <span className="dim jobs-channel-note">Runs once, then disables itself</span>}
            </>
        ),
    },
    {
        key: 'task_type', label: 'Type', sortable: true,
        render: (row) => <Badge tone={taskTypeTone(row.task_type)}>{row.task_type.toUpperCase()}</Badge>,
    },
    {
        key: 'enabled', label: 'Status', sortable: true,
        render: (row) => <Badge tone={row.enabled ? 'success' : 'muted'}>{row.enabled ? 'Enabled' : 'Disabled'}</Badge>,
    },
    {
        key: 'run_times', label: 'Schedule',
        render: (row) => (
            <>
                <div>{formatRunTimes(row.run_times ?? [])}</div>
                {/* Mon=0 — ScheduledTask.run_days uses Python's weekday(). */}
                <div className="dim jobs-channel-note">{formatRunDays(row.run_days ?? [])}</div>
            </>
        ),
    },
    { key: 'run_count', label: 'Runs', sortable: true, align: 'end', render: (row) => fmt.number(row.run_count) },
    {
        key: 'last_run', label: 'Last run', sortable: true,
        render: (row) => (row.last_run == null
            ? <span className="dim">Never</span>
            : <span title={fmt.datetime(row.last_run)}>{fmt.relative(row.last_run)}</span>),
    },
    {
        key: 'created', label: 'Created', sortable: true,
        render: (row) => <span title={fmt.datetime(row.created)}>{fmt.relative(row.created)}</span>,
    },
];

const FILTERS: FilterDef[] = [
    { key: 'enabled', label: 'Status', type: 'boolean', trueLabel: 'Enabled', falseLabel: 'Disabled' },
    { key: 'task_type', label: 'Type', type: 'select', options: SCHEDULED_TASK_TYPE_OPTIONS },
];

export function ScheduledTasksPage() {
    const { can: canView } = useCan(SCHEDULED_TASK_VIEW_PERMS);
    const { can: canManage } = useCan(SCHEDULED_TASK_MANAGE_PERMS);
    const queryClient = useQueryClient();
    const save = ScheduledTaskModel.useSave();

    // Fail-closed, and structurally so: with no view grant the table is never
    // mounted, so no list request is issued to be denied. A manage grant does
    // NOT open this page — see the file header.
    if (!canView) {
        return (
            <div className="panel jobs-note jobs-note-info">
                <i className="bi bi-shield-lock" />
                <span>
                    Scheduled tasks need a system-level <code>jobs</code> or <code>view_scheduled_tasks</code> grant.
                    A manage grant on its own is not enough: the backend would answer with your personal tasks rather
                    than the system’s.
                </span>
            </div>
        );
    }

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ScheduledTaskModel.keys.root });

    const create = async () => {
        const saved = await openScheduledTaskEditor({
            // Creation is ALWAYS caller-owned: django-mojo stamps `user` from
            // the request, so there is no owner field to offer and no
            // arbitrary-owner write to make.
            submit: (changes) => save.mutateAsync({ id: null, changes }),
        });
        if (saved) {
            await invalidate();
            toast.success('Scheduled task created');
        }
    };

    // Enable/disable are the one safe bulk edit here: reversible, one field,
    // and the exact `save({enabled})` the detail performs. Delete stays a
    // single-record armed action in the detail — a bulk cascade over task
    // results is not something to arm once for a whole selection.
    const setEnabled = (enabled: boolean): BatchAction<ScheduledTaskRow> => ({
        key: enabled ? 'enable' : 'disable',
        label: enabled ? 'Enable' : 'Disable',
        icon: enabled ? 'bi-play-circle' : 'bi-pause-circle',
        run: (row) => save.mutateAsync({ id: row.id, changes: { enabled } }),
    });

    return (
        <ModelTable<ScheduledTaskRow>
            model={ScheduledTaskModel}
            title="Scheduled tasks"
            eyebrow="Jobs"
            columns={COLUMNS}
            filters={FILTERS}
            searchable
            searchPlaceholder="Search name, description, channel…"
            defaultSort="-created"
            columnChooser
            persistState
            persistKey="admin-jobs-scheduled-tasks"
            autoRefresh={60}
            exportFormats={['csv', 'json']}
            onRowClick={(row) => showScheduledTaskDetail(row.id)}
            {...(canManage
                ? {
                    addLabel: 'New task',
                    onAdd: () => { void create(); },
                    selectable: true,
                    batchActions: [setEnabled(true), setEnabled(false)],
                }
                : {})}
        />
    );
}
