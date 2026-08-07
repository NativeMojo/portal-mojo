/** DOM-free image-editor geometry and operation contracts.
 *
 * Numeric defaults, crop clamp order, transform limits, and filter order are
 * ported from web-mojo's ImageCropView/ImageTransformView/ImageFiltersView.
 * Coordinates are always logical image pixels; preview CSS size and DPR never
 * enter this module.
 */

export interface ImageSize {
    width: number;
    height: number;
}

export interface ImagePoint {
    x: number;
    y: number;
}

export interface ImageRect extends ImagePoint, ImageSize {}

export interface CropData extends ImageRect {
    originalWidth: number;
    originalHeight: number;
}

export type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';

export interface CropOptions {
    aspectRatio?: number | null;
    minCropSize?: number;
    fixedCropSize?: ImageSize | null;
    cropAndScale?: ImageSize | null;
}

export interface CanvasMapping {
    scale: number;
    offsetX: number;
    offsetY: number;
}

export interface TransformState {
    scale: number;
    rotation: number;
    translateX: number;
    translateY: number;
}

export interface FilterState {
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    blur: number;
    grayscale: number;
    sepia: number;
}

export type FilterPresetName = keyof typeof FILTER_PRESETS;

export interface TransformOperation extends TransformState {
    kind: 'transform';
}

export interface CropOperation {
    kind: 'crop';
    rect: ImageRect;
    output: ImageSize | null;
}

export interface FilterOperation {
    kind: 'filters';
    filters: FilterState;
    preset: FilterPresetName;
}

export type ImageEditorOperation = TransformOperation | CropOperation | FilterOperation;

export interface ImageEditorSnapshot {
    operations: readonly ImageEditorOperation[];
    mode: ImageEditorMode;
}

export type ImageEditorMode = 'transform' | 'crop' | 'filters';

export const MIN_TRANSFORM_SCALE = 0.1;
export const MAX_TRANSFORM_SCALE = 5;
export const TRANSFORM_SCALE_STEP = 0.02;
export const DEFAULT_MIN_CROP_SIZE = 50;
export const DEFAULT_HISTORY_LIMIT = 20;

export const DEFAULT_TRANSFORM: Readonly<TransformState> = Object.freeze({
    scale: 1,
    rotation: 0,
    translateX: 0,
    translateY: 0,
});

export const DEFAULT_FILTERS: Readonly<FilterState> = Object.freeze({
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hue: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
});

export const FILTER_PRESETS = Object.freeze({
    none: Object.freeze({ name: 'Original', filters: Object.freeze({}) }),
    blackWhite: Object.freeze({ name: 'Black & White', filters: Object.freeze({ grayscale: 100 }) }),
    sepia: Object.freeze({ name: 'Sepia', filters: Object.freeze({ sepia: 100 }) }),
    vintage: Object.freeze({ name: 'Vintage', filters: Object.freeze({ sepia: 60, contrast: 110, brightness: 110, saturation: 80 }) }),
    cool: Object.freeze({ name: 'Cool Tones', filters: Object.freeze({ hue: 200, saturation: 120, brightness: 95 }) }),
    warm: Object.freeze({ name: 'Warm Tones', filters: Object.freeze({ hue: 25, saturation: 110, brightness: 105 }) }),
    vibrant: Object.freeze({ name: 'Vibrant', filters: Object.freeze({ brightness: 105, contrast: 115, saturation: 140, hue: 5 }) }),
    dramatic: Object.freeze({ name: 'Dramatic', filters: Object.freeze({ brightness: 90, contrast: 150, saturation: 120 }) }),
    soft: Object.freeze({ name: 'Soft', filters: Object.freeze({ brightness: 110, contrast: 85, blur: 1 }) }),
} as const);

export const FILTER_ORDER: readonly (keyof FilterState)[] = Object.freeze([
    'brightness', 'contrast', 'saturation', 'hue', 'blur', 'grayscale', 'sepia',
]);

