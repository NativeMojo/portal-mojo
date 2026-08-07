import {
    useCallback, useEffect, useMemo, useRef, useState,
    type PointerEvent as ReactPointerEvent,
} from 'react';
import { modal, type ModalSize } from '../modal';
import {
    applyOperationsToPixels, decodeImageSource, drawPixelSurface, pixelSurfaceToBlob,
    ImageEditorError, type DecodedImage, type ImageEditorSource,
} from './canvas';
import {
    CROP_HANDLES, DEFAULT_FILTERS, DEFAULT_HISTORY_LIMIT, DEFAULT_TRANSFORM,
    FILTER_PRESETS, TRANSFORM_SCALE_STEP, appendOperation, canvasMapping,
    commitSnapshot, cropDataFromBox, filterString, imageToCanvas, initializeCropBox,
    lastCropData, moveCropBox, newCropBox, operationOutputSize, resizeCropBox,
    rotateTransform, type CropHandle, type CropOptions, type FilterPresetName,
    type FilterState, type ImageEditorMode, type ImageEditorOperation,
    type ImageEditorSnapshot, type ImagePoint, type ImageRect, type TransformState,
} from './math';

const ALL_MODES: readonly ImageEditorMode[] = ['transform', 'crop', 'filters'];

export interface ImageEditorResult {
    blob: Blob;
    filename: string;
    width: number;
    height: number;
    cropData: ReturnType<typeof cropDataFromBox> | null;
    operations: readonly ImageEditorOperation[];
}

export interface ImageEditorOptions {
    filename?: string;
    startMode?: ImageEditorMode | string;
    modes?: readonly (ImageEditorMode | string)[];
    crop?: CropOptions;
    initialOperations?: readonly ImageEditorOperation[];
    maxHistory?: number;
    saveText?: string;
}

export interface ImageEditorProps extends ImageEditorOptions {
    source: ImageEditorSource;
    onSave: (result: ImageEditorResult) => void | Promise<void>;
    onCancel?: () => void;
    disabled?: boolean;
    onBusyChange?: (busy: boolean) => void;
}

export interface ImageEditorModalOptions extends ImageEditorOptions {
    title?: string;
    size?: ModalSize;
    /** Optional owner lifecycle signal; abort closes the editor with null. */
    signal?: AbortSignal;
}

interface Timeline {
    history: readonly ImageEditorSnapshot[];
    index: number;
}

interface DragState {
    pointerId: number;
    kind: 'pan' | 'move-crop' | 'resize-crop' | 'new-crop';
    start: ImagePoint;
    initialTransform: TransformState;
    initialCrop: ImageRect;
    initialDirty: boolean;
    handle?: CropHandle;
}

function positiveFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateSize(size: CropOptions['fixedCropSize'], label: string): void {
    if (size == null) return;
    if (!positiveFinite(size.width) || !positiveFinite(size.height) || !Number.isInteger(size.width) || !Number.isInteger(size.height)) {
        throw new TypeError(`${label} must use positive finite integer dimensions.`);
    }
}

export function validateImageEditorOptions(source: ImageEditorSource, options: ImageEditorOptions): void {
    if (!(typeof source === 'string' && source.length > 0) && !(typeof Blob !== 'undefined' && source instanceof Blob)) {
        throw new TypeError('ImageEditor source must be a non-empty URL or Blob.');
    }
    if (options.crop?.aspectRatio != null && !positiveFinite(options.crop.aspectRatio)) {
        throw new TypeError('ImageEditor crop aspectRatio must be positive and finite.');
    }
    if (options.crop?.minCropSize != null && !positiveFinite(options.crop.minCropSize)) {
        throw new TypeError('ImageEditor minCropSize must be positive and finite.');
    }
    validateSize(options.crop?.fixedCropSize, 'ImageEditor fixedCropSize');
    validateSize(options.crop?.cropAndScale, 'ImageEditor cropAndScale');
    if (options.maxHistory != null && (!Number.isInteger(options.maxHistory) || options.maxHistory < 1 || options.maxHistory > DEFAULT_HISTORY_LIMIT)) {
        throw new TypeError(`ImageEditor maxHistory must be an integer from 1 to ${DEFAULT_HISTORY_LIMIT}.`);
    }
    for (const operation of options.initialOperations ?? []) {
        if (operation.kind === 'transform') {
            if (![operation.scale, operation.rotation, operation.translateX, operation.translateY].every(Number.isFinite) || operation.scale <= 0) {
                throw new TypeError('ImageEditor transform operations require finite values and a positive scale.');
            }
        } else if (operation.kind === 'crop') {
            if (![operation.rect.x, operation.rect.y, operation.rect.width, operation.rect.height].every(Number.isFinite)
                || operation.rect.width <= 0 || operation.rect.height <= 0) {
                throw new TypeError('ImageEditor crop operations require finite coordinates and positive dimensions.');
            }
            validateSize(operation.output, 'ImageEditor crop output');
        } else if (operation.kind === 'filters') {
            if (!Object.values(operation.filters).every(Number.isFinite)) throw new TypeError('ImageEditor filter operations require finite values.');
        } else {
            throw new TypeError('ImageEditor received an unknown operation.');
        }
    }
}

