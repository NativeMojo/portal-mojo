// TagInput — chip-style free-text tags with a full keyboard flow, ported from
// web-mojo's TagInputView (src/core/forms/inputs/TagInput.js).
//
// THE VALUE IS A CSV STRING, both directions. django-mojo models split the
// stored string on the separator, so `onChange` hands back the joined string
// first and the array second — a component that emitted only an array would
// quietly change the wire shape. Two invariants keep that string honest:
//   1. no committed tag may contain the separator (every commit is split first);
//   2. the separator must be exactly ONE character (anything else falls back to
//      "," with a console.warn — the house rule for unknown option values).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface TagInputProps {
    /** Renders a hidden input under this name, for native form posts. */
    name?: string;
    /** CSV string (the wire shape) or an array — both parse to the same tags. */
    value?: string | string[];
    /** Fires on every commit/removal: the CSV string FIRST, then the array. */
    onChange?: (value: string, tags: string[]) => void;
    placeholder?: string;
    /** Cap on interactive adds (default 50); also the counter's denominator. */
    maxTags?: number;
    allowDuplicates?: boolean;
    /** One character; joins the CSV and splits incoming values (default ","). */
    separator?: string;
    trimTags?: boolean;
    minLength?: number;
    maxLength?: number;
    disabled?: boolean;
    /** Chips only: no input, no remove icons. */
    readonly?: boolean;
    className?: string;
}

// One warn per bad separator — a mis-sized separator is a config bug, not a
// render event (same policy as SchemaForm's unknown select values).
const warnedSeparators = new Set<string>();

function resolveSeparator(separator: string): string {
    if (separator.length === 1) return separator;
    if (!warnedSeparators.has(separator)) {
        warnedSeparators.add(separator);
        console.warn(`TagInput: separator ${JSON.stringify(separator)} must be exactly one character — falling back to ","`);
    }
    return ',';
}

/**
 * String/array → tag list: split on the separator, trim, drop empties, and
 * drop duplicates unless they are allowed. Array entries are split too, so an
 * array can never smuggle a separator into a tag and break the CSV round-trip.
 *
 * Deliberately does NOT apply minLength/maxLength/maxTags: those cap what a
 * user may ADD. Silently dropping stored values would lose backend data on the
 * next save (web-mojo's setTags did exactly that).
 */
function parseTags(
    value: string | string[] | null | undefined,
    separator: string,
    trimTags: boolean,
    allowDuplicates: boolean,
): string[] {
    const pieces = Array.isArray(value)
        ? value.flatMap((v) => String(v ?? '').split(separator))
        : String(value ?? '').split(separator);
    const out: string[] = [];
    for (const piece of pieces) {
        const tag = trimTags ? piece.trim() : piece;
        if (tag === '' || tag.trim() === '') continue;
        if (!allowDuplicates && out.includes(tag)) continue;
        out.push(tag);
    }
    return out;
}

