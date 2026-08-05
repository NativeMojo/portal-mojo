// Sidebar — the mission-control band. Menu is data (label/icon/route),
// exactly like web-mojo's sidebar config; rendering is a 40-line map.
import { NavLink } from 'react-router-dom';

const MENU: { divider?: string; label?: string; icon?: string; to?: string }[] = [
    { divider: 'Main' },
    { label: 'Dashboard', icon: 'bi-grid-1x2', to: '/' },
    { label: 'Users', icon: 'bi-people', to: '/users' },
    { divider: 'System' },
    { label: 'Settings', icon: 'bi-gear', to: '/settings' },
];

const USING_MOCK = !import.meta.env.VITE_MOJO_API;

export function Sidebar() {
    return (
        <aside className="sidebar">
            <div className="side-brand">
                <span className="brand-dot" />
                <span className="brand-name">MOJO&nbsp;Portal</span>
            </div>
            <nav className="side-nav">
                {MENU.map((item, i) => item.divider ? (
                    <div key={i} className="side-label">{item.divider}</div>
                ) : (
                    <NavLink
                        key={item.to}
                        to={item.to!}
                        end={item.to === '/'}
                        className={({ isActive }) => `nav-item${isActive ? ' nav-active' : ''}`}
                    >
                        <i className={`bi ${item.icon}`} /> {item.label}
                    </NavLink>
                ))}
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
