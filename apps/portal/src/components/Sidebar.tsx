// Sidebar — the mission-control band. Menu is data (label/icon/route),
// exactly like web-mojo's sidebar config; rendering is a map. The System
// section is permission-gated with <Guarded> (view_admin; `admin` and
// superuser pass implicitly) — the A4 sidebar engine turns this into a
// registry keyed by context.
import { NavLink } from 'react-router-dom';
import { Guarded } from 'portal-mojo/ui';

interface Item { label: string; icon: string; to: string }

const MAIN: Item[] = [
    { label: 'Dashboard', icon: 'bi-grid-1x2', to: '/' },
    { label: 'Users', icon: 'bi-people', to: '/users' },
];
const SYSTEM: Item[] = [
    { label: 'Settings', icon: 'bi-gear', to: '/settings' },
];

const USING_MOCK = !import.meta.env.VITE_MOJO_API;

function NavItems({ items }: { items: Item[] }) {
    return (
        <>
            {items.map((item) => (
                <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `nav-item${isActive ? ' nav-active' : ''}`}
                >
                    <i className={`bi ${item.icon}`} /> {item.label}
                </NavLink>
            ))}
        </>
    );
}

export function Sidebar() {
    return (
        <aside className="sidebar">
            <div className="side-brand">
                <span className="brand-dot" />
                <span className="brand-name">MOJO&nbsp;Portal</span>
            </div>
            <nav className="side-nav">
                <div className="side-label">Main</div>
                <NavItems items={MAIN} />
                <Guarded permission="view_admin">
                    <div className="side-label">System</div>
                    <NavItems items={SYSTEM} />
                </Guarded>
            </nav>
            <div className="side-foot">
                <span className={`mode-chip${USING_MOCK ? '' : ' mode-live'}`}>
                    <i className={`bi ${USING_MOCK ? 'bi-database' : 'bi-broadcast'}`} />
                    {USING_MOCK ? 'Mock API' : 'Live API'}
                </span>
                <span className="side-version">v0.1.0</span>
            </div>
        </aside>
    );
}
