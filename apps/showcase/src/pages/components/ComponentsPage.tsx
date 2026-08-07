// Component playground — every portal-mojo component family, live, in one
// place: the manual test bed. Each section is a small self-contained demo;
// the matching reference doc for AI/humans lives in packages/portal-mojo/docs.
// The rail is GROUPED and collapsible — the group holding the active demo
// auto-opens (deep links land expanded), the rest stay folded.
//
// House invariant on display here too: tables and filters are SERVER-driven
// (wire params, django-mojo answers) — the Groups demo below runs against
// /api/group on whichever transport the app is using (mock or live).
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TableDemo } from './demos-data';
import { FiltersDemo } from './demos-filters';
import { SearchDemo } from './demos-search';
import { ChartsDemo } from './demos-charts';
import { FormsDemo, ModalsDemo, ToastsDemo } from './demos-feedback';
import { DetailViewFullDemo } from './demos-detailview';
import { DataViewDemo } from './demos-dataview';
import { DisplayDemo, SkeletonDemo, AccessDemo } from './demos-display';
import { PopoverDemo } from './demos-popover';
import { TagInputDemo } from './demos-taginput';
import { DrawerDemo } from './demos-drawer';
import { RightPanelDemo } from './demos-right-panel';
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
import { PasswordDemo } from './demos-password';
import { IdiomsDemo } from './demos-idioms';
import { LoadingDemo } from './demos-loading';
import { RecordFeedDemo } from './demos-record-feed';
import { AdminCredentialsDemo } from './demos-admin-credentials';
import { AdminMonitoringDemo } from './demos-admin-monitoring';
import { AdminMetricsExplorerDemo } from './demos-admin-metrics-explorer';
import { AdminDashboardDemo } from './demos-admin-dashboard';
import { AdminCloudWatchDemo } from './demos-admin-cloudwatch';
import { AdminSettingsDemo } from './demos-admin-settings';
import { AdminBouncerDemo } from './demos-admin-bouncer';
import { AdminDevicesDemo } from './demos-admin-devices';
import { AdminNetworkDemo } from './demos-admin-network';
import { AdminDnsDemo } from './demos-admin-dns';
import { AdminDnsCertificatesDemo } from './demos-admin-dns-certificates';
import { AdminDnsRegistrarDemo } from './demos-admin-dns-registrar';
import { AdminIncidentsDemo } from './demos-admin-incidents';
import { AdminRulesDemo } from './demos-admin-rules';
import { AdminJobsDemo } from './demos-admin-jobs';
import { AdminMembersDemo } from './demos-admin-members';
import { AdminIdentityUsersDemo } from './demos-admin-identity-users';
import { AdminStorageDemo } from './demos-admin-storage';
import { AdminShortlinksDemo } from './demos-admin-shortlinks';
import { AdminMessagingDemo } from './demos-admin-messaging';
import { AdminPhoneHubDemo } from './demos-admin-phonehub';
import { AdminPushDemo } from './demos-admin-push';
import { ChartsMetricsC2Demo, ChartsMiniWidgetDemo, ChartsKpiDemo, ChartsPieDemo } from './demos-charts-c2';
import { WorldMapDemo, WorldMapRoutesDemo } from './demos-worldmap';
import { FormWizardDemo, TabsDemo } from './demos-form-wizard';
import { LocationAddressDemo } from './demos-location-address';

interface DemoSection {
    key: string;
    title: string;
    icon: string;
    blurb: string;
    render: () => ReactNode;
}

interface DemoGroup {
    title: string;
    sections: DemoSection[];
}