function normalizeModes(modes: ImageEditorOptions['modes']): readonly ImageEditorMode[] {
    if (!modes?.length) return ALL_MODES;
    const known: ImageEditorMode[] = [];
    for (const candidate of modes) {
        if (ALL_MODES.includes(candidate as ImageEditorMode)) {
            if (!known.includes(candidate as ImageEditorMode)) known.push(candidate as ImageEditorMode);
        } else {
            console.warn(`ImageEditor: unknown mode ${JSON.stringify(candidate)} — ignoring it.`);
        }
    }
    if (known.length) return known;
    console.warn('ImageEditor: no known modes remained — falling back to transform.');
    return ['transform'];
}

function normalizeMode(mode: string | undefined, modes: readonly ImageEditorMode[]): ImageEditorMode {
    if (mode && modes.includes(mode as ImageEditorMode)) return mode as ImageEditorMode;
    if (mode) console.warn(`ImageEditor: unavailable start mode ${JSON.stringify(mode)} — falling back to ${modes[0]}.`);
    return modes[0]!;
}

function outputFilename(requested: string | undefined, decoded: string): string {
    const candidate = requested?.trim() || decoded.trim() || 'edited-image.png';
    const safe = candidate.replace(/[\\/\r\n]/g, '-');
    return safe.toLowerCase().endsWith('.png') ? safe : `${safe.replace(/\.[^.]+$/, '')}-edited.png`;
}

function transformDirty(state: TransformState): boolean {
    return state.scale !== 1 || state.rotation !== 0 || state.translateX !== 0 || state.translateY !== 0;
}

function filterDirty(filters: FilterState, preset: FilterPresetName): boolean {
    return preset !== 'none' || filterString(filters) !== 'none';
}

