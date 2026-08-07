import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });

try {
    const math = await server.ssrLoadModule('/packages/portal-mojo/src/ui/image-editor/math.ts');
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
    console.log('verify-image-editor: math goldens passed');
} finally {
    await server.close();
}