const GROUPS: DemoGroup[] = [
    {
        title: 'Data',
        sections: [
            {
                key: 'table', title: 'ModelTable', icon: 'bi-table',
                blurb: 'Server-driven table: every sort, filter, search and page is a wire param. Chooser, persistState, expand, groupBy, export.',
                render: () => <TableDemo />,
            },
            {
                key: 'filters', title: 'Filters', icon: 'bi-funnel',
                blurb: 'Every filter type against a live table, with the exact wire params printed as you go: text, select, multiselect (field__in), boolean, number, and the dr_* daterange triple.',
                render: () => <FiltersDemo />,
            },
            {
                key: 'search', title: 'Expanding search', icon: 'bi-search',
                blurb: 'maestro fsearch: a 30px ICON at rest — all three states shown side by side, the 300ms debounce logged keystroke-by-keystroke, and the committed term driving a real server query.',
                render: () => <SearchDemo />,
            },
            {
                key: 'record-feed', title: 'RecordFeed', icon: 'bi-chat-left-text',
                blurb: 'Record-scoped notes and events: typed ticket/incident adapters, optimistic sends, status and assistant rows, plus controlled streaming mode.',
                render: () => <RecordFeedDemo />,
            },
        ],
    },
    {
        title: 'Forms',
        sections: [
            {
                key: 'form-wizard', title: 'FormWizard', icon: 'bi-signpost-split',
                blurb: 'One shared schema across ordered wizard and tab modes: cross-step visibility, validation focus, retained drafts, async finish, and awaitable modal.',
                render: () => <FormWizardDemo />,
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
                key: 'password', title: 'Password tools', icon: 'bi-shield-lock',
                blurb: 'checkPasswordStrength (web-mojo-exact scoring) + PasswordStrengthMeter + crypto generatePassword — the reset-form pieces.',
                render: () => <PasswordDemo />,
            },
        ],
    },
    {
        title: 'Date & time',
        sections: [
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
                key: 'timezone', title: 'TimezoneSelect', icon: 'bi-globe-americas',
                blurb: 'IANA zone picker over ComboBox — offset labels with the Unicode minus, local-zone default, Python↔ICU alias tolerance, commit-only.',
                render: () => <TimezoneSelectDemo />,
            },
        ],
    },
    {
        title: 'Pickers',
        sections: [
            {
                key: 'location-address', title: 'AddressField', icon: 'bi-geo-alt',
                blurb: 'django-mojo location autocomplete with a private provider session, stale-response guards, and one atomic declared-field details patch.',
                render: () => <LocationAddressDemo />,
            },
            {
                key: 'collection-select', title: 'CollectionSelect', icon: 'bi-menu-button-wide',
                blurb: 'Single record picker over any model — 400ms server search, bare-id → label hydration through the shared cache, commit-only change.',
                render: () => <CollectionSelectDemo />,
            },
            {
                key: 'collection-multiselect', title: 'CollectionMultiSelect', icon: 'bi-list-check',
                blurb: 'Server-backed multi-pick dropdown — summary trigger, menu with live server search, SELECT/DESELECT counts, shift-click ranges, normalized ids; variant="panel" keeps the inline box.',
                render: () => <CollectionMultiSelectDemo />,
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
                key: 'taginput', title: 'TagInput', icon: 'bi-tags',
                blurb: 'Chip entry with the full keyboard flow — Enter/Tab/comma commit, roving chip focus. Emits the CSV string django-mojo stores.',
                render: () => <TagInputDemo />,
            },
        ],
    },
    {
        title: 'Overlays',
        sections: [
            {
                key: 'tabs', title: 'Tabs', icon: 'bi-segmented-nav',
                blurb: 'Accessible controlled/uncontrolled tabs with eight token-only variants, disabled-key navigation, aliases, and a loud fallback.',
                render: () => <TabsDemo />,
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
                key: 'right-panel', title: 'Right panel', icon: 'bi-layout-sidebar-reverse',
                blurb: 'Persistent non-modal complementary shell slot: route-independent open/replace/close, focus restoration, Escape/dialog ordering, and narrow layout.',
                render: () => <RightPanelDemo />,
            },
            {
                key: 'toasts', title: 'Toasts', icon: 'bi-chat-square-dots',
                blurb: 'success / error / info / warning — the batch bar uses warning for partial results.',
                render: () => <ToastsDemo />,
            },
            {
                key: 'loading', title: 'Loaders', icon: 'bi-hourglass-split',
                blurb: 'Spinner atom, the blocking full-screen overlay (top layer, above modals), the view loader, inline loaders — all with the anti-flash delay that keeps fast work silent.',
                render: () => <LoadingDemo />,
            },
            {
                key: 'idioms', title: 'UX idioms', icon: 'bi-hand-index-thumb',
                blurb: 'Armed two-step confirm for the irreversible; act-now + Undo for the reversible; a persistent progress card for the long-running.',
                render: () => <IdiomsDemo />,
            },
        ],
    },
    {
        title: 'Detail',
        sections: [
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
        ],
    },
    {
        title: 'Display',
        sections: [
            {
                key: 'charts', title: 'Charts', icon: 'bi-graph-up',
                blurb: 'Dependency-free SVG: SeriesChart (line/bar/area, stacked, legend) + MetricsChart against /api/metrics/fetch.',
                render: () => <ChartsDemo />,
            },
            {
                key: 'charts-metrics', title: 'MetricsChart+', icon: 'bi-graph-up-arrow',
                blurb: 'C2 completion: stats summary + view-data dialogs (CSV), the custom date-range dialog feeding dt_start/dt_end epochs, and exportChartPng.',
                render: () => <ChartsMetricsC2Demo />,
            },
            {
                key: 'charts-mini', title: 'Metrics mini widget', icon: 'bi-activity',
                blurb: 'Compact metrics card: windowed trending, stats/data/refresh/settings actions, persisted settings — and the entity search scoping the metric via account=.',
                render: () => <ChartsMiniWidgetDemo />,
            },
            {
                key: 'charts-kpi', title: 'KPI & progress', icon: 'bi-speedometer2',
                blurb: 'KPITile/KPIStrip (one batched fetch, delta badges that never render Infinity%) and CircularProgress (sizes, gauges, segments, gradients).',
                render: () => <ChartsKpiDemo />,
            },
            {
                key: 'charts-pie', title: 'PieChart', icon: 'bi-pie-chart',
                blurb: 'Native SVG pie/doughnut: all three input shapes, golden-angle colors, center labels, label-keyed arc tween, slice click, PNG export.',
                render: () => <ChartsPieDemo />,
            },
            {
                key: 'worldmap', title: 'WorldMap', icon: 'bi-globe-americas',
                blurb: 'Dependency-free geo map — no tiles, no CDN, no network: sized country markers, the login tone palette, legend toggles, double-click drill-down, the injectable land seam, and the off-bounds counter.',
                render: () => <WorldMapDemo />,
            },
            {
                key: 'worldmap-routes', title: 'WorldMap routes', icon: 'bi-broadcast-pin',
                blurb: 'Origin→country arcs with intensity-driven width/opacity, antimeridian splitting, the animation opt-out, interactive on vs off, and COUNTRY_OPTIONS (where ES is Spain again).',
                render: () => <WorldMapRoutesDemo />,
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
        ],
    },
    {
        title: 'Admin',
        sections: [
            {
                key: 'admin-dashboard', title: 'Admin dashboard', icon: 'bi-grid-1x2',
                blurb: 'Global operational overview backed only by authoritative metric and count endpoints, with independent permission gates and safe root fallback.',
                render: () => <AdminDashboardDemo />,
            },
            {
                key: 'admin-cloudwatch', title: 'CloudWatch', icon: 'bi-clouds',
                blurb: 'Global EC2, RDS, and Redis infrastructure monitoring with exact resource discovery, friendly metric identities, constrained controls, and modal-only resource details.',
                render: () => <AdminCloudWatchDemo />,
            },
            {
                key: 'admin-messaging', title: 'Email & contact messages', icon: 'bi-envelope-at',
                blurb: 'Global SES domains, mailboxes, immutable delivery history, templates and the public support queue — explicit side effects, offline previews, and secret-safe mock parity.',
                render: () => <AdminMessagingDemo />,
            },
            {
                key: 'admin-phonehub', title: 'Phone Hub', icon: 'bi-phone',
                blurb: 'Global phone lookup, sanitized SMS audit history, and write-only Twilio, AWS, and Mojo provider configuration with exact operation gates.',
                render: () => <AdminPhoneHubDemo />,
            },
            {
                key: 'admin-push', title: 'Push notifications', icon: 'bi-bell',
                blurb: 'Caller-only stats, globally gated metrics, strict device/delivery projections, templates, and cache-free FCM configuration without send, retry, or delete shortcuts.',
                render: () => <AdminPushDemo />,
            },
            {
                key: 'admin-storage', title: 'Storage', icon: 'bi-hdd-stack',
                blurb: 'Global S3 buckets, masked storage backends, capability-safe files, sharing and finite rendition convergence — with explicit destructive confirmation and no upload or deletion shortcuts.',
                render: () => <AdminStorageDemo />,
            },
            {
                key: 'admin-shortlinks', title: 'Shortlinks', icon: 'bi-link-45deg',
                blurb: 'Global shortlink inventory and privacy-bounded tracked-click history with destination-free Query caches and reconciled mutations.',
                render: () => <AdminShortlinksDemo />,
            },
            {
                key: 'admin-users', title: 'Users', icon: 'bi-people',
                blurb: 'Reusable full-fidelity Users table and 14-section detail with system-pinned permissions and caller-only secrets.',
                render: () => <AdminIdentityUsersDemo />,
            },
            {
                key: 'admin-members', title: 'Members', icon: 'bi-person-badge',
                blurb: 'Global membership table/detail, explicit no-oracle invitation versus authorized directory add, safe grants, and fixed-group composition.',
                render: () => <AdminMembersDemo />,
            },
            {
                key: 'admin-credentials', title: 'Credentials', icon: 'bi-key',
                blurb: 'Reusable group API-key and webhook administration, including one-shot token handling, explicit audited reveals, and permission-aware controls.',
                render: () => <AdminCredentialsDemo />,
            },
            {
                key: 'admin-monitoring', title: 'Monitoring', icon: 'bi-activity',
                blurb: 'Stored request/response inspection and Redis-backed metrics-permission administration with exact operator gates.',
                render: () => <AdminMonitoringDemo />,
            },
            {
                key: 'admin-metrics-explorer', title: 'Metrics Explorer', icon: 'bi-graph-up',
                blurb: 'Permission-safe recorded-metrics discovery with full colon-slug identity, KPI deltas, group fan-out, and exact scalar reads.',
                render: () => <AdminMetricsExplorerDemo />,
            },
            {
                key: 'admin-settings', title: 'Runtime settings', icon: 'bi-gear',
                blurb: 'Real global/group settings with write-only secrets and direction-aware atomic transition payloads.',
                render: () => <AdminSettingsDemo />,
            },
            {
                key: 'admin-bouncer', title: 'Bouncer', icon: 'bi-shield-check',
                blurb: 'Risk decisions, device investigation, and supported bot-signature administration without caching token nonces.',
                render: () => <AdminBouncerDemo />,
            },
            {
                key: 'admin-devices', title: 'Devices, logins & GeoIP', icon: 'bi-laptop',
                blurb: 'Fleet-wide device triage, the login-location world map with country drill-down, and the GeoIP dossier with expiry-aware enforcement and a never-cached raw provider record.',
                render: () => <AdminDevicesDemo />,
            },
            {
                key: 'admin-network', title: 'Network security', icon: 'bi-hdd-network',
                blurb: 'Perimeter control: blocked IPs with honest expiry state, the firewall log with the target IP pulled out of the payload, kernel IP sets created disabled behind an armed enable, and the geofencing page — posture header, rules editor, simulator, evidence log and exemptions.',
                render: () => <AdminNetworkDemo />,
            },
            {
                key: 'admin-dns', title: 'DNS domains & records', icon: 'bi-globe2',
                blurb: 'Global DNS credentials, domain inventory/KISS detail, and safe live complete-set records with explicit corrections, stale preflight, and provider-specific refusal states.',
                render: () => <AdminDnsDemo />,
            },
            {
                key: 'admin-dns-certificates', title: 'DNS certificates & ACME', icon: 'bi-patch-check',
                blurb: 'Global certificate custody, in-zone ACME requests, renewal-aware bounded polling, delegation readiness, and literal platform gates for house assets without exposing private material.',
                render: () => <AdminDnsCertificatesDemo />,
            },
            {
                key: 'admin-dns-registrar', title: 'DNS registrar & contacts', icon: 'bi-cart-check',
                blurb: 'Safe domain search/quote/purchase with one-use tokens and durable-ledger reconciliation, plus locally held scoped registrant PII and manual superuser-only House adoption.',
                render: () => <AdminDnsRegistrarDemo />,
            },
            {
                key: 'admin-incidents', title: 'Incidents & events', icon: 'bi-shield-exclamation',
                blurb: 'Priority incident triage, immutable day-grouped events, forensic details, sanitized exports, and selection-wide merge semantics.',
                render: () => <AdminIncidentsDemo />,
            },
            {
                key: 'admin-rules', title: 'Rule Engine', icon: 'bi-diagram-3',
                blurb: 'Always-inactive rule creation and a lossless, runtime-aware ordered handler DSL editor with explicit legacy warnings.',
                render: () => <AdminRulesDemo />,
            },
            {
                key: 'admin-jobs', title: 'Jobs engine', icon: 'bi-cpu',
                blurb: 'Runner fleet triage, per-channel queue depth, the segmented job table with an armed cancel and a republishing retry, dry-run-first purge, and scheduled tasks with a global-only gate that closes the owner fallback.',
                render: () => <AdminJobsDemo />,
            },
        ],
    },
    {
        title: 'Access',
        sections: [
            {
                key: 'access', title: 'Permissions', icon: 'bi-shield-lock',
                blurb: 'useCan / <Guarded> against the live session — category rollup, member context, fail-closed.',
                render: () => <AccessDemo />,
            },
        ],
    },
];