export const CROP_HANDLES: Readonly<Record<CropHandle, Readonly<ImagePoint>>> = Object.freeze({
    nw: Object.freeze({ x: 0, y: 0 }),
    ne: Object.freeze({ x: 1, y: 0 }),
    sw: Object.freeze({ x: 0, y: 1 }),
    se: Object.freeze({ x: 1, y: 1 }),
    n: Object.freeze({ x: 0.5, y: 0 }),
    s: Object.freeze({ x: 0.5, y: 1 }),
    w: Object.freeze({ x: 0, y: 0.5 }),
    e: Object.freeze({ x: 1, y: 0.5 }),
});

export function canvasMapping(image: ImageSize, canvas: ImageSize, autoFit = true): CanvasMapping {
    const scaleX = canvas.width / image.width;
    const scaleY = canvas.height / image.height;
    const scale = autoFit ? Math.min(scaleX, scaleY, 1) : 1;
    return {
        scale,
        offsetX: (canvas.width - image.width * scale) / 2,
        offsetY: (canvas.height - image.height * scale) / 2,
    };
}

export function imageToCanvas(rect: ImageRect, mapping: CanvasMapping): ImageRect {
    return {
        x: rect.x * mapping.scale + mapping.offsetX,
        y: rect.y * mapping.scale + mapping.offsetY,
        width: rect.width * mapping.scale,
        height: rect.height * mapping.scale,
    };
}

export function canvasToImage(rect: ImageRect, mapping: CanvasMapping): ImageRect {
    return {
        x: (rect.x - mapping.offsetX) / mapping.scale,
        y: (rect.y - mapping.offsetY) / mapping.scale,
        width: rect.width / mapping.scale,
        height: rect.height / mapping.scale,
    };
}

export function initializeCropBox(image: ImageSize, options: CropOptions = {}): ImageRect {
    const minCropSize = options.minCropSize ?? DEFAULT_MIN_CROP_SIZE;
    let cropWidth: number;
    let cropHeight: number;

    if (options.fixedCropSize) {
        cropWidth = options.fixedCropSize.width;
        cropHeight = options.fixedCropSize.height;
    } else {
        cropWidth = Math.floor(image.width * 0.8);
        cropHeight = Math.floor(image.height * 0.8);
        const aspectRatio = options.cropAndScale
            ? options.cropAndScale.width / options.cropAndScale.height
            : options.aspectRatio;
        if (aspectRatio) {
            if (cropWidth / cropHeight > aspectRatio) cropWidth = cropHeight * aspectRatio;
            else cropHeight = cropWidth / aspectRatio;
        }
        cropWidth = Math.max(minCropSize, cropWidth);
        cropHeight = Math.max(minCropSize, cropHeight);
    }

    return {
        x: Math.floor((image.width - cropWidth) / 2),
        y: Math.floor((image.height - cropHeight) / 2),
        width: cropWidth,
        height: cropHeight,
    };
}

/** Mutates a copy using ImageCropView's exact minimum/bounds clamp order. */
export function constrainCropBox(input: ImageRect, image: ImageSize, minCropSize = DEFAULT_MIN_CROP_SIZE): ImageRect {
    const box = { ...input };
    box.width = Math.max(minCropSize, box.width);
    box.height = Math.max(minCropSize, box.height);
    if (box.x < 0) {
        box.width += box.x;
        box.x = 0;
    }
    if (box.y < 0) {
        box.height += box.y;
        box.y = 0;
    }
    if (box.x + box.width > image.width) box.width = image.width - box.x;
    if (box.y + box.height > image.height) box.height = image.height - box.y;
    box.width = Math.max(0, box.width);
    box.height = Math.max(0, box.height);
    return box;
}

