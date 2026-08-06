// group-sections/AuditSection.tsx — GroupAuditTimelineSection port
// (GroupView.js:1064-1112): the group's OBJECT logs
// (model_name=account.Group, model_id=<id> — the source's shared LogList),
// rendered as a DAY-GROUPED timeline: one date heading per day, a Timeline
// under each, tones mapped from the log level (LOG_LEVEL_TONE).
import { Eyebrow, Timeline, fmt, type TimelineItem } from 'portal-mojo/ui';
import { LogModel, type LogRow } from '../../../../../packages/portal-mojo/src/admin/monitoring';
import { type GroupRow } from '../../models';
import { LOG_TONE, groupAuditParams } from './shared';

/** Bucket rows by local calendar day, newest day first (rows arrive -created). */
function groupByDay(rows: LogRow[]): { day: string; items: TimelineItem[] }[] {
    const buckets: { day: string; items: TimelineItem[] }[] = [];
    for (const l of rows) {
        const day = fmt.date(l.created);
        const item: TimelineItem = {
            tone: LOG_TONE[l.level] ?? 'muted',
            title: l.kind ?? l.level,
            body: (
                <span className="dim">
                    {l.log ? fmt.truncate(l.log, 110) : ''}
                    {l.username && <> · <code>{l.username}</code></>}
                </span>
            ),
            meta: fmt.relative(l.created),
        };
        const last = buckets[buckets.length - 1];
        if (last && last.day === day) last.items.push(item);
        else buckets.push({ day, items: [item] });
    }
    return buckets;
}

export function AuditSection({ group }: { group: GroupRow }) {
    const { data, isPending } = LogModel.useList({ ...groupAuditParams(group.id), size: 25 });
    const buckets = groupByDay(data?.rows ?? []);

    return (
        <>
            <Eyebrow>Audit</Eyebrow>
            {!isPending && buckets.length === 0 && (
                <Timeline items={[]} emptyText="No audit entries recorded for this group yet." />
            )}
            {buckets.map((b) => (
                <div key={b.day} className="ga-audit-day">
                    <div className="ga-audit-day-label">{b.day}</div>
                    <Timeline items={b.items} />
                </div>
            ))}
            {(data?.count ?? 0) > (data?.rows.length ?? 0) && (
                <p className="dim" style={{ marginTop: 8 }}>
                    {data!.count - data!.rows.length} older entries — see the Logs page for the full history.
                </p>
            )}
        </>
    );
}
