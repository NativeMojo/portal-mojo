# portal-mojo — component & client reference

Reference docs for every export, written to be loaded into an AI coding
context. Each page states the import path, the API surface, the wire
contract it speaks, and the invariants that must hold. Live demos for
everything: run the showcase (`npm run dev:showcase`) → **Develop → Components**.

| Page | Covers |
|---|---|
| [client.md](client.md) | Transport, envelope boundary, `mojoList/Get/Save/Delete/Download/Metrics`, `mojoCall`, `mojoQueryDefaults`, mock vs live |
| [defineModel.md](defineModel.md) | Model definitions + hooks, POST_SAVE_ACTIONS, `fetchOne`, cache keys |
| [params.md](params.md) | `useTableParams` — the single source of truth for table state; persistence blob |
| [auth.md](auth.md) | Login flows, token upkeep, hosted-auth (bouncer page) bridge, auth events |
| [auth-pages.md](auth-pages.md) | The in-app auth pages: routes + guard, `VITE_MOJO_AUTH` switch, fresh-auth (440 step-up) modal, MFA panel, password tools |
| [admin-credentials.md](admin-credentials.md) | Group API keys and webhook subscriptions — dual-mount pages, permission registry, secret-safe create/reveal/rotation |
| [admin-dashboard.md](admin-dashboard.md) | Package-owned global Admin landing, authoritative signals, independent gates, caller-isolated caches, and root fallback |
| [admin-cloudwatch.md](admin-cloudwatch.md) | Global EC2/RDS/Redis CloudWatch charts, exact resource/fetch wires, constrained controls, refresh ownership, and modal details |
| [admin-monitoring.md](admin-monitoring.md) | Monitoring Admin registration, logs, and exact Redis-backed metrics-permission mutations |
| [admin-metrics-explorer.md](admin-metrics-explorer.md) | Read-only recorded-metrics discovery, full-slug adapters, KPI/fan-out/scalar contracts, and cache identity |
| [admin-settings.md](admin-settings.md) | Runtime settings admin — direction-aware atomic writes, write-only secrets, and global/group scope |
| [admin-bouncer.md](admin-bouncer.md) | Bouncer decisions, device investigations, and bot-signature administration with token-safe caching |
| [admin-security-tickets.md](admin-security-tickets.md) | Ticket queue, KISS detail modal, notes, approvals, and Maestro sync contract |
| [admin-incidents.md](admin-incidents.md) | Incident/event triage, forensic detail, merge semantics, and sanitized export boundary |
| [admin-rules.md](admin-rules.md) | Always-inactive RuleSet authoring and the lossless, runtime-effective handler-chain builder |
| [admin-members.md](admin-members.md) | Global membership table/detail, no-oracle admission, extensible grants, Group-detail composition, and unsupported-operation boundaries |
| [admin-identity-users.md](admin-identity-users.md) | Global Users table and 14-section detail, system gates, action contracts, and one-time credential invariants |
| [admin-devices-geoip.md](admin-devices-geoip.md) | Fleet device triage, the login-location world map with country drill-down, and the GeoIP dossier — expiry-aware enforcement, the never-cached raw provider record, and the backend traps the port encodes |
| [admin-jobs.md](admin-jobs.md) | Jobs engine — runner fleet, per-channel queue depth, the segmented job table with armed cancel and republishing retry, the dry-run-first control plane, scheduled tasks with a global-only gate, and the thirteen backend corrections the port encodes |
| [admin-network-security.md](admin-network-security.md) | Perimeter control — blocked IPs, the firewall log, kernel IP sets and the geofencing page (posture, rules, simulator, evidence, exemptions), with the DSL projection and every backend correction the port encodes |
| [admin-dns.md](admin-dns.md) | Global DNS foundation — capability gates, safe typed resources, provider credential lifecycle, and secret/PII/material boundaries |
| [admin-dns-records.md](admin-dns-records.md) | Domain inventory/KISS detail and id-less live DNS records — complete-set writes, explicit corrections, stale preflight, and provider behavior |
| [admin-dns-certificates.md](admin-dns-certificates.md) | Certificate custody and ACME lifecycle — in-zone requests, delegation readiness, house gates, renewal-aware bounded polling, and the no-material boundary |
| [admin-dns-registrar.md](admin-dns-registrar.md) | Domain search/quote/purchase, one-use token custody, durable-ledger reconciliation, scoped registrant PII, and manual House adoption |
| [admin-storage.md](admin-storage.md) | Global S3 buckets, masked storage backends, capability-safe FileView/shares, and finite rendition convergence |
| [admin-messaging.md](admin-messaging.md) | SES domains/mailboxes/sent/templates plus public contact requests, with write-only credentials and offline HTML previews |
| [admin-phonehub.md](admin-phonehub.md) | Global Phone Hub: evidence-backed lookup, sanitized SMS audits, and write-only provider configuration |
| [admin-assistant.md](admin-assistant.md) | Global REST-only Assistant panel, conversations, strict blocks, context reuse, skills, and explicit tiered memory |
| [ModelTable.md](ModelTable.md) | The server-driven table: columns, filters, selection/batch, chooser, persist, autoRefresh, expand, groupBy, export, skeleton |
| [forms.md](forms.md) | The `Field` language, `SchemaForm`, `formModal`, `FormView` inline autosave + showWhen + tabsets |
| [tabs-and-form-wizard.md](tabs-and-form-wizard.md) | Accessible Tabs variants and shared-state FormWizard, async finish, reset/roster semantics, modal helper |
| [DetailView.md](DetailView.md) | The UserView-style detail surface + row/section primitives |
| [feedback.md](feedback.md) | Awaitable `modal.*`, `toast.*` |
| [idioms.md](idioms.md) | ArmedButton (two-step confirm), `undoToast` (grace-period undo), `progressToast` — the dangerous-action trio |
| [loading.md](loading.md) | `Spinner`, `busy()`/`busyWhile()` blocking overlay, `ViewLoader`, `InlineLoader`, `Busy` — the anti-flash delay rule and skeleton-vs-loader guidance |
| [popover.md](popover.md) | Anchored top-layer popover shell — placement, reposition, outside/Escape close, the dialog stacking story |
| [taginput.md](taginput.md) | Chip/tag entry — CSV wire shape, keyboard matrix, validation + inline errors |
| [combobox.md](combobox.md) | The house autocomplete — options with descriptions/meta, commit-only change pipeline, allowCustom, ARIA |
| [location-address.md](location-address.md) | Six-endpoint LocationClient, private provider sessions, stale guards, controlled AddressField, atomic form patching |
| [calendar.md](calendar.md) | The picker engine + `dateFns` namespace — three precisions, range anchor/preview, drill-down zoom |
| [datepicker.md](datepicker.md) | Single-value picker shell — precisions, display-format stripping, clear/required/inline states |
| [daterange.md](daterange.md) | Range picker + PresetRail — quick ranges, precision modes, the FilterBar daterange dialog |
| [timezone-select.md](timezone-select.md) | IANA zone picker over ComboBox — offset labels, local default, alias tolerance, commit-only |
| [timepicker.md](timepicker.md) | Stepper time entry — 12h/24h, minute step math, min/max, ISO/IANA/object serialization, embed mode |
| [datetimepicker.md](datetimepicker.md) | Calendar + time + timezone in one popover — DST-correct offsets, boundary-day clamping |
| [collection-select.md](collection-select.md) | Single record picker — server search, id→label hydration, null sentinel, shared cache keys |
| [multiselect-dropdown.md](multiselect-dropdown.md) | Static checkbox dropdown — summarized trigger, Done footer, disabled options |
| [collection-multiselect.md](collection-multiselect.md) | Server-backed multi-pick dropdown (panel variant available) — model binding, 400ms search, select/deselect-all, shift-click ranges |
| [detail-primitives.md](detail-primitives.md) | StatusPanel, FlowStrip, Timeline, KnownFieldsCard, MetadataSection, StackTraceView — the detail-page pack |
| [dataview.md](dataview.md) | Auto-inferring key/value grid + safe JSON viewer — schema or inference, nested records |
| [markdown.md](markdown.md) | MarkdownView — server render via docit, allowlist sanitizer trust model, client fallback |
| [record-feed.md](record-feed.md) | RecordFeed — ticket/incident adapters, chronological latest-window normalization, optimistic sends, controlled mode |
| [right-panel.md](right-panel.md) | Explicit opt-in persistent shell slot — provider state, focus/Escape semantics, route preservation, responsive layout |
| [charts.md](charts.md) | `SeriesChart`, `MetricsChart` (+stats/data dialogs, custom `dt_*` range), `MetricsMiniWidget`, `KPITile/KPIStrip`, `CircularProgress`, `PieChart`, `exportChartPng`, the metrics wire shape |
| [worldmap.md](worldmap.md) | `WorldMap` — dependency-free geo map (no tiles/CDN/network), the projection math, `COUNTRY_CENTROIDS`/`COUNTRY_OPTIONS`, metrics-slug→country binding, and the injectable `land` seam |
| [menus-and-access.md](menus-and-access.md) | Menu registry + SidebarNav; `useMe`/`useCan`/`Guarded`; group context |
| [grouping-and-fmt.md](grouping-and-fmt.md) | `groupBy*` helpers, `fmt.*` formatters |

