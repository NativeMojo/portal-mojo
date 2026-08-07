// JobsTablePage — every job in the engine, one segmented table. Port of
// web-mojo JobsTablePage.js + sections/JobTableSection.js.
//
// The source shipped a `Page` wrapping a reusable `JobTableSection` so the
// same table could be embedded elsewhere with a hardcoded `status`. Here the
// segment IS the params store — `status` (+ `run_at__isnull`) — so one
// ModelTable with preset bundles replaces the five configurations, and a
// deep link like `?channel=email&status=failed` lands on exactly the view it
// describes. That is also how JobChannelsPanel opens a backed-up channel.
//
// Wire notes that shape this page:
//   · `defaultSort='-created'` is not a nicety. jobs.Job's backend default
//     ordering is `-id` over 32-char uuid hex — an unsorted list is
//     lexicographic noise. `normalizeJobListParams` guarantees a sort reaches
//     the wire; this names the one an operator wants.
//   · the export is a bounded CLIENT projection (see columns.tsx) because the
//     server's `download_format` would ship payload, metadata and last_error.
//   · batch Cancel sends `payload: true` — `{}` is falsy in Python and the
//     handler answers "cancel_request must be true" at HTTP 200.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCan } from '../../client/runtime';
import { ModelTable, type BatchAction, type FilterDef, type RowTone } from '../../ui';
import { JOB_EXPORTER, JOB_SEGMENTS, jobColumns, jobSegmentOf } from './columns';
import { showJobDetail } from './JobDetail';
import {
    canCancelJob,
    isOverdueJob,
    JOBS_MANAGE_PERMS,
    JOB_STATUS_OPTIONS,
    JobModel,
    type JobRow,
} from './models';
import { useChannelOptions, useRunners } from './queries';

/** Same tick as the other operational tables; skipped while a dialog is open. */
const AUTO_REFRESH_SEC = 30;

export function JobsTablePage() {
    const [searchParams] = useSearchParams();
    // Columns follow the status being viewed, not the chip highlight — see
    // jobSegmentOf. Reading the URL directly keeps this a pure observer of the
    // params store the table owns.
    const segment = jobSegmentOf(searchParams.get('status'), searchParams.get('run_at__isnull'));

    const channels = useChannelOptions();
    const runners = useRunners();
    const { can: canManage } = useCan(JOBS_MANAGE_PERMS);
    const cancel = JobModel.useAction('cancel_request');

    const filters = useMemo<FilterDef[]>(() => {
        const out: FilterDef[] = [
            { key: 'status', label: 'Status', type: 'multiselect', options: [...JOB_STATUS_OPTIONS] },
        ];
        // An empty select is worse than no select: it looks broken and it can
        // only ever write a filter nothing matches. Both of these lists come
        // from live state (configured channels, the registered fleet), so both
        // are offered only once they exist.
        if (channels.channels.length > 0) {
            out.push({ key: 'channel', label: 'Channel', type: 'select', options: channels.options });
        }
        out.push({ key: 'func', label: 'Function', type: 'text', placeholder: 'e.g. send_email' });
        const fleet = runners.data ?? [];
        if (fleet.length > 0) {
            out.push({
                // `runner_id` exact — the runner that CLAIMED the job. Free
                // search also matches it (Job declares no SEARCH_FIELDS, so the
                // backend falls back to every text field), which is how a job
                // held by a runner that has since vanished stays findable.
                key: 'runner_id', label: 'Runner', type: 'select',
                options: fleet.map((runner) => ({ value: runner.runner_id, label: runner.runner_id })),
            });
        }
        out.push({ key: 'created', label: 'Created', type: 'daterange' });
        return out;
    }, [channels.channels.length, channels.options, runners.data]);

    const batchActions = useMemo<BatchAction<JobRow>[]>(() => {
        if (!canManage) return [];
        return [{
            key: 'cancel',
            label: 'Cancel',
            icon: 'bi-x-circle',
            danger: true,
            // A terminal job is refused by JobActionsService — never submit one.
            eligible: canCancelJob,
            confirm: 'Request cancellation of the selected job(s)? Running jobs stop cooperatively; queued jobs are canceled outright.',
            run: (row) => cancel.mutateAsync({ id: row.id, payload: true }),
        }];
    }, [canManage, cancel]);

    return (
        <ModelTable<JobRow>
            model={JobModel}
            eyebrow="Job engine"
            title="Jobs"
            columns={jobColumns(segment)}
            filters={filters}
            presets={JOB_SEGMENTS}
            defaultSort="-created"
            searchable
            searchPlaceholder="Search id, function, runner, error…"
            rowTone={rowTone}
            selectable={canManage}
            batchActions={batchActions}
            columnChooser
            persistState
            persistKey="admin-jobs-list"
            autoRefresh={AUTO_REFRESH_SEC}
            exporter={JOB_EXPORTER}
            exportFormats={['csv', 'json']}
            onRowClick={(row) => showJobDetail(row.id)}
        />
    );
}

/** Failures shout; a scheduled job the scheduler has walked past warns. */
function rowTone(row: JobRow): RowTone | null {
    if (row.status === 'failed') return 'danger';
    if (isOverdueJob(row)) return 'warning';
    return null;
}
