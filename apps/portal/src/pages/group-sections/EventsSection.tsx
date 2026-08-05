// group-sections/EventsSection.tsx — the incident Events table port
// (GroupView.js:1271-1282): events recorded ABOUT this group
// (model_name=account.Group, model_id=<id>) with the source's columns —
// Date / Category badge / Title.
import { Badge, Eyebrow, fmt } from 'portal-mojo/ui';
import type { GroupRow } from '../../models';
import { IncidentEventModel } from './models';

export function EventsSection({ group }: { group: GroupRow }) {
    const { data, isPending, isError, error } = IncidentEventModel.useList({
        model_name: 'account.Group',
        model_id: group.id,
        size: 25,
        sort: '-created',
    });
    const rows = data?.rows ?? [];

    return (
        <>
            <Eyebrow>Events</Eyebrow>
            {isError && (
                <p className="dim-italic">
                    Events unavailable — {error instanceof Error ? error.message : 'the incident API rejected the request'}.
                </p>
            )}
            {!isPending && !isError && rows.length === 0 && (
                <p className="dim-italic">No incident events recorded for this group.</p>
            )}
            {rows.length > 0 && (
                <div className="tbl-scroll">
                    <table className="tbl">
                        <thead>
                            <tr>
                                <th style={{ width: 170 }}>Date</th>
                                <th>Category</th>
                                <th>Title</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((ev) => (
                                <tr key={ev.id}>
                                    <td className="dim">{fmt.datetime(ev.created)}</td>
                                    <td><Badge tone="info">{ev.category}</Badge></td>
                                    <td>{ev.title ?? <span className="dim">—</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}
