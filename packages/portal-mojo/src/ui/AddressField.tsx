import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    LocationClient,
    isStaleLocationRequest,
    type AddressDetails,
    type AddressSuggestion,
} from '../client/location';
import type { FieldValue, FieldValues } from '../client/types';
import { Popover } from './Popover';

export type AddressPart = keyof Pick<AddressDetails,
    'address1' | 'address2' | 'city' | 'state' | 'state_code' |
    'postal_code' | 'country' | 'country_code' | 'latitude' |
    'longitude' | 'formatted_address' | 'place_id'>;

export interface AddressFieldProps {
    value: string;
    onCommit: (value: string) => void;
    /** When supplied, selection is one atomic multi-field form commit. */
    onPatch?: (patch: FieldValues) => void;
    /** address detail part → declared form field name. */
    fields?: Partial<Record<AddressPart, string>>;
    /** Default destination for address1 when fields.address1 is absent. */
    fieldName?: string;
    client?: LocationClient;
    country?: string;
    minChars?: number;
    debounceMs?: number;
    maxSuggestions?: number;
    placeholder?: string;
    disabled?: boolean;
    required?: boolean;
    invalid?: boolean;
    id?: string;
    ariaDescribedBy?: string;
    focusTarget?: (node: HTMLElement | null) => void;
}

function detailsPatch(
    details: AddressDetails,
    destinations: Partial<Record<AddressPart, string>>,
): FieldValues {
    const patch: FieldValues = {};
    for (const [part, name] of Object.entries(destinations) as Array<[AddressPart, string]>) {
        const value = details[part];
        if (value !== undefined && value !== null) patch[name] = value as FieldValue;
    }
    return patch;
}