## Non-negotiables (apply to every page below)

1. **Tables are SERVER-driven.** Sort, search, filters and paging are wire
   params django-mojo answers. Nothing filters/sorts rows client-side; if
   you are about to `Array.filter` table rows, stop — write a param.
2. **One envelope-unwrap boundary** (`client.ts`). A failed save REJECTS —
   never resolve failure as success, never sniff `resp.data.data`.
3. **Models are definitions, not instances** (`defineModel`). TanStack Query
   owns cache/reactivity; there is no second ownership system.
4. **Controlled inputs, one value pipeline.** A control can never display a
   value its state doesn't hold. Unknown option values fall back to a
   default WITH a `console.warn` — never to rendering nothing.
5. **Both themes, day one.** Style with tokens from `apps/portal/src/theme.css`
   (`--surface`, `--ink`, `--mute`, `--accent`, …) and verify under
   `data-theme="light"` AND `"dark"`.
6. **django-mojo datetimes are epoch SECONDS** on the wire. `fmt.*` accepts
   them directly; do not `new Date(epochSeconds)` without ×1000.
7. **The mock speaks the exact wire contract** (`src/client/mock.ts`). When a
   contract detail changes, the mock changes in the same commit — it is the
   contract's executable spec.

## Working agreement

Every new component ships with: a page here, a demo section in the
playground (`apps/showcase/src/pages/components/`), and a browser
verification in both themes.