const SECTIONS: DemoSection[] = GROUPS.flatMap((g) => g.sections);

const groupOf = (key: string): string | undefined =>
    GROUPS.find((g) => g.sections.some((s) => s.key === key))?.title;

export function ComponentsPage() {
    const [sp, setSp] = useSearchParams();
    const activeKey = sp.get('demo') ?? SECTIONS[0]!.key;
    const active = SECTIONS.find((s) => s.key === activeKey) ?? SECTIONS[0]!;
    const [, setRemountNonce] = useState(0);

    // Open state per group — starts with (only) the active demo's group, and
    // any navigation (clicks here, deep links, back/forward) re-opens the
    // group that owns the now-active demo. Others keep their user-set state.
    const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
        () => new Set([groupOf(active.key) ?? GROUPS[0]!.title]),
    );
    useEffect(() => {
        const title = groupOf(active.key);
        if (!title) return;
        setOpenGroups((prev) => {
            if (prev.has(title)) return prev;
            const next = new Set(prev);
            next.add(title);
            return next;
        });
    }, [active.key]);

    const toggleGroup = (title: string) =>
        setOpenGroups((prev) => {
            const next = new Set(prev);
            if (next.has(title)) next.delete(title);
            else next.add(title);
            return next;
        });

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
                {GROUPS.map((g) => {
                    const isOpen = openGroups.has(g.title);
                    const hasActive = g.sections.some((s) => s.key === active.key);
                    return (
                        <div key={g.title}>
                            <button
                                className={`cmp-rail-group${isOpen ? ' is-open' : ''}${hasActive ? ' has-active' : ''}`}
                                aria-expanded={isOpen}
                                onClick={() => toggleGroup(g.title)}
                            >
                                <i className="bi bi-chevron-right" aria-hidden="true" />
                                {g.title}
                                <span className="cmp-rail-group-count">{g.sections.length}</span>
                            </button>
                            {isOpen && g.sections.map((s) => (
                                <button
                                    key={s.key}
                                    className={`cmp-rail-item${s.key === active.key ? ' cmp-rail-active' : ''}`}
                                    onClick={() => pick(s.key)}
                                >
                                    <i className={`bi ${s.icon}`} /> {s.title}
                                </button>
                            ))}
                        </div>
                    );
                })}
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
