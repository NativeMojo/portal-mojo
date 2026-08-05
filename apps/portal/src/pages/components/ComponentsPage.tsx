// Component playground — every portal-mojo component family, live, in one
// place: the manual test bed. Each section is a small self-contained demo;
// the matching reference doc for AI/humans lives in packages/portal-mojo/docs.
//
// House invariant on display here too: tables and filters are SERVER-driven
// (wire params, django-mojo answers) — the Groups demo below runs against
// /api/group on whichever transport the app is using (mock or live).
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TableDemo, FiltersNote } from './demos-data';
import { ChartsDemo } from './demos-charts';
import { FormsDemo, ModalsDemo, ToastsDemo, DetailViewDemo } from './demos-feedback';
import { DisplayDemo, SearchDemo, SkeletonDemo, AccessDemo } from './demos-display';
import { PopoverDemo } from './demos-popover';

interface DemoSection {
    key: string;
    title: string;
    icon: string;
    blurb: string;
    render: () => ReactNode;
}

const SECTIONS: DemoSection[] = [
    {
        key: 'table', title: 'ModelTable', icon: 'bi-table',
        blurb: 'Server-driven table: every sort, filter, search and page is a wire param. Chooser, persistState, expand, groupBy, export.',
        render: () => <TableDemo />,
    },
    {
        key: 'filters', title: 'Filters', icon: 'bi-funnel',
        blurb: 'Add-Filter menu, typed dialogs, editable pills — all writing Django lookups into the params store.',
        render: () => <FiltersNote />,
    },
    {
        key: 'search', title: 'Expanding search', icon: 'bi-search',
        blurb: 'maestro fsearch: icon at rest, input on focus, pinned while holding text, "/" to focus, 300ms debounce to the wire.',
        render: () => <SearchDemo />,
    },
    {
        key: 'forms', title: 'SchemaForm', icon: 'bi-ui-checks',
        blurb: 'The field-definition language: fields are data, inputs are controlled, selects can never show what state doesn\'t hold.',
        render: () => <FormsDemo />,
    },
    {
        key: 'popover', title: 'Popover', icon: 'bi-front',
        blurb: 'Anchored top-layer primitive every dropdown control mounts in — stacks above native-<dialog> modals via the HTML Popover API.',
        render: () => <PopoverDemo />,
    },
    {
        key: 'modals', title: 'Modals', icon: 'bi-window-stack',
        blurb: 'Awaitable native-<dialog> manager: confirm, form, detail — stacking for free.',
        render: () => <ModalsDemo />,
    },
    {
        key: 'toasts', title: 'Toasts', icon: 'bi-chat-square-dots',
        blurb: 'success / error / info / warning — the batch bar uses warning for partial results.',
        render: () => <ToastsDemo />,
    },
    {
        key: 'detail', title: 'DetailView', icon: 'bi-person-badge',
        blurb: 'The UserView house style: header chips + active switch over a section rail.',
        render: () => <DetailViewDemo />,
    },
    {
        key: 'charts', title: 'Charts', icon: 'bi-graph-up',
        blurb: 'Dependency-free SVG: SeriesChart (line/bar/area, stacked, legend) + MetricsChart against /api/metrics/fetch.',
        render: () => <ChartsDemo />,
    },
    {
        key: 'display', title: 'Badges & formatters', icon: 'bi-tags',
        blurb: 'Badge tones, fmt.* (epoch-seconds aware), initials, inferTone.',
        render: () => <DisplayDemo />,
    },
    {
        key: 'skeleton', title: 'Skeletons', icon: 'bi-body-text',
        blurb: 'The loading silhouette: avatar + stacked lines, cycled widths, pills.',
        render: () => <SkeletonDemo />,
    },
    {
        key: 'access', title: 'Permissions', icon: 'bi-shield-lock',
        blurb: 'useCan / <Guarded> against the live session — category rollup, member context, fail-closed.',
        render: () => <AccessDemo />,
    },
];

export function ComponentsPage() {
    const [sp, setSp] = useSearchParams();
    const activeKey = sp.get('demo') ?? SECTIONS[0]!.key;
    const active = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0]!;
    const [, setRemountNonce] = useState(0);

    const pick = (key: string) => {
        const next = new URLSearchParams(sp);
        next.set('demo', key);
        setSp(next, { replace: true });
        setRemountNonce((n) => n + 1);
    };

    return (
        <div className="cmp-layout">
            <nav className="cmp-rail panel" aria-label="Component demos">
                <div className="eyebrow" style={{ padding: '14px 16px 6px' }}>portal-mojo</div>
                {SECTIONS.map((s) => (
                    <button
                        key={s.key}
                        className={`cmp-rail-item${s.key === active.key ? ' cmp-rail-active' : ''}`}
                        onClick={() => pick(s.key)}
                    >
                        <i className={`bi ${s.icon}`} /> {s.title}
                    </button>
                ))}
                <div className="cmp-rail-foot dim">
                    Docs: <code>packages/portal-mojo/docs</code>
                </div>
            </nav>
            <div className="cmp-body">
                <div className="panel panel-pad cmp-intro">
                    <div className="eyebrow">Playground</div>
                    <h1 className="panel-title">{active.title}</h1>
                    <p className="dim cmp-blurb">{active.blurb}</p>
                </div>
                {active.render()}
            </div>
        </div>
    );
}