export function constrainToAspectRatio(input: ImageRect, handle: CropHandle, ratio: number): ImageRect {
    const box = { ...input };
    if (!ratio) return box;
    let anchorX = 0;
    let anchorY = 0;

    if (['nw', 'ne', 'sw', 'se'].includes(handle)) {
        if (handle === 'nw') { anchorX = box.x + box.width; anchorY = box.y + box.height; }
        else if (handle === 'ne') { anchorX = box.x; anchorY = box.y + box.height; }
        else if (handle === 'sw') { anchorX = box.x + box.width; anchorY = box.y; }
        else { anchorX = box.x; anchorY = box.y; }

        if (box.width / box.height > ratio) box.width = box.height * ratio;
        else box.height = box.width / ratio;

        if (handle === 'nw') { box.x = anchorX - box.width; box.y = anchorY - box.height; }
        else if (handle === 'ne') { box.x = anchorX; box.y = anchorY - box.height; }
        else if (handle === 'sw') { box.x = anchorX - box.width; box.y = anchorY; }
        else { box.x = anchorX; box.y = anchorY; }
    } else if (handle === 'n' || handle === 's') {
        const centerX = box.x + box.width / 2;
        box.width = box.height * ratio;
        box.x = centerX - box.width / 2;
    } else {
        const centerY = box.y + box.height / 2;
        box.height = box.width / ratio;
        box.y = centerY - box.height / 2;
    }
    return box;
}

export function resizeCropBox(
    initial: ImageRect,
    dragStart: ImagePoint,
    current: ImagePoint,
    handle: CropHandle,
    image: ImageSize,
    options: CropOptions = {},
): ImageRect {
    const deltaX = current.x - dragStart.x;
    const deltaY = current.y - dragStart.y;
    let box = { ...initial };
    if (handle === 'nw') { box.x += deltaX; box.y += deltaY; box.width -= deltaX; box.height -= deltaY; }
    else if (handle === 'ne') { box.y += deltaY; box.width += deltaX; box.height -= deltaY; }
    else if (handle === 'sw') { box.x += deltaX; box.width -= deltaX; box.height += deltaY; }
    else if (handle === 'se') { box.width += deltaX; box.height += deltaY; }
    else if (handle === 'n') { box.y += deltaY; box.height -= deltaY; }
    else if (handle === 's') box.height += deltaY;
    else if (handle === 'w') { box.x += deltaX; box.width -= deltaX; }
    else box.width += deltaX;

    const ratio = options.cropAndScale
        ? options.cropAndScale.width / options.cropAndScale.height
        : options.aspectRatio;
    if (ratio) box = constrainToAspectRatio(box, handle, ratio);
    return constrainCropBox(box, image, options.minCropSize ?? DEFAULT_MIN_CROP_SIZE);
}

export function newCropBox(start: ImagePoint, current: ImagePoint, image: ImageSize, options: CropOptions = {}): ImageRect {
    let box: ImageRect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(current.x - start.x),
        height: Math.abs(current.y - start.y),
    };
    const ratio = options.cropAndScale
        ? options.cropAndScale.width / options.cropAndScale.height
        : options.aspectRatio;
    if (ratio) box = constrainToAspectRatio(box, 'se', ratio);
    const min = options.minCropSize ?? DEFAULT_MIN_CROP_SIZE;
    if (box.width < min) box.width = min;
    if (box.height < min) box.height = min;
    return constrainCropBox(box, image, min);
}

export function moveCropBox(initial: ImageRect, delta: ImagePoint, image: ImageSize): ImageRect {
    return {
        x: Math.max(0, Math.min(image.width - initial.width, initial.x + delta.x)),
        y: Math.max(0, Math.min(image.height - initial.height, initial.y + delta.y)),
        width: initial.width,
        height: initial.height,
    };
}

/** CropView's export/getCropData order intentionally uses the original x/y in the width/height clamps. */
export function cropDataFromBox(box: ImageRect, image: ImageSize): CropData {
    return {
        x: Math.max(0, Math.min(box.x, image.width)),
        y: Math.max(0, Math.min(box.y, image.height)),
        width: Math.min(box.width, image.width - box.x),
        height: Math.min(box.height, image.height - box.y),
        originalWidth: image.width,
        originalHeight: image.height,
    };
}

export function clampTransformScale(scale: number): number {
    return Math.max(MIN_TRANSFORM_SCALE, Math.min(MAX_TRANSFORM_SCALE, scale));
}

