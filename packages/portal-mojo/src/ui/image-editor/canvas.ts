import {
    combinedFilters, cropDataFromBox, operationOutputSize, transformOutputSize,
    type FilterState, type ImageEditorOperation, type ImageSize, type TransformState,
} from './math';

export type ImageEditorSource = string | Blob;

export interface PixelSurface extends ImageSize {
    data: Uint8ClampedArray;
}

export interface DecodedImage {
    pixels: PixelSurface;
    filename: string;
    dispose: () => void;
}

export class ImageEditorError extends Error {
    constructor(message = 'The image could not be processed.') {
        super(message);
        this.name = 'ImageEditorError';
    }
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function copySurface(surface: PixelSurface): PixelSurface {
    return { width: surface.width, height: surface.height, data: new Uint8ClampedArray(surface.data) };
}

function pixelAt(surface: PixelSurface, x: number, y: number, channel: number): number {
    if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return 0;
    return surface.data[(y * surface.width + x) * 4 + channel]!;
}

function transformPixels(surface: PixelSurface, transform: TransformState): PixelSurface {
    const output = transformOutputSize(surface, transform);
    const data = new Uint8ClampedArray(output.width * output.height * 4);
    const radians = transform.rotation * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    for (let y = 0; y < output.height; y += 1) {
        for (let x = 0; x < output.width; x += 1) {
            const dx = x + 0.5 - output.width / 2 - transform.translateX;
            const dy = y + 0.5 - output.height / 2 - transform.translateY;
            const sx = Math.floor((dx * cos + dy * sin) / transform.scale + surface.width / 2);
            const sy = Math.floor((-dx * sin + dy * cos) / transform.scale + surface.height / 2);
            const target = (y * output.width + x) * 4;
            for (let channel = 0; channel < 4; channel += 1) data[target + channel] = pixelAt(surface, sx, sy, channel);
        }
    }
    return { ...output, data };
}

function cropPixels(surface: PixelSurface, rect: { x: number; y: number; width: number; height: number }, output: ImageSize | null): PixelSurface {
    const crop = cropDataFromBox(rect, surface);
    const width = Math.max(1, Math.floor(output?.width ?? crop.width));
    const height = Math.max(1, Math.floor(output?.height ?? crop.height));
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const sx = Math.floor(crop.x + (x + 0.5) * crop.width / width);
            const sy = Math.floor(crop.y + (y + 0.5) * crop.height / height);
            const target = (y * width + x) * 4;
            for (let channel = 0; channel < 4; channel += 1) data[target + channel] = pixelAt(surface, sx, sy, channel);
        }
    }
    return { width, height, data };
}

function boxBlur(surface: PixelSurface, radius: number): PixelSurface {
    const size = Math.max(0, Math.round(radius));
    if (!size) return surface;
    const output = copySurface(surface);
    for (let y = 0; y < surface.height; y += 1) {
        for (let x = 0; x < surface.width; x += 1) {
            const totals = [0, 0, 0, 0];
            let count = 0;
            for (let by = Math.max(0, y - size); by <= Math.min(surface.height - 1, y + size); by += 1) {
                for (let bx = Math.max(0, x - size); bx <= Math.min(surface.width - 1, x + size); bx += 1) {
                    for (let channel = 0; channel < 4; channel += 1) totals[channel] += pixelAt(surface, bx, by, channel);
                    count += 1;
                }
            }
            const target = (y * surface.width + x) * 4;
            for (let channel = 0; channel < 4; channel += 1) output.data[target + channel] = clampByte(totals[channel]! / count);
        }
    }
    return output;
}

/** Deterministic, alpha-preserving implementation of the legacy CSS-filter order. */
export function filterPixels(surface: PixelSurface, filters: FilterState): PixelSurface {
    let output = copySurface(surface);
    const brightness = filters.brightness / 100;
    const contrast = filters.contrast / 100;
    const saturation = filters.saturation / 100;
    const hue = filters.hue * Math.PI / 180;
    const cos = Math.cos(hue);
    const sin = Math.sin(hue);

    for (let index = 0; index < output.data.length; index += 4) {
        let r = output.data[index]! * brightness;
        let g = output.data[index + 1]! * brightness;
        let b = output.data[index + 2]! * brightness;
        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;

        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = lum + (r - lum) * saturation;
        g = lum + (g - lum) * saturation;
        b = lum + (b - lum) * saturation;

        const hr = (0.213 + cos * 0.787 - sin * 0.213) * r + (0.715 - cos * 0.715 - sin * 0.715) * g + (0.072 - cos * 0.072 + sin * 0.928) * b;
        const hg = (0.213 - cos * 0.213 + sin * 0.143) * r + (0.715 + cos * 0.285 + sin * 0.140) * g + (0.072 - cos * 0.072 - sin * 0.283) * b;
        const hb = (0.213 - cos * 0.213 - sin * 0.787) * r + (0.715 - cos * 0.715 + sin * 0.715) * g + (0.072 + cos * 0.928 + sin * 0.072) * b;
        r = hr; g = hg; b = hb;

        output.data[index] = clampByte(r);
        output.data[index + 1] = clampByte(g);
        output.data[index + 2] = clampByte(b);
        // Alpha is deliberately untouched by colour operations.
    }
    output = boxBlur(output, filters.blur);
    const grayscale = filters.grayscale / 100;
    const sepia = filters.sepia / 100;
    for (let index = 0; index < output.data.length; index += 4) {
        let r = output.data[index]!;
        let g = output.data[index + 1]!;
        let b = output.data[index + 2]!;
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = r + (gray - r) * grayscale;
        g = g + (gray - g) * grayscale;
        b = b + (gray - b) * grayscale;
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        output.data[index] = clampByte(r + (sr - r) * sepia);
        output.data[index + 1] = clampByte(g + (sg - g) * sepia);
        output.data[index + 2] = clampByte(b + (sb - b) * sepia);
    }
    return output;
}