export function ImageEditor(props: ImageEditorProps) {
    validateImageEditorOptions(props.source, props);
    const modes = useMemo(() => normalizeModes(props.modes), [props.modes]);
    const initialMode = normalizeMode(props.startMode, modes);
    const maxHistory = props.maxHistory ?? DEFAULT_HISTORY_LIMIT;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<SVGSVGElement>(null);
    const decodedRef = useRef<DecodedImage | null>(null);
    const loadGeneration = useRef(0);
    const saveGeneration = useRef(0);
    const savingRef = useRef(false);
    const drag = useRef<DragState | null>(null);
    const [decoded, setDecoded] = useState<DecodedImage | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<ImageEditorMode>(initialMode);
    const [timeline, setTimeline] = useState<Timeline>({ history: [], index: -1 });
    const [transform, setTransform] = useState<TransformState>({ ...DEFAULT_TRANSFORM });
    const [cropBox, setCropBox] = useState<ImageRect>({ x: 0, y: 0, width: 0, height: 0 });
    const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTERS });
    const [preset, setPreset] = useState<FilterPresetName>('none');
    const [dirty, setDirty] = useState(false);

    const committed = timeline.index >= 0 ? timeline.history[timeline.index]!.operations : (props.initialOperations ?? []);
    const sourceSize = decoded?.pixels ?? { width: 1, height: 1 };
    const workingSize = operationOutputSize(sourceSize, committed);
    const cropOptions = useMemo(() => props.crop ?? {}, [props.crop]);

    const resetDraft = useCallback((nextMode: ImageEditorMode, size = workingSize) => {
        setTransform({ ...DEFAULT_TRANSFORM });
        setFilters({ ...DEFAULT_FILTERS });
        setPreset('none');
        setCropBox(initializeCropBox(size, cropOptions));
        setDirty(false);
        setMode(nextMode);
    }, [cropOptions, workingSize]);

    useEffect(() => {
        const generation = ++loadGeneration.current;
        let live = true;
        void decodeImageSource(props.source).then((next) => {
            if (!live || generation !== loadGeneration.current) { next.dispose(); return; }
            const operations = Object.freeze([...(props.initialOperations ?? [])]);
            const snapshot: ImageEditorSnapshot = Object.freeze({ mode: initialMode, operations });
            decodedRef.current?.dispose();
            decodedRef.current = next;
            setDecoded(next);
            setTimeline({ history: Object.freeze([snapshot]), index: 0 });
            setError(null);
            const size = operationOutputSize(next.pixels, operations);
            setTransform({ ...DEFAULT_TRANSFORM });
            setFilters({ ...DEFAULT_FILTERS });
            setPreset('none');
            setCropBox(initializeCropBox(size, cropOptions));
            setDirty(false);
            setMode(initialMode);
        }, () => {
            if (live && generation === loadGeneration.current) setError('The image could not be loaded. Your current edit is unchanged.');
        });
        return () => { live = false; };
    }, [cropOptions, initialMode, props.initialOperations, props.source]);

    useEffect(() => () => {
        loadGeneration.current += 1;
        saveGeneration.current += 1;
        decodedRef.current?.dispose();
        decodedRef.current = null;
    }, []);

    const operationForMode = useCallback((forceCrop = false): ImageEditorOperation | null => {
        if (mode === 'transform') return transformDirty(transform) ? { kind: 'transform', ...transform } : null;
        if (mode === 'filters') return filterDirty(filters, preset) ? { kind: 'filters', filters: { ...filters }, preset } : null;
        return dirty || forceCrop ? { kind: 'crop', rect: { ...cropBox }, output: cropOptions.cropAndScale ? { ...cropOptions.cropAndScale } : null } : null;
    }, [cropBox, cropOptions.cropAndScale, dirty, filters, mode, preset, transform]);

    const previewOperations = useMemo(() => {
        const draft = operationForMode(false);
        return draft && draft.kind !== 'crop' ? appendOperation(committed, draft) : committed;
    }, [committed, operationForMode]);
    const preview = useMemo(() => decoded ? applyOperationsToPixels(decoded.pixels, previewOperations) : null, [decoded, previewOperations]);

    useEffect(() => {
        if (!canvasRef.current || !preview) return;
        try { drawPixelSurface(canvasRef.current, preview); setError(null); }
        catch { setError('The image preview could not be rendered. Your edit is unchanged.'); }
    }, [preview]);

    useEffect(() => { props.onBusyChange?.(busy); return () => props.onBusyChange?.(false); }, [busy, props.onBusyChange]);

    const commit = useCallback((nextMode = mode, forceCrop = false): readonly ImageEditorOperation[] => {
        const operation = operationForMode(forceCrop);
        const nextOperations = operation ? appendOperation(committed, operation) : committed;
        if (operation) {
            setTimeline((current) => commitSnapshot(current.history, current.index, { mode: nextMode, operations: nextOperations }, maxHistory));
        }
        const nextSize = operationOutputSize(sourceSize, nextOperations);
        resetDraft(nextMode, nextSize);
        return nextOperations;
    }, [committed, maxHistory, mode, operationForMode, resetDraft, sourceSize]);

    const switchMode = (nextMode: ImageEditorMode) => {
        if (nextMode === mode || busy || props.disabled) return;
        if (dirty || transformDirty(transform) || filterDirty(filters, preset)) commit(nextMode);
        else resetDraft(nextMode);
    };

    const undo = () => {
        if (busy || props.disabled || timeline.index <= 0) return;
        const index = timeline.index - 1;
        const snapshot = timeline.history[index]!;
        setTimeline({ ...timeline, index });
        resetDraft(snapshot.mode, operationOutputSize(sourceSize, snapshot.operations));
    };
    const redo = () => {
        if (busy || props.disabled || timeline.index >= timeline.history.length - 1) return;
        const index = timeline.index + 1;
        const snapshot = timeline.history[index]!;
        setTimeline({ ...timeline, index });
        resetDraft(snapshot.mode, operationOutputSize(sourceSize, snapshot.operations));
    };
    const reset = () => {
        if (busy || props.disabled) return;
        const snapshot: ImageEditorSnapshot = Object.freeze({ mode: modes[0]!, operations: Object.freeze([]) });
        setTimeline({ history: Object.freeze([snapshot]), index: 0 });
        resetDraft(modes[0]!, sourceSize);
        setError(null);
    };

    const save = async () => {
        if (!decoded || savingRef.current || props.disabled) return;
        savingRef.current = true;
        const generation = ++saveGeneration.current;
        setBusy(true);
        props.onBusyChange?.(true);
        setError(null);
        try {
            const draft = operationForMode(mode === 'crop');
            const finalOperations = draft ? appendOperation(committed, draft) : committed;
            const pixels = applyOperationsToPixels(decoded.pixels, finalOperations);
            const blob = await pixelSurfaceToBlob(pixels);
            if (generation !== saveGeneration.current) return;
            const result: ImageEditorResult = {
                blob,
                filename: outputFilename(props.filename, decoded.filename),
                width: pixels.width,
                height: pixels.height,
                cropData: lastCropData(decoded.pixels, finalOperations),
                operations: Object.freeze([...finalOperations]),
            };
            await props.onSave(result);
        } catch (caught) {
            if (generation === saveGeneration.current) setError(caught instanceof ImageEditorError ? caught.message : 'The edited image could not be saved.');
        } finally {
            if (generation === saveGeneration.current) {
                savingRef.current = false;
                setBusy(false);
                props.onBusyChange?.(false);
            }
        }
    };

    const pointFor = (event: ReactPointerEvent, element: Element): ImagePoint => {
        const rect = element.getBoundingClientRect();
        return { x: (event.clientX - rect.left) * workingSize.width / rect.width, y: (event.clientY - rect.top) * workingSize.height / rect.height };
    };

    const beginPointer = (event: ReactPointerEvent<SVGSVGElement | HTMLCanvasElement>) => {
        if (busy || props.disabled || event.button !== 0) return;
        const element = event.currentTarget;
        const start = pointFor(event, element);
        let kind: DragState['kind'] = 'pan';
        let handle: CropHandle | undefined;
        if (mode === 'crop') {
            const target = event.target as Element;
            const rawHandle = target.getAttribute('data-crop-handle');
            if (rawHandle && rawHandle in CROP_HANDLES) { kind = 'resize-crop'; handle = rawHandle as CropHandle; }
            else if (target.getAttribute('data-crop-box') === 'true') kind = 'move-crop';
            else kind = 'new-crop';
        } else if (mode !== 'transform') return;
        drag.current = { pointerId: event.pointerId, kind, start, initialTransform: { ...transform }, initialCrop: { ...cropBox }, initialDirty: dirty, handle };
        (element.closest('.image-editor') as HTMLElement | null)?.focus();
        element.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const movePointer = (event: ReactPointerEvent<SVGSVGElement | HTMLCanvasElement>) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const point = pointFor(event, event.currentTarget);
        const delta = { x: point.x - active.start.x, y: point.y - active.start.y };
        if (active.kind === 'pan') setTransform({ ...active.initialTransform, translateX: active.initialTransform.translateX + delta.x, translateY: active.initialTransform.translateY + delta.y });
        else if (active.kind === 'move-crop') setCropBox(moveCropBox(active.initialCrop, delta, workingSize));
        else if (active.kind === 'resize-crop' && active.handle) setCropBox(resizeCropBox(active.initialCrop, active.start, point, active.handle, workingSize, cropOptions));
        else setCropBox(newCropBox(active.start, point, workingSize, cropOptions));
        setDirty(true);
    };

    const endPointer = (event: ReactPointerEvent<SVGSVGElement | HTMLCanvasElement>) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const cancelPointer = (event: ReactPointerEvent<SVGSVGElement | HTMLCanvasElement>) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        setTransform(active.initialTransform);
        setCropBox(active.initialCrop);
        setDirty(active.initialDirty);
        drag.current = null;
    };

    const canvasBox = imageToCanvas(cropBox, canvasMapping(workingSize, workingSize));
    const disabled = busy || props.disabled || !decoded;

    return (
        <div
            className="image-editor"
            tabIndex={-1}
            onKeyDown={(event) => {
                if (event.key === 'Escape' && drag.current) {
                    setTransform(drag.current.initialTransform);
                    setCropBox(drag.current.initialCrop);
                    setDirty(drag.current.initialDirty);
                    drag.current = null;
                    event.preventDefault();
                    event.stopPropagation();
                } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
                    event.preventDefault();
                    if (event.shiftKey) redo(); else undo();
                }
            }}
        >
            <div className="image-editor-toolbar">
                <div className="image-editor-modes" role="group" aria-label="Editing mode">
                    {modes.map((candidate) => <button key={candidate} type="button" className={`btn${mode === candidate ? ' btn-primary' : ''}`} disabled={disabled} aria-pressed={mode === candidate} onClick={() => switchMode(candidate)}>{candidate[0]!.toUpperCase() + candidate.slice(1)}</button>)}
                </div>
                <div className="image-editor-history" role="group" aria-label="History">
                    <button type="button" className="btn btn-compact" disabled={disabled || timeline.index <= 0} onClick={undo} aria-label="Undo"><i className="bi bi-arrow-counterclockwise" /></button>
                    <button type="button" className="btn btn-compact" disabled={disabled || timeline.index >= timeline.history.length - 1} onClick={redo} aria-label="Redo"><i className="bi bi-arrow-clockwise" /></button>
                    <button type="button" className="btn btn-compact" disabled={disabled} onClick={reset}>Reset</button>
                </div>
            </div>

            <div className="image-editor-controls">
                {mode === 'transform' && <>
                    <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => { setTransform((value) => ({ ...value, scale: Math.min(5, value.scale + TRANSFORM_SCALE_STEP) })); setDirty(true); }}>Zoom in</button>
                    <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => { setTransform((value) => ({ ...value, scale: Math.max(0.1, value.scale - TRANSFORM_SCALE_STEP) })); setDirty(true); }}>Zoom out</button>
                    <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => { setTransform((value) => rotateTransform(value, -90)); setDirty(true); }}>Rotate left</button>
                    <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => { setTransform((value) => rotateTransform(value, 90)); setDirty(true); }}>Rotate right</button>
                    <button type="button" className="btn btn-compact" disabled={disabled} onClick={() => { setTransform((value) => ({ ...value, translateX: 0, translateY: 0 })); setDirty(true); }}>Center</button>
                    <span className="image-editor-value">{Math.round(transform.scale * 100)}% · {transform.rotation}°</span>
                </>}
                {mode === 'crop' && <>
                    <span className="image-editor-value">{Math.round(cropBox.width)} × {Math.round(cropBox.height)} px{cropOptions.cropAndScale ? ` → ${cropOptions.cropAndScale.width} × ${cropOptions.cropAndScale.height}` : ''}</span>
                </>}
                {mode === 'filters' && <label className="image-editor-preset">Effect
                    <select className="select" value={preset} disabled={disabled} onChange={(event) => {
                        const next = event.target.value;
                        if (next in FILTER_PRESETS) setPreset(next as FilterPresetName);
                        else { console.warn(`ImageEditor: unknown filter preset ${JSON.stringify(next)} — falling back to Original.`); setPreset('none'); }
                        setDirty(true);
                    }}>
                        {Object.entries(FILTER_PRESETS).map(([key, value]) => <option key={key} value={key}>{value.name}</option>)}
                    </select>
                </label>}
                <button type="button" className="btn btn-primary btn-compact image-editor-apply" disabled={disabled || (mode !== 'crop' && !dirty && !transformDirty(transform) && !filterDirty(filters, preset))} onClick={() => commit(mode, mode === 'crop')}>Apply</button>
            </div>

            {mode === 'filters' && <div className="image-editor-sliders">
                {([
                    ['brightness', 0, 200, '%'], ['contrast', 0, 200, '%'], ['saturation', 0, 200, '%'],
                    ['hue', 0, 360, '°'], ['blur', 0, 10, 'px'], ['grayscale', 0, 100, '%'], ['sepia', 0, 100, '%'],
                ] as const).map(([name, min, max, unit]) => <label key={name}><span>{name} <b>{filters[name]}{unit}</b></span><input type="range" min={min} max={max} value={filters[name]} disabled={disabled} onChange={(event) => { setFilters((value) => ({ ...value, [name]: Number(event.target.value) })); setDirty(true); }} /></label>)}
            </div>}

            <div className={`image-editor-stage is-${mode}`} aria-busy={!decoded || busy}>
                {!decoded && <div className="image-editor-message">Loading image…</div>}
                <div className="image-editor-preview">
                    <canvas ref={canvasRef} className="image-editor-canvas" onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={cancelPointer} />
                    {decoded && mode === 'crop' && <svg ref={overlayRef} className="image-editor-crop" viewBox={`0 0 ${workingSize.width} ${workingSize.height}`} preserveAspectRatio="none" onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={cancelPointer}>
                        <path className="image-editor-crop-shade" fillRule="evenodd" d={`M0 0H${workingSize.width}V${workingSize.height}H0Z M${canvasBox.x} ${canvasBox.y}V${canvasBox.y + canvasBox.height}H${canvasBox.x + canvasBox.width}V${canvasBox.y}Z`} />
                        <rect data-crop-box="true" className="image-editor-crop-box" x={canvasBox.x} y={canvasBox.y} width={canvasBox.width} height={canvasBox.height} />
                        {!cropOptions.fixedCropSize && Object.entries(CROP_HANDLES).map(([name, point]) => <rect key={name} data-crop-handle={name} className="image-editor-crop-handle" x={canvasBox.x + canvasBox.width * point.x - 6} y={canvasBox.y + canvasBox.height * point.y - 6} width="12" height="12" vectorEffect="non-scaling-stroke" />)}
                    </svg>}
                </div>
            </div>

            {error && <div className="image-editor-error" role="alert">{error}</div>}
            <div className="image-editor-footer">
                <span>{preview?.width ?? 0} × {preview?.height ?? 0}px · {committed.length} committed operation{committed.length === 1 ? '' : 's'}</span>
                <div className="modal-actions">
                    {props.onCancel && <button type="button" className="btn" disabled={busy} onClick={props.onCancel}>Cancel</button>}
                    <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => void save()}>{busy ? 'Saving…' : (props.saveText ?? 'Save image')}</button>
                </div>
            </div>
        </div>
    );
}

