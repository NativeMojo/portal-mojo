import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const math = await server.ssrLoadModule('/packages/portal-mojo/src/ui/image-editor/math.ts');
    const canvas = await server.ssrLoadModule('/packages/portal-mojo/src/ui/image-editor/canvas.ts');
    const image = { width: 1000, height: 500 };
    const mapping = math.canvasMapping(image, { width: 500, height: 500 });
    assert.deepEqual(mapping, { scale: 0.5, offsetX: 0, offsetY: 125 });
    assert.deepEqual(math.canvasToImage(math.imageToCanvas({ x: 100, y: 25, width: 250, height: 100 }, mapping), mapping), { x: 100, y: 25, width: 250, height: 100 });

    assert.deepEqual(math.initializeCropBox(image), { x: 100, y: 50, width: 800, height: 400 });
    assert.deepEqual(math.initializeCropBox(image, { cropAndScale: { width: 200, height: 200 } }), { x: 300, y: 50, width: 400, height: 400 });
    assert.deepEqual(math.constrainCropBox({ x: -10, y: -5, width: 40, height: 60 }, image, 50), { x: 0, y: 0, width: 40, height: 55 }, 'source minimum-then-edge clamp order is retained');
    assert.deepEqual(math.cropDataFromBox({ x: -5, y: 20, width: 40, height: 60 }, image), { x: 0, y: 20, width: 40, height: 60, originalWidth: 1000, originalHeight: 500 }, 'source export clamp order is retained');

    const resized = math.resizeCropBox({ x: 100, y: 100, width: 200, height: 100 }, { x: 300, y: 200 }, { x: 350, y: 250 }, 'se', image, { aspectRatio: 2 });
    assert.deepEqual(resized, { x: 100, y: 100, width: 250, height: 125 });
    assert.deepEqual(math.moveCropBox({ x: 900, y: 450, width: 150, height: 100 }, { x: 50, y: 50 }, image), { x: 850, y: 400, width: 150, height: 100 });

    assert.equal(math.clampTransformScale(0), 0.1);
    assert.equal(math.clampTransformScale(9), 5);
    assert.equal(math.rotateTransform({ ...math.DEFAULT_TRANSFORM }, -90).rotation, 270);
    assert.deepEqual(math.zoomTransformAtPoint({ ...math.DEFAULT_TRANSFORM }, 2, { x: 75, y: 25 }, { width: 100, height: 100 }), { scale: 2, rotation: 0, translateX: -25, translateY: 25 });
    assert.deepEqual(math.transformOutputSize({ width: 4, height: 2 }, { scale: 1, rotation: 90, translateX: 9, translateY: -4 }), { width: 2, height: 4 });

    assert.equal(math.filterString({ ...math.DEFAULT_FILTERS }), 'none');
    assert.equal(math.filterString({ ...math.DEFAULT_FILTERS }, 'vintage'), 'brightness(110%) contrast(110%) saturate(80%) hue-rotate(0deg) blur(0px) grayscale(0%) sepia(60%)');

    let operations = math.appendOperation([], { kind: 'transform', scale: 1, rotation: 90, translateX: 0, translateY: 0 });
    operations = math.appendOperation(operations, { kind: 'crop', rect: { x: 0, y: 0, width: 2, height: 3 }, output: { width: 200, height: 200 } });
    operations = math.appendOperation(operations, { kind: 'filters', filters: { ...math.DEFAULT_FILTERS }, preset: 'sepia' });
    assert.deepEqual(operations.map((operation) => operation.kind), ['transform', 'crop', 'filters']);
    assert.deepEqual(math.operationOutputSize({ width: 4, height: 2 }, operations), { width: 200, height: 200 });

    let timeline = math.commitSnapshot([], -1, { mode: 'transform', operations: [] }, 3);
    timeline = math.commitSnapshot(timeline.history, timeline.index, { mode: 'crop', operations: operations.slice(0, 1) }, 3);
    timeline = math.commitSnapshot(timeline.history, timeline.index, { mode: 'filters', operations }, 3);
    timeline = math.commitSnapshot(timeline.history, 0, { mode: 'crop', operations: operations.slice(0, 2) }, 3);
    assert.deepEqual(timeline.history.map((entry) => entry.mode), ['transform', 'crop'], 'divergence truncates redo snapshots');
    assert(Object.isFrozen(timeline.history) && Object.isFrozen(timeline.history[1].operations), 'snapshots and operation rosters are immutable');

    const pixels = { width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]) };
    const browserFixtureOps = [
        { kind: 'crop', rect: { x: 1, y: 0, width: 1, height: 1 }, output: { width: 2, height: 1 } },
        { kind: 'filters', filters: { ...math.DEFAULT_FILTERS, grayscale: 100 }, preset: 'none' },
    ];
    const rendered = canvas.applyOperationsToPixels(pixels, browserFixtureOps);
    assert.deepEqual({ width: rendered.width, height: rendered.height }, { width: 2, height: 1 }, 'browser raster adapter emits requested output dimensions');
    assert.deepEqual([...rendered.data], [18, 18, 18, 128, 18, 18, 18, 128], 'deterministic pixels preserve alpha and exclude crop overlays');
    assert.equal(createHash('sha256').update(rendered.data).digest('hex'), '93f3353464ccb8c946a58b77e823ae0c4a80fce737c279a083b9cd6d30343ec2');
    const transformThenCrop = [
        { kind: 'transform', scale: 2, rotation: 0, translateX: 0, translateY: 0 },
        { kind: 'crop', rect: { x: 0, y: 0, width: 1, height: 1 }, output: null },
    ];
    assert.deepEqual(math.operationOutputSize(pixels, transformThenCrop), { width: 1, height: 1 });
    assert.deepEqual(math.operationOutputSize(pixels, [...transformThenCrop].reverse()), { width: 2, height: 2 }, 'chronological action order changes composition');

    // Browser-work limits reject before raster allocation. A tiny compressed
    // source and its decoded dimensions are deliberately checked separately.
    canvas.assertImageSourceSize(canvas.MAX_IMAGE_SOURCE_BYTES);
    assert.throws(() => canvas.assertImageSourceSize(canvas.MAX_IMAGE_SOURCE_BYTES + 1), /source exceeds/);
    let oversizedBitmapClosed = 0;
    globalThis.createImageBitmap = async () => ({ width: 8_000, height: 8_000, close() { oversizedBitmapClosed += 1; } });
    await assert.rejects(
        () => canvas.decodeImageSource(new Blob(['compressed'], { type: 'image/png' })),
        /decoded image exceeds/i,
        'a small compressed body cannot bypass the decoded-pixel ceiling',
    );
    assert.equal(oversizedBitmapClosed, 1, 'rejected decoded bitmap closes immediately');
    delete globalThis.createImageBitmap;
    assert.throws(
        () => math.assertImageEditorSize({ width: 8_000, height: 8_000 }, 'Decoded image'),
        /safe pixel limits/,
        'decoded dimensions are independently bounded',
    );
    assert.throws(
        () => math.validateImageEditorPipeline({ width: 600, height: 600 }, [
            { kind: 'transform', scale: 5, rotation: 0, translateX: 0, translateY: 0 },
            { kind: 'transform', scale: 5, rotation: 0, translateX: 0, translateY: 0 },
        ]),
        /safe pixel limits/,
        'compound transforms are checked at every intermediate output',
    );
    assert.throws(
        () => math.validateImageEditorOperationRanges([{ kind: 'crop', rect: { x: 0, y: 0, width: 1, height: 1 }, output: { width: 5_000, height: 4_000 } }]),
        /safe pixel limits/,
        'oversized explicit crop output rejects',
    );
    assert.throws(
        () => math.validateImageEditorOperationRanges([{ kind: 'filters', filters: { ...math.DEFAULT_FILTERS, blur: 11 }, preset: 'none' }]),
        /blur filter/,
        'naive blur cannot exceed the UI range',
    );
    assert.throws(
        () => math.validateImageEditorOperationRanges(Array.from({ length: math.MAX_IMAGE_EDITOR_OPERATIONS + 1 }, () => ({ kind: 'transform', ...math.DEFAULT_TRANSFORM }))),
        /at most/,
        'operation sequences have a hard work bound',
    );

    const [editorSource, portalCss, showcaseCss] = await Promise.all([
        readFile(new URL('../packages/portal-mojo/src/ui/image-editor/ImageEditor.tsx', import.meta.url), 'utf8'),
        readFile(new URL('../apps/portal/src/theme/image-editor.css', import.meta.url), 'utf8'),
        readFile(new URL('../apps/showcase/src/theme/image-editor.css', import.meta.url), 'utf8'),
    ]);
    assert.match(editorSource, /saveGeneration/);
    assert.match(editorSource, /loadGeneration/);
    assert.match(editorSource, /controller\.abort\(\)/, 'source replacement and unmount abort URL work');
    assert.match(editorSource, /canvas\.toBlob|pixelSurfaceToBlob/);
    assert(!/download\s*=|\.click\(\)/.test(editorSource), 'save never auto-downloads');
    assert.equal(portalCss, showcaseCss, 'both themes carry byte-identical editor styles');
    await stat(new URL('../packages/portal-mojo/docs/image-editor.md', import.meta.url));
    await stat(new URL('../apps/showcase/src/pages/components/demos-image-editor.tsx', import.meta.url));
    console.log('verify-image-editor: math, raster, history, and three-legged contracts passed');
} finally {
    await server.close();
}
