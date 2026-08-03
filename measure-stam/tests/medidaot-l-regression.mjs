#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEST_VERSION = '20260803a';
const TEST_CACHE_DATE = '2026-08-03a';
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
    'master-system.js',
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

function makeIndependentOrganObject() {
  const organId = 'stem-a';
  const organAnchorIds = [0, 1, 2, 3].map(
    commandIndex => `o:${organId}:p0:c${commandIndex}:anchor`
  );
  const sourcePaths = [{
    rule: 'evenodd',
    commands: [
      { type: 'M', x: 10, y: 10 },
      { type: 'L', x: 90, y: 10 },
      { type: 'L', x: 90, y: 20 },
      { type: 'L', x: 60, y: 20 },
      { type: 'C', x1: 59, y1: 45, x2: 59, y2: 70, x: 58, y: 90 },
      { type: 'C', x1: 53, y1: 94, x2: 47, y2: 94, x: 42, y: 90 },
      { type: 'C', x1: 41, y1: 70, x2: 41, y2: 45, x: 40, y: 20 },
      { type: 'L', x: 10, y: 20 },
      { type: 'Z' }
    ]
  }];
  const basePaths = [{
    rule: 'evenodd',
    commands: [
      { type: 'M', x: 10, y: 10 },
      { type: 'L', x: 90, y: 10 },
      { type: 'L', x: 90, y: 20 },
      { type: 'L', x: 60, y: 20 },
      { type: 'L', x: 40, y: 20 },
      { type: 'L', x: 10, y: 20 },
      { type: 'Z' }
    ]
  }];
  const organPaths = [{
    rule: 'evenodd',
    commands: [
      { type: 'M', x: 40, y: 20 },
      { type: 'C', x1: 41, y1: 45, x2: 41, y2: 70, x: 42, y: 90 },
      { type: 'C', x1: 47, y1: 94, x2: 53, y2: 94, x: 58, y: 90 },
      { type: 'C', x1: 59, y1: 70, x2: 59, y2: 45, x: 60, y: 20 },
      { type: 'Z' }
    ]
  }];
  return {
    id: 'independent-organ-object',
    type: 'letterTemplate',
    template: { kind: 'image-region-vector', tradition: 'custom', layoutMode: 'tight-v1' },
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    letterEditAnchors: true,
    vectorDetailLevel: 'organs',
    letterVector: {
      schemaVersion: 3,
      sourceKey: 'photographed-selection', letter: '', tradition: 'custom',
      style: 'photographed-letter', slug: 'photographed-selection',
      viewBox: [0, 0, 100, 100], weight: 1, revision: 1,
      paths: sourcePaths,
      composition: {
        schemaVersion: 3,
        mode: 'organ-subpaths-v1',
        basePaths,
        connectorMode: 'paired-boundary-port-bridge'
      },
      handleCounts: { anchors: 10, controls: 6, total: 16 },
      featureCoordinateSpace: 'vector-local',
      featureAngleConvention: 'signed-clockwise-from-vertical',
      features: [{
        id: 'stem-axis-a', type: 'stem-axis', label: 'ציר ירך', organId,
        topologyStatus: 'bound-organ-subpath',
        anchorIds: organAnchorIds.slice(), point: { x: 50, y: 20 },
        root: { x: 50, y: 20 }, tip: { x: 50, y: 90 }, angleDeg: 0
      }, {
        id: organId, type: 'stem-organ', label: 'ירך שלמה', organId, stemId: 'stem-axis-a',
        topologyStatus: 'bound-organ-subpath',
        anchorIds: organAnchorIds.slice(), point: { x: 50, y: 55 },
        root: { x: 50, y: 20 }, tip: { x: 50, y: 90 }
      }],
      organs: [{
        id: organId,
        type: 'stem',
        paths: organPaths,
        anchorIds: organAnchorIds,
        boundaryPorts: [{
          id: 'root-left', role: 'root-left',
          sourceAnchorId: 'p0:c4:anchor', organAnchorId: organAnchorIds[0],
          sourcePoint: { x: 40, y: 20 }
        }, {
          id: 'root-right', role: 'root-right',
          sourceAnchorId: 'p0:c3:anchor', organAnchorId: organAnchorIds[3],
          sourcePoint: { x: 60, y: 20 }
        }],
        junction: {
          id: 'stem-a-junction',
          type: 'paired-boundary-port',
          sourcePortIds: ['p0:c4:anchor', 'p0:c3:anchor'],
          organPortIds: [organAnchorIds[0], organAnchorIds[3]]
        },
        transformMode: 'rigid-subpath',
        topologyStatus: 'exclusive-contour-arc'
      }]
    }
  };
}

function makeLassoOrganObject() {
  const object = makeIndependentOrganObject();
  object.id = 'lasso-organ-object';
  return object;
}

