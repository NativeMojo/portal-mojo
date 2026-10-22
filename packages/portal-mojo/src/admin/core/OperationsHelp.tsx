import { useId, useRef, useState, type ReactNode } from 'react';
import { Popover } from '../../ui/Popover';

/** Keep explanatory copy one deliberate action away from the working surface. */
export function OperationsHelp({ label, children }: { label: string; children: ReactNode }) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const id = useId();
    return <><button ref={anchor} type="button" className="ops-help" aria-label={`About ${label}`} aria-expanded={open} aria-controls={open ? id : undefined} onClick={event => { event.preventDefault(); setOpen(value => !value); }}><i className="bi bi-question-circle" aria-hidden="true" /></button><Popover anchorRef={anchor} open={open} onClose={() => setOpen(false)} id={id} aria-label={`About ${label}`} className="ops-help-content">{children}</Popover></>;
}