export function TagInput({
    name,
    value = '',
    onChange,
    placeholder = 'Add tags...',
    maxTags = 50,
    allowDuplicates = false,
    separator = ',',
    trimTags = true,
    minLength = 1,
    maxLength = 50,
    disabled = false,
    readonly = false,
    className,
}: TagInputProps) {
    const sep = resolveSeparator(separator);
    const tags = useMemo(
        () => parseTags(value, sep, trimTags, allowDuplicates),
        [value, sep, trimTags, allowDuplicates],
    );
    const editable = !disabled && !readonly;

    // Draft text is the ONLY local value state — it is not a tag yet. The ref
    // mirrors it synchronously so blur can't commit a stale draft after a Tab
    // (Tab clears the draft, then the browser moves focus in the same tick).
    const [draft, setDraft] = useState('');
    const draftRef = useRef('');
    const setDraftValue = (next: string) => {
        draftRef.current = next;
        setDraft(next);
    };

    // A rejected add flashes here for ~3s. Boxed in an object ON PURPOSE: a
    // bare string would make a repeat of the same message a no-op setState, so
    // the second rejection would inherit the first one's dying timer.
    const [error, setError] = useState<{ text: string } | null>(null);
    const flashError = (text: string) => setError({ text });
    useEffect(() => {
        if (!error) return;
        const t = setTimeout(() => setError(null), 3000);
        return () => clearTimeout(t);
    }, [error]);

    // Controlled: with no onChange the field can only ever show what the parent
    // already holds, so adds would silently vanish. Say so once per instance
    // rather than rendering a dead control (house rule: never fail silently).
    useEffect(() => {
        if (!onChange && !readonly && !disabled) {
            console.warn('TagInput: no onChange handler — value is controlled, so added/removed tags will not stick. Pass onChange, or mark the field readonly.');
        }
        // Mount-only: this is a config check, not a render event.
    }, []);

    const wrapRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const chipRefs = useRef<(HTMLSpanElement | null)[]>([]);

    // Focus after a removal has to wait for the re-render that drops the chip,
    // so it is a request applied post-commit. -1 means the text input. The
    // nonce guarantees a render even if the parent ignores onChange.
    const pendingFocus = useRef<number | null>(null);
    const [, bumpFocus] = useState(0);
    const requestFocus = (index: number) => {
        pendingFocus.current = index;
        bumpFocus((n) => n + 1);
    };
    useLayoutEffect(() => {
        const req = pendingFocus.current;
        if (req === null) return;
        pendingFocus.current = null;
        if (req < 0) inputRef.current?.focus();
        else (chipRefs.current[req] ?? inputRef.current)?.focus();
    });

    const emit = (next: string[]) => onChange?.(next.join(sep), next);

    /**
     * The single add path — every commit route (Enter, Tab, separator key,
     * input-change, blur) funnels through here. Splits on the separator and on
     * newlines first, so a paste of "a,b,c," becomes three tags rather than one
     * tag that would re-split on the next load.
     */
    const commitText = (raw: string): boolean => {
        if (!editable) return false;
        const pieces = raw.split(sep).flatMap((p) => p.split(/[\r\n]+/));
        let next = tags;
        let added = false;
        for (const piece of pieces) {
            const tag = trimTags ? piece.trim() : piece;
            if (tag.trim() === '') continue;             // nothing typed — no error
            if (tag.length < minLength) {
                flashError(`Tag must be at least ${minLength} character${minLength === 1 ? '' : 's'}`);
                continue;
            }
            if (tag.length > maxLength) {
                flashError(`Tag must be at most ${maxLength} characters`);
                continue;
            }
            if (!allowDuplicates && next.includes(tag)) {
                flashError(`Tag "${tag}" already exists`);
                continue;
            }
            if (next.length >= maxTags) {
                flashError(`Maximum ${maxTags} tags allowed`);
                break;
            }
            next = [...next, tag];
            added = true;
        }
        if (added) emit(next);
        return added;
    };

    const removeAt = (index: number): boolean => {
        if (!editable) return false;
        if (index < 0 || index >= tags.length) return false;
        emit(tags.filter((_, i) => i !== index));
        return true;
    };

    /** Remove + keep the keyboard flow alive: previous chip, else the input. */
    const removeAndRefocus = (index: number) => {
        const held = wrapRef.current?.contains(document.activeElement) ?? false;
        if (!removeAt(index)) return;
        if (held) requestFocus(index > 0 ? index - 1 : -1);
    };

    // ── input ─────────────────────────────────────────────────────────────
    // Change-path commit: text ending in the separator or a newline. Covers
    // pastes and soft keyboards, which never fire a usable keydown.
    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        const last = v.slice(-1);
        if (last === sep || last === '\n' || last === '\r') {
            commitText(v.slice(0, -1));
            setDraftValue('');
            return;
        }
        setDraftValue(v);
    };

    const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const text = draftRef.current;
        switch (e.key) {
            case 'Enter':
                // Only swallow Enter when it does something here; an empty
                // field lets an enclosing form submit as usual.
                if (text.trim()) {
                    e.preventDefault();
                    commitText(text);
                    setDraftValue('');
                }
                break;
            case 'Tab':
                // Deliberate deviation from web-mojo: commit but do NOT
                // preventDefault, so Tab still leaves the field. The source
                // trapped focus in the input for as long as it held text.
                if (text.trim()) {
                    commitText(text);
                    setDraftValue('');
                }
                break;
            case sep:
                // The separator can never be part of a tag — always swallowed.
                e.preventDefault();
                if (text.trim()) {
                    commitText(text);
                    setDraftValue('');
                }
                break;
            case 'Backspace':
                if (text === '' && tags.length > 0) {
                    e.preventDefault();
                    removeAt(tags.length - 1);
                }
                break;
            case 'ArrowLeft':
                if (text === '' && tags.length > 0) {
                    e.preventDefault();
                    chipRefs.current[tags.length - 1]?.focus();
                }
                break;
            case 'ArrowRight':
                if (text === '' && tags.length > 0) {
                    e.preventDefault();
                    chipRefs.current[0]?.focus();
                }
                break;
            case 'Escape':
                // Clears the draft only. web-mojo also blurred; leaving focus
                // put means Escape in a modal still reaches the dialog once
                // there is nothing left to clear.
                if (text !== '') {
                    e.preventDefault();
                    setDraftValue('');
                }
                break;
        }
    };

    const onInputBlur = () => {
        const text = draftRef.current;
        if (text === '') return;
        // Commit on blur (the house commit set is select/Enter/blur) — typed
        // text is never silently dropped. Rejected adds clear too and say why,
        // exactly as the Enter path does.
        commitText(text);
        setDraftValue('');
    };

    // ── chips ─────────────────────────────────────────────────────────────
    const onChipKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>, index: number) => {
        switch (e.key) {
            case 'Backspace':
            case 'Delete':
                // Delete is handled too — the chip's own aria-label promises it
                // (web-mojo said so but only wired Backspace).
                e.preventDefault();
                if (!editable) return;
                if (removeAt(index)) requestFocus(index > 0 ? index - 1 : -1);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (index === 0) inputRef.current?.focus();
                else chipRefs.current[index - 1]?.focus();
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (index === tags.length - 1) inputRef.current?.focus();
                else chipRefs.current[index + 1]?.focus();
                break;
        }
    };

    const classes = [
        'tag-input',
        disabled ? 'tag-input-disabled' : '',
        readonly ? 'tag-input-readonly' : '',
        className ?? '',
    ].filter(Boolean).join(' ');

    return (
        <div className={classes}>
            {/* role=group, not web-mojo's role=combobox: there is no popup to
                expand, and aria-expanded="false" forever is a lie to AT. */}
            <div
                ref={wrapRef}
                className="tag-input-wrap"
                role="group"
                aria-label={name ? `${name} tags` : 'Tags'}
                // Clicking the wrapper's own padding must not blur the input
                // (blur commits) — swallow the default focus shift and place
                // focus explicitly on click instead.
                onMouseDown={(e) => { if (editable && e.target === e.currentTarget) e.preventDefault(); }}
                onClick={() => { if (editable) inputRef.current?.focus(); }}
            >
                {tags.map((tag, i) => (
                    <span
                        key={`${i}:${tag}`}
                        ref={(el) => { chipRefs.current[i] = el; }}
                        className="tag-chip"
                        tabIndex={0}
                        role="button"
                        aria-label={editable ? `Tag: ${tag}. Press Delete or Backspace to remove.` : `Tag: ${tag}`}
                        onKeyDown={(e) => onChipKeyDown(e, i)}
                        onClick={(e) => { e.stopPropagation(); chipRefs.current[i]?.focus(); }}
                    >
                        <span className="tag-chip-text">{tag}</span>
                        {editable && (
                            // Mouse affordance only — aria-hidden so it does not
                            // double the chip in the a11y tree (nesting an
                            // interactive element inside role=button is invalid).
                            <i
                                className="bi bi-x tag-chip-x"
                                aria-hidden="true"
                                onClick={(e) => { e.stopPropagation(); removeAndRefocus(i); }}
                            />
                        )}
                    </span>
                ))}
                {!readonly && (
                    <input
                        ref={inputRef}
                        type="text"
                        className="tag-input-field"
                        value={draft}
                        placeholder={placeholder}
                        disabled={disabled}
                        autoComplete="off"
                        onChange={onInputChange}
                        onKeyDown={onInputKeyDown}
                        onBlur={onInputBlur}
                    />
                )}
            </div>
            {/* Native form posts get the CSV, same as web-mojo's hidden input. */}
            {name && <input type="hidden" name={name} value={tags.join(sep)} />}
            <div className="tag-input-foot">
                <span className="tag-input-count">{tags.length}/{maxTags} tags</span>
                {/* Live region stays mounted so AT announces the flash; CSS
                    hides it while empty (.tag-input-error:empty). */}
                <span className="tag-input-error" role="status" aria-live="polite">{error?.text ?? ''}</span>
            </div>
        </div>
    );
}