function makePromotableContourObject() {
  const sourcePaths = JSON.parse(JSON.stringify(makeIndependentOrganObject().letterVector.paths));
  return {
    id: 'promotable-contour-object',
    type: 'letterTemplate',
    template: { kind: 'image-region-vector', tradition: 'custom', layoutMode: 'tight-v1' },
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    letterEditAnchors: true,
    vectorDetailLevel: 'organs',
    letterVector: {
      schemaVersion: 3,
      sourceKey: 'photographed-selection', letter: '', tradition: 'custom',
      style: 'photographed-letter', slug: 'photographed-selection',
      viewBox: [0, 0, 100, 100], weight: 1, revision: 4,
      paths: sourcePaths,
      composition: {
        schemaVersion: 3,
        mode: 'flat-source-v3',
        basePaths: JSON.parse(JSON.stringify(sourcePaths)),
        connectorMode: 'none'
      },
      handleCounts: { anchors: 8, controls: 6, total: 14 },
      featureCoordinateSpace: 'vector-local',
      featureAngleConvention: 'signed-clockwise-from-vertical',
      features: [],
      organs: []
    }
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
    const firstRow = Math.max(0, Math.floor(y));
    const lastRow = Math.min(height, Math.ceil(y + rectangleHeight));
    const firstColumn = Math.max(0, Math.floor(x));
    const lastColumn = Math.min(width, Math.ceil(x + rectangleWidth));
    for (let row = firstRow; row < lastRow; row++) {
      for (let column = firstColumn; column < lastColumn; column++) {
        gray[row * width + column] = value;
      }
    }
  };

  const slopedBar = (x, y, barWidth, barHeight, rise, value = 15) => {
    for (let offset = 0; offset < barWidth; offset++) {
      rectangle(
        x + offset,
        y + rise * offset / Math.max(1, barWidth - 1),
        1,
        barHeight,
        value
      );
    }
  };

  return {
    source: { width, height, gray },
    rectangle,
    slopedBar
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

function makeDetachedRoofSeatLayout({
  rowCount = 3,
  pitch = 75,
  bodyOffset = 32,
  nib = 6,
  seatRise = 0,
  roofStemHeight = 0
} = {}) {
  const width = 400;
  const height = 20 + Math.max(0, rowCount - 1) * pitch +
    bodyOffset + Math.abs(seatRise) + nib + 20;
  const canvas = createSyntheticCanvas(width, height);
  for (let row = 0; row < rowCount; row++) {
    const y = 20 + row * pitch;
    for (const x of [25, 210]) {
      canvas.rectangle(x, y, 140, nib);
      if (roofStemHeight > nib) canvas.rectangle(x, y, nib, roofStemHeight);
      canvas.slopedBar(x + 5, y + bodyOffset, 130, nib, seatRise);
    }
  }
  return canvas.source;
}

function makeConnectedBodyRows({
  rowCount = 3,
  pitch = 36,
  bodyHeight = 24,
  nib = 6,
  stemWidth = 6
} = {}) {
  const width = 400;
  const height = 20 + Math.max(0, rowCount - 1) * pitch + bodyHeight + 30;
  const canvas = createSyntheticCanvas(width, height);
  for (let row = 0; row < rowCount; row++) {
    const y = 20 + row * pitch;
    for (const x of [25, 210]) {
      canvas.rectangle(x, y, 140, nib);
      canvas.rectangle(x, y, stemWidth, bodyHeight);
      canvas.rectangle(x + 140 - stemWidth, y, stemWidth, bodyHeight);
      canvas.rectangle(x, y + bodyHeight - nib, 140, nib);
    }
  }
  return canvas.source;
}

function makeSparseBodyRows({
  rowCount = 2,
  pitch = 60,
  bodyHeight = 24,
  nib = 6,
  stemWidth = 3,
  copies = 1
} = {}) {
  const width = 400;
  const height = 20 + Math.max(0, rowCount - 1) * pitch + bodyHeight + 30;
  const canvas = createSyntheticCanvas(width, height);
  for (let row = 0; row < rowCount; row++) {
    const y = 20 + row * pitch;
    for (let copy = 0; copy < copies; copy++) {
      const x = 25 + copy * 185;
      canvas.rectangle(x, y, 140, nib);
      canvas.rectangle(x, y, stemWidth, bodyHeight);
    }
  }
  return canvas.source;
}

function makeRoofOnlyRowsWithLoneDescender() {
  const canvas = createSyntheticCanvas(400, 260);
  for (const y of [20, 95, 170]) {
    for (const x of [25, 210]) canvas.rectangle(x, y, 140, 6);
  }
  canvas.rectangle(80, 20, 20, 50);
  canvas.rectangle(25, 95, 3, 24);
  canvas.rectangle(25, 170, 3, 24);
  return canvas.source;
}

function makeWideDescenderRows(width = 48) {
  const canvas = createSyntheticCanvas(400, 260);
  for (const y of [20, 96, 172]) {
    for (const x of [25, 210]) {
      canvas.rectangle(x, y, 140, 6);
      canvas.rectangle(x, y, 6, 24);
      canvas.rectangle(x + 134, y, 6, 24);
      canvas.rectangle(x, y + 18, 140, 6);
    }
  }
  canvas.rectangle(198, 41, width, 65);
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

function makePhotographedInterlineAcceptanceRows() {
  const canvas = createSyntheticCanvas(460, 270);
  const nib = 10;
  const rowTops = [24, 99, 174];
  const letterXs = [24, 112, 200, 288, 376];

  for (const rowTop of rowTops) {
    for (let letterIndex = 0; letterIndex < letterXs.length; letterIndex++) {
      const x = letterXs[letterIndex];
      const localSlope = letterIndex % 2 ? 1 : -1;
      canvas.slopedBar(x, rowTop, 64, nib, localSlope);
      canvas.rectangle(x + 4, rowTop, nib, 40);
      canvas.slopedBar(x + 4, rowTop + 30, 56, nib, localSlope);

      for (const tagOffset of [18, 38]) {
        canvas.rectangle(x + tagOffset, rowTop - 9, 3, 9);
      }
    }
  }

  // Two broad, connected descenders are deliberately wider than an ordinary
  // stem. They must not pull the stable row boundary down into the clearance.
  canvas.rectangle(72, rowTops[0] + 30, 22, 27);
  canvas.rectangle(332, rowTops[1] + 30, 24, 26);

  // Small photographed grains and one faint scratch should be removed as
  // non-structural noise before the interline boundary is selected.
  for (const [x, y] of [[16, 74], [180, 84], [260, 150], [448, 162]]) {
    canvas.rectangle(x, y, 2, 2, 48);
  }
  canvas.slopedBar(150, 86, 13, 2, 2, 92);
  return { source: canvas.source, nib, rowTops, expectedGapPx: 34 };
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
    projectMeta: { id: 'medidaot-l-regression' },
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

test('a selected anchor group translates atomically without double-moving shared controls', () => {
  const object = makeLetterObject('ש');
  const before = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  const anchorIds = before.filter(handle => handle.kind === 'anchor').slice(0, 4).map(handle => handle.id);
  assert.equal(anchorIds.length, 4);
  const beforeById = new Map(before.map(handle => [handle.id, handle.point]));
  const delta = { x: 19, y: -13 };

  const result = vector.translateObjectHandles(object, anchorIds, delta, {
    moveAdjacentControls: true
  });
  assert.equal(Array.from(result.ids).join('|'), anchorIds.join('|'));
  assert.ok(result.movedCoordinateCount >= anchorIds.length);
  const after = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  let movedControlCount = 0;
  for (const handle of after) {
    const previous = beforeById.get(handle.id);
    assert.ok(previous, `missing previous handle ${handle.id}`);
    const dx = handle.point.x - previous.x;
    const dy = handle.point.y - previous.y;
    const unchanged = Math.abs(dx) < 1e-7 && Math.abs(dy) < 1e-7;
    const movedOnce = Math.abs(dx - delta.x) < 1e-7 && Math.abs(dy - delta.y) < 1e-7;
    assert.ok(unchanged || movedOnce, `${handle.id} must move zero or one group delta, received ${dx},${dy}`);
    if (handle.kind === 'control' && movedOnce) movedControlCount++;
    if (anchorIds.includes(handle.id)) assert.ok(movedOnce, `${handle.id} must move with the group`);
  }
  assert.ok(movedControlCount > 0, 'adjacent Bézier controls must follow selected anchors');
});

test('semantic vector metadata clones independently and a stem tilts around its roof junction', () => {
  const object = {
    id: 'photographed-stem',
    type: 'letterTemplate',
    template: { kind: 'image-region-vector', tradition: 'custom', layoutMode: 'tight-v1' },
    points: [
      { x: 100, y: 100 }, { x: 300, y: 100 },
      { x: 300, y: 500 }, { x: 100, y: 500 }
    ],
    letterVector: {
      schemaVersion: 2,
      sourceKey: 'photographed-selection',
      letter: '', tradition: 'custom', style: 'photographed-letter', slug: 'photographed-selection',
      viewBox: [0, 0, 100, 100], weight: 1, revision: 1,
      paths: [{
        rule: 'evenodd',
        commands: [
          { type: 'M', x: 42, y: 8 },
          { type: 'C', x1: 43, y1: 32, x2: 53, y2: 70, x: 55, y: 92 },
          { type: 'Z' }
        ]
      }],
      handleCounts: { anchors: 2, controls: 2, total: 4 },
      featureCoordinateSpace: 'vector-local',
      featureAngleConvention: 'signed-clockwise-from-vertical',
      features: [{
        id: 'stem-1', type: 'stem-axis', label: 'ציר ירך',
        point: { x: 42, y: 8 }, root: { x: 42, y: 8 }, tip: { x: 55, y: 92 }, angleDeg: -8.8
      }],
      trace: { semanticMethod: 'component-projection-v1' }
    }
  };
  const sourcePaths = JSON.stringify(object.letterVector.paths);
  const expectedAngle = context.MEDIDAOT_MASTER_SYSTEM.signedVerticalAngle(
    object.letterVector.features[0].root,
    object.letterVector.features[0].tip
  );
  const clone = vector.cloneVectorData(object);
  assert.equal(clone.schemaVersion, 3, 'legacy schema 2 metadata must clone into the current schema');
  assert.equal(clone.featureCoordinateSpace, 'vector-local');
  assert.equal(clone.featureAngleConvention, 'signed-deviation-from-vertical');
  closeTo(clone.features[0].angleDeg, expectedAngle, 1e-9,
    'loaded semantic angles must use the master signed vertical convention');
  assert.equal(JSON.stringify(clone.paths), sourcePaths,
    'angle normalization must not alter the photographed contour');
  assert.equal(clone.features[0].type, 'stem-axis');
  assert.equal(clone.trace.semanticMethod, 'component-projection-v1');
  clone.features[0].root.x = -999;
  assert.equal(object.letterVector.features[0].root.x, 42, 'feature metadata must not alias the source');

  const before = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  const root = before.find(handle => handle.id === 'p0:c0:anchor');
  const tip = before.find(handle => handle.id === 'p0:c1:anchor');
  assert.ok(root && tip);
  const result = vector.tiltObjectHandles(object, [root.id, tip.id], 0, {
    rootImage: root.point,
    tipImage: tip.point,
    pivotImage: root.point,
    moveAdjacentControls: true,
    moveInternalControlsOnly: true,
    transformMode: 'rotate'
  });
  const after = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  const nextRoot = after.find(handle => handle.id === root.id);
  const nextTip = after.find(handle => handle.id === tip.id);
  closeTo(nextRoot.point.x, root.point.x, 1e-7, 'roof junction x must remain fixed');
  closeTo(nextRoot.point.y, root.point.y, 1e-7, 'roof junction y must remain fixed');
  closeTo(nextTip.point.x, nextRoot.point.x, 1e-7, 'zero-degree stem must end on the root axis');
  closeTo(
    Math.hypot(nextTip.point.x - nextRoot.point.x, nextTip.point.y - nextRoot.point.y),
    Math.hypot(tip.point.x - root.point.x, tip.point.y - root.point.y),
    1e-7,
    'rigid axis rotation must preserve stem length'
  );
  assert.equal(result.targetAngleDeg, 0);
  assert.equal(result.transformMode, 'rotate');
  assert.ok(result.movedCoordinateCount >= 4, 'the stem and adjacent Bézier controls must tilt together');
});

test('a detected organ rotates rigidly while anchors outside the organ remain fixed', () => {
  const object = {
    id: 'rigid-organ',
    type: 'letterTemplate',
    template: { kind: 'image-region-vector', tradition: 'custom', layoutMode: 'tight-v1' },
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    letterVector: {
      schemaVersion: 3,
      sourceKey: 'photographed-selection', letter: '', tradition: 'custom',
      style: 'photographed-letter', slug: 'photographed-selection',
      viewBox: [0, 0, 100, 100], weight: 1, revision: 1,
      paths: [{
        rule: 'evenodd',
        commands: [
          { type: 'M', x: 10, y: 10 },
          { type: 'C', x1: 20, y1: 10, x2: 36, y2: 18, x: 40, y: 20 },
          { type: 'C', x1: 41, y1: 42, x2: 41, y2: 70, x: 42, y: 90 },
          { type: 'C', x1: 47, y1: 94, x2: 53, y2: 94, x: 58, y: 90 },
          { type: 'C', x1: 59, y1: 70, x2: 59, y2: 42, x: 60, y: 20 },
          { type: 'C', x1: 64, y1: 18, x2: 80, y2: 10, x: 90, y: 10 },
          { type: 'Z' }
        ]
      }],
      handleCounts: { anchors: 6, controls: 10, total: 16 },
      features: [],
      organs: [{
        id: 'stem-organ', type: 'stem',
        anchorIds: ['p0:c1:anchor', 'p0:c2:anchor', 'p0:c3:anchor', 'p0:c4:anchor']
      }]
    }
  };
  const selectedIds = object.letterVector.organs[0].anchorIds;
  const before = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  const beforeMap = new Map(before.map(handle => [handle.id, handle.point]));
  const mean = ids => ids.reduce((sum, id) => ({
    x: sum.x + beforeMap.get(id).x / ids.length,
    y: sum.y + beforeMap.get(id).y / ids.length
  }), { x: 0, y: 0 });
  const root = mean(['p0:c1:anchor', 'p0:c4:anchor']);
  const tip = mean(['p0:c2:anchor', 'p0:c3:anchor']);
  const pairDistances = [];
  for (let first = 0; first < selectedIds.length; first++) {
    for (let second = first + 1; second < selectedIds.length; second++) {
      pairDistances.push([
        selectedIds[first], selectedIds[second],
        Math.hypot(
          beforeMap.get(selectedIds[first]).x - beforeMap.get(selectedIds[second]).x,
          beforeMap.get(selectedIds[first]).y - beforeMap.get(selectedIds[second]).y
        )
      ]);
    }
  }
  vector.tiltObjectHandles(object, selectedIds, 20, {
    rootImage: root,
    tipImage: tip,
    pivotImage: root,
    currentAngleDeg: 0,
    moveAdjacentControls: true,
    moveInternalControlsOnly: true,
    transformMode: 'rotate'
  });
  const after = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  const afterMap = new Map(after.map(handle => [handle.id, handle.point]));
  for (const [first, second, expected] of pairDistances) {
    closeTo(
      Math.hypot(afterMap.get(first).x - afterMap.get(second).x, afterMap.get(first).y - afterMap.get(second).y),
      expected,
      1e-7,
      `${first}/${second} distance must stay rigid`
    );
  }
  for (const externalId of ['p0:c0:anchor', 'p0:c5:anchor']) {
    closeTo(afterMap.get(externalId).x, beforeMap.get(externalId).x, 1e-7, `${externalId} x must not move`);
    closeTo(afterMap.get(externalId).y, beforeMap.get(externalId).y, 1e-7, `${externalId} y must not move`);
  }
});

test('the public vector engine and render payload advertise contour topology schema v3', () => {
  assert.equal(vector.vectorSchemaVersion, 3, 'the public engine schema must match photographed vectors');
  const object = makeIndependentOrganObject();
  const render = vector.getRenderVector(object);
  assert.equal(render.schemaVersion, 3);
  assert.equal(render.paths.length, 3, 'rendering composes the base, organ and explicit junction bridge');
  assert.equal(JSON.stringify(render.paths[0]), JSON.stringify(object.letterVector.composition.basePaths[0]));
  assert.equal(JSON.stringify(render.paths[1]), JSON.stringify(object.letterVector.organs[0].paths[0]));
  assert.equal(render.paths[2].commands.at(-1).type, 'Z', 'the junction bridge is a closed fill path');
  assert.equal(vector.stats(object).schemaVersion, 3);
});

test('one contiguous contour arc promotes with exact base and organ commands', () => {
  const object = makePromotableContourObject();
  const objectBefore = JSON.stringify(object);
  const sourceBefore = JSON.stringify(object.letterVector.paths);
  const selected = [3, 4, 5, 6].map(index => `p0:c${index}:anchor`);
  const result = vector.promoteBaseSelectionToOrgan(object, selected);

  assert.equal(result.ok, true, result.message);
  assert.equal(result.organId, 'manual-stem-1');
  assert.deepEqual(Array.from(result.handleIds), [0, 1, 2, 3].map(
    index => `o:manual-stem-1:p0:c${index}:anchor`
  ));
  assert.equal(result.vector.revision, object.letterVector.revision + 1);
  assert.equal(JSON.stringify(object), objectBefore, 'promotion planning must not mutate the source object');
  assert.equal(JSON.stringify(result.vector.paths), sourceBefore,
    'the immutable photographed source contour must remain byte-identical');

  assert.deepEqual(JSON.parse(JSON.stringify(result.vector.composition.basePaths)), [{
    rule: 'evenodd',
    commands: [
      { type: 'M', x: 40, y: 20 },
      { type: 'L', x: 10, y: 20 },
      { type: 'L', x: 10, y: 10 },
      { type: 'L', x: 90, y: 10 },
      { type: 'L', x: 90, y: 20 },
      { type: 'L', x: 60, y: 20 },
      { type: 'Z' }
    ]
  }], 'the base must use the exact complementary arc and expand the old Z edge to L');
  assert.deepEqual(JSON.parse(JSON.stringify(result.organ.paths)), [{
    rule: 'nonzero',
    commands: [
      { type: 'M', x: 60, y: 20 },
      { type: 'C', x1: 59, y1: 45, x2: 59, y2: 70, x: 58, y: 90 },
      { type: 'C', x1: 53, y1: 94, x2: 47, y2: 94, x: 42, y: 90 },
      { type: 'C', x1: 41, y1: 70, x2: 41, y2: 45, x: 40, y: 20 },
      { type: 'Z' }
    ]
  }], 'promotion must preserve every selected cubic and its controls exactly');
  assert.deepEqual(JSON.parse(JSON.stringify(result.organ.boundaryPorts.map(port => ({
    source: port.sourceAnchorId,
    organ: port.organAnchorId
  })))), [{
    source: 'p0:c5:anchor',
    organ: 'o:manual-stem-1:p0:c0:anchor'
  }, {
    source: 'p0:c0:anchor',
    organ: 'o:manual-stem-1:p0:c3:anchor'
  }]);
  assert.equal(result.organ.junctions.length, 1);
  assert.equal(result.organ.boundaryPorts.length, 2);
});

test('invalid contour promotions fail atomically with specific reasons', () => {
  const cases = [{
    label: 'disconnected anchors',
    ids: ['p0:c3:anchor', 'p0:c4:anchor', 'p0:c6:anchor'],
    code: 'disjoint-selection'
  }, {
    label: 'whole contour',
    ids: Array.from({ length: 8 }, (_, index) => `p0:c${index}:anchor`),
    code: 'whole-contour'
  }, {
    label: 'cubic control mixed into the selection',
    ids: ['p0:c3:anchor', 'p0:c4:anchor', 'p0:c5:control-in'],
    code: 'not-base-anchors'
  }];

  for (const fixture of cases) {
    const object = makePromotableContourObject();
    const before = JSON.stringify(object);
    const result = vector.promoteBaseSelectionToOrgan(object, fixture.ids);
    assert.equal(result.ok, false, fixture.label);
    assert.equal(result.code, fixture.code, fixture.label);
    assert.equal(JSON.stringify(object), before, `${fixture.label} must leave the object byte-identical`);
  }
});

test('a promoted organ translates without changing its source or base contours', () => {
  const object = makePromotableContourObject();
  const plan = vector.promoteBaseSelectionToOrgan(
    object,
    [3, 4, 5, 6].map(index => `p0:c${index}:anchor`)
  );
  assert.equal(plan.ok, true, plan.message);
  object.letterVector = plan.vector;
  const sourceBefore = JSON.stringify(object.letterVector.paths);
  const baseBefore = JSON.stringify(object.letterVector.composition.basePaths);
  const handlesBefore = new Map(vector.enumerateHandles(object, { coordinateSpace: 'image' })
    .filter(handle => plan.handleIds.includes(handle.id))
    .map(handle => [handle.id, handle.point]));
  const delta = { x: 12, y: -7 };

  vector.translateObjectHandles(object, plan.handleIds, delta, {
    moveAdjacentControls: true,
    moveInternalControlsOnly: true
  });

  assert.equal(JSON.stringify(object.letterVector.paths), sourceBefore);
  assert.equal(JSON.stringify(object.letterVector.composition.basePaths), baseBefore);
  const handlesAfter = new Map(vector.enumerateHandles(object, { coordinateSpace: 'image' })
    .filter(handle => plan.handleIds.includes(handle.id))
    .map(handle => [handle.id, handle.point]));
  for (const id of plan.handleIds) {
    closeTo(handlesAfter.get(id).x - handlesBefore.get(id).x, delta.x, 1e-7, `${id} x translation`);
    closeTo(handlesAfter.get(id).y - handlesBefore.get(id).y, delta.y, 1e-7, `${id} y translation`);
  }
});

test('a promoted organ tilts rigidly while its source and base remain unchanged', () => {
  const object = makePromotableContourObject();
  const plan = vector.promoteBaseSelectionToOrgan(
    object,
    [3, 4, 5, 6].map(index => `p0:c${index}:anchor`)
  );
  assert.equal(plan.ok, true, plan.message);
  object.letterVector = plan.vector;
  const sourceBefore = JSON.stringify(object.letterVector.paths);
  const baseBefore = JSON.stringify(object.letterVector.composition.basePaths);
  const before = new Map(vector.enumerateHandles(object, { coordinateSpace: 'image' })
    .filter(handle => plan.handleIds.includes(handle.id))
    .map(handle => [handle.id, handle.point]));
  const distances = [];
  for (let first = 0; first < plan.handleIds.length; first++) {
    for (let second = first + 1; second < plan.handleIds.length; second++) {
      const a = before.get(plan.handleIds[first]);
      const b = before.get(plan.handleIds[second]);
      distances.push([plan.handleIds[first], plan.handleIds[second], Math.hypot(a.x - b.x, a.y - b.y)]);
    }
  }
  const currentAngle = Math.atan2(plan.tip.x - plan.root.x, plan.tip.y - plan.root.y) * 180 / Math.PI;

  vector.tiltObjectHandles(object, plan.handleIds, 18, {
    rootImage: plan.root,
    tipImage: plan.tip,
    pivotImage: plan.root,
    currentAngleDeg: currentAngle,
    moveAdjacentControls: true,
    moveInternalControlsOnly: true,
    transformMode: 'rotate'
  });

  assert.equal(JSON.stringify(object.letterVector.paths), sourceBefore);
  assert.equal(JSON.stringify(object.letterVector.composition.basePaths), baseBefore);
  const after = new Map(vector.enumerateHandles(object, { coordinateSpace: 'image' })
    .filter(handle => plan.handleIds.includes(handle.id))
    .map(handle => [handle.id, handle.point]));
  for (const [firstId, secondId, expected] of distances) {
    const first = after.get(firstId);
    const second = after.get(secondId);
    closeTo(Math.hypot(first.x - second.x, first.y - second.y), expected, 1e-7,
      `${firstId}/${secondId} rigid distance`);
  }
  const firstPort = after.get(plan.handleIds[0]);
  const secondPort = after.get(plan.handleIds.at(-1));
  closeTo((firstPort.x + secondPort.x) / 2, plan.root.x, 1e-7, 'tilt pivot x');
  closeTo((firstPort.y + secondPort.y) / 2, plan.root.y, 1e-7, 'tilt pivot y');
});

test('lasso completion promotes new organs and has no raw-base movement fallback', () => {
  const source = readAppFile('letter-tools.js');
  const start = source.indexOf('function finishLetterAnchorLasso(');
  const end = source.indexOf('\nfunction runScheduledLetterWeightRender(', start);
  assert.ok(start >= 0 && end > start, 'lasso completion source must be present');
  const finish = source.slice(start, end);
  assert.match(finish, /promoteBaseSelectionToOrgan\?\.\(object,\s*rawSelected/,
    'an unmatched lasso must invoke the topology promotion API');
  assert.match(finish, /selected\s*=\s*\[\.\.\.promoted\.handleIds\]/,
    'successful promotion must select namespaced organ handles');
  assert.match(finish, /if \(!promoted\.ok\)[\s\S]*?return \[\];/,
    'failed promotion must exit before any raw group can move');
  assert.doesNotMatch(finish, /:\s*rawSelected\b/,
    'organ-mode lasso must never fall back to translating raw base anchors');
  assert.doesNotMatch(finish, /selected\s*=\s*rawSelected\b/,
    'raw base anchors must not become a draggable organ selection');
});

test('saved schema v1 and v2 vectors migrate canonically to v3 without changing source contours', () => {
  const paths = [{
    rule: 'evenodd',
    commands: [
      { type: 'M', x: 10, y: 10 },
      { type: 'C', x1: 20, y1: 10, x2: 40, y2: 80, x: 50, y: 90 },
      { type: 'L', x: 10, y: 90 },
      { type: 'Z' }
    ]
  }];
  const legacyVectors = [1, 2].map(schemaVersion => ({
    schemaVersion,
    sourceKey: 'photographed-selection', letter: '', tradition: 'custom',
    style: 'photographed-letter', slug: 'photographed-selection',
    viewBox: [0, 0, 100, 100], weight: 1, revision: 4,
    paths: structuredClone(paths),
    ...(schemaVersion === 2 ? {
      featureCoordinateSpace: 'vector-local',
      featureAngleConvention: 'signed-clockwise-from-vertical',
      features: [{
        id: 'legacy-stem', type: 'stem-axis', label: 'ציר ירך',
        point: { x: 10, y: 10 }, root: { x: 10, y: 10 }, tip: { x: 50, y: 90 }
      }]
    } : {})
  }));

  assert.equal(typeof vector.migrateVectorData, 'function', 'schema upgrades need one public migration entry point');
  const migrated = legacyVectors.map(letterVector => vector.migrateVectorData(letterVector));

  assert.deepEqual(
    migrated.map(letterVector => letterVector.schemaVersion),
    [3, 3],
    'both old editable schemas must enter the current in-memory representation'
  );
  migrated.forEach((letterVector, index) => {
    assert.equal(
      JSON.stringify(letterVector.paths),
      JSON.stringify(paths),
      `schema ${index + 1} migration must preserve the immutable source contour`
    );
    assert.deepEqual(JSON.parse(JSON.stringify(letterVector.migration)), {
      fromSchemaVersion: index + 1,
      toSchemaVersion: 3,
      mode: 'legacy-flat-vectors'
    });
  });
  assert.equal(migrated[1].features[0].id, 'legacy-stem', 'v2 semantic metadata must survive migration');
  assert.equal(migrated[1].featureAngleConvention, 'signed-deviation-from-vertical');
  closeTo(
    migrated[1].features[0].angleDeg,
    context.MEDIDAOT_MASTER_SYSTEM.signedVerticalAngle(
      migrated[1].features[0].root,
      migrated[1].features[0].tip
    ),
    1e-9,
    'v2 migration must derive its semantic angle through the master convention'
  );
  assert.equal(legacyVectors[0].schemaVersion, 1, 'migration must not mutate the loaded snapshot');
  assert.equal(legacyVectors[1].schemaVersion, 2, 'migration must not mutate the loaded snapshot');
});

test('translating an organ changes only its independent subpath and preserves source contours', () => {
  const object = makeIndependentOrganObject();
  const organ = object.letterVector.organs[0];
  const sourceBefore = JSON.stringify(object.letterVector.paths);
  const remainderBefore = JSON.stringify(object.letterVector.composition.basePaths);
  const organBefore = JSON.stringify(organ.paths);
  const handlesBefore = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  const byIdBefore = new Map(handlesBefore.map(handle => [handle.id, handle.point]));
  for (const anchorId of organ.anchorIds) {
    assert.ok(byIdBefore.has(anchorId), `${anchorId} must enumerate from organs[].paths`);
  }

  const delta = { x: 13, y: -7 };
  vector.translateObjectHandles(object, organ.anchorIds, delta, {
    moveAdjacentControls: true,
    moveInternalControlsOnly: true
  });

  assert.equal(JSON.stringify(object.letterVector.paths), sourceBefore,
    'organ translation must not rewrite the photographed source contour');
  assert.equal(JSON.stringify(object.letterVector.composition.basePaths), remainderBefore,
    'organ translation must not rewrite the static render remainder');
  assert.notEqual(JSON.stringify(object.letterVector.organs[0].paths), organBefore,
    'the independent organ geometry must receive the translation');
  const byIdAfter = new Map(vector.enumerateHandles(object, { coordinateSpace: 'image' })
    .map(handle => [handle.id, handle.point]));
  for (const anchorId of organ.anchorIds) {
    closeTo(byIdAfter.get(anchorId).x - byIdBefore.get(anchorId).x, delta.x, 1e-7, `${anchorId} x delta`);
    closeTo(byIdAfter.get(anchorId).y - byIdBefore.get(anchorId).y, delta.y, 1e-7, `${anchorId} y delta`);
  }
});

test('rotating an organ is rigid and leaves the source contour and remainder byte-identical', () => {
  const object = makeIndependentOrganObject();
  const organ = object.letterVector.organs[0];
  const sourceBefore = JSON.stringify(object.letterVector.paths);
  const remainderBefore = JSON.stringify(object.letterVector.composition.basePaths);
  const organBefore = JSON.stringify(organ.paths);
  const handlesBefore = vector.enumerateHandles(object, { coordinateSpace: 'image' });
  const byIdBefore = new Map(handlesBefore.map(handle => [handle.id, handle.point]));
  for (const anchorId of organ.anchorIds) {
    assert.ok(byIdBefore.has(anchorId), `${anchorId} must enumerate from organs[].paths`);
  }
  const pairDistances = [];
  for (let first = 0; first < organ.anchorIds.length; first++) {
    for (let second = first + 1; second < organ.anchorIds.length; second++) {
      const firstPoint = byIdBefore.get(organ.anchorIds[first]);
      const secondPoint = byIdBefore.get(organ.anchorIds[second]);
      pairDistances.push([
        organ.anchorIds[first], organ.anchorIds[second],
        Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y)
      ]);
    }
  }

  vector.tiltObjectHandles(object, organ.anchorIds, 18, {
    rootImage: { x: 50, y: 20 },
    tipImage: { x: 50, y: 90 },
    pivotImage: { x: 50, y: 20 },
    currentAngleDeg: 0,
    moveAdjacentControls: true,
    moveInternalControlsOnly: true,
    transformMode: 'rotate'
  });

  assert.equal(JSON.stringify(object.letterVector.paths), sourceBefore,
    'organ rotation must not rewrite the photographed source contour');
  assert.equal(JSON.stringify(object.letterVector.composition.basePaths), remainderBefore,
    'organ rotation must not rewrite the static render remainder');
  assert.notEqual(JSON.stringify(object.letterVector.organs[0].paths), organBefore,
    'the independent organ geometry must receive the rotation');
  const byIdAfter = new Map(vector.enumerateHandles(object, { coordinateSpace: 'image' })
    .map(handle => [handle.id, handle.point]));
  for (const [firstId, secondId, expectedDistance] of pairDistances) {
    const firstPoint = byIdAfter.get(firstId);
    const secondPoint = byIdAfter.get(secondId);
    closeTo(
      Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y),
      expectedDistance,
      1e-7,
      `${firstId}/${secondId} must retain rigid distance`
    );
  }
});

test('lasso selection retains organ feature metadata when rebuilt as the next drag handle', () => {
  const object = makeLassoOrganObject();
  const state = {
    objects: [object],
    selectedId: object.id,
    letterVectorSelection: null,
    letterVectorLasso: {
      id: object.id,
      points: [
        { x: 35, y: 15 }, { x: 65, y: 15 },
        { x: 65, y: 96 }, { x: 35, y: 96 }
      ]
    }
  };
  const pointInPolygon = (point, polygon) => {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const first = polygon[index];
      const second = polygon[previous];
      const crosses = (first.y > point.y) !== (second.y > point.y) &&
        point.x < (second.x - first.x) * (point.y - first.y) /
          ((second.y - first.y) || Number.EPSILON) + first.x;
      if (crosses) inside = !inside;
    }
    return inside;
  };
  const toolsContext = vm.createContext({
    console,
    Map,
    WeakMap,
    Set,
    Math,
    Number,
    Object,
    Array,
    state,
    distance: (first, second) => Math.hypot(second.x - first.x, second.y - first.y),
    midpoint: (first, second) => ({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }),
    pointInPolygon,
    isLetterTemplate: candidate => candidate?.type === 'letterTemplate',
    allLetterVectorHandles: candidate => vector.enumerateHandles(candidate, { coordinateSpace: 'image' }),
    letterVectorEngine: () => vector,
    letterAsset: () => null,
    MASTER_SYSTEM: {
      signedVerticalAngle: (root, tip) => Math.atan2(tip.x - root.x, tip.y - root.y) * 180 / Math.PI
    },
    $: () => ({ classList: { remove() {} } }),
    statusText: { textContent: '' },
    syncLetterControls() {},
    draw() {}
  });
  toolsContext.globalThis = toolsContext;
  const source = readAppFile('letter-tools.js');
  const helpersStart = source.indexOf('function representativeOrganHandle(');
  const helpersEnd = source.indexOf('\nfunction drawLetterVectorHandles(', helpersStart);
  const finishStart = source.indexOf('function finishLetterAnchorLasso(');
  const finishEnd = source.indexOf('\nfunction runScheduledLetterWeightRender(', finishStart);
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'vector handle helper block must be present');
  assert.ok(finishStart >= 0 && finishEnd > finishStart, 'lasso completion function must be present');
  vm.runInContext(source.slice(helpersStart, helpersEnd), toolsContext, {
    filename: 'letter-tools-vector-handles.js'
  });
  vm.runInContext(source.slice(finishStart, finishEnd), toolsContext, {
    filename: 'letter-tools-lasso-finish.js'
  });

  const selectedIds = toolsContext.finishLetterAnchorLasso();
  assert.equal(selectedIds.length, 4, 'the lasso must select the complete semantic organ');
  const lassoSelection = JSON.parse(JSON.stringify(state.letterVectorSelection));
  assert.deepEqual({
    featureId: lassoSelection.featureId,
    semanticType: lassoSelection.semanticType,
    organId: lassoSelection.organId
  }, {
    featureId: 'stem-a',
    semanticType: 'stem-organ',
    organId: 'stem-a'
  });
  assert.ok(lassoSelection.rootImage && lassoSelection.tipImage,
    'lasso selection must retain the organ axis endpoints');

  const rebuiltHandles = toolsContext.letterVectorHandles(object);
  const dragHandle = rebuiltHandles.find(handle => handle.groupLabel?.startsWith('custom:'));
  assert.ok(dragHandle, 'the selected anchor group must be rebuilt for the next pointer drag');
  const dragMetadata = JSON.parse(JSON.stringify({
    featureId: dragHandle.featureId ?? null,
    semanticType: dragHandle.semanticType ?? null,
    organId: dragHandle.organId ?? null,
    rootImage: dragHandle.rootImage ?? null,
    tipImage: dragHandle.tipImage ?? null
  }));
  assert.deepEqual(
    dragMetadata,
    {
      featureId: lassoSelection.featureId,
      semanticType: lassoSelection.semanticType,
      organId: lassoSelection.organId,
      rootImage: lassoSelection.rootImage,
      tipImage: lassoSelection.tipImage
    },
    'lasso -> hit-test -> drag must not erase the semantic organ identity or axis endpoints'
  );
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

  const prepared = autoMeasure.helpers.prepareRaster(source);

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
    const evidence = gap.boundaries.raster;
    assert.equal(gap.boundaries.zeroMargin, true);
    assert.ok(evidence, 'zero-margin gaps must retain their raster evidence');
    assert.equal(
      prepared.binary[evidence.upperInkY * prepared.width + evidence.x],
      1,
      'the upper endpoint must follow the last real ink pixel'
    );
    assert.equal(
      prepared.binary[evidence.lowerRoofY * prepared.width + evidence.x],
      1,
      'the lower endpoint must touch the next real roof pixel'
    );
    assert.equal(
      prepared.binary[evidence.upperBoundaryY * prepared.width + evidence.x],
      0,
      'the measured clearance must begin immediately after the upper ink'
    );
  }

  const signature = JSON.stringify(interline.gaps.map(gap => ({
    valuePx: gap.valuePx,
    points: gap.points,
    raster: gap.boundaries.raster
  })));
  for (let repetition = 0; repetition < 5; repetition++) {
    const repeated = autoMeasure.analyzeInterline(source, { nibPx: nib.valuePx });
    assert.equal(
      JSON.stringify(repeated.gaps.map(gap => ({
        valuePx: gap.valuePx,
        points: gap.points,
        raster: gap.boundaries.raster
      }))),
      signature,
      'automatic interline placement must be deterministic'
    );
  }

  const selfCalibrating = autoMeasure.analyzeInterline(source);
  closeTo(selfCalibrating.nibPx, 6, 0.25);
  closeTo(selfCalibrating.medianPx, 54, 0.5);
});

