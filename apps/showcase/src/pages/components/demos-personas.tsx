// Personas demo — the full pipeline live: definePersonas (two hats + one
// gated role), PersonaProvider owning the active persona (persist + snap +
// <html data-persona>/<html data-density>), persona-scoped menus built by
// personaSectionsMenu and resolved by the REAL menu registry against a fake
// route picker, and auditPersonas reporting a deliberately leaked gate key.
//
// Menus are registered ONCE at module load (the declared-once rule); they are
// persona-scoped, so the showcase's own sidebar — whose routes step-1 match —
// is never hijacked. Menu resolution below runs against a FIXTURE `me`
// holding the demo.* keys, so what you see is the persona mechanics, not
// your session's grants; the availability strip uses your real session.
import { useEffect, useMemo, useState } from 'react';
import { useMe, type Me } from 'portal-mojo/client';
import { Badge, registerMenus, resolveActiveMenu, type MenuConfig } from 'portal-mojo/ui';
import {
    PersonaProvider, auditPersonas, definePersonas, personaSectionsMenu,
    personasOwningPath, usePersona, type PersonaDef, type PersonaSection,
} from 'portal-mojo/personas';

// ── Fixtures (module scope: declared once) ────────────────────────────

definePersonas([
    {
        slug: 'demo-support', label: 'Support', icon: 'bi-headset', home: '/demo/queue',
        density: 'simple', grants: { keys: ['demo.queue', 'demo.players'] },
    },
    {
        slug: 'demo-owner', label: 'Brand Owner', icon: 'bi-graph-up', home: '/demo/reports',
        density: 'dense', grants: { keys: ['demo.reports', 'demo.players'] },
    },
    {
        // Role-style: gated. Visible in `available` only when your session
        // holds demo.audit (superuser/admin sessions pass every gate).
        slug: 'demo-auditor', label: 'Auditor', icon: 'bi-shield-check', home: '/demo/audit',
        tone: 'admin', gate: ['demo.audit'],
    },
]);

const DEMO_SECTIONS: PersonaSection[] = [
    {
        id: 'demo:queue', label: 'Work queues', icon: 'bi-inbox', basePath: 'demo/queue',
        permissions: ['demo.queue'], personas: ['demo-support'],
        element: <div />, children: [],
    },
    {
        id: 'demo:players', label: 'Players', icon: 'bi-people', basePath: 'demo/players',
        permissions: ['demo.players'],
        // Shared surface, per-persona presentation overrides:
        personas: { 'demo-support': { navGroup: 'Console' }, 'demo-owner': { label: 'Player drill-down', navGroup: 'Insight' } },
        element: <div />, children: [],
    },
    {
        id: 'demo:reports', label: 'Reports', icon: 'bi-file-earmark-bar-graph', basePath: 'demo/reports',
        permissions: ['demo.reports'], personas: ['demo-owner'],
        element: <div />, children: [],
    },
];

registerMenus(personaSectionsMenu(DEMO_SECTIONS));

/** Fixture session for menu resolution — holds every demo.* key, so the
 *  panels demonstrate persona eligibility rather than this session's grants. */
const FIXTURE_ME: Me = { id: 0, permissions: { 'demo.queue': true, 'demo.players': true, 'demo.reports': true } };

const FAKE_ROUTES = ['/demo/queue', '/demo/players', '/demo/reports', '/somewhere/else'];

// Audit fixtures: marketing's preset deliberately holds support's gate key.
const AUDIT_PERSONAS: PersonaDef[] = [
    { slug: 'support', label: 'Support', home: '/s', gate: ['support.queue'] },
    { slug: 'marketing', label: 'Marketing', home: '/m', gate: ['marketing.campaigns'] },
    { slug: 'explorer', label: 'Explorer (hat)', home: '/' },
];
const AUDIT_PRESETS = [
    { slug: 'support', label: 'Support', keys: ['support.queue', 'players.view'] },
    { slug: 'marketing', label: 'Marketing', keys: ['marketing.campaigns', 'support.queue', 'players.view'] },
];

// ── Panels ────────────────────────────────────────────────────────────

function MenuPanel({ menu, active }: { menu: MenuConfig | null; active: boolean }) {
    return (
        <div className="panel panel-pad" style={{ flex: 1, minWidth: 220, opacity: active ? 1 : 0.7 }}>
            <div className="demo-row" style={{ marginBottom: 8 }}>
                <code>{menu?.name ?? '(no menu resolves)'}</code>
                {active && <Badge tone="primary">active persona</Badge>}
            </div>
            {menu?.items.map((item, i) => item.divider
                ? <div key={i} className="eyebrow" style={{ marginTop: 8 }}>{item.divider}</div>
                : <div key={i} className="demo-row"><i className={`bi ${item.icon}`} /> {item.label} <code className="dim">{item.route}</code></div>)}
        </div>
    );
}