export function imageEditorModal(source: ImageEditorSource, options: ImageEditorModalOptions = {}): Promise<ImageEditorResult | null> {
    validateImageEditorOptions(source, options);
    let pending = false;
    const { title = 'Image editor', size = 'lg', signal, ...editorOptions } = options;
    return modal.open<ImageEditorResult | null>((close) => (
        <ImageEditorModalBody source={source} title={title} signal={signal} options={editorOptions} close={close} onBusyChange={(value) => { pending = value; }} />
    ), { size, flush: true, canDismiss: () => !pending });
}

function ImageEditorModalBody({ source, title, signal, options, close, onBusyChange }: {
    source: ImageEditorSource;
    title: string;
    signal?: AbortSignal;
    options: ImageEditorOptions;
    close: (result: ImageEditorResult | null) => void;
    onBusyChange: (busy: boolean) => void;
}) {
    useEffect(() => {
        if (!signal) return;
        if (signal.aborted) { close(null); return; }
        const abort = () => close(null);
        signal.addEventListener('abort', abort, { once: true });
        return () => signal.removeEventListener('abort', abort);
    }, [close, signal]);
    return <div className="image-editor-modal">
        <h2 className="image-editor-modal-title">{title}</h2>
        <ImageEditor
            {...options}
            source={source}
            onSave={(result) => close(result)}
            onCancel={() => close(null)}
            onBusyChange={onBusyChange}
        />
    </div>;
}
