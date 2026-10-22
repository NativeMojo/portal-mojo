import { useId, useRef, useState, type ReactNode } from 'react';
import { Popover } from '../../ui/Popover';
export function FleetHelp({ label, children }: { label: string; children: ReactNode }) {
    const anchor = useRef<HTMLButtonElement>(null), id = useId();
    const [open, setOpen] = useState(false);
    return <><button ref={anchor} type="button" className="ops-help" aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}><i className="bi bi-info-circle" aria-hidden="true" /></button><Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} id={id} aria-label={`About ${label}`} className="ops-help-content">{children}</Popover></>;
}
