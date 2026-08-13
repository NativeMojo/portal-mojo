// Flat menu sections (board #1606) — before/after panels showing what
// flattenMenuItems does to a `presentation: 'flat'` section. Rendered with
// the personas demo's MenuPanel idiom: the showcase has no SidebarNav
// consumer (and none of its accordion/rail CSS), so the real-SidebarNav
// pass happens in apps/portal.
import { flattenMenuItems, type MenuContext, type MenuItem } from 'portal-mojo/ui';

const SETTINGS_SECTION: MenuItem = {
    id: 'settings', label: 'Settings', icon: 'bi-gear', route: '/settings',
    presentation: 'flat', group: 'Brand',
    children: [
        { label: 'Brand profile', route: '/settings/brand', group: 'Brand' },
        { label: 'Theme', route: '/settings/theme', group: 'Brand' },
        { label: 'Members', route: '/settings/members', group: 'Access', icon: 'bi-people' },
        { label: 'API keys', route: '/settings/keys', group: 'Access' },
        { id: 'reports', label: 'Reports', group: 'Access', children: [
            { label: 'Monthly', route: '/settings/reports/monthly' },
        ] },
        { label: 'Webhooks', route: '/settings/webhooks', group: 'Access' },
        { label: 'Audit log', route: '/settings/audit', group: 'Activity' },
    ],
};

const CTX: MenuContext = { me: null, member: null, group: null, persona: null };

function ItemsPanel({ title, items, note }: { title: string; items: MenuItem[]; note: string }) {
    return (
        <div className="panel panel-pad" style={{ flex: 1, minWidth: 260 }}>
            <div className="eyebrow">{title}</div>
            <p className="dim" style={{ margin: '4px 0 10px' }}>{note}</p>
            <ItemRows items={items} depth={0} />
        </div>
    );
}

function ItemRows({ items, depth }: { items: MenuItem[]; depth: number }) {
    return (
        <>
            {items.map((item, i) => item.divider
                ? <div key={i} className="eyebrow" style={{ marginTop: 8 }}>{item.divider}</div>
                : (
                    <div key={i} style={{ paddingLeft: depth * 14 }}>
                        <div className="demo-row">
                            <i className={`bi ${item.icon ?? 'bi-dot'}`} /> {item.label}
                            {item.exact && <code className="dim">exact</code>}
                            {item.children && <code className="dim">accordion</code>}
                        </div>
                        {item.children && <ItemRows items={item.children} depth={depth + 1} />}
                    </div>
                ))}
        </>
    );
}

export function MenusDemo() {
    return (
        <>
            <div className="panel panel-pad">
                <div className="eyebrow">presentation: 'flat'</div>
                <p className="dim" style={{ margin: '4px 0 0', maxWidth: 700 }}>
                    A flat section's children hoist to top level under labeled group dividers (divider on
                    group <i>change</i> — run semantics), the section's own route hoists first as an
                    exact-matched home row, a nested child stays an accordion and resets the run, and icons
                    fall back to the section's. Gates compose section ∧ child. <code>SidebarNav</code> applies
                    this automatically; the panels below show the raw item lists.
                </p>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
                <ItemsPanel
                    title="Declared (one section)"
                    items={[SETTINGS_SECTION]}
                    note="An accordion section with per-child group labels."
                />
                <ItemsPanel
                    title="Rendered (flattened)"
                    items={flattenMenuItems([SETTINGS_SECTION], CTX)}
                    note="What SidebarNav renders: flat rows under group dividers."
                />
            </div>
        </>
    );
}