export function AddressField({
    value,
    onCommit,
    onPatch,
    fields,
    fieldName,
    client,
    country = 'US',
    minChars = 3,
    debounceMs = 220,
    maxSuggestions = 8,
    placeholder = 'Start typing an address…',
    disabled = false,
    required = false,
    invalid = false,
    id,
    ariaDescribedBy,
    focusTarget,
}: AddressFieldProps) {
    const ownedClientRef = useRef<LocationClient | null>(null);
    if (!client && !ownedClientRef.current) ownedClientRef.current = new LocationClient();
    const location = client ?? ownedClientRef.current!;
    const previousClientRef = useRef(location);
    const mountedRef = useRef(true);
    const selectionRef = useRef(0);
    const [draft, setDraft] = useState<string | null>(null);
    const draftRef = useRef<string | null>(null);
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const anchorRef = useRef<HTMLDivElement>(null);
    const uid = useId();
    const listId = `address-list-${uid}`;
    const destinations = useMemo(() => ({
        ...(fieldName ? { address1: fieldName } : {}),
        ...(fields ?? {}),
    }), [fieldName, fields]);

    useEffect(() => {
        if (previousClientRef.current !== location) previousClientRef.current.cancelPending();
        previousClientRef.current = location;
        return () => location.cancelPending();
    }, [location]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            selectionRef.current += 1;
            ownedClientRef.current?.cancelPending();
        };
    }, []);

    const setDraftBoth = (next: string | null) => {
        draftRef.current = next;
        setDraft(next);
    };
    const close = () => {
        setOpen(false);
        setHighlight(-1);
        setSuggestions([]);
    };
    const revert = () => {
        selectionRef.current += 1;
        location.reset();
        setDraftBoth(null);
        setBusy(false);
        setError('');
        close();
    };
    const commitRaw = () => {
        const next = draftRef.current;
        if (next === null) { close(); return; }
        location.reset();
        setDraftBoth(null);
        close();
        if (next !== value) onCommit(next);
    };

    useEffect(() => {
        const query = draft?.trim() ?? '';
        setSuggestions([]);
        setHighlight(-1);
        // Selection details started before this render; its own busy-state
        // update must not invalidate that request.
        if (busy) {
            setOpen(false);
            return;
        }
        location.cancelPending();
        if (disabled || query.length < minChars) {
            setOpen(false);
            return;
        }
        const timer = window.setTimeout(() => {
            location.autocomplete(query, { country }).then(
                (result) => {
                    if (!mountedRef.current || draftRef.current?.trim() !== query) return;
                    setSuggestions(result.data.slice(0, maxSuggestions));
                    setOpen(true);
                    setError('');
                },
                (reason: unknown) => {
                    if (!mountedRef.current || isStaleLocationRequest(reason)) return;
                    setSuggestions([]);
                    setOpen(false);
                    setError(reason instanceof Error ? reason.message : 'Address lookup failed');
                },
            );
        }, debounceMs);
        return () => window.clearTimeout(timer);
    }, [draft, country, debounceMs, disabled, busy, location, maxSuggestions, minChars]);

    const select = async (suggestion: AddressSuggestion) => {
        const selection = ++selectionRef.current;
        setDraftBoth(suggestion.description);
        close();
        setBusy(true);
        setError('');
        try {
            const details = await location.placeDetails(suggestion.place_id);
            if (!mountedRef.current || selection !== selectionRef.current) return;
            const patch = detailsPatch(details, destinations);
            const primary = details.address1 ?? details.formatted_address ?? suggestion.description;
            setDraftBoth(null);
            if (onPatch && Object.keys(patch).length > 0) onPatch(patch);
            else if (primary !== value) onCommit(primary);
        } catch (reason) {
            if (!mountedRef.current || selection !== selectionRef.current || isStaleLocationRequest(reason)) return;
            // The provider description was never committed, so dropping the
            // draft atomically restores the prior controlled value.
            setDraftBoth(null);
            setError(reason instanceof Error ? reason.message : 'Address details failed');
        } finally {
            if (mountedRef.current && selection === selectionRef.current) setBusy(false);
        }
    };

    const shown = draft ?? value;
    const activeId = open && highlight >= 0 ? `${listId}-${highlight}` : undefined;

    return (
        <div className="address-field" ref={anchorRef}>
            <div className="address-input-wrap">
                <i className="bi bi-geo-alt address-icon" aria-hidden="true" />
                <input
                    ref={(node) => focusTarget?.(node)}
                    id={id}
                    className={`input address-input${invalid ? ' input-invalid' : ''}`}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={open}
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={invalid || undefined}
                    autoComplete="street-address"
                    value={shown}
                    placeholder={placeholder}
                    disabled={disabled}
                    readOnly={busy}
                    aria-busy={busy || undefined}
                    required={required}
                    onChange={(event) => {
                        setDraftBoth(event.target.value);
                        setError('');
                    }}
                    onBlur={() => { if (!busy) commitRaw(); }}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' && suggestions.length > 0) {
                            event.preventDefault();
                            setOpen(true);
                            setHighlight((current) => (current + 1) % suggestions.length);
                        } else if (event.key === 'ArrowUp' && open && suggestions.length > 0) {
                            event.preventDefault();
                            setHighlight((current) => current <= 0 ? suggestions.length - 1 : current - 1);
                        } else if (event.key === 'Enter') {
                            event.preventDefault();
                            if (open && highlight >= 0 && suggestions[highlight]) void select(suggestions[highlight]);
                            else commitRaw();
                        } else if (event.key === 'Tab' && draftRef.current !== null) {
                            commitRaw();
                        } else if (event.key === 'Escape' && !open && draftRef.current !== null) {
                            event.preventDefault();
                            revert();
                        }
                    }}
                />
                {busy && <span className="address-spinner" role="status" aria-label="Loading address details" />}
            </div>
            {error && <span className="address-error" role="alert">{error}</span>}
            <Popover
                anchorRef={anchorRef}
                open={open}
                onClose={(reason) => reason === 'escape' ? revert() : commitRaw()}
                id={listId}
                className="address-pop"
                role="listbox"
            >
                {suggestions.map((suggestion, index) => (
                    <div
                        key={suggestion.place_id}
                        id={`${listId}-${index}`}
                        className={`address-option${highlight === index ? ' address-option-hot' : ''}`}
                        role="option"
                        aria-selected={highlight === index}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => void select(suggestion)}
                    >
                        <i className="bi bi-geo-alt" aria-hidden="true" />
                        <span>
                            <strong>{suggestion.main_text || suggestion.description}</strong>
                            {suggestion.secondary_text && <small>{suggestion.secondary_text}</small>}
                        </span>
                    </div>
                ))}
            </Popover>
        </div>
    );
}
