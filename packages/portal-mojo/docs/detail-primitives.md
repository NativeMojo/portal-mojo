# Detail primitives — the record-page building blocks

```ts
import {
    StatusPanel, FlowStrip, Timeline, KnownFieldsCard, MetadataSection, StackTraceView,
} from 'portal-mojo/ui';
```

Six small pieces admin record pages are composed from, ported from
web-mojo's `src/core/views/data/*` primitives plus its admin metadata
section. They are presentational and stateless (except `MetadataSection`,
which writes) — drop them inside a `DetailView` section, a `panel`, or a
`modal.detail`. Styles: `apps/portal/src/theme/detail-primitives.css`.

**All three trusted-HTML slots are gone.** web-mojo rendered
`StatusPanel.meta`, `FlowStrip.value/hint` and `Timeline.detail` as
trusted HTML with a "the caller must escape interpolations" contract.
Here they are `ReactNode` props — compose `<code>`/`<strong>`/`<a>`
directly and the escaping question never arises (architecture rule 6).

## StatusPanel — "what state is this in, what do I do next"

```tsx
<StatusPanel
    tone="danger" state="Firing" icon="bi-fire"        // icon replaces the tone dot
    headline="Auth brute-force from 203.0.113.0/24"
    meta={<>Triggered <code>4m ago</code> · 218 events</>}
    actions={<><button className="btn btn-primary btn-compact">Acknowledge</button></>}
/>
```

The hero banner that opens an Overview section. Tone tints the surface and
colors the state eyebrow + dot. `actions` is a slot — the caller owns the
handlers (web-mojo dispatched `data-action` through a global pipeline).
Container queries stack the actions under the headline below 480px of the
panel's OWN width, so it behaves inside an `lg` modal.

## FlowStrip — STEP 1 → N

```tsx
<FlowStrip
    steps={[
        { title: 'Match', tone: 'primary', value: <code>category=auth</code>, hint: 'Every condition must match.' },
        { title: 'Re-trigger', empty: true, value: 'Not configured' },
    ]}
    onEditStep={(step, i) => openTab(step, i)}
/>
```

| Step field | Effect |
|---|---|
| `num` | eyebrow; defaults to `STEP <n>` |
| `tone` | 2px cap over the column + colored eyebrow (which stage failed) |
| `empty` | renders `value` muted-italic ("not configured") |
| `editable: false` | opts one step out of the pencil |
| `editTitle` | pencil tooltip; defaults to `Edit <title>` |

Column count rides the inline `--flow-strip-cols` custom property; the CSS
container queries reflow 4 → 2 → 1 off the strip's own width. Empty
`steps` renders nothing.

## Timeline — the vertical event feed

```tsx
<Timeline items={[{ tone: 'danger', title: 'Incident opened', meta: fmt.relative(ev.at), body: <>…</> }]} limit={5} />
```

`{tone, title, meta, body}` — source names were `headline/when/detail`.
`meta` is the right-aligned monospace timestamp column: format it yourself
(`fmt.relative` / `fmt.datetime`, both epoch-SECONDS aware). `limit` slices
to the first N ("recent activity" mode). The empty state renders inside the
`<ol>` so the rail stays visually intact.

## KnownFieldsCard — promoted keys + raw blob

```tsx
<KnownFieldsCard
    data={record.metadata ?? {}}
    known={[
        { key: 'created_by', label: 'Created by' },
        { key: 'last_resolved', label: 'Resolved', format: 'datetime' },   // an fmt.* name
        { key: 'os.family', label: 'OS', format: (v, key, data) => <code>{String(v)}</code> },
        { key: 'agent_prompt', hideEmpty: true },
    ]}
    rawLabel="Raw metadata"
/>
```

- `key` is a **dotted path** (`os.family`); an own property of that literal
  name wins over traversal.
- `format` is an `fmt.*` name (`date` | `datetime` | `relative`) or a
  function returning any node. An unknown name **warns and renders the raw
  value** — never nothing (rule 4).
- Missing values render a muted `—`; `hideEmpty` drops the row instead.
- Objects with no formatter render as compact JSON in a `<code>`.
- The raw blob goes in a collapsed `<details>` below (`showRaw={false}` to
  drop it, `rawCollapsed={false}` to start open). Skipped for an empty blob.

## MetadataSection — editable key/value CRUD (writes)

```tsx
<MetadataSection
    endpoint="/api/user" id={user.id} metadata={user.metadata}
    onSaved={(next) => qc.setQueryData<User>(['/api/user', 'one', user.id], (p) => p && { ...p, metadata: next })}
/>
```

**Wire contract:** every mutation is one `POST <endpoint>/<id>` with body
`{metadata: {…the whole blob…}}` through `mojoCall` — the same single
envelope-unwrap boundary as everything else. Add, edit and delete all take
this one path; there is no per-key endpoint.

Invariants:

1. **Controlled on `metadata`; `onSaved` is REQUIRED.** The component never
   mirrors server state (rule 5) — wire `onSaved` into the TanStack cache or
   parent state or the UI will not move after a save.
2. **A rejected save is unmissable** (rule 3). `mojoCall` REJECTS; the
   server's own message lands in a persistent inline banner AND the editor
   stays open holding what you typed. web-mojo read `resp.status === 200`
   off a never-rejecting `model.save()` and fired a generic toast — that is
   exactly the trap this port retires. Editing is therefore inline, not a
   modal: a closed modal has no editor state to keep.
3. **Values are JSON-parsed when they can be** (source semantics): `42`,
   `true` and `{"a":1}` land as real types, everything else stays a string.
   Object values then display **read-only** — a string editor round-trips
   them lossily; remove and re-add to change one.

Deletion confirms through `modal.confirm`; success toasts.

## StackTraceView — JS **and** Python tracebacks

```tsx
<StackTraceView trace={job.stack_trace} collapseAfter={24} />
```

One parser, both dialects, in this match order (ported verbatim):
`at fn (file:line:col)` → `at file:line:col` → `File "…", line N, in fn` →
any `at …` line → context. Non-string traces are JSON-pretty-printed first.

- **Re-themed.** The source shipped a hardcoded light-only `<style>` block
  (`#f8f9fa` surface, `#dc3545`/`#0d6efd`/`#6610f2` text) that was
  unreadable in dark mode. This renders semantic classes over tokens.
- **The exception line is found anywhere.** The source only colored line 0,
  so every Python traceback — which opens with `Traceback (most recent call
  last):` and puts the exception LAST — rendered its most important line as
  plain context. An anchored `^[A-Za-z_][\w.]*(Error|Exception|…)` pattern
  now catches it, including dotted ones (`django.db.utils.IntegrityError`).
- Frame indentation is preserved so Python frames stay aligned with their
  source lines, terminal-style.
- Traces longer than `collapseAfter` (default 24) collapse behind a "Show
  all N lines" toggle; `0` disables collapsing. The body scroll-caps at
  600px either way.

## Pitfalls

- `tone` is portal-mojo's 6-value `Tone` (`success | warning | danger |
  info | muted | primary`), not web-mojo's 7 — `default`/`secondary` both
  map to `muted`. Tones arriving as wire data go through a runtime guard:
  unknown values fall back to `muted` **with a `console.warn`**.
- Timestamps are never formatted for you. django-mojo sends epoch SECONDS;
  pass them through `fmt.*` before handing them to `Timeline.meta`.
- `KnownFieldsCard` and `MetadataSection` both render a `metadata` blob and
  are easy to confuse: the card is read-only with promoted known keys; the
  section is the editor. A detail page often wants both.
