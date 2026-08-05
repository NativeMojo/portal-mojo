// Calendar — the picker engine. Ported from web-mojo
// src/core/forms/inputs/calendar/Calendar.js (623 lines, read in full).
//
// Renders day-grid / month-grid / year-grid based on `precision` and the
// current view (zoom level). Supports single-value and range selection at
// every precision. Same engine, three precisions.
//
// Cross-page anchor persistence: once a range start is committed, paging
// with prev/next or keyboard does not clear it. Hover preview tints visible
// cells up to the cursor regardless of where the anchor sits.
//
// Drill-down zoom: clicking the header label moves up one level
// (day → month → year). Selecting a tile above the configured `precision`
// drills back down; a tile at precision commits.
//
// React shape: SELECTION IS CONTROLLED — `value` (single) / `startValue` +
// `endValue` (range) are props; commits arrive via callbacks and paint only
// once the owner writes them back. The component owns view / page / anchor /
// hover as internal state. External prop writes keep the source's
// setValue/setRange semantics: a new `value` re-pages to it; a new range
// clears any in-progress anchor. While an anchor is active the committed
// range is suppressed (source nulls it); Escape cancels the anchor and the
// committed props paint again — the one deviation from source, which left
// the calendar blank until the next commit (nothing consumed range:cancel).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
    addMonths,
    compareByPrecision, compareYm, compareYmd,
    daysInMonth,
    formatByPrecision, formatYm, formatYmd,
    monthNames,
    parseByPrecision, parseYmd,
    today,
    weekdayNames, weekdayWithFirstDay,
} from './fns';
import type { ParsedDate, ParsedYm, ParsedYmd, Precision } from './fns';

export type { ParsedDate, ParsedYm, ParsedYmd, Precision } from './fns';

export const PRECISION_RANK: Record<Precision, number> = { year: 0, month: 1, day: 2 };

export type CalendarMode = 'single' | 'range';

export interface CalendarSelectEvent { value: string; parsed: ParsedDate }
export interface CalendarRangeSelectEvent { start: string; end: string }
export interface CalendarRangeStartEvent { anchor: string }
export interface CalendarViewChangeEvent { view: Precision }
export interface CalendarNavigateEvent { delta: number }

export interface CalendarProps {
    /** Grid the picker commits at: 'day' | 'month' | 'year'. Default 'day'. */
    precision?: Precision;
    /** 'single' | 'range'. Default 'single'. */
    mode?: CalendarMode;
    /** Day view only: 1 | 2 side-by-side month panes. Default 1. */
    months?: 1 | 2;
    /** Single mode — canonical string at precision (YYYY-MM-DD / YYYY-MM / YYYY). */
    value?: string | null;
    /** Range mode — canonical strings at precision. */
    startValue?: string | null;
    endValue?: string | null;
    /** Bounds, compared at the PANE precision being painted (a year tile is
     *  disabled only when the whole year is out of bounds). */
    min?: string | null;
    max?: string | null;
    /** Individually disabled days, "YYYY-MM-DD" — day grids only. */
    disabledDates?: string[];
    /** First weekday: 0=Sun, 1=Mon, … Default 1. */
    firstDay?: number;
    /** BCP-47 locale for month/weekday names. Default 'en-US'. */
    locale?: string;
    /** Initial page (first visible month / decade seed). Defaults to the
     *  selection, else today. */
    year?: number | null;
    month?: number | null;
    className?: string;
    /** Single mode: a value was committed at picker precision. */
    onSelect?: (event: CalendarSelectEvent) => void;
    /** Range mode: both ends committed (ordered). */
    onRangeSelect?: (event: CalendarRangeSelectEvent) => void;
    /** Range mode: first anchor placed (no commit yet). */
    onRangeStart?: (event: CalendarRangeStartEvent) => void;
    /** Range mode: in-progress anchor cancelled (Escape). */
    onRangeCancel?: () => void;
    /** Zoom level changed (drill-down or header zoom-out). */
    onViewChange?: (event: CalendarViewChangeEvent) => void;
    /** Page changed (prev/next/PageUp/PageDown). */
    onNavigate?: (event: CalendarNavigateEvent) => void;
}