test('photographed interline acceptance uses stable row boundaries at 3.4 nibs', () => {
  const fixture = makePhotographedInterlineAcceptanceRows();
  const result = autoMeasure.analyzeInterline(fixture.source, { nibPx: fixture.nib });

  assertThreeRowsAndTwoGaps(result, 'photographed 34px interline fixture');
  closeTo(result.medianPx, fixture.expectedGapPx, 1, 'accepted interline pixels');
  closeTo(result.medianNib, 3.4, .1, 'accepted interline nib ratio');

  const prepared = autoMeasure.helpers.prepareRaster(fixture.source);
  for (const gap of result.gaps) {
    closeTo(gap.valuePx, fixture.expectedGapPx, 1, 'each photographed interline gap');
    closeTo(
      gap.points[1].y - gap.points[0].y,
      gap.valuePx,
      1e-9,
      'gap endpoints must span the measured clearance'
    );
    closeTo(
      gap.boundaries.lowerReferenceRoofTopY - gap.boundaries.upperBottomInkY,
      gap.valuePx,
      1e-9,
      'gap must run from stable bottom ink to the next stable roof'
    );
    assert.equal(gap.boundaries.zeroMargin, true);
    const evidence = gap.boundaries.raster;
    assert.ok(evidence, 'accepted gaps must retain raster boundary evidence');
    assert.equal(
      prepared.binary[evidence.upperInkY * prepared.width + evidence.x],
      1,
      'the stable upper boundary must touch real ink'
    );
    assert.equal(
      prepared.binary[evidence.lowerRoofY * prepared.width + evidence.x],
      1,
      'the stable lower roof must touch real ink'
    );
    assert.equal(
      prepared.binary[evidence.upperBoundaryY * prepared.width + evidence.x],
      0,
      'the clearance must start immediately after upper-row ink'
    );
  }

  const signature = JSON.stringify(result.gaps.map(gap => ({
    valuePx: gap.valuePx,
    points: gap.points,
    raster: gap.boundaries.raster
  })));
  for (let repetition = 0; repetition < 5; repetition++) {
    const repeated = autoMeasure.analyzeInterline(fixture.source, { nibPx: fixture.nib });
    assert.equal(
      JSON.stringify(repeated.gaps.map(gap => ({
        valuePx: gap.valuePx,
        points: gap.points,
        raster: gap.boundaries.raster
      }))),
      signature,
      'photographed interline placement must be deterministic'
    );
  }
});

