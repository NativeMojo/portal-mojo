// DetailView + SideNav — the record-viewer layout: flat header (avatar,
// title, subtitle, chips, active switch, close) over a left rail of grouped
// sections. Direct port of web-mojo's headerConfig/sections schema; the
// section bodies are plain components built from FlatRow / SecurityItem.
import { useState, type ReactNode } from 'react';
import { initials } from './format';
import type { Tone } from './format';

export interface Chip {
    icon?: string;
    text: string;
    tone?: Tone;
}

export interface Section {
    key: string;
    label: string;
    icon: string;
    render: () => ReactNode;
}

export type RailEntry = Section | { divider: string };

export function DetailView({ avatarName, icon, title, subtitle, chips = [], active, sections, initialSection, onClose }: {
    avatarName?: string;
    icon?: string;
    title: string;
    subtitle?: string;
    chips?: Chip[];
    active?: { value: boolean; onChange: (next: boolean) => void };
    sections: RailEntry[];
    initialSection?: string;
    onClose: () => void;
}) {
    const real = sections.filter((s): s is Section => !('divider' in s));
    const [activeKey, setActiveKey] = useState(initialSection ?? real[0]?.key ?? '');
    const current = real.find((s) => s.key === activeKey) ?? real[0];

    return (
        <div className="detail">
            <header className="detail-header">
                <div className="detail-avatar">
                    {avatarName ? initials(avatarName) : <i className={`bi ${icon ?? 'bi-file-earmark'}`} />}
                </div>
                <div className="detail-id">
                    <h2 className="detail-title">{title}</h2>
                    <div className="detail-sub">
                        {subtitle}
                        {chips.map((chip, i) => (
                            <span key={i} className={`chip chip-${chip.tone ?? 'muted'}`}>
                                {chip.icon && <i className={`bi ${chip.icon}`} />} {chip.text}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="detail-gutter">
                    {active && (
                        <label className="switch-inline" title={active.value ? 'Active' : 'Inactive'}>
                            <input
                                type="checkbox"
                                role="switch"
                                className="switch"
                                checked={active.value}
                                onChange={(e) => active.onChange(e.target.checked)}
                            />
                        </label>
                    )}
                    <button className="btn-icon" onClick={onClose} title="Close" aria-label="Close">
                        <i className="bi bi-x-lg" />
                    </button>
                </div>
            </header>
            <div className="detail-body">
                <nav className="detail-rail" aria-label={`${title} sections`}>
                    {sections.map((entry, i) => 'divider' in entry ? (
                        <div key={`d${i}`} className="rail-divider">{entry.divider}</div>
                    ) : (
                        <button
                            key={entry.key}
                            className={`rail-item${entry.key === current?.key ? ' rail-active' : ''}`}
                            onClick={() => setActiveKey(entry.key)}
                        >
                            <i className={`bi ${entry.icon}`} /> {entry.label}
                        </button>
                    ))}
                </nav>
                <div className="detail-content">{current?.render()}</div>
            </div>
        </div>
    );
}

/** Uppercase group heading inside a section (CONTACT / ACCOUNT / …). */
export function Eyebrow({ children }: { children: ReactNode }) {
    return <div className="eyebrow section-eyebrow">{children}</div>;
}

/** The canonical label / value / action row. */
export function FlatRow({ label, children, action, actionIcon = 'bi-pencil', actionTitle }: {
    label: string;
    children: ReactNode;
    action?: () => void;
    actionIcon?: string;
    actionTitle?: string;
}) {
    return (
        <div className="flat-row">
            <div className="flat-label">{label}</div>
            <div className="flat-value">{children}</div>
            <div className="flat-action">
                {action && (
                    <button className="btn-icon btn-icon-sm" onClick={action} title={actionTitle ?? `Edit ${label.toLowerCase()}`}>
                        <i className={`bi ${actionIcon}`} />
                    </button>
                )}
            </div>
        </div>
    );
}

/** Richer icon row: icon / title + description / trailing content. */
export function SecurityItem({ icon, title, desc, children }: {
    icon: string;
    title: string;
    desc: string;
    children?: ReactNode;
}) {
    return (
        <div className="sec-item">
            <div className="sec-icon"><i className={`bi ${icon}`} /></div>
            <div className="sec-info">
                <div className="sec-title">{title}</div>
                <div className="sec-desc">{desc}</div>
            </div>
            <div className="sec-right">{children}</div>
        </div>
    );
}