export function rotateTransform(state: TransformState, degrees: number): TransformState {
    let rotation = (state.rotation + degrees) % 360;
    if (rotation < 0) rotation += 360;
    return { ...state, rotation };
}

export function zoomTransformAtPoint(state: TransformState, scale: number, point: ImagePoint, canvas: ImageSize): TransformState {
    const oldScale = state.scale;
    const nextScale = clampTransformScale(scale);
    if (oldScale === nextScale) return { ...state };
    const scaleDiff = nextScale / oldScale;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    return {
        ...state,
        scale: nextScale,
        translateX: (state.translateX - (point.x - centerX)) * scaleDiff + (point.x - centerX),
        translateY: (state.translateY - (point.y - centerY)) * scaleDiff + (point.y - centerY),
    };
}

export function transformOutputSize(input: ImageSize, transform: TransformState): ImageSize {
    const radians = transform.rotation * Math.PI / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    return {
        width: Math.max(1, Math.ceil((input.width * cos + input.height * sin) * transform.scale - 1e-10)),
        height: Math.max(1, Math.ceil((input.width * sin + input.height * cos) * transform.scale - 1e-10)),
    };
}

export function combinedFilters(filters: FilterState, preset: FilterPresetName): FilterState {
    const entry = FILTER_PRESETS[preset];
    if (!entry) {
        console.warn(`ImageEditor: unknown filter preset ${JSON.stringify(preset)} — falling back to Original.`);
        return { ...filters };
    }
    return { ...filters, ...entry.filters };
}

export function filterString(filters: FilterState, preset: FilterPresetName = 'none'): string {
    const values = combinedFilters(filters, preset);
    const clean = filters.brightness === 100 && filters.contrast === 100 && filters.saturation === 100
        && filters.hue === 0 && filters.blur === 0 && filters.grayscale === 0 && filters.sepia === 0;
    if (clean && preset === 'none') return 'none';
    return [
        `brightness(${values.brightness}%)`,
        `contrast(${values.contrast}%)`,
        `saturate(${values.saturation}%)`,
        `hue-rotate(${values.hue}deg)`,
        `blur(${values.blur}px)`,
        `grayscale(${values.grayscale}%)`,
        `sepia(${values.sepia}%)`,
    ].join(' ');
}

export function appendOperation(
    operations: readonly ImageEditorOperation[],
    operation: ImageEditorOperation,
): readonly ImageEditorOperation[] {
    return Object.freeze([...operations, Object.freeze(operation)]);
}

export function operationOutputSize(source: ImageSize, operations: readonly ImageEditorOperation[]): ImageSize {
    return operations.reduce<ImageSize>((size, operation) => {
        if (operation.kind === 'transform') return transformOutputSize(size, operation);
        if (operation.kind === 'crop') return operation.output ?? {
            width: Math.max(1, Math.floor(operation.rect.width)),
            height: Math.max(1, Math.floor(operation.rect.height)),
        };
        return size;
    }, source);
}

export function lastCropData(source: ImageSize, operations: readonly ImageEditorOperation[]): CropData | null {
    let size = source;
    let latest: CropData | null = null;
    for (const operation of operations) {
        if (operation.kind === 'transform') size = transformOutputSize(size, operation);
        else if (operation.kind === 'crop') {
            latest = cropDataFromBox(operation.rect, size);
            size = operation.output ?? {
                width: Math.max(1, Math.floor(operation.rect.width)),
                height: Math.max(1, Math.floor(operation.rect.height)),
            };
        }
    }
    return latest;
}

export function commitSnapshot(
    history: readonly ImageEditorSnapshot[],
    index: number,
    snapshot: ImageEditorSnapshot,
    maxHistory = DEFAULT_HISTORY_LIMIT,
): { history: readonly ImageEditorSnapshot[]; index: number } {
    const next = [...history.slice(0, index + 1), Object.freeze({
        mode: snapshot.mode,
        operations: Object.freeze([...snapshot.operations]),
    })];
    const bounded = next.length > maxHistory ? next.slice(next.length - maxHistory) : next;
    return { history: Object.freeze(bounded), index: bounded.length - 1 };
}
