import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type TabVariant = 'minimal' | 'traditional' | 'underline' | 'underline-all' | 'pills' | 'pills-solid' | 'segmented' | 'btn-group';

export interface TabItem {
    key: string;
    label: ReactNode;
    panel: ReactNode;
    disabled?: boolean;
    ariaLabel?: string;
}

export interface TabsProps {
    items: TabItem[];
    activeKey?: string | null;
    defaultActiveKey?: string | null;
    onActiveKeyChange?: (key: string) => void;
    variant?: TabVariant | 'buttongroup' | 'btngroup' | (string & {});
    ariaLabel?: string;
    className?: string;
}

const VARIANTS = new Set<TabVariant>(['minimal', 'traditional', 'underline', 'underline-all', 'pills', 'pills-solid', 'segmented', 'btn-group']);
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(message);
}

export function normalizeTabVariant(value: string | undefined): TabVariant {
    if (value === 'buttongroup' || value === 'btngroup') return 'btn-group';
    if (!value) return 'underline-all';
    if (VARIANTS.has(value as TabVariant)) return value as TabVariant;
    warnOnce(`variant:${value}`, `Tabs: unknown variant "${value}" — falling back to "underline-all"`);
    return 'underline-all';
}

export function normalizeTabItems(items: TabItem[]): TabItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (!item.key || seen.has(item.key)) {
            warnOnce(`key:${item.key || '<empty>'}`, `Tabs: ${item.key ? `duplicate key "${item.key}"` : 'empty key'} ignored`);
            return false;
        }
        seen.add(item.key);
        return true;
    });
}

export function effectiveTabKey(requested: string | null | undefined, items: TabItem[]): string | null {
    const enabled = items.filter((item) => !item.disabled);
    if (requested && enabled.some((item) => item.key === requested)) return requested;
    return enabled[0]?.key ?? null;
}

export function nextTabKey(items: TabItem[], current: string | null, key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'): string | null {
    const enabled = items.filter((item) => !item.disabled);
    if (!enabled.length) return null;
    if (key === 'Home') return enabled[0]!.key;
    if (key === 'End') return enabled[enabled.length - 1]!.key;
    const at = Math.max(0, enabled.findIndex((item) => item.key === current));
    const delta = key === 'ArrowRight' ? 1 : -1;
    return enabled[(at + delta + enabled.length) % enabled.length]!.key;
}

export function Tabs({ items, activeKey, defaultActiveKey, onActiveKeyChange, variant, ariaLabel = 'Tabs', className }: TabsProps) {
    const normalized = useMemo(() => normalizeTabItems(items), [items]);
    const controlled = activeKey !== undefined;
    const [internalKey, setInternalKey] = useState<string | null>(() => effectiveTabKey(defaultActiveKey, normalized));
    const requested = controlled ? activeKey : internalKey;
    const effective = effectiveTabKey(requested, normalized);
    const uid = useId().replace(/:/g, '');
    const refs = useRef(new Map<string, HTMLButtonElement>());
    const invalidNotice = `${String(requested)}|${normalized.filter((item) => !item.disabled).map((item) => item.key).join('|')}|${effective}`;
    const lastNotice = useRef('');

    useEffect(() => {
        if (!controlled && internalKey !== effective) setInternalKey(effective);
    }, [controlled, internalKey, effective]);

    useEffect(() => {
        if (!controlled || requested === effective || effective == null || lastNotice.current === invalidNotice) return;
        lastNotice.current = invalidNotice;
        onActiveKeyChange?.(effective);
    }, [controlled, requested, effective, invalidNotice, onActiveKeyChange]);

    const select = (key: string, focus = false) => {
        if (!controlled) setInternalKey(key);
        onActiveKeyChange?.(key);
        if (focus) window.setTimeout(() => refs.current.get(key)?.focus(), 0);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = nextTabKey(normalized, effective, event.key as 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End');
        if (next) select(next, true);
    };

    const variantName = normalizeTabVariant(variant);
    return (
        <div className={className ? `mojo-tabs ${className}` : 'mojo-tabs'} data-tab-variant={variantName}>
            <div className="mojo-tab-list" role="tablist" aria-label={ariaLabel}>
                {normalized.map((item, index) => {
                    const selected = item.key === effective;
                    const tabId = `tab-${uid}-${index}`;
                    const panelId = `panel-${uid}-${index}`;
                    return (
                        <button
                            ref={(node) => { if (node) refs.current.set(item.key, node); else refs.current.delete(item.key); }}
                            key={item.key}
                            id={tabId}
                            type="button"
                            role="tab"
                            aria-label={item.ariaLabel}
                            aria-selected={selected}
                            aria-disabled={item.disabled || undefined}
                            aria-controls={panelId}
                            tabIndex={selected ? 0 : -1}
                            disabled={item.disabled}
                            className="mojo-tab"
                            onClick={() => select(item.key)}
                            onKeyDown={onKeyDown}
                        >
                            {item.label}
                        </button>
                    );
                })}
            </div>
            <div className="mojo-tab-panels">
                {normalized.map((item, index) => {
                    const selected = item.key === effective;
                    return (
                        <div key={item.key} id={`panel-${uid}-${index}`} role="tabpanel" aria-labelledby={`tab-${uid}-${index}`} hidden={!selected} className="mojo-tab-panel">
                            {selected ? item.panel : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
