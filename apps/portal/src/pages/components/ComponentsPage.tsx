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
import { FormsDemo, ModalsDemo, ToastsDemo } from './demos-feedback';
import { DetailViewFullDemo } from './demos-detailview';
import { DataViewDemo } from './demos-dataview';
import { DisplayDemo, SearchDemo, SkeletonDemo, AccessDemo } from './demos-display';
import { PopoverDemo } from './demos-popover';
import { TagInputDemo } from './demos-taginput';
import { DrawerDemo } from './demos-drawer';
import { ComboBoxDemo } from './demos-combobox';
import { FormatDemo } from './demos-format';
import { CollectionMultiSelectDemo } from './demos-collection-multiselect';
import { DetailPrimitivesDemo } from './demos-detail-primitives';
import { CalendarDemo } from './demos-calendar';
import { MarkdownDemo } from './demos-markdown';
import { DatePickerDemo } from './demos-datepicker';
import { MultiSelectDropdownDemo } from './demos-multiselect-dropdown';
import { AutosaveDemo } from './demos-autosave';
import { TimezoneSelectDemo } from './demos-timezone-select';
import { TimePickerDemo } from './demos-timepicker';
import { DateRangeDemo } from './demos-daterange';
import { DateTimePickerDemo } from './demos-datetimepicker';
import { KitchenSinkDemo } from './demos-kitchen-sink';
import { CollectionSelectDemo } from './demos-collection-select';

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
        key: 'kitchen-sink', title: 'Kitchen sink form', icon: 'bi-grid-3x3-gap',
        blurb: 'ONE schema rendering every registered field type through the registry — state vs wire shapes live, on both SchemaForm and FormView autosave.',
        render: () => <KitchenSinkDemo />,
    },
    {
        key: 'autosave', title: 'FormView autosave', icon: 'bi-magic',
        blurb: 'No save buttons: edits batch 300ms into ONE save, per-field saved/error indicators, revert-on-fail from the server snapshot, showWhen, permission tabsets.',
        render: () => <AutosaveDemo />,
    },
    {
        key: 'forms', title: 'SchemaForm', icon: 'bi-ui-checks',
        blurb: 'The field-definition language: fields are data, inputs are controlled, selects can never show what state doesn\'t hold.',
        render: () => <FormsDemo />,
    },
    {
        key: 'calendar', title: 'Calendar', icon: 'bi-calendar3',
        blurb: 'The picker engine: one grid, three precisions, range anchor + hover preview, drill-down zoom — canonical YYYY-MM-DD strings out.',
        render: () => <CalendarDemo />,
    },
    {
        key: 'datepicker', title: 'DatePicker', icon: 'bi-calendar-date',
        blurb: 'Single-value picker over the Calendar engine — day/month/year precision, trigger or inline, clear ✕ governed by required/disabled/readOnly.',
        render: () => <DatePickerDemo />,
    },
    {
        key: 'daterange', title: 'DateRangePicker', icon: 'bi-calendar3-range',
        blurb: 'Two-pane range picker with the quick-range presets rail — day/month/year modes, cross-page anchor, and the FilterBar daterange dialog now uses it.',
        render: () => <DateRangeDemo />,
    },
    {
        key: 'datetimepicker', title: 'DateTimePicker', icon: 'bi-calendar-event',
        blurb: 'Calendar + time steppers + timezone in one popover — DST-correct ISO offsets computed at the selected date, one value out.',
        render: () => <DateTimePickerDemo />,
    },
    {
        key: 'timepicker', title: 'TimePicker', icon: 'bi-clock',
        blurb: 'Stepper time entry — typed digits, arrow steps, AM/PM, minute step with midnight wrap, min/max clamp, ISO/IANA/object serialization.',
        render: () => <TimePickerDemo />,
    },
    {
        key: 'collection-select', title: 'CollectionSelect', icon: 'bi-menu-button-wide',
        blurb: 'Single record picker over any model — 400ms server search, bare-id → label hydration through the shared cache, commit-only change.',
        render: () => <CollectionSelectDemo />,
    },
    {
        key: 'timezone', title: 'TimezoneSelect', icon: 'bi-globe-americas',
        blurb: 'IANA zone picker over ComboBox — offset labels with the Unicode minus, local-zone default, Python↔ICU alias tolerance, commit-only.',
        render: () => <TimezoneSelectDemo />,
    },
    {
        key: 'multiselect-dropdown', title: 'MultiSelectDropdown', icon: 'bi-check2-square',
        blurb: 'Static-options checkbox dropdown — trigger summarizes picks, menu stays open while ticking, Done closes. Row/checkbox desync killed by construction.',
        render: () => <MultiSelectDropdownDemo />,
    },
    {
        key: 'combobox', title: 'ComboBox', icon: 'bi-input-cursor-text',
        blurb: 'The house autocomplete — descriptions + meta on options, match highlighting, allowCustom, full ARIA. Change fires on COMMIT, never per keystroke.',
        render: () => <ComboBoxDemo />,
    },
    {
        key: 'collection-multiselect', title: 'CollectionMultiSelect', icon: 'bi-list-check',
        blurb: 'Server-backed multi-pick: live checkbox list, 400ms server search, SELECT/DESELECT counts, shift-click ranges, normalized ids.',
        render: () => <CollectionMultiSelectDemo />,
    },
    {
        key: 'taginput', title: 'TagInput', icon: 'bi-tags',
        blurb: 'Chip entry with the full keyboard flow — Enter/Tab/comma commit, roving chip focus. Emits the CSV string django-mojo stores.',
        render: () => <TagInputDemo />,
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
        key: 'drawer', title: 'Drawer', icon: 'bi-layout-sidebar-inset-reverse',
        blurb: 'Right slide-over on the same awaitable <dialog> manager: width presets, eyebrow/title/meta header, stacking over a modal, awaited result.',
        render: () => <DrawerDemo />,
    },
    {
        key: 'toasts', title: 'Toasts', icon: 'bi-chat-square-dots',
        blurb: 'success / error / info / warning — the batch bar uses warning for partial results.',
        render: () => <ToastsDemo />,
    },
    {
        key: 'detail', title: 'DetailView', icon: 'bi-person-badge',
        blurb: 'The UserView house style, completed: gated sections (fail-closed), sticky self-heal, live badges, kebab context menu, keep-alive sections.',
        render: () => <DetailViewFullDemo />,
    },
    {
        key: 'dataview', title: 'DataView', icon: 'bi-card-list',
        blurb: 'Point it at any record and get a detail grid: names + values pick the formatter, nested objects nest, raw JSON gets tokenized spans with copy + collapse.',
        render: () => <DataViewDemo />,
    },
    {
        key: 'detail-primitives', title: 'Detail primitives', icon: 'bi-layout-text-window-reverse',
        blurb: 'StatusPanel, FlowStrip, Timeline, KnownFieldsCard, MetadataSection, StackTraceView — ReactNode slots, both trace dialects, failure unmissable.',
        render: () => <DetailPrimitivesDemo />,
    },
    {
        key: 'charts', title: 'Charts', icon: 'bi-graph-up',
        blurb: 'Dependency-free SVG: SeriesChart (line/bar/area, stacked, legend) + MetricsChart against /api/metrics/fetch.',
        render: () => <ChartsDemo />,
    },
    {
        key: 'markdown', title: 'MarkdownView', icon: 'bi-markdown',
        blurb: 'Server-rendered markdown via /api/docit/render with a safe client fallback — the sanitizer IS the trust boundary, and the demo proves it.',
        render: () => <MarkdownDemo />,
    },
    {
        key: 'format', title: 'Formatters', icon: 'bi-braces',
        blurb: 'The full fmt namespace — filesize, currency, phone, duration… every value a live call, edge cases included.',
        render: () => <FormatDemo />,
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
