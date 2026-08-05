// Stats-summary and view-data dialogs for series charts — the React port of
// web-mojo MetricsChart's onActionShowStats / onActionShowDataTable (and the
// single-series twins on MetricsMiniChartWidget, which shared none of the
// code there; here both surfaces call these two functions). Native <dialog>
// via the awaitable modal manager in portal-mojo/ui.
import { modal } from '../ui/modal';
import {
    GRANULARITY_NOUN,
    buildCsv,
    computeSeriesStats,
    csvFilename,
    defaultStatFormat,
    toNumber,
    type SeriesLike,
} from './stats';

export interface ChartDialogOptions {
    /** Dialog title ("API Activity — Stats" / the data dialog's header). */
    title: string;
    labels: readonly string[];
    datasets: readonly SeriesLike[];
    /** Bucket noun for the "Hourly · 24 points" line (granularity value). */
    granularity?: string;
    /** Value formatter; default = int/2dp locale formatting. */
    formatter?: (n: number) => string;
}

function pointsLine(granularity: string | undefined, points: number): string {
    const noun = granularity ? GRANULARITY_NOUN[granularity] ?? granularity : null;
    const pts = `${points} ${points === 1 ? 'point' : 'points'}`;
    return noun ? `${noun} · ${pts}` : pts;
}

function EmptyBody({ onClose }: { onClose: () => void }) {
    return (
        <>
            <div className="modal-message">No data to display.</div>
            <div className="modal-actions">
                <button className="btn" onClick={onClose}>Close</button>
            </div>
        </>
    );
}

/** Per-series Latest / Min / Max / Avg / Median / Sum summary dialog. */
export function showSeriesStats(opts: ChartDialogOptions): Promise<unknown> {
    const stats = computeSeriesStats(opts.datasets);
    const fmt = opts.formatter ?? defaultStatFormat;
    const cols = ['Latest', 'Min', 'Max', 'Avg', 'Median', 'Sum'] as const;
    const pick = (s: (typeof stats)[number], col: (typeof cols)[number]): number =>
        col === 'Latest' ? s.latest : col === 'Min' ? s.min : col === 'Max' ? s.max
            : col === 'Avg' ? s.avg : col === 'Median' ? s.median : s.sum;

    return modal.open((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">{opts.title}</h2>
            {stats.length === 0 ? (
                <EmptyBody onClose={() => close(null)} />
            ) : (
                <>
                    <div className="chart-dialog-sub">{pointsLine(opts.granularity, stats[0]!.count)}</div>
                    <div className="chart-dialog-scroll">
                        <table className="chart-stats-table">
                            <thead>
                                <tr>
                                    <th>Series</th>
                                    {cols.map((c) => <th key={c} className="num">{c}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {stats.map((s) => (
                                    <tr key={s.label}>
                                        <td>{s.label}</td>
                                        {cols.map((c) => <td key={c} className="num">{fmt(pick(s, c))}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="modal-actions">
                        <button className="btn" onClick={() => close(null)}>Close</button>
                    </div>
                </>
            )}
        </div>
    ), { size: 'md' });
}

/** Trigger a text-file download (the CSV button). */
function downloadText(text: string, filename: string, mime: string): void {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** The raw series as a table: one row per label, one column per series, + CSV. */
export function showSeriesData(opts: ChartDialogOptions): Promise<unknown> {
    const { labels, datasets } = opts;
    const hasData = labels.length > 0 && datasets.length > 0;
    const fmt = opts.formatter ?? defaultStatFormat;
    const headers = ['Label', ...datasets.map((d) => d.label ?? '')];
    const rows = labels.map((label, i) => [label, ...datasets.map((d) => toNumber(d.data?.[i]))] as const);

    const downloadCsv = () => {
        downloadText(buildCsv(headers, rows), csvFilename(opts.title), 'text/csv;charset=utf-8');
    };

    return modal.open((close) => (
        <div className="modal-pad">
            <h2 className="modal-title">{opts.title}</h2>
            {!hasData ? (
                <EmptyBody onClose={() => close(null)} />
            ) : (
                <>
                    <div className="chart-dialog-sub">{pointsLine(opts.granularity, labels.length)}</div>
                    <div className="chart-dialog-scroll chart-dialog-scroll-tall">
                        <table className="chart-data-table">
                            <thead>
                                <tr>
                                    {headers.map((h, i) => <th key={i} className={i === 0 ? undefined : 'num'}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, ri) => (
                                    <tr key={ri}>
                                        <td>{row[0]}</td>
                                        {row.slice(1).map((v, ci) => <td key={ci} className="num">{fmt(v as number)}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="modal-actions">
                        <button className="btn" onClick={downloadCsv}>
                            <i className="bi bi-download" /> Download CSV
                        </button>
                        <button className="btn btn-primary" onClick={() => close(null)}>Close</button>
                    </div>
                </>
            )}
        </div>
    ), { size: 'lg' });
}