function PersonasDemoInner() {
    const { persona, def, personas, available, setPersona } = usePersona();
    const { data: me } = useMe();

    // Prove the stamping by reading the REAL root attributes after the
    // provider's effect ran. Child effects fire BEFORE parent effects, so a
    // same-tick read sees the previous stamp — defer one macrotask (not rAF:
    // background/headless tabs may never produce a frame).
    const [stamped, setStamped] = useState({ persona: '—', density: '—' });
    useEffect(() => {
        const id = setTimeout(() => setStamped({
            persona: document.documentElement.dataset.persona ?? '(unset)',
            density: document.documentElement.dataset.density ?? '(unset)',
        }), 0);
        return () => clearTimeout(id);
    }, [persona]);

    const [fakeRoute, setFakeRoute] = useState(FAKE_ROUTES[0]!);
    const resolveFor = (slug: string) =>
        resolveActiveMenu(fakeRoute, { me: FIXTURE_ME, member: null, group: null, persona: slug });

    const leakReport = useMemo(() => auditPersonas(AUDIT_PERSONAS, AUDIT_PRESETS, { strict: 'signature-diagonal' }), []);

    return (
        <>
            <div className="panel panel-pad" style={{ marginBottom: 16 }}>
                <div className="eyebrow">Switcher — availablePersonas(me) against your live session</div>
                <div className="demo-row" style={{ marginBottom: 10 }}>
                    {personas.map((p) => {
                        const held = available.some((a) => a.slug === p.slug);
                        return (
                            <button
                                key={p.slug}
                                type="button"
                                className={`btn ${p.slug === persona ? 'btn-primary' : ''}`}
                                disabled={!held}
                                title={held ? undefined : `gated on ${JSON.stringify(p.gate)} — not held by this session`}
                                onClick={() => setPersona(p.slug)}
                            >
                                {p.icon && <i className={`bi ${p.icon}`} />} {p.label}
                                {p.gate && <i className="bi bi-lock" style={{ marginLeft: 6, opacity: 0.6 }} />}
                            </button>
                        );
                    })}
                </div>
                <p className="dim" style={{ marginBottom: 10 }}>
                    Auditor is role-style (gated on <code>demo.audit</code>) — locked unless your session holds it
                    (admin/superuser sessions pass every gate). The other two are hats: available to any
                    authenticated user.{!me && ' You are signed out, so no persona is available and the snap holds off.'}
                </p>
                <div className="eyebrow">Live root attributes (persona-scoped CSS keys off these — with :root defaults)</div>
                <div className="demo-row">
                    <code>&lt;html data-persona="{stamped.persona}" data-density="{stamped.density}"&gt;</code>
                    <Badge tone="info">home: {def?.home ?? '—'}</Badge>
                </div>
            </div>

            <div className="panel panel-pad" style={{ marginBottom: 16 }}>
                <div className="eyebrow">Persona-scoped menus — declared ONCE, persona is a resolution input</div>
                <div className="demo-row" style={{ marginBottom: 10 }}>
                    <span>Fake route:</span>
                    <select value={fakeRoute} onChange={(e) => setFakeRoute(e.target.value)}>
                        {FAKE_ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <span className="dim">
                        owners: {personasOwningPath(fakeRoute).join(', ') || '(none — usePersonaFollowsRoute would hold still)'}
                    </span>
                </div>
                <div className="demo-row" style={{ alignItems: 'stretch' }}>
                    {(['demo-support', 'demo-owner'] as const).map((slug) => (
                        <MenuPanel key={slug} menu={resolveFor(slug)} active={slug === persona} />
                    ))}
                </div>
                <p className="dim" style={{ marginTop: 10 }}>
                    Both personas carry <code>/demo/players</code> — the active persona's menu wins the shared
                    route; an unowned route falls back to the persona's own menu (step 2a) before any default.
                    Resolution here runs with a fixture <code>me</code> holding the demo keys; item visibility
                    itself stays permission-filtered fail-closed — a persona never widens access.
                </p>
            </div>

            <div className="panel panel-pad">
                <div className="eyebrow">auditPersonas — strict 'signature-diagonal' over a deliberate leak</div>
                <p className="dim" style={{ marginBottom: 8 }}>
                    Fixture: marketing's preset also holds <code>support.queue</code> (support's gate key), so
                    every marketing admin would see the Support portal. The hat persona is skipped.
                </p>
                {leakReport.findings.length === 0
                    ? <Badge tone="success">no findings</Badge>
                    : leakReport.findings.map((f) => (
                        <div key={f} className="demo-row"><Badge tone="danger">finding</Badge> <code>{f}</code></div>
                    ))}
            </div>
        </>
    );
}

export function PersonasDemo() {
    return (
        <PersonaProvider fallback="demo-support">
            <PersonasDemoInner />
        </PersonaProvider>
    );
}
