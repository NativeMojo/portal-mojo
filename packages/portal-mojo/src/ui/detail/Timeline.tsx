// Timeline — the vertical event feed: a hairline connector with tone-colored
// dots. Incident history, job lifecycle, recent activity, audit trails —
// anywhere the record's story is "this happened, then this, then this."
// Port of web-mojo src/core/views/data/Timeline.js.
//
//   ●  Title line                            4m ago
//   │  Optional supporting body
//   ●  Title line                            1h ago
//   │  body
//
// Deviations from source: `detail` was a TRUSTED-HTML string — it is the
// `body` ReactNode slot here (architecture rule 6); source field names
// headline/detail/when read as title/body/meta.
import type { ReactNode } from 'react';
import type { Tone } from '../format';
import { normalizeTone } from './StatusPanel';

export interface TimelineItem {
    /** Colors the dot — the feed's only signal of "which of these went wrong". */
    tone?: Tone;
    title: string;
    /** Right-aligned timestamp column ("4m ago", "2026-04-21 11:42"). */
    meta?: string;
    /** Supporting line under the title. A slot; compose `<code>`/`<a>` freely. */
    body?: ReactNode;
}

export function Timeline({ items, emptyText = 'No events yet.', limit }: {
    items: TimelineItem[];
    emptyText?: string;
    /** Render at most N items (the feed's "recent activity" mode). */
    limit?: number;
}) {
    // The empty state renders INSIDE the <ol> so the rail stays visually intact.
    const shown = limit && limit > 0 ? items.slice(0, Math.floor(limit)) : items;

    return (
        <ol className="detail-timeline">
            {shown.length === 0 ? (
                <li className="detail-timeline-empty dim">{emptyText}</li>
            ) : shown.map((item, i) => (
                <li key={`${item.title}-${i}`} className={`detail-timeline-item tone-${normalizeTone(item.tone, 'Timeline')}`}>
                    <div>
                        <div className="detail-timeline-title">{item.title}</div>
                        {item.body != null && item.body !== '' && <div className="detail-timeline-body">{item.body}</div>}
                    </div>
                    {item.meta && <span className="detail-timeline-meta">{item.meta}</span>}
                </li>
            ))}
        </ol>
    );
}