export function applyOperationsToPixels(source: PixelSurface, operations: readonly ImageEditorOperation[]): PixelSurface {
    return operations.reduce<PixelSurface>((surface, operation) => {
        if (operation.kind === 'transform') return transformPixels(surface, operation);
        if (operation.kind === 'crop') return cropPixels(surface, operation.rect, operation.output);
        return filterPixels(surface, combinedFilters(operation.filters, operation.preset));
    }, copySurface(source));
}

function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new ImageEditorError();
    return context;
}

function pixelsFromDrawable(drawable: CanvasImageSource, size: ImageSize): PixelSurface {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas2d(canvas);
    context.drawImage(drawable, 0, 0, size.width, size.height);
    try {
        const image = context.getImageData(0, 0, size.width, size.height);
        return { width: size.width, height: size.height, data: new Uint8ClampedArray(image.data) };
    } catch {
        throw new ImageEditorError();
    }
}

async function decodeBlob(blob: Blob): Promise<{ drawable: CanvasImageSource; width: number; height: number; dispose: () => void }> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob);
            if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new ImageEditorError(); }
            return { drawable: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
        } catch {
            // Some browsers expose createImageBitmap but do not decode every
            // image MIME it accepts through <img>; use the owned-URL fallback.
        }
    }
    const ownedUrl = URL.createObjectURL(blob);
    try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new ImageEditorError('The selected image could not be decoded.'));
            element.src = ownedUrl;
        });
        return { drawable: image, width: image.naturalWidth, height: image.naturalHeight, dispose: () => URL.revokeObjectURL(ownedUrl) };
    } catch (error) {
        URL.revokeObjectURL(ownedUrl);
        throw error instanceof ImageEditorError ? error : new ImageEditorError();
    }
}

export async function decodeImageSource(source: ImageEditorSource): Promise<DecodedImage> {
    let blob: Blob;
    let filename = 'edited-image.png';
    if (typeof source === 'string') {
        try {
            const response = await fetch(source, { credentials: 'same-origin' });
            if (!response.ok) throw new ImageEditorError();
            blob = await response.blob();
        } catch {
            throw new ImageEditorError('The image could not be loaded.');
        }
    } else if (source instanceof Blob) {
        blob = source;
        if ('name' in source && typeof source.name === 'string' && source.name) filename = source.name;
    } else {
        throw new ImageEditorError('Select a valid image source.');
    }
    const decoded = await decodeBlob(blob);
    try {
        const pixels = pixelsFromDrawable(decoded.drawable, decoded);
        return { pixels, filename, dispose: decoded.dispose };
    } catch (error) {
        decoded.dispose();
        throw error instanceof ImageEditorError ? error : new ImageEditorError();
    }
}

export function drawPixelSurface(canvas: HTMLCanvasElement, surface: PixelSurface): void {
    canvas.width = surface.width;
    canvas.height = surface.height;
    const context = canvas2d(canvas);
    const image = context.createImageData(surface.width, surface.height);
    image.data.set(surface.data);
    context.putImageData(image, 0, 0);
}

export function pixelSurfaceToBlob(surface: PixelSurface): Promise<Blob> {
    const canvas = document.createElement('canvas');
    drawPixelSurface(canvas, surface);
    return new Promise((resolve, reject) => {
        try {
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new ImageEditorError('The edited image could not be encoded.')), 'image/png');
        } catch {
            reject(new ImageEditorError('The edited image could not be encoded.'));
        }
    });
}

export async function renderImageOperations(decoded: DecodedImage, operations: readonly ImageEditorOperation[]): Promise<{ pixels: PixelSurface; blob: Blob; width: number; height: number }> {
    const expected = operationOutputSize(decoded.pixels, operations);
    const pixels = applyOperationsToPixels(decoded.pixels, operations);
    if (pixels.width !== expected.width || pixels.height !== expected.height) throw new ImageEditorError();
    const blob = await pixelSurfaceToBlob(pixels);
    return { pixels, blob, width: pixels.width, height: pixels.height };
}
