import {
    useCallback, useEffect, useId, useRef, useState,
    type ChangeEvent, type DragEvent, type ReactNode,
} from 'react';

export type FileSelectionRejectionCode = 'type' | 'size' | 'count';

export interface FileSelectionRejection {
    filename: string;
    code: FileSelectionRejectionCode;
    message: string;
}

export interface FileSelectionRules {
    /** MIME patterns (`image/*`), exact MIME types, or extensions (`.pdf`). */
    accept?: string | string[];
    maxFileSize?: number;
    /** Maximum files accepted from one gesture. */
    maxFiles?: number;
}

export interface FileSelectionResult {
    accepted: File[];
    rejected: FileSelectionRejection[];
}

const asAcceptList = (accept: FileSelectionRules['accept']): string[] =>
    (Array.isArray(accept) ? accept : String(accept ?? '').split(','))
        .map((value) => value.trim().toLowerCase()).filter(Boolean);

function matchesAccept(file: File, patterns: string[]): boolean {
    if (!patterns.length || patterns.includes('*/*')) return true;
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return patterns.some((pattern) => {
        if (pattern.startsWith('.')) return name.endsWith(pattern);
        if (pattern.endsWith('/*')) return type.startsWith(`${pattern.slice(0, -1)}`);
        return type !== '' && type === pattern;
    });
}

/** Pure, browser-independent selection validation. `accept` remains UX; the server is authoritative. */
export function validateFileSelection(files: Iterable<File>, rules: FileSelectionRules = {}): FileSelectionResult {
    const patterns = asAcceptList(rules.accept);
    const limit = Number.isSafeInteger(rules.maxFiles) && Number(rules.maxFiles) > 0
        ? Number(rules.maxFiles) : Number.POSITIVE_INFINITY;
    const maxSize = Number.isFinite(rules.maxFileSize) && Number(rules.maxFileSize) >= 0
        ? Number(rules.maxFileSize) : Number.POSITIVE_INFINITY;
    const accepted: File[] = [];
    const rejected: FileSelectionRejection[] = [];
    for (const file of files) {
        if (accepted.length >= limit) {
            rejected.push({ filename: file.name, code: 'count', message: `Only ${limit} file${limit === 1 ? '' : 's'} can be selected at once.` });
        } else if (!matchesAccept(file, patterns)) {
            rejected.push({ filename: file.name, code: 'type', message: `${file.name} is not an accepted file type.` });
        } else if (file.size > maxSize) {
            rejected.push({ filename: file.name, code: 'size', message: `${file.name} exceeds the maximum file size.` });
        } else {
            accepted.push(file);
        }
    }
    return { accepted, rejected };
}

function isFileDrag(event: globalThis.DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return Boolean(types && Array.from(types).includes('Files'));
}

let navigationGuardUsers = 0;
const guardFileNavigation = (event: globalThis.DragEvent) => {
    if (isFileDrag(event)) event.preventDefault();
};

function retainFileNavigationGuard(): () => void {
    if (typeof window === 'undefined') return () => {};
    navigationGuardUsers += 1;
    if (navigationGuardUsers === 1) {
        window.addEventListener('dragover', guardFileNavigation);
        window.addEventListener('drop', guardFileNavigation);
    }
    return () => {
        navigationGuardUsers = Math.max(0, navigationGuardUsers - 1);
        if (navigationGuardUsers === 0) {
            window.removeEventListener('dragover', guardFileNavigation);
            window.removeEventListener('drop', guardFileNavigation);
        }
    };
}

export interface UseFileDropOptions extends FileSelectionRules {
    disabled?: boolean;
    onSelection: (result: FileSelectionResult) => void;
}

/** Accessible drop behavior. Consumers spread the returned handlers on their actual control. */
export function useFileDrop(options: UseFileDropOptions) {
    const { disabled = false, onSelection } = options;
    const [isDragActive, setDragActive] = useState(false);
    const depth = useRef(0);
    const latest = useRef(options);
    latest.current = options;

    useEffect(() => retainFileNavigationGuard(), []);

    const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
        if (disabled || !isFileDrag(event.nativeEvent)) return;
        event.preventDefault();
        depth.current += 1;
        setDragActive(true);
    }, [disabled]);
    const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
        if (disabled || !isFileDrag(event.nativeEvent)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, [disabled]);
    const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
        if (disabled || !isFileDrag(event.nativeEvent)) return;
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragActive(false);
    }, [disabled]);
    const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
        if (disabled || !isFileDrag(event.nativeEvent)) return;
        event.preventDefault();
        depth.current = 0;
        setDragActive(false);
        onSelection(validateFileSelection(Array.from(event.dataTransfer.files), latest.current));
    }, [disabled, onSelection]);

    return { isDragActive, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

interface PickerCommonProps extends FileSelectionRules {
    disabled?: boolean;
    multiple?: boolean;
    onSelection: (result: FileSelectionResult) => void;
}

function acceptAttribute(accept: FileSelectionRules['accept']): string | undefined {
    const values = asAcceptList(accept);
    return values.length ? values.join(',') : undefined;
}

export interface FilePickerProps extends PickerCommonProps {
    children?: ReactNode;
    className?: string;
}

export function FilePicker({ children = 'Choose files', className, disabled, multiple = true, onSelection, ...rules }: FilePickerProps) {
    const input = useRef<HTMLInputElement>(null);
    const id = `file-picker-${useId().replace(/:/g, '')}`;
    const changed = (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        onSelection(validateFileSelection(files, { ...rules, maxFiles: rules.maxFiles ?? (multiple ? undefined : 1) }));
    };
    return (
        <>
            <input ref={input} id={id} className="file-input-hidden" type="file" tabIndex={-1} aria-hidden="true"
                accept={acceptAttribute(rules.accept)} multiple={multiple} disabled={disabled} onChange={changed} />
            <button type="button" className={className ? `btn file-picker ${className}` : 'btn file-picker'} disabled={disabled}
                onClick={() => input.current?.click()}>{children}</button>
        </>
    );
}

export interface FileDropZoneProps extends PickerCommonProps {
    children?: ReactNode | ((state: { isDragActive: boolean }) => ReactNode);
    className?: string;
    label?: string;
}

export function FileDropZone({ children, className, label = 'Choose files or drop them here', disabled, multiple = true, onSelection, ...rules }: FileDropZoneProps) {
    const input = useRef<HTMLInputElement>(null);
    const { isDragActive, dropProps } = useFileDrop({ ...rules, disabled, maxFiles: rules.maxFiles ?? (multiple ? undefined : 1), onSelection });
    const changed = (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        onSelection(validateFileSelection(files, { ...rules, maxFiles: rules.maxFiles ?? (multiple ? undefined : 1) }));
    };
    return (
        <div className="file-drop-zone-wrap">
            <input ref={input} className="file-input-hidden" type="file" tabIndex={-1} aria-hidden="true"
                accept={acceptAttribute(rules.accept)} multiple={multiple} disabled={disabled} onChange={changed} />
            <button type="button" className={`file-drop-zone${isDragActive ? ' is-drag-active' : ''}${className ? ` ${className}` : ''}`}
                disabled={disabled} aria-label={label} onClick={() => input.current?.click()} {...dropProps}>
                {typeof children === 'function' ? children({ isDragActive }) : children ?? (
                    <span className="file-drop-prompt"><i className="bi bi-cloud-arrow-up" /> <span>{isDragActive ? 'Drop files to add them' : label}</span></span>
                )}
            </button>
        </div>
    );
}
