// Standalone Admin chrome. Group switching belongs to product portals; this
// artifact is deliberately global and renders one categorized Admin menu.
import { SidebarNav } from 'portal-mojo/ui/shell';
import { usingMockTransport } from 'portal-mojo/client/runtime';

const USING_MOCK = usingMockTransport();
const version = import.meta.env.VITE_MOJO_APP_VERSION ?? 'development';

export function Sidebar({
    collapsed,
    onToggle,
}: {
    collapsed: boolean;
    onToggle(): void;
}) {
    return (
        <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
            <div className="side-brand">
                <div className="side-brand-identity">
                    <span className="brand-dot" />
                    <span className="brand-name">MOJO&nbsp;Admin</span>
                </div>
                <button
                    type="button"
                    className="sidebar-toggle"
                    aria-label={collapsed ? 'Expand Admin sidebar' : 'Collapse Admin sidebar'}
                    onClick={onToggle}
                >
                    <i className={`bi ${collapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`} />
                </button>
            </div>
            <div className="side-nav-scroll">
                <SidebarNav collapsed={collapsed} onRequestExpand={collapsed ? onToggle : undefined} />
            </div>
            <div className="side-foot">
                <span className={`mode-chip${USING_MOCK ? '' : ' mode-live'}`} data-tooltip={collapsed ? (USING_MOCK ? 'Mock API' : 'Live API') : undefined}>
                    <i className={`bi ${USING_MOCK ? 'bi-database' : 'bi-broadcast'}`} />
                    <span className="nav-text">{USING_MOCK ? 'Mock API' : 'Live API'}</span>
                </span>
                <span className="side-version">v{version}</span>
            </div>
        </aside>
    );
}