const CELL = 'mojo-calendar-cell';

function decadeStart(year: number): number { return Math.floor(year / 10) * 10; }

/** Unknown enum-ish prop values fall back WITH a warn — never render nothing. */
function normPrecision(p: Precision | undefined): Precision {
    if (p == null || p === 'day' || p === 'month' || p === 'year') return p ?? 'day';
    console.warn(`Calendar: unknown precision "${String(p)}" — falling back to "day"`);
    return 'day';
}
function normMode(m: CalendarMode | undefined): CalendarMode {
    if (m == null || m === 'single' || m === 'range') return m ?? 'single';
    console.warn(`Calendar: unknown mode "${String(m)}" — falling back to "single"`);
    return 'single';
}

export function Calendar(props: CalendarProps) {
    const precision = normPrecision(props.precision);
    const mode = normMode(props.mode);
    const {
        value = null, startValue = null, endValue = null,
        min = null, max = null, disabledDates,
        firstDay = 1, locale = 'en-US',
        year = null, month = null, className = '',
        onSelect, onRangeSelect, onRangeStart, onRangeCancel, onViewChange, onNavigate,
    } = props;
    const panes = Math.max(1, Math.min(2, (props.months ?? 1) | 0));

    // ── Internal state: view / page / anchor / hover ──────────────
    const [view, setView] = useState<Precision>(precision);
    const [page, setPage] = useState<{ y: number; m: number }>(() => {
        const t = today();
        const seed = (mode === 'single'
            ? parseByPrecision(value, precision)
            : (parseByPrecision(startValue, precision) || parseByPrecision(endValue, precision))) || t;
        return {
            y: year != null ? Number(year) : seed.y,
            m: month != null ? Number(month) : (seed.m ?? t.m),
        };
    });
    const [anchor, setAnchor] = useState<ParsedDate | null>(null);
    const [hover, setHover] = useState<ParsedDate | null>(null);

    // Precision prop change = a different picker: reset zoom + interaction.
    const prevPrecision = useRef(precision);
    useEffect(() => {
        if (prevPrecision.current === precision) return;
        prevPrecision.current = precision;
        setView(precision);
        setAnchor(null);
        setHover(null);
    }, [precision]);

    // ── Controlled-selection sync (setValue / setRange semantics) ─
    // Our own commits echo back as prop changes — those must not re-page or
    // cancel anything, so remember what we emitted and skip the echo.
    const lastEmittedValue = useRef<string | null>(null);
    const lastEmittedRange = useRef<{ start: string; end: string } | null>(null);
    const prevValueProp = useRef<string | null>(value);
    const prevStartProp = useRef<string | null>(startValue);
    const prevEndProp = useRef<string | null>(endValue);

    useEffect(() => {
        if (value === prevValueProp.current) return;
        prevValueProp.current = value;
        const echo = value !== null && value === lastEmittedValue.current;
        lastEmittedValue.current = null;
        if (echo || mode !== 'single') return;
        // setValue semantics: page over to the new value (when it parses).
        const parsed = parseByPrecision(value, precision);
        if (parsed) setPage((p) => ({ y: parsed.y, m: parsed.m ?? p.m }));
    }, [value, mode, precision]);

    useEffect(() => {
        if (startValue === prevStartProp.current && endValue === prevEndProp.current) return;
        prevStartProp.current = startValue;
        prevEndProp.current = endValue;
        const emitted = lastEmittedRange.current;
        lastEmittedRange.current = null;
        if (emitted && emitted.start === startValue && emitted.end === endValue) return;
        // setRange semantics: a programmatic range write cancels any
        // in-progress anchor (do NOT write range props from onRangeStart).
        setAnchor(null);
        setHover(null);
    }, [startValue, endValue]);

    // ── Derived selection / constraints ───────────────────────────
    const selected = useMemo(
        () => (mode === 'single' ? parseByPrecision(value, precision) : null),
        [mode, value, precision],
    );
    const startP = useMemo(
        () => (mode === 'range' ? parseByPrecision(startValue, precision) : null),
        [mode, startValue, precision],
    );
    const endP = useMemo(
        () => (mode === 'range' ? parseByPrecision(endValue, precision) : null),
        [mode, endValue, precision],
    );
    const minP = useMemo(
        () => parseByPrecision(min, precision) || (min ? parseYmd(min) : null),
        [min, precision],
    );
    const maxP = useMemo(
        () => parseByPrecision(max, precision) || (max ? parseYmd(max) : null),
        [max, precision],
    );
    const disabledSet = useMemo(
        () => new Set((disabledDates ?? []).map((s) => formatYmd(parseYmd(s))).filter(Boolean)),
        [disabledDates],
    );

    const isDisabledAt = (cur: ParsedDate, level: Precision): boolean => {
        if (minP && compareByPrecision(cur, minP, level) < 0) return true;
        if (maxP && compareByPrecision(cur, maxP, level) > 0) return true;
        if (level === 'day' && disabledSet.size) {
            if (disabledSet.has(formatYmd(cur as ParsedYmd))) return true;
        }
        return false;
    };

    // ── Range visuals ─────────────────────────────────────────────
    // While an anchor is active it (plus hover) defines the painted span and
    // the committed range is suppressed — in-PREVIEW classes, distinct from
    // the committed in-RANGE classes.
    const rangeClasses = (cur: ParsedDate, level: Precision): string[] => {
        const out: string[] = [];
        let start = startP;
        let end = endP;
        if (anchor) {
            const other = hover || anchor;
            const cmp = compareByPrecision(anchor, other, level);
            start = cmp <= 0 ? anchor : other;
            end = cmp <= 0 ? other : anchor;
        }
        if (!start || !end) return out;

        const inClass = anchor ? `${CELL}-in-preview` : `${CELL}-in-range`;
        const cmpS = compareByPrecision(cur, start, level);
        const cmpE = compareByPrecision(cur, end, level);
        if (cmpS > 0 && cmpE < 0) out.push(inClass);
        if (cmpS === 0) {
            out.push(`${CELL}-anchor`, `${CELL}-anchor-start`);
            if (compareByPrecision(start, end, level) === 0) out.push(`${CELL}-anchor-solo`);
            else out.push(inClass);
        }
        if (cmpE === 0 && compareByPrecision(start, end, level) !== 0) {
            out.push(`${CELL}-anchor`, `${CELL}-anchor-end`, inClass);
        }
        return out;
    };

    // ── Commit / interaction ──────────────────────────────────────
    const commitValue = (val: ParsedDate) => {
        if (mode === 'single') {
            const str = formatByPrecision(val, precision);
            lastEmittedValue.current = str;
            onSelect?.({ value: str, parsed: val });
            return;
        }
        if (!anchor) {
            setAnchor(val);
            setHover(null);
            onRangeStart?.({ anchor: formatByPrecision(val, precision) });
            return;
        }
        // Second click — commit range, swapping if needed.
        const cmp = compareByPrecision(anchor, val, precision);
        const start = cmp <= 0 ? anchor : val;
        const end = cmp <= 0 ? val : anchor;
        setAnchor(null);
        setHover(null);
        const startStr = formatByPrecision(start, precision);
        const endStr = formatByPrecision(end, precision);
        lastEmittedRange.current = { start: startStr, end: endStr };
        onRangeSelect?.({ start: startStr, end: endStr });
    };

    const clickYear = (yr: number) => {
        if (precision === 'year') { commitValue({ y: yr }); return; }
        // Drill down into that year.
        setPage((p) => ({ ...p, y: yr }));
        setView('month');
        onViewChange?.({ view: 'month' });
    };

    const clickMonth = (ym: ParsedYm) => {
        if (precision === 'month') { commitValue(ym); return; }
        // Drill down into that month.
        setPage({ y: ym.y, m: ym.m });
        setView('day');
        onViewChange?.({ view: 'day' });
    };

    const clickDay = (ymd: ParsedYmd) => { commitValue(ymd); };

    const navigate = (delta: number) => {
        setPage((p) => {
            if (view === 'day') {
                const next = addMonths({ y: p.y, m: p.m }, delta);
                return { y: next.y, m: next.m };
            }
            if (view === 'month') return { ...p, y: p.y + delta };
            return { ...p, y: decadeStart(p.y) + delta * 10 };
        });
        onNavigate?.({ delta });
    };

    const zoomOut = (level: Precision) => {
        if (level === 'day') { setView('month'); onViewChange?.({ view: 'month' }); return; }
        if (level === 'month') { setView('year'); onViewChange?.({ view: 'year' }); }
        // year — already at top
    };

    const hoverCell = (parsed: ParsedDate, disabled: boolean) => {
        if (mode !== 'range' || !anchor || disabled) return;
        // Same functional-set trick as source's same-hover check: returning
        // the identical reference skips the re-render.
        setHover((h) => (h && compareByPrecision(h, parsed, view) === 0 ? h : parsed));
    };

    const rootMouseLeave = () => {
        if (mode !== 'range' || !anchor) return;
        setHover((h) => (h ? null : h));
    };

    const rootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const key = event.key;
        if (key === 'Escape') {
            if (anchor) {
                setAnchor(null);
                setHover(null);
                onRangeCancel?.();
                event.preventDefault();
            }
            return;
        }
        if (key === 'PageUp') { navigate(-1); event.preventDefault(); return; }
        if (key === 'PageDown') { navigate(1); event.preventDefault(); }
    };

    // ── Panes ─────────────────────────────────────────────────────
    const renderHead = (label: ReactNode, level: Precision, showPrev: boolean, showNext: boolean) => (
        <div className="mojo-calendar-head">
            <button
                type="button"
                className="mojo-calendar-head-label"
                data-level={level}
                onClick={() => zoomOut(level)}
            >
                {label}
            </button>
            <div className="mojo-calendar-nav">
                {showPrev && (
                    <button type="button" className="mojo-calendar-nav-btn" aria-label="Previous"
                        onClick={() => navigate(-1)}>{'‹'}</button>
                )}
                {showNext && (
                    <button type="button" className="mojo-calendar-nav-btn" aria-label="Next"
                        onClick={() => navigate(1)}>{'›'}</button>
                )}
            </div>
        </div>
    );

    const renderDayPane = (y: number, m: number, showPrev: boolean, showNext: boolean) => {
        const firstWeekday = weekdayWithFirstDay(y, m, 1, firstDay);
        const total = daysInMonth(y, m);
        const todayP = today();

        const cells: ReactNode[] = [];
        for (let i = 0; i < firstWeekday; i++) {
            cells.push(<div key={`b${i}`} className={`${CELL} ${CELL}-blank`} />);
        }
        for (let d = 1; d <= total; d++) {
            const cur: ParsedYmd = { y, m, d };
            const disabled = isDisabledAt(cur, 'day');
            const classes = [CELL];
            if (cur.y === todayP.y && cur.m === todayP.m && cur.d === todayP.d) classes.push(`${CELL}-today`);
            if (disabled) classes.push(`${CELL}-disabled`);
            if (mode === 'range') classes.push(...rangeClasses(cur, 'day'));
            else if (selected && compareYmd(cur, selected) === 0) classes.push(`${CELL}-selected`);
            cells.push(
                <button
                    key={d}
                    type="button"
                    className={classes.join(' ')}
                    disabled={disabled}
                    data-ymd={formatYmd(cur)}
                    onClick={() => clickDay(cur)}
                    onMouseEnter={() => hoverCell(cur, disabled)}
                >
                    <span className="mojo-calendar-cell-inner">{d}</span>
                </button>,
            );
        }

        const names = monthNames(locale, 'long');
        return (
            <div key={`${y}-${m}`} className="mojo-calendar-pane">
                {renderHead(
                    <>{names[m - 1]} <span className="mojo-calendar-year">{y}</span></>,
                    'day', showPrev, showNext,
                )}
                <div className="mojo-calendar-grid mojo-calendar-grid-day">
                    {weekdayNames(locale, firstDay, 'short').map((w, i) => (
                        <div key={i} className="mojo-calendar-weekday">{w}</div>
                    ))}
                </div>
                <div className="mojo-calendar-grid mojo-calendar-grid-day">{cells}</div>
            </div>
        );
    };

    const renderMonthPane = (y: number) => {
        const names = monthNames(locale, 'short');
        const cells: ReactNode[] = [];
        for (let m = 1; m <= 12; m++) {
            const cur: ParsedYm = { y, m };
            const disabled = isDisabledAt(cur, 'month');
            const classes = [CELL];
            if (disabled) classes.push(`${CELL}-disabled`);
            if (precision === 'month' && mode === 'range') classes.push(...rangeClasses(cur, 'month'));
            else if (precision === 'month' && mode === 'single' && selected && compareYm(cur, selected) === 0) {
                classes.push(`${CELL}-selected`);
            }
            cells.push(
                <button
                    key={m}
                    type="button"
                    className={classes.join(' ')}
                    disabled={disabled}
                    data-ym={formatYm(cur)}
                    onClick={() => clickMonth(cur)}
                    onMouseEnter={() => hoverCell(cur, disabled)}
                >
                    <span className="mojo-calendar-cell-inner">{names[m - 1]}</span>
                </button>,
            );
        }
        return (
            <div className="mojo-calendar-pane">
                {renderHead(String(y), 'month', true, true)}
                <div className="mojo-calendar-grid mojo-calendar-grid-month">{cells}</div>
            </div>
        );
    };

    const renderYearPane = (decade: number) => {
        const cells: ReactNode[] = [];
        for (let i = 0; i < 12; i++) {
            const yr = decade + i;
            const cur: ParsedDate = { y: yr };
            const disabled = isDisabledAt(cur, 'year');
            const classes = [CELL];
            if (disabled) classes.push(`${CELL}-disabled`);
            if (precision === 'year' && mode === 'range') classes.push(...rangeClasses(cur, 'year'));
            else if (precision === 'year' && mode === 'single' && selected && selected.y === yr) {
                classes.push(`${CELL}-selected`);
            }
            cells.push(
                <button
                    key={yr}
                    type="button"
                    className={classes.join(' ')}
                    disabled={disabled}
                    data-year={String(yr)}
                    onClick={() => clickYear(yr)}
                    onMouseEnter={() => hoverCell(cur, disabled)}
                >
                    <span className="mojo-calendar-cell-inner">{yr}</span>
                </button>,
            );
        }
        return (
            <div className="mojo-calendar-pane">
                {renderHead(`${decade} – ${decade + 11}`, 'year', true, true)}
                <div className="mojo-calendar-grid mojo-calendar-grid-year">{cells}</div>
            </div>
        );
    };

    // ── Render ────────────────────────────────────────────────────
    const dayPanes: ReactNode[] = [];
    if (view === 'day') {
        for (let i = 0; i < panes; i++) {
            let y = page.y;
            let m = page.m + i;
            while (m > 12) { m -= 12; y += 1; }
            dayPanes.push(renderDayPane(y, m, i === 0, i === panes - 1));
        }
    }

    return (
        <div
            className={`mojo-calendar mojo-calendar-${precision}${className ? ` ${className}` : ''}`}
            onMouseLeave={rootMouseLeave}
            onKeyDown={rootKeyDown}
        >
            <div className={panes > 1 && view === 'day' ? 'mojo-calendar-multi' : 'mojo-calendar-single'}>
                {view === 'day' && dayPanes}
                {view === 'month' && renderMonthPane(page.y)}
                {view === 'year' && renderYearPane(decadeStart(page.y))}
            </div>
        </div>
    );
}
