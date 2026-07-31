#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEST_VERSION = '20260731k';
const TEST_CACHE_DATE = '2026-07-31k';
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(testDirectory, '..');

function readAppFile(relativePath) {
  return fs.readFileSync(path.join(appDirectory, relativePath), 'utf8');
}

function createEngineContext(additionalGlobals = {}) {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Uint8Array,
    Uint32Array,
    Float64Array,
    Int32Array,
    Map,
    WeakMap,
    Set,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    TypeError,
    RangeError,
    Error,
    SyntaxError,
    ...additionalGlobals
  });
  context.globalThis = context;
  for (const filename of [
    'letter-assets.js',
    'letter-vector-engine.js',
    'auto-measure.js'
  ]) {
    vm.runInContext(readAppFile(filename), context, { filename });
  }
  return context;
}

function closeTo(actual, expected, tolerance = 1e-6, message = '') {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message || 'values differ'}: expected ${expected}, received ${actual}`
  );
}

function assertFiniteBounds(bounds, label) {
  for (const key of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
    assert.ok(Number.isFinite(bounds[key]), `${label}.${key} must be finite`);
  }
  assert.ok(bounds.width > 0, `${label}.width must be positive`);
  assert.ok(bounds.height > 0, `${label}.height must be positive`);
}

function makeLetterObject(letter, layoutMode = 'source-cell-v2') {
  return {
    id: `letter-${letter}`,
    type: 'letter-template',
    template: {
      letter,
      tradition: 'beitYosef',
      layoutMode
    },
    points: [
      { x: 100, y: 200 },
      { x: 719.1, y: 841.64 }
    ]
  };
}

function approximateInkArea(paths, cubicSteps = 18) {
  let signedTotal = 0;
  for (const entry of paths) {
    let contour = [];
    let current = null;

    const finishContour = () => {
      if (contour.length >= 3) {
        let twiceArea = 0;
        for (let index = 0; index < contour.length; index++) {
          const first = contour[index];
          const second = contour[(index + 1) % contour.length];
          twiceArea += first.x * second.y - second.x * first.y;
        }
        signedTotal += twiceArea / 2;
      }
      contour = [];
      current = null;
    };

    for (const command of entry.commands) {
      if (command.type === 'M') {
        finishContour();
        current = { x: command.x, y: command.y };
        contour.push(current);
      } else if (command.type === 'L') {
        current = { x: command.x, y: command.y };
        contour.push(current);
      } else if (command.type === 'C') {
        assert.ok(current, 'a cubic command must follow a current point');
        const start = current;
        for (let step = 1; step <= cubicSteps; step++) {
          const t = step / cubicSteps;
          const inverse = 1 - t;
          current = {
            x:
              inverse ** 3 * start.x +
              3 * inverse ** 2 * t * command.x1 +
              3 * inverse * t ** 2 * command.x2 +
              t ** 3 * command.x,
            y:
              inverse ** 3 * start.y +
              3 * inverse ** 2 * t * command.y1 +
              3 * inverse * t ** 2 * command.y2 +
              t ** 3 * command.y
          };
          contour.push(current);
        }
      } else if (command.type === 'Z') {
        finishContour();
      }
    }
    finishContour();
  }
  return Math.abs(signedTotal);
}

function createSyntheticCanvas(width = 400, height = 260) {
  const gray = new Uint8Array(width * height);
  gray.fill(245);

  const rectangle = (x, y, rectangleWidth, rectangleHeight, value = 15) => {
    const firstRow = Math.max(0, y);
    const lastRow = Math.min(height, y + rectangleHeight);
    const firstColumn = Math.max(0, x);
    const lastColumn = Math.min(width, x + rectangleWidth);
    for (let row = firstRow; row < lastRow; row++) {
      for (let column = firstColumn; column < lastColumn; column++) {
        gray[row * width + column] = value;
      }
    }
  };

  return {
    source: { width, height, gray },
    rectangle
  };
}

function makeSyntheticRows() {
  const canvas = createSyntheticCanvas(300, 220);

  for (const [x, y, roofWidth] of [
    [20, 20, 85],
    [130, 20, 100],
    [40, 80, 95],
    [160, 80, 100],
    [20, 140, 110],
    [155, 140, 115]
  ]) {
    canvas.rectangle(x, y, roofWidth, 6);
  }

  return canvas.source;
}

function makeBetLikeRows() {
  const canvas = createSyntheticCanvas();
  for (const y of [20, 95, 170]) {
    for (const x of [25, 210]) {
      canvas.rectangle(x, y, 140, 6);
      canvas.rectangle(x, y, 7, 34);
      canvas.rectangle(x + 133, y, 7, 34);
      canvas.rectangle(x, y + 28, 140, 6);
    }
  }
  return canvas.source;
}

function makeDetachedRoofSeatRows() {
  const canvas = createSyntheticCanvas();
  for (const y of [20, 95, 170]) {
    for (const x of [25, 210]) {
      canvas.rectangle(x, y, 140, 6);
      canvas.rectangle(x + 5, y + 30, 130, 6);
    }
  }
  return canvas.source;
}

function makeRoofStemRows() {
  const canvas = createSyntheticCanvas();
  for (const y of [20, 95, 170]) {
    for (const x of [25, 210]) {
      canvas.rectangle(x, y, 140, 6);
      canvas.rectangle(x, y, 12, 38);
      canvas.rectangle(x + 128, y, 12, 34);
      canvas.rectangle(x + 65, y, 12, 30);
    }
  }
  return canvas.source;
}

function makeTaggedRowsWithDescender() {
  const canvas = createSyntheticCanvas();
  for (const y of [24, 100, 176]) {
    for (const x of [25, 210]) {
      canvas.rectangle(x, y, 140, 6);
      canvas.rectangle(x, y, 7, 33);
      canvas.rectangle(x + 133, y, 7, 33);
      canvas.rectangle(x, y + 27, 140, 6);
      for (const tagX of [x + 25, x + 65, x + 105]) {
        canvas.rectangle(tagX, y - 10, 3, 10);
      }
    }
  }
  canvas.rectangle(190, 55, 5, 28);
  return canvas.source;
}

function makeBlankImage(width = 160, height = 120) {
  const gray = new Uint8Array(width * height);
  gray.fill(255);
  return { width, height, gray };
}

function makeAppState(image, overrides = {}) {
  const formula = {
    nibPx: null,
    nibSamples: [],
    analysis: {},
    calibration: null,
    ...(overrides.formula || {})
  };
  return {
    image,
    objects: [],
    nextId: 1,
    selectedId: null,
    projectMeta: { id: 'medidaot-k-regression' },
    ...overrides,
    formula
  };
}

function createAppHarness(state) {
  const statusText = { textContent: '' };
  const analysisOverlay = { hidden: true };
  const calls = { snapshots: 0, renders: 0 };
  const appContext = createEngineContext({
    state,
    statusText,
    analysisOverlay,
    snapshot() {
      calls.snapshots += 1;
    },
    renderAll() {
      calls.renders += 1;
    }
  });
  return {
    context: appContext,
    autoMeasure: appContext.MEDIDAOT_AUTO_MEASURE,
    statusText,
    analysisOverlay,
    calls
  };
}

function assertThreeRowsAndTwoGaps(result, label) {
  assert.equal(result.rows.length, 3, `${label} must resolve to three physical rows`);
  assert.equal(result.gaps.length, 2, `${label} must produce two adjacent gaps`);
  assert.equal(result.diagnostics.physicalLineCount, 3);
  assert.equal(result.diagnostics.rowCount, 3);
  assert.equal(result.diagnostics.gapCount, 2);
  for (const [index, gap] of result.gaps.entries()) {
    assert.equal(gap.upperRowIndex, index);
    assert.equal(gap.lowerRowIndex, index + 1);
    assert.ok(gap.valuePx > 0);
    closeTo(gap.points[1].y - gap.points[0].y, gap.valuePx, 1e-9);
  }
}

const context = createEngineContext();
const letters = context.MEDIDAOT_LETTERS;
const vector = context.MEDIDAOT_VECTOR_ENGINE;
const autoMeasure = context.MEDIDAOT_AUTO_MEASURE;
const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

test('all 34 source-board vector assets parse with matching metrics', () => {
  assert.equal(letters.order.length, 27);
  assert.equal(vector.ariOverrideLetters.length, 7);

  const metrics = vector.listSourceMetrics();
  assert.equal(metrics.length, 34);
  assert.equal(new Set(metrics.map(metric => metric.key)).size, 34);

  let anchorTotal = 0;
  let controlTotal = 0;
  for (const metric of metrics) {
    const tradition = metric.style === 'ari' ? 'ari' : 'beitYosef';
    const asset = letters.traditions[tradition][metric.letter];
    assert.ok(asset, `missing ${metric.key}`);
    assert.equal(asset.style, metric.style);
    assert.equal(asset.slug, metric.slug);
    asset.viewBox.forEach((value, index) => {
      closeTo(value, metric.assetViewBox[index], 1e-9, `${metric.key} viewBox ${index}`);
    });
    closeTo(metric.sourceCell.width, vector.sourceBoard.canonicalCellWidth, 1e-9);
    closeTo(metric.sourceCell.height, vector.sourceBoard.canonicalCellHeight, 1e-9);

    const parsed = vector.parseLegacyAsset(asset);
    assert.equal(parsed.sourceKey, `${metric.style}:${metric.slug}`);
    assert.equal(parsed.paths.length, asset.paths.length);
    const counts = vector.getHandleCounts(parsed);
    assert.ok(counts.anchors > 0, `${metric.key} must expose anchors`);
    assert.equal(counts.total, counts.anchors + counts.controls);
    anchorTotal += counts.anchors;
    controlTotal += counts.controls;
    assertFiniteBounds(vector.computePathBounds(parsed.paths), `${metric.key} bounds`);

    for (const [index, entry] of parsed.paths.entries()) {
      const serialized = vector.serializePathData(entry.commands);
      const reparsed = vector.parsePathData(serialized);
      assert.equal(
        reparsed.length,
        entry.commands.length,
        `${metric.key} path ${index} must round-trip`
      );
    }
  }

  assert.ok(anchorTotal > 1_000, 'the complete board should expose detailed anchors');
  assert.ok(controlTotal > 1_000, 'the complete board should expose detailed controls');
});

test('source-cell layout preserves relative visual sizes instead of equal tight heights', () => {
  const tav = makeLetterObject('ת');
  const tsadi = makeLetterObject('צ');
  const tavVisual = vector.getVisualBounds(tav);
  const tsadiVisual = vector.getVisualBounds(tsadi);
  assert.equal(tavVisual.layoutMode, 'source-cell-v2');
  assert.equal(tsadiVisual.layoutMode, 'source-cell-v2');
  assert.deepEqual(tavVisual.objectRect, tsadiVisual.objectRect);
  assertFiniteBounds(tavVisual.image, 'tav image bounds');
  assertFiniteBounds(tsadiVisual.image, 'tsadi image bounds');

  assert.ok(
    Math.abs(tavVisual.image.height - tsadiVisual.image.height) > 100,
    'tav and tsadi must not be normalized to the same visual height'
  );
  assert.ok(
    Math.abs(tavVisual.image.width - tsadiVisual.image.width) > 50,
    'tav and tsadi must retain distinct visual widths'
  );

  const tavMetric = vector.getSourceMetrics('ת', 'beitYosef');
  const tsadiMetric = vector.getSourceMetrics('צ', 'beitYosef');
  assert.notEqual(tavMetric.outlineBounds.height, tsadiMetric.outlineBounds.height);
  assert.notEqual(tavMetric.outlineBounds.width, tsadiMetric.outlineBounds.width);
  assert.notEqual(tavMetric.outlineOffsetInCell.y, tsadiMetric.outlineOffsetInCell.y);
});

test('old saved letters remain on the tight-v1 compatibility layout', () => {
  const oldObject = {
    type: 'letter-template',
    template: { letter: 'ת', tradition: 'beitYosef' },
    points: [
      { x: 37, y: 41 },
      { x: 337, y: 441 }
    ]
  };
  assert.equal(vector.resolveLayoutMode(oldObject), 'tight-v1');
  assert.equal(vector.hasMaterializedVector(oldObject), false);

  const transform = vector.getLayoutTransform(oldObject);
  assert.equal(transform.layoutMode, 'tight-v1');
  const [viewX, viewY, viewWidth, viewHeight] = transform.viewBox;
  const topLeft = transform.localToImage({ x: viewX, y: viewY });
  const bottomRight = transform.localToImage({
    x: viewX + viewWidth,
    y: viewY + viewHeight
  });
  closeTo(topLeft.x, 37);
  closeTo(topLeft.y, 41);
  closeTo(bottomRight.x, 337);
  closeTo(bottomRight.y, 441);
  assert.equal(
    vector.hasMaterializedVector(oldObject),
    false,
    'read-only compatibility rendering must stay lazy'
  );
});

test('anchor editing is copy-on-write and does not mutate the canonical asset', () => {
  const first = makeLetterObject('א');
  const second = makeLetterObject('א');
  const canonicalAsset = letters.traditions.beitYosef['א'];
  const canonicalBefore = JSON.stringify(canonicalAsset);
  const secondBefore = JSON.stringify(vector.getRenderVector(second).paths);

  const handles = vector.enumerateHandles(first, { coordinateSpace: 'image' });
  const anchor = handles.find(handle => handle.kind === 'anchor');
  assert.ok(anchor, 'an editable anchor is required');
  const target = {
    x: anchor.point.x + 17,
    y: anchor.point.y - 11
  };
  const move = vector.moveObjectHandle(first, anchor.id, target);

  assert.equal(vector.hasMaterializedVector(first), true);
  assert.equal(vector.hasMaterializedVector(second), false);
  closeTo(move.point.x, target.x);
  closeTo(move.point.y, target.y);
  assert.ok(move.vector.revision >= 2);

  const movedHandle = vector
    .enumerateHandles(first, { coordinateSpace: 'image' })
    .find(handle => handle.id === anchor.id);
  assert.ok(movedHandle);
  closeTo(movedHandle.point.x, target.x);
  closeTo(movedHandle.point.y, target.y);
  assert.equal(JSON.stringify(vector.getRenderVector(second).paths), secondBefore);
  assert.equal(JSON.stringify(canonicalAsset), canonicalBefore);
});

test('weight changes ink while preserving the glyph outer size at .55, 1, and 1.45', () => {
  assert.deepEqual(
    { ...vector.weightRange },
    { minimum: 0.55, maximum: 1.45 }
  );
  const asset = letters.traditions.beitYosef['ת'];
  const weights = [0.55, 1, 1.45];
  const renders = weights.map(weight => vector.getRenderVector(asset, { weight }));
  const baseline = renders[1].bounds;

  for (const [index, render] of renders.entries()) {
    assert.equal(render.weight, weights[index]);
    assertFiniteBounds(render.bounds, `weight ${weights[index]} bounds`);
    for (const key of ['left', 'top', 'right', 'bottom']) {
      closeTo(render.bounds[key], baseline[key], 1e-6, `weight ${weights[index]} ${key}`);
    }
  }

  assert.notEqual(JSON.stringify(renders[0].paths), JSON.stringify(renders[1].paths));
  assert.notEqual(JSON.stringify(renders[2].paths), JSON.stringify(renders[1].paths));
  const areas = renders.map(render => approximateInkArea(render.paths));
  assert.ok(
    areas[0] < areas[1] && areas[1] < areas[2],
    `ink area should grow with weight, received ${areas.join(', ')}`
  );

  const object = makeLetterObject('ת');
  assert.equal(vector.setObjectWeight(object, -100).weight, 0.55);
  assert.equal(vector.setObjectWeight(object, 100).weight, 1.45);
});

test('materialized editable vectors are plain JSON and load back intact', () => {
  const object = makeLetterObject('ש');
  vector.setObjectWeight(object, 1.2);
  const handle = vector
    .enumerateHandles(object, { coordinateSpace: 'image' })
    .find(candidate => candidate.kind === 'control');
  assert.ok(handle, 'shin should have a Bézier control handle');
  vector.moveObjectHandle(object, handle.id, {
    x: handle.point.x + 4,
    y: handle.point.y + 7
  });

  const json = JSON.stringify(object);
  assert.ok(json.includes('"letterVector"'));
  assert.doesNotMatch(json, /Path2D|DOMMatrix|function/);
  const restored = JSON.parse(json);
  assert.equal(vector.hasMaterializedVector(restored), true);
  assert.equal(restored.letterVector.weight, 1.2);
  assert.equal(
    vector.getHandleCounts(restored).total,
    vector.getHandleCounts(object).total
  );
  assertFiniteBounds(vector.getRenderVector(restored).bounds, 'restored vector bounds');

  for (const entry of restored.letterVector.paths) {
    for (const command of entry.commands) {
      for (const [key, value] of Object.entries(command)) {
        if (key !== 'type') {
          assert.ok(Number.isFinite(value), `restored ${command.type}.${key} must be finite`);
        }
      }
    }
  }
});

test('automatic CV detects nib thickness and bottom-to-next-roof interline gaps', () => {
  const source = makeSyntheticRows();
  const nib = autoMeasure.analyzeNib(source);
  closeTo(nib.valuePx, 6, 0.25, 'detected nib');
  assert.equal(nib.kind, 'nib');
  assert.ok(nib.confidence >= 0.7);
  assert.equal(nib.aggregation.acceptedCount, 6);
  assert.equal(nib.aggregation.rejectedCount, 0);
  assert.ok(nib.evidence.every(sample => sample.points.length === 2));

  const interline = autoMeasure.analyzeInterline(source, { nibPx: nib.valuePx });
  assert.equal(interline.kind, 'interline');
  assert.equal(interline.formulaKey, 'between-lines');
  assert.equal(interline.category, 'line-gap');
  assert.equal(interline.normalizedByNib, true);
  assert.equal(interline.rows.length, 3);
  assert.equal(interline.gaps.length, 2);
  closeTo(interline.medianPx, 54, 0.5, 'median interline gap');
  closeTo(interline.medianNib, 9, 0.1, 'median interline nib units');

  for (const gap of interline.gaps) {
    closeTo(
      gap.points[1].y - gap.points[0].y,
      gap.valuePx,
      1e-9,
      'gap endpoints must span the measured clearance'
    );
    closeTo(
      gap.boundaries.lowerReferenceRoofTopY -
        gap.boundaries.upperBottomInkY,
      gap.valuePx,
      1e-9,
      'gap must be defined from upper ink bottom to the next roof'
    );
    closeTo(gap.valueNib, gap.valuePx / nib.valuePx, 1e-9);
  }

  const selfCalibrating = autoMeasure.analyzeInterline(source);
  closeTo(selfCalibrating.nibPx, 6, 0.25);
  closeTo(selfCalibrating.medianPx, 54, 0.5);
});

test('connected bet-like roof, stems, and seat resolve as one row, not cavity gaps', () => {
  const result = autoMeasure.analyzeInterline(makeBetLikeRows(), { nibPx: 6 });
  assertThreeRowsAndTwoGaps(result, 'connected bet-like rows');
  assert.equal(result.diagnostics.detectedBandCount, 6);
  result.rows.forEach((row, index) => {
    closeTo(row.roofTopY, [20, 95, 170][index], 1);
    closeTo(row.bottomY, [54, 129, 204][index], 1);
  });
  result.gaps.forEach(gap => {
    closeTo(gap.valuePx, 41, 1);
    assert.ok(gap.valuePx > 30, 'the internal letter cavity must not become interline space');
  });
});

test('detached roofs and seats are grouped into three physical text rows', () => {
  const result = autoMeasure.analyzeInterline(makeDetachedRoofSeatRows(), { nibPx: 6 });
  assertThreeRowsAndTwoGaps(result, 'detached roof/seat rows');
  assert.equal(result.diagnostics.detectedBandCount, 6);
  result.rows.forEach((row, index) => {
    closeTo(row.roofTopY, [20, 95, 170][index], 1);
    closeTo(row.bottomY, [56, 131, 206][index], 1);
  });
  result.gaps.forEach(gap => closeTo(gap.valuePx, 39, 1));
});

test('downward stems define row bottoms even when no seats are present', () => {
  const result = autoMeasure.analyzeInterline(makeRoofStemRows(), { nibPx: 6 });
  assertThreeRowsAndTwoGaps(result, 'roof and stem rows');
  assert.equal(result.diagnostics.detectedBandCount, 3);
  result.rows.forEach((row, index) => {
    const roofTop = [20, 95, 170][index];
    closeTo(row.roofTopY, roofTop, 1);
    assert.ok(
      row.bottomY >= roofTop + 30,
      'robust row bottom must include meaningful downward stems'
    );
  });
  result.gaps.forEach(gap => closeTo(gap.valuePx, 41, 1.5));
});

test('tagin and an isolated descender do not bridge or manufacture rows', () => {
  const result = autoMeasure.analyzeInterline(makeTaggedRowsWithDescender(), { nibPx: 6 });
  assertThreeRowsAndTwoGaps(result, 'tagged rows with isolated descender');
  result.rows.forEach((row, index) => {
    closeTo(row.roofTopY, [24, 100, 176][index], 1);
    closeTo(row.bottomY, [57, 133, 209][index], 1.5);
  });
  assert.ok(result.rows[0].bottomY < 60, 'isolated descender must not extend the first row');
  assert.ok(result.rows[1].roofTopY > 95, 'isolated descender must not become a middle row');
  result.gaps.forEach(gap => closeTo(gap.valuePx, 43, 1.5));
});

test('runInterline installs a detected nib and both measurement families atomically', async () => {
  const state = makeAppState(makeBetLikeRows());
  const harness = createAppHarness(state);
  const result = await harness.autoMeasure.runInterline();

  assertThreeRowsAndTwoGaps(result, 'integrated automatic interline run');
  closeTo(result.nib.valuePx, 6, 0.25);
  assert.ok(result.appliedNib);
  assert.ok(result.applied);
  closeTo(state.formula.nibPx, 6, 0.25);
  assert.equal(state.formula.analysis.status, 'done');
  assert.equal(state.formula.calibration.method, 'whole-image-horizontal-roofs');
  assert.equal(state.formula.calibration.verified, false);
  const nibObjects = state.objects.filter(
    object => object.role === harness.autoMeasure.roles.nib
  );
  const gapObjects = state.objects.filter(
    object => object.role === harness.autoMeasure.roles.interline
  );
  assert.ok(nibObjects.length >= 2 && nibObjects.length <= 10);
  assert.equal(gapObjects.length, 2);
  assert.equal(harness.calls.snapshots, 1, 'batched nib and gap apply should use one undo snapshot');
  assert.equal(harness.analysisOverlay.hidden, true);
});

test('human-corrected engine objects survive subsequent automatic cleanup', async () => {
  const state = makeAppState(makeBetLikeRows());
  const harness = createAppHarness(state);
  await harness.autoMeasure.runInterline();

  const originalGaps = state.objects.filter(
    object => object.role === harness.autoMeasure.roles.interline
  );
  const correctedGap = originalGaps[0];
  const uncorrectedGapId = originalGaps[1].id;
  correctedGap.gapDetection.manualCorrected = true;
  correctedGap.provenance.origin = 'human-corrected';
  await harness.autoMeasure.runInterline();
  assert.ok(state.objects.includes(correctedGap));
  assert.equal(state.objects.some(object => object.id === uncorrectedGapId), false);
  assert.equal(
    state.objects.filter(object => object.role === harness.autoMeasure.roles.interline).length,
    3,
    'one corrected gap plus two fresh automatic gaps should remain'
  );

  const originalNibObjects = state.objects.filter(
    object => object.role === harness.autoMeasure.roles.nib
  );
  const correctedNib = originalNibObjects[0];
  const uncorrectedNibId = originalNibObjects[1].id;
  correctedNib.manualCorrected = true;
  correctedNib.provenance.origin = 'human-corrected';
  await harness.autoMeasure.runNib();
  assert.ok(state.objects.includes(correctedNib));
  assert.equal(state.objects.some(object => object.id === uncorrectedNibId), false);
  assert.ok(
    state.objects.filter(object => object.role === harness.autoMeasure.roles.nib).length > 1
  );
});

test('verified manual nib calibration remains active during automatic validation', async () => {
  const manualNib = {
    id: 99,
    type: 'nib',
    auto: false,
    points: [{ x: 10, y: 10 }, { x: 10, y: 19 }],
    provenance: { origin: 'human' }
  };
  const state = makeAppState(makeBetLikeRows(), {
    objects: [manualNib],
    nextId: 100,
    formula: {
      nibPx: 9,
      calibration: {
        verified: true,
        objectId: manualNib.id,
        valuePx: 9,
        method: 'manual-two-point'
      }
    }
  });
  const harness = createAppHarness(state);
  const nibResult = await harness.autoMeasure.runNib();

  closeTo(nibResult.valuePx, 6, 0.25, 'automatic validation proposal');
  assert.equal(nibResult.applied.manualLockPreserved, true);
  assert.equal(nibResult.applied.activeValuePx, 9);
  assert.equal(state.formula.nibPx, 9);
  assert.equal(state.formula.calibration.objectId, manualNib.id);
  assert.equal(state.formula.calibration.verified, true);
  assert.ok(state.objects.includes(manualNib));
  assert.ok(state.formula.calibration.validations.length >= 1);
  const automaticSamples = state.formula.nibSamples.filter(
    sample => sample.role === harness.autoMeasure.roles.nib
  );
  assert.ok(automaticSamples.length > 0);
  assert.ok(automaticSamples.every(sample => sample.active === false));
  assert.ok(automaticSamples.every(sample => sample.validationOnly === true));

  const interline = await harness.autoMeasure.runInterline();
  assertThreeRowsAndTwoGaps(interline, 'interline with locked manual nib');
  assert.equal(interline.nib, null);
  assert.equal(interline.nibPx, 9);
  assert.equal(state.formula.nibPx, 9);
  assert.equal(state.formula.calibration.objectId, manualNib.id);
  assert.ok(state.objects.includes(manualNib));
});

test('failed automatic analysis reports failure and preserves existing measurements', async () => {
  const correctedGap = {
    id: 7,
    type: 'gap',
    role: 'medidaot-auto-interline-gap-v1',
    auto: true,
    gapDetection: { manualCorrected: true },
    provenance: { origin: 'human-corrected' }
  };
  const state = makeAppState(makeBlankImage(), {
    objects: [correctedGap],
    nextId: 8
  });
  const harness = createAppHarness(state);
  const result = await harness.autoMeasure.runInterline();

  assert.equal(result.applied, null);
  assert.equal(result.rows.length, 0);
  assert.equal(result.gaps.length, 0);
  assert.ok(result.error);
  assert.equal(state.formula.analysis.status, 'failed');
  assert.equal(state.formula.analysis.error, result.error);
  assert.ok(harness.statusText.textContent.includes('לא זוהו'));
  assert.equal(harness.analysisOverlay.hidden, true);
  assert.equal(harness.calls.snapshots, 0);
  assert.deepEqual(state.objects, [correctedGap]);
});

test('a rapid second interline request cancels the stale first apply', async () => {
  const state = makeAppState(makeBetLikeRows());
  const harness = createAppHarness(state);
  const first = harness.autoMeasure.runInterline();
  const second = harness.autoMeasure.runInterline();
  const [staleResult, currentResult] = await Promise.all([first, second]);

  assert.equal(staleResult.stale, true);
  assert.equal(staleResult.applied, undefined);
  assert.equal(currentResult.stale, undefined);
  assertThreeRowsAndTwoGaps(currentResult, 'latest rapid interline run');
  assert.ok(currentResult.appliedNib);
  assert.ok(currentResult.applied);
  assert.equal(harness.calls.snapshots, 1, 'only the current run may mutate undo history');
  assert.equal(
    state.objects.filter(object => object.role === harness.autoMeasure.roles.interline).length,
    2
  );
  assert.equal(state.formula.analysis.status, 'done');
  assert.equal(state.formula.analysis.runToken, 2);
  assert.equal(harness.analysisOverlay.hidden, true);
});

test('HTML and service worker reference one complete k-version asset set', async () => {
  const expectedScripts = [
    'letter-assets.js',
    'letter-vector-engine.js',
    'app-1.js',
    'letter-tools.js',
    'app-2.js',
    'app-3.js',
    'app-4.js',
    'auto-measure.js',
    'stability-patch.js'
  ].map(filename => `${filename}?v=${TEST_VERSION}`);

  for (const htmlName of ['medidaot.html', 'index.html']) {
    const html = readAppFile(htmlName);
    assert.doesNotMatch(html, /20260731j/);
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)]
      .map(match => match[1]);
    assert.deepEqual(scripts, expectedScripts);
    assert.match(html, new RegExp(`styles\\.css\\?v=${TEST_VERSION}`));

    const localReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => match[1])
      .filter(reference =>
        !reference.startsWith('#') &&
        !reference.startsWith('data:') &&
        !/^https?:/i.test(reference)
      );
    for (const reference of localReferences) {
      const filename = reference.split('?')[0];
      assert.ok(
        fs.existsSync(path.join(appDirectory, filename)),
        `${htmlName} references missing ${filename}`
      );
    }
  }

  const serviceWorker = readAppFile('sw.js');
  const cacheNameMatch = serviceWorker.match(/const CACHE_NAME = '([^']+)'/);
  assert.ok(cacheNameMatch);
  const cacheName = cacheNameMatch[1];
  assert.ok(cacheName.endsWith(TEST_CACHE_DATE));
  const appShellMatch = serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(appShellMatch);
  const appShell = [...appShellMatch[1].matchAll(/'([^']+)'/g)]
    .map(match => match[1]);
  for (const script of expectedScripts) {
    assert.ok(appShell.includes(`./${script}`), `service worker misses ${script}`);
  }
  for (const reference of appShell) {
    const relative = reference.replace(/^\.\//, '').split('?')[0];
    if (!relative) continue;
    assert.ok(
      fs.existsSync(path.join(appDirectory, relative)),
      `service worker references missing ${relative}`
    );
  }

  const handlers = {};
  const deleted = [];
  const serviceWorkerContext = vm.createContext({
    self: {
      addEventListener(name, handler) {
        handlers[name] = handler;
      },
      clients: {
        async claim() {}
      },
      async skipWaiting() {}
    },
    caches: {
      async keys() {
        return [cacheName, 'medidaot-old-version', 'unrelated-app-cache'];
      },
      async delete(key) {
        deleted.push(key);
        return true;
      },
      async open() {
        return { async addAll() {}, async put() {} };
      },
      async match() {
        return null;
      }
    },
    async fetch() {
      throw new Error('fetch is not part of the activation regression');
    }
  });
  vm.runInContext(serviceWorker, serviceWorkerContext, { filename: 'sw.js' });
  assert.equal(typeof handlers.activate, 'function');
  let activation;
  handlers.activate({
    waitUntil(promise) {
      activation = promise;
    }
  });
  await activation;
  assert.deepEqual(deleted, ['medidaot-old-version']);
});

let passed = 0;
for (const { name, callback } of tests) {
  try {
    await callback();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${tests.length} focused Medidaot k regression groups passed.`);
if (passed !== tests.length) {
  throw new Error(`${tests.length - passed} regression group(s) failed`);
}