test('tiny ink inside a larger component bounding box stays removed', () => {
  const width = 24;
  const height = 24;
  const binary = new Uint8Array(width * height);
  const put = (x, y) => { binary[y * width + x] = 1; };
  for (let y = 3; y <= 18; y++) {
    put(3, y);
    put(18, y);
  }
  for (let x = 3; x <= 18; x++) put(x, 18);
  put(10, 10);

  const cleaned = autoMeasure.helpers.removeTinyInk(binary, width, height, 8);
  assert.equal(cleaned[10 * width + 10], 0, 'the isolated grain must not be revived by a bounding box');
  assert.equal(cleaned[18 * width + 3], 1, 'the large connected component must remain');
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

test('one physical roof/seat row fails safely across offsets and seat slopes', () => {
  for (const [bodyOffset, seatRise, roofStemHeight = 0] of [
    [18, 0],
    [31, 0],
    [40, 0],
    [48, 0],
    [32, -10],
    [32, 10],
    [40, 0, 18]
  ]) {
    const source = makeDetachedRoofSeatLayout({
      rowCount: 1,
      bodyOffset,
      seatRise,
      roofStemHeight
    });
    const prepared = autoMeasure.helpers.prepareRaster(source);
    const detection = autoMeasure.helpers.detectRowBands(prepared, 6);
    assert.match(
      detection.profile.ambiguityReason || '',
      /unresolved-horizontal-members/,
      `offset ${bodyOffset}, rise ${seatRise} must retain an explicit ambiguity reason`
    );
    assert.throws(
      () => autoMeasure.analyzeInterline(source, { nibPx: 6 }),
      /Ambiguous row structure/,
      `offset ${bodyOffset}, rise ${seatRise} must not manufacture an interline gap`
    );
  }
});

test('stable same-phase periods group detached 32px roof/seat members by row', () => {
  const result = autoMeasure.analyzeInterline(
    makeDetachedRoofSeatLayout({ rowCount: 3, pitch: 75, bodyOffset: 32 }),
    { nibPx: 6 }
  );
  assertThreeRowsAndTwoGaps(result, '32px detached roof/seat rows');
  assert.equal(result.diagnostics.detectedBandCount, 6);
  assert.equal(result.diagnostics.linePitchStep, 2);
  closeTo(result.diagnostics.estimatedLinePitchRasterPx, 75, 1e-9);
  result.rows.forEach((row, index) => {
    closeTo(row.roofTopY, 20 + index * 75, 1);
    closeTo(row.bottomY, 58 + index * 75, 1);
  });
  result.gaps.forEach(gap => closeTo(gap.valuePx, 37, 1));
});

test('genuinely close connected rows remain separate physical lines', () => {
  for (const pitch of [32, 34, 36]) {
    const result = autoMeasure.analyzeInterline(
      makeConnectedBodyRows({ rowCount: 3, pitch, bodyHeight: 24, stemWidth: 6 }),
      { nibPx: 6 }
    );
    assertThreeRowsAndTwoGaps(result, `close connected rows at pitch ${pitch}`);
    assert.equal(result.diagnostics.linePitchMethod, 'horizontal-track-phase-chains');
    result.rows.forEach((row, index) => {
      closeTo(row.roofTopY, 20 + index * pitch, 1);
      closeTo(row.bottomY, 44 + index * pitch, 1);
    });
    result.gaps.forEach(gap => closeTo(gap.valuePx, pitch - 24, 1));
  }
});

test('a two-band result needs independent body evidence in both rows', () => {
  const ambiguousSource = makeDetachedRoofSeatLayout({
    rowCount: 1,
    bodyOffset: 40
  });
  const ambiguousPrepared = autoMeasure.helpers.prepareRaster(ambiguousSource);
  const ambiguousDetection = autoMeasure.helpers.detectRowBands(
    ambiguousPrepared,
    6
  );
  assert.equal(ambiguousDetection.profile.twoBandSingleInterval, true);
  assert.equal(ambiguousDetection.profile.independentBodyEvidenceCount, 0);
  assert.equal(ambiguousDetection.profile.ambiguousTwoBandPair, true);
  assert.equal(
    ambiguousDetection.rows.length,
    2,
    'fail-safe ambiguity must preserve candidate rows for diagnostics'
  );
  assert.equal(
    ambiguousDetection.profile.ambiguityReason,
    'unresolved-horizontal-members-without-independent-downward-bodies'
  );
  assert.throws(
    () => autoMeasure.analyzeInterline(ambiguousSource, { nibPx: 6 }),
    /Ambiguous row structure/
  );

  const supportedSource = makeConnectedBodyRows({
    rowCount: 2,
    pitch: 60,
    bodyHeight: 24,
    stemWidth: 12
  });
  const supported = autoMeasure.analyzeInterline(supportedSource, { nibPx: 6 });
  assert.equal(supported.diagnostics.detectedBandCount, 2);
  assert.equal(supported.diagnostics.linePitchMethod, 'horizontal-track-phase-chains');
  assert.equal(supported.diagnostics.independentBodyEvidenceCount, 2);
  assert.equal(supported.diagnostics.ambiguousTwoBandPair, false);
  assert.equal(supported.rows.length, 2);
  assert.equal(supported.gaps.length, 1);
  closeTo(supported.gaps[0].valuePx, 36, 1);
});

test('two genuine sparse-body rows use connected stem evidence, not body quantiles', () => {
  for (const stemWidth of [3, 6, 12]) {
    for (const copies of [1, 2]) {
      const result = autoMeasure.analyzeInterline(
        makeSparseBodyRows({ stemWidth, copies }),
        { nibPx: 6 }
      );
      assert.equal(result.rows.length, 2);
      assert.equal(result.gaps.length, 1);
      assert.equal(result.diagnostics.twoBandSingleInterval, true);
      assert.equal(result.diagnostics.independentBodyEvidenceCount, 2);
      assert.equal(result.diagnostics.ambiguityReason, null);
      closeTo(result.rows[0].roofTopY, 20, 1);
      closeTo(result.rows[0].bottomY, 44, 1);
      closeTo(result.rows[1].roofTopY, 80, 1);
      closeTo(result.gaps[0].valuePx, 36, 1);
    }
  }
});

test('one connected descender cannot override a roof-only row consensus', () => {
  const source = makeRoofOnlyRowsWithLoneDescender();
  const result = autoMeasure.analyzeInterline(source, { nibPx: 6 });

  assertThreeRowsAndTwoGaps(result, 'roof-only rows with one connected descender');
  assert.equal(result.diagnostics.independentBodyEvidenceCount, 3,
    'body evidence in other rows must not validate an unrelated descender depth');
  assert.equal(result.rows[0].bottomY, 70,
    'the fixture must retain the misleading component bottom that caused the regression');
  closeTo(result.gaps[0].valuePx, 69, 1e-9,
    'the stable roof bottom, not the isolated descender, must define the first clearance');
  assert.equal(result.gaps[0].boundaries.support.boundaryConsensus, 'all-stable-runs');
  assert.equal(result.gaps[0].boundaries.raster.upperInkY, 25,
    'the first upper endpoint must remain on the six-pixel roof');
  closeTo(result.gaps[1].valuePx, 51, 1e-9,
    'the repeated three-pixel stems must continue to define their real body bottom');
  assert.equal(
    result.gaps[1].boundaries.support.boundaryConsensus,
    'repeated-or-majority-body'
  );
});

test('repeated detached roof/seat phases group by line period across offsets and slopes', () => {
  for (const fixture of [
    { bodyOffset: 18, pitch: 38, seatRise: 0 },
    { bodyOffset: 24, pitch: 44, seatRise: 0 },
    { bodyOffset: 32, pitch: 75, seatRise: 0 },
    { bodyOffset: 32, pitch: 80, seatRise: -10 },
    { bodyOffset: 32, pitch: 80, seatRise: 10 },
    { bodyOffset: 40, pitch: 80, seatRise: 0 },
    { bodyOffset: 40, pitch: 80, seatRise: -10 },
    { bodyOffset: 40, pitch: 80, seatRise: 10 }
  ]) {
    const result = autoMeasure.analyzeInterline(
      makeDetachedRoofSeatLayout({ rowCount: 3, ...fixture }),
      { nibPx: 6 }
    );
    assertThreeRowsAndTwoGaps(
      result,
      `detached phases ${JSON.stringify(fixture)}`
    );
    assert.equal(result.diagnostics.linePitchMethod, 'horizontal-track-phase-chains');
    closeTo(result.diagnostics.estimatedLinePitchRasterPx, fixture.pitch, 1);
    result.rows.forEach((row, index) => {
      closeTo(row.roofTopY, 20 + index * fixture.pitch, 1);
    });
  }
});

test('wide long descenders cannot promote a double-period harmonic', () => {
  for (const width of [48, 80]) {
    const result = autoMeasure.analyzeInterline(makeWideDescenderRows(width), { nibPx: 6 });
    assert.equal(result.rows.length, 3);
    assert.equal(result.diagnostics.physicalLineCount, 3);
    assert.equal(result.diagnostics.linePitchMethod, 'horizontal-track-phase-chains');
    closeTo(result.diagnostics.estimatedLinePitchRasterPx, 76, 1);
    assert.ok(
      result.gaps.length >= 1 && result.gaps.length <= 2,
      'an overlapping descender may suppress only its affected clearance'
    );
    assert.ok(
      result.gaps.every(gap => gap.lowerRowIndex - gap.upperRowIndex === 1),
      'remaining measurements must stay between adjacent physical rows'
    );
    closeTo(result.gaps[result.gaps.length - 1].valuePx, 52, 1.5);
  }
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

test('gap ratios retain their measurement-time calibration and source', () => {
  const appSource = readAppFile('app-1.js');
  const helpersStart = appSource.indexOf('function measurementLengthPx(');
  const helpersEnd = appSource.indexOf('\nfunction midpoint(', helpersStart);
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, 'measurement helper block must be present');
  const helperState = {
    formula: {
      nibPx: 10,
      calibration: { id: 'calibration-a', method: 'manual-line' }
    }
  };
  const helperContext = vm.createContext({
    state: helperState,
    distance: (first, second) => Math.hypot(second.x - first.x, second.y - first.y),
    Date,
    Number,
    Object
  });
  vm.runInContext(appSource.slice(helpersStart, helpersEnd), helperContext, { filename: 'app-1-measurement-helpers.js' });

  const manualGap = {
    type: 'gap',
    points: [{ x: 0, y: 0 }, { x: 0, y: 30 }],
    provenance: { origin: 'human' }
  };
  helperContext.captureGapNormalization(manualGap, helperState.formula.nibPx, 'manual-measurement');
  assert.equal(helperContext.gapMeasurementSource(manualGap), 'manual');
  closeTo(helperContext.measurementRatioNib(manualGap), 3);
  helperState.formula.nibPx = 5;
  closeTo(
    helperContext.measurementRatioNib(manualGap),
    3,
    1e-12,
    'manual ratio must remain tied to the captured 10px nib'
  );

  const automaticGap = {
    type: 'gap',
    points: [{ x: 0, y: 0 }, { x: 0, y: 34 }],
    gapDetection: { medianPx: 34, manualCorrected: false },
    autoMeasurement: { valuePx: 34, valueNib: 3.4 },
    provenance: { origin: 'automatic' }
  };
  assert.equal(helperContext.gapMeasurementSource(automaticGap), 'automatic');
  closeTo(helperContext.measurementRatioNib(automaticGap), 3.4);
  automaticGap.gapDetection.manualCorrected = true;
  automaticGap.points[1].y = 20;
  helperContext.captureGapNormalization(automaticGap, helperState.formula.nibPx, 'manual-endpoint-correction');
  assert.equal(helperContext.gapMeasurementSource(automaticGap), 'manual');
  closeTo(helperContext.measurementRatioNib(automaticGap), 4);

  helperState.formula.nibPx = null;
  const uncalibratedGap = {
    type: 'gap',
    points: [{ x: 0, y: 0 }, { x: 0, y: 16 }],
    provenance: { origin: 'human' }
  };
  helperContext.captureGapNormalization(uncalibratedGap, null, 'manual-measurement');
  helperState.formula.nibPx = 8;
  assert.equal(
    helperContext.measurementRatioNib(uncalibratedGap),
    null,
    'a later calibration must not retroactively normalize an uncalibrated measurement'
  );

  manualGap.formulaKey = 'between-lines';
  const freshAutomaticGap = {
    id: 2,
    uid: 'automatic-gap',
    type: 'gap',
    formulaKey: 'between-lines',
    points: [{ x: 10, y: 0 }, { x: 10, y: 34 }],
    gapDetection: { medianPx: 34, manualCorrected: false, confidence: .9 },
    normalization: { nibPxAtMeasurement: 10 },
    autoMeasurement: { valuePx: 34, valueNib: 3.4 },
    provenance: { origin: 'automatic' }
  };
  manualGap.id = 1;
  manualGap.uid = 'manual-gap';
  helperState.objects = [freshAutomaticGap, manualGap];
  helperState.formula.analysis = {};
  helperContext.structuredCloneSafe = value => JSON.parse(JSON.stringify(value));
  const app3Source = readAppFile('app-3.js');
  const summaryStart = app3Source.indexOf('function refreshBetweenLinesSummary(');
  const summaryEnd = app3Source.indexOf('\nfunction clearDraftState(', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'interline summary function must be present');
  vm.runInContext(app3Source.slice(summaryStart, summaryEnd), helperContext, {
    filename: 'app-3-interline-summary.js'
  });
  helperContext.refreshBetweenLinesSummary();
  assert.equal(helperState.formula.analysis.interlineSummaries.manual.count, 1);
  assert.equal(helperState.formula.analysis.interlineSummaries.automatic.count, 1);
  assert.equal(helperState.formula.analysis.interlineSummaries.activeSource, 'manual');
  closeTo(helperState.formula.analysis.manualInterlineMedianNib, 3);
  closeTo(helperState.formula.analysis.autoInterlineMedianNib, 3.4);
  closeTo(helperState.formula.analysis.betweenLinesMedianNib, 3);
  closeTo(helperState.formula.betweenLinesPx, 30);

  helperState.formula.calibration = { id: 'calibration-b', method: 'manual-line' };
  helperState.projectMeta = { id: 'measurement-ratio-test' };
  const app4Source = readAppFile('app-4.js');
  const metricsStart = app4Source.indexOf('function activeNibCalibrationId(');
  const metricsEnd = app4Source.indexOf('\nfunction createStableId(', metricsStart);
  assert.ok(metricsStart >= 0 && metricsEnd > metricsStart, 'measurement metrics function must be present');
  vm.runInContext(app4Source.slice(metricsStart, metricsEnd), helperContext, {
    filename: 'app-4-measurement-metrics.js'
  });
  const persistedMetrics = helperContext.measurementMetrics(manualGap);
  closeTo(persistedMetrics.lengthNib, 3);
  assert.equal(
    persistedMetrics.calibrationId,
    'calibration-a',
    'exported metrics must retain the measurement-time calibration id'
  );
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
  const capturedRatios = gapObjects.map(object => object.autoMeasurement.valueNib);
  for (const [index, object] of gapObjects.entries()) {
    closeTo(object.normalization.nibPxAtMeasurement, state.formula.nibPx, 1e-9);
    closeTo(
      capturedRatios[index],
      object.autoMeasurement.valuePx / object.normalization.nibPxAtMeasurement,
      1e-9,
      'automatic gap ratio must use its captured calibration'
    );
  }
  state.formula.nibPx *= 1.75;
  gapObjects.forEach((object, index) => {
    closeTo(
      object.autoMeasurement.valueNib,
      capturedRatios[index],
      1e-12,
      'later calibration changes must not rewrite an existing gap ratio'
    );
  });
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

test('cancelActiveRun invalidates an in-flight engine result before it can repopulate measurements', async () => {
  const state = makeAppState(makeBetLikeRows());
  const harness = createAppHarness(state);
  const pending = harness.autoMeasure.runInterline();
  const cancellationToken = harness.autoMeasure.cancelActiveRun({ render: false });
  const staleResult = await pending;

  assert.equal(cancellationToken, 2);
  assert.equal(staleResult.stale, true);
  assert.equal(staleResult.applied, undefined);
  assert.equal(state.objects.length, 0, 'a late canceled result may not recreate measurements');
  assert.equal(state.formula.analysis.status, 'idle');
  assert.equal(state.formula.analysis.runToken, cancellationToken);
  assert.equal(state.formula.analysis.runKind, null);
  assert.equal(harness.analysisOverlay.hidden, true);
  assert.equal(harness.calls.snapshots, 0);

  const currentResult = await harness.autoMeasure.runInterline();
  assert.equal(currentResult.stale, undefined);
  assertThreeRowsAndTwoGaps(currentResult, 'run after explicit cancellation');
  assert.equal(state.formula.analysis.runToken, 3);
});

test('photographed vector source links round-trip through stable project identifiers', () => {
  const noop = () => {};
  const element = { addEventListener: noop, showModal: noop, close: noop };
  const persistenceContext = vm.createContext({
    console,
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
    Error,
    TypeError,
    RangeError,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    Int32Array,
    Float64Array,
    structuredClone,
    $: () => element,
    window: { addEventListener: noop },
    renderFormulaUI: noop,
    renderControls: noop,
    resizeCanvas: noop,
    structuredCloneSafe: structuredClone,
    createStableId: () => 'generated-measurement-id',
    defaultCategory: () => 'reference-template',
    defaultName: () => 'measurement',
    isResultLabelVisible: () => false,
    state: { image: null, formula: {} },
    SEMANTIC_CATEGORIES: [],
    BUILTIN_VARIABLES: []
  });
  persistenceContext.globalThis = persistenceContext;
  vm.runInContext(readAppFile('master-system.js'), persistenceContext, { filename: 'master-system.js' });
  persistenceContext.MASTER_SYSTEM = persistenceContext.MEDIDAOT_MASTER_SYSTEM;
  vm.runInContext(readAppFile('letter-vector-engine.js'), persistenceContext, { filename: 'letter-vector-engine.js' });
  vm.runInContext(readAppFile('app-4.js'), persistenceContext, { filename: 'app-4.js' });
  persistenceContext.measurementGeometry = () => ({ type: 'polygon', points: [] });
  persistenceContext.measurementMetrics = () => ({});
  persistenceContext.mergeFormula = formula => structuredClone(formula || {});
  persistenceContext.normalizeQuadPoints = points => points;
  persistenceContext.enforceSemanticStyle = () => {};
  persistenceContext.normalizeLetterTemplateObject = object => {
    if ((+object.letterVector?.schemaVersion || 1) < persistenceContext.MEDIDAOT_VECTOR_ENGINE.vectorSchemaVersion) {
      object.letterVector = persistenceContext.MEDIDAOT_VECTOR_ENGINE.migrateVectorData(object.letterVector);
    }
    return object;
  };

  const schema3Project = {
    format: 'mirror-sofer.measure-stam.project',
    schemaVersion: '3.0.0',
    project: { id: 'schema3-project', title: 'legacy fixture' },
    formula: { nibPx: 8 },
    measurements: [{
      id: 'legacy-vector-object',
      uid: 'legacy-vector-object',
      type: 'letterTemplate',
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 60 }, { x: 0, y: 60 }],
      template: { kind: 'image-region-vector', tradition: 'custom' },
      letterVector: {
        schemaVersion: 1,
        sourceKey: 'photographed-selection', letter: '', tradition: 'custom',
        style: 'photographed-letter', slug: 'photographed-selection',
        viewBox: [0, 0, 40, 60], weight: 1, revision: 1,
        paths: [{ rule: 'evenodd', commands: [
          { type: 'M', x: 5, y: 5 }, { type: 'L', x: 35, y: 5 },
          { type: 'L', x: 35, y: 55 }, { type: 'L', x: 5, y: 55 }, { type: 'Z' }
        ] }]
      }
    }]
  };
  const migratedSchema3 = persistenceContext.migrateProjectData(schema3Project);
  const loadedSchema3 = persistenceContext.prepareLoadedObjects(migratedSchema3.objects).objects[0];
  assert.equal(migratedSchema3.projectMeta.id, 'schema3-project');
  assert.equal(loadedSchema3.type, 'letterTemplate');
  assert.equal(loadedSchema3.letterVector.schemaVersion, 3);
  assert.equal(loadedSchema3.letterVector.migration.fromSchemaVersion, 1);
  assert.equal(loadedSchema3.letterVector.paths[0].commands.length, 5);

  const frame = {
    id: 41,
    uid: 'frame-stable-id',
    type: 'area',
    points: [],
    linkedVectorId: 42
  };
  const vectorObject = {
    id: 42,
    uid: 'vector-stable-id',
    type: 'letterTemplate',
    points: [],
    template: { kind: 'image-region-vector' },
    sourceSelection: { frameId: 41 }
  };
  const stableIdMap = new Map([
    [frame.id, frame.uid],
    [vectorObject.id, vectorObject.uid]
  ]);
  const serializedFrame = persistenceContext.serializeMeasurementV3(frame, stableIdMap);
  const serializedVector = persistenceContext.serializeMeasurementV3(vectorObject, stableIdMap);

  assert.equal(serializedFrame.linkedVectorId, vectorObject.uid);
  assert.equal(serializedFrame.legacy.linkedVectorIdRuntime, vectorObject.id);
  assert.equal(serializedVector.sourceFrameId, frame.uid);
  assert.equal(serializedVector.sourceSelection.frameId, frame.uid);
  assert.equal(serializedVector.legacy.sourceFrameIdRuntime, frame.id);

  persistenceContext.normalizeLoadedObject = object => structuredClone(object);
  const prepared = persistenceContext.prepareLoadedObjects([serializedFrame, serializedVector]);
  const loadedFrame = prepared.objects.find(object => object.uid === frame.uid);
  const loadedVector = prepared.objects.find(object => object.uid === vectorObject.uid);
  assert.equal(loadedFrame.linkedVectorId, loadedVector.id);
  assert.equal(loadedVector.sourceFrameId, loadedFrame.id);
  assert.equal(loadedVector.sourceSelection.frameId, loadedFrame.id);
});

test('HTML, manifests, and service worker reference one complete release asset set', async () => {
  const expectedScripts = [
    'master-system.js',
    'letter-assets.js',
    'letter-vector-engine.js',
    'app-1.js',
    'region-vector.js',
    'letter-tools.js',
    'app-2.js',
    'app-3.js',
    'app-4.js',
    'slant-analyzer.js',
    'professional-tools.js',
    'auto-measure.js',
    'stability-patch.js'
  ].map(filename => `${filename}?v=${TEST_VERSION}`);

  for (const htmlName of ['medidaot.html', 'index.html']) {
    const html = readAppFile(htmlName);
    assert.doesNotMatch(html, /20260731[klm]/);
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

  for (const manifestName of ['manifest.webmanifest', 'manifest-medidaot.webmanifest']) {
    const manifest = JSON.parse(readAppFile(manifestName));
    assert.match(manifest.start_url, new RegExp(`(?:\\?|&)v=${TEST_VERSION}(?:&|$)`));
  }

  assert.match(readAppFile('app-4.js'), /appVersion:\s*'2026\.08\.03a'/);

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

console.log(`\n${passed}/${tests.length} focused Medidaot regression groups passed.`);
if (passed !== tests.length) {
  throw new Error(`${tests.length - passed} regression group(s) failed`);
}
