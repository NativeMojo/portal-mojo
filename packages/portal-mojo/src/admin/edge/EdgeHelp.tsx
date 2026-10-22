import { useId, useRef, useState, type ReactNode } from 'react';
import { Popover } from '../../ui';

/** Short, keyboard-accessible help, including inside native dialogs. */
export function EdgeHelp({ label, children }: { label: string; children: ReactNode }) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const id = useId();
    return <span className="edge-help"><button ref={anchor} type="button" className="btn-icon" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}><i className="bi bi-info-circle" aria-hidden="true" /></button><Popover id={id} anchorRef={anchor} open={open} onClose={() => setOpen(false)} className="edge-help-popover" aria-label={label}>{children}</Popover></span>;
}
