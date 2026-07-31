#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createCanvas, Path2D, ImageData } = require('@napi-rs/canvas');
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(testDirectory, '..');

function loadContext() {
  const document = {
    createElement(name) {
      if (name === 'canvas') return createCanvas(1, 1);
      return {};
    },
    querySelectorAll() { return []; }
  };
  const context = vm.createContext({
    console,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    RegExp,
    Map,
    WeakMap,
    Set,
    Date,
    TypeError,
    RangeError,
    Error,
    SyntaxError,
    Uint8Array,
    Uint8ClampedArray,
    Int32Array,
    Float32Array,
    Float64Array,
    Path2D,
    ImageData,
    document,
    $: () => null,
    clamp: (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))
  });
  context.globalThis = context;
  for (const filename of ['letter-assets.js', 'letter-vector-engine.js', 'letter-tools.js']) {
    vm.runInContext(
      fs.readFileSync(path.join(appDirectory, filename), 'utf8'),
      context,
      { filename }
    );
  }
  return context;
}

function rectangleMask(width, height, rectangles, holes = []) {
  const alpha = new Uint8ClampedArray(width * height);
  for (const [x, y, rectangleWidth, rectangleHeight] of rectangles) {
    for (let row = y; row < y + rectangleHeight; row += 1) {
      for (let column = x; column < x + rectangleWidth; column += 1) {
        alpha[row * width + column] = 255;
      }
    }
  }
  for (const [x, y, rectangleWidth, rectangleHeight] of holes) {
    for (let row = y; row < y + rectangleHeight; row += 1) {
      for (let column = x; column < x + rectangleWidth; column += 1) {
        alpha[row * width + column] = 0;
      }
    }
  }
  return alpha;
}

function canvasAlphaArea(canvas) {
  const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let area = 0;
  for (let index = 3; index < data.length; index += 4) area += data[index] / 255;
  return area;
}

function canvasAlpha(canvas) {
  const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let index = 0, source = 3; index < alpha.length; index += 1, source += 4) {
    alpha[index] = rgba[source];
  }
  return alpha;
}

function assertTopologyRetained(base, output, width, height, significantArea, direction, key) {
  const baseInk = morphology.maskComponents(base, width, height, true);
  const baseClear = morphology.maskComponents(base, width, height, false);
  const outputInk = morphology.maskComponents(output, width, height, true);
  const outputClear = morphology.maskComponents(output, width, height, false);
  const majorInk = baseInk.components.filter(component => component.area >= significantArea);
  const majorHoles = baseClear.components.filter(component =>
    !component.touchesBorder && component.area >= significantArea
  );
  const inkLabels = new Set();
  for (const component of majorInk) {
    const labelCounts = new Map();
    let retained = 0;
    for (const pixel of component.pixels) {
      if (output[pixel] < 128) continue;
      retained += 1;
      const label = outputInk.labels[pixel];
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }
    const labels = [...labelCounts]
      .filter(([, area]) => area >= significantArea)
      .map(([label]) => label);
    assert.equal(labels.length, 1, `${key} ${direction}: a major ink component split or vanished`);
    assert.ok(retained >= Math.max(3, component.area * .025),
      `${key} ${direction}: a major ink component lost its protected core`);
    inkLabels.add(labels[0]);
  }
  if (direction === 'high') {
    assert.equal(inkLabels.size, majorInk.length, `${key}: dilation merged major ink components`);
  }
  const holeLabels = new Set();
  for (const component of majorHoles) {
    const labelCounts = new Map();
    let retained = 0;
    for (const pixel of component.pixels) {
      if (output[pixel] >= 128) continue;
      retained += 1;
      const label = outputClear.labels[pixel];
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }
    const labels = [...labelCounts]
      .filter(([, area]) => area >= significantArea)
      .map(([label]) => label);
    assert.equal(labels.length, 1, `${key} ${direction}: a counter split or vanished`);
    const label = labels[0];
    assert.equal(outputClear.components[label]?.touchesBorder, false,
      `${key} ${direction}: a counter opened to the exterior`);
    assert.ok(retained >= Math.max(3, component.area * .025),
      `${key} ${direction}: a counter lost its protected core`);
    holeLabels.add(label);
  }
  assert.equal(holeLabels.size, majorHoles.length, `${key}: distinct counters merged`);
  const outputMajorHoles = outputClear.components.filter(component =>
    !component.touchesBorder && component.area >= significantArea
  );
  if (direction === 'high') {
    assert.ok(outputMajorHoles.length <= majorHoles.length, `${key}: dilation created a new counter`);
  }
}

function makeLetterObject(letter, tradition) {
  return {
    id: `${tradition}-${letter}`,
    type: 'letterTemplate',
    points: [
      { x: 0, y: 0 },
      { x: 180, y: 0 },
      { x: 180, y: 180 },
      { x: 0, y: 180 }
    ],
    template: {
      kind: 'letter',
      letter,
      tradition,
      layoutMode: 'source-cell-v2',
      vectorAssetVersion: 2
    },
    letterMode: 'solid',
    letterOpacity: 1,
    letterOutlineWidth: 3,
    letterWeight: 1,
    letterGridVisible: false,
    color: '#000000'
  };
}

const context = loadContext();
const morphology = context.MEDIDAOT_LETTER_MORPHOLOGY;
const engine = context.MEDIDAOT_VECTOR_ENGINE;
const letters = context.MEDIDAOT_LETTERS;

let scheduledFrame = null;
let scheduledDraws = 0;
let scheduledResults = 0;
context.requestAnimationFrame = callback => {
  assert.equal(scheduledFrame, null, 'only one weight frame may be queued');
  scheduledFrame = callback;
  return 17;
};
context.cancelAnimationFrame = () => { scheduledFrame = null; };
context.draw = () => { scheduledDraws += 1; };
context.renderResults = () => { scheduledResults += 1; };
context.scheduleLetterWeightRender();
context.scheduleLetterWeightRender();
context.scheduleLetterWeightRender();
assert.equal(scheduledDraws, 0, 'weight input state may update before its coalesced draw');
const coalescedFrame = scheduledFrame;
scheduledFrame = null;
coalescedFrame();
assert.equal(scheduledDraws, 1, 'three weight inputs in one frame must draw once');
assert.equal(scheduledResults, 1, 'results must update with the coalesced draw');
context.scheduleLetterWeightRender();
context.flushLetterWeightRender();
assert.equal(scheduledDraws, 2, 'pointer-up flush must commit the pending exact draw');
delete context.requestAnimationFrame;
delete context.cancelAnimationFrame;
delete context.draw;
delete context.renderResults;

/* A union of overlapping components must erode only at its exposed boundary. */
const overlap = rectangleMask(80, 60, [
  [8, 12, 46, 28],
  [34, 20, 38, 28]
]);
const overlapSigned = morphology.buildSignedDistance(overlap, 80, 60);
const overlapThin = morphology.renderSignedDistance(overlapSigned, -4);
assert.ok(overlapThin[30 * 80 + 40] > 240, 'union erosion must not cut an overlap seam');

/* Holes remain holes, while the union changes monotonically through the range. */
const ring = rectangleMask(90, 90, [[10, 10, 70, 70]], [[31, 31, 28, 28]]);
const ringSigned = morphology.buildSignedDistance(ring, 90, 90);
const ringLow = morphology.renderSignedDistance(ringSigned, -4);
const ringMaster = morphology.renderSignedDistance(ringSigned, 0);
const ringHigh = morphology.renderSignedDistance(ringSigned, 4);
assert.ok(
  morphology.alphaArea(ringLow) < morphology.alphaArea(ringMaster)
    && morphology.alphaArea(ringMaster) < morphology.alphaArea(ringHigh),
  'union-mask ink area must increase monotonically'
);
assert.equal(ringHigh[45 * 90 + 45], 0, 'a surviving counter must remain transparent');

const outline = morphology.renderSignedDistance(ringSigned, 4, 3);
assert.ok(morphology.alphaArea(outline) > 0, 'outline must be derived from the weighted union');
assert.equal(outline[45 * 90 + 45], 0, 'outline rendering must preserve a counter interior');

const fixedEnvelopeA = morphology.stableEnvelope(
  { left: -12.25, top: -30.5, right: 78.75, bottom: 116.5 },
  18
);
const fixedEnvelopeB = morphology.stableEnvelope(
  { left: -12.25, top: -30.5, right: 78.75, bottom: 116.5 },
  18
);
assert.deepEqual(fixedEnvelopeA, fixedEnvelopeB, 'render envelope must not depend on weight');
assert.ok(fixedEnvelopeA.top < -30.5 && fixedEnvelopeA.bottom > 116.5, 'envelope must retain overshoots');

/* Exercise the real Bézier assets and renderer at the complete 27 + 7 set. */
const metrics = engine.listSourceMetrics();
assert.equal(metrics.length, 34, 'all source glyphs must be covered');
const coldBuildTimes = [];
const effectiveLow = [];
const effectiveHigh = [];
for (const metric of metrics) {
  const tradition = metric.style === 'ari' ? 'ari' : 'beitYosef';
  const object = makeLetterObject(metric.letter, tradition);
  const asset = letters.traditions[tradition][metric.letter];
  const assetBefore = JSON.stringify(asset);
  const started = performance.now();
  const base = context.buildLetterUnionMask(
    object,
    { x: 0, y: 0, width: 180, height: 180 },
    asset,
    1,
    24
  );
  coldBuildTimes.push(performance.now() - started);
  const resizedBase = context.buildLetterUnionMask(
    object,
    { x: 0, y: 0, width: 1440, height: 900 },
    asset,
    8,
    24
  );
  assert.strictEqual(base, resizedBase, `${metric.key}: rect/zoom must reuse canonical geometry`);
  assert.ok(base.masterInkBounds, `${metric.key}: canonical master must contain ink`);

  object.letterWeight = .55;
  const low = context.renderedLetterMask(base, object, { outlinePixels: 0 });
  object.letterWeight = 1.45;
  const high = context.renderedLetterMask(base, object, { outlinePixels: 0 });
  effectiveLow.push(low.weightInfo.effective);
  effectiveHigh.push(high.weightInfo.effective);
  assert.ok(low.weightInfo.effective < .999, `${metric.key}: safe low endpoint must still thin visibly`);
  assert.ok(high.weightInfo.effective > 1.001, `${metric.key}: safe high endpoint must still thicken visibly`);
  assertTopologyRetained(
    base.masterAlpha,
    canvasAlpha(low.canvas),
    base.width,
    base.height,
    base.topology.significantArea,
    'low',
    metric.key
  );
  assertTopologyRetained(
    base.masterAlpha,
    canvasAlpha(high.canvas),
    base.width,
    base.height,
    base.topology.significantArea,
    'high',
    metric.key
  );

  /* Every 1% slider step must remain inside the first safe topology prefix. */
  const topologyFactor = Math.max(1, Math.round(base.pixelsPerNib / 8));
  const topologyProxy = morphology.downsampleAlpha(
    base.masterAlpha, base.width, base.height, topologyFactor
  );
  const topologySigned = morphology.buildSignedDistance(
    topologyProxy.alpha, topologyProxy.width, topologyProxy.height
  );
  const topologyAnalyzer = morphology.createTopologySafetyAnalyzer(
    topologyProxy.alpha,
    topologySigned,
    topologyProxy.width,
    topologyProxy.height
  );
  const topologyMaximumOffset = .45 * 8 / 2;
  const topologyLimits = morphology.topologyLimits(
    topologyProxy.alpha,
    topologySigned,
    topologyProxy.width,
    topologyProxy.height,
    topologyMaximumOffset
  );
  const stepAreas = [];
  for (let intensity = -100; intensity <= 100; intensity += 1) {
    const requestedOffset = intensity / 100 * topologyMaximumOffset;
    const appliedOffset = requestedOffset < 0
      ? -Math.min(-requestedOffset, topologyLimits.erosion)
      : Math.min(requestedOffset, topologyLimits.dilation);
    const stepAlpha = morphology.renderSignedDistance(topologySigned, appliedOffset);
    stepAreas.push(morphology.alphaArea(stepAlpha));
    assert.equal(topologyAnalyzer.safeAt(appliedOffset), true,
      `${metric.key} intensity ${intensity} left the first safe topology prefix`);
  }
  for (let index = 1; index < stepAreas.length; index += 1) {
    assert.ok(stepAreas[index] + .01 >= stepAreas[index - 1],
      `${metric.key}: ink area regressed between intermediate intensity steps`);
  }

  if (metric.style === 'beit-yosef' && metric.letter === 'ד') {
    for (let intensity = -100; intensity <= 100; intensity += 1) {
      const weight = 1 + intensity / 100 * .45;
      const resolved = context.resolveLetterWeightOffset(base, weight);
      const fullAlpha = morphology.renderSignedDistance(base.signed, resolved.appliedOffset);
      assertTopologyRetained(
        base.masterAlpha,
        fullAlpha,
        base.width,
        base.height,
        base.topology.significantArea,
        intensity <= 0 ? 'low' : 'high',
        `beit-yosef:ד full-resolution intensity ${intensity}`
      );
      if (intensity === -65) {
        assert.equal(resolved.capped, true,
          'BY Dalet -65 must be capped before its narrow unsafe topology band');
      }
    }
  }

  const areas = [];
  const bounds = [];
  for (const weight of [.55, 1, 1.45]) {
    object.letterWeight = weight;
    const canvas = createCanvas(520, 520);
    context.drawLetterTemplateShape(
      canvas.getContext('2d'),
      object,
      { x: 170, y: 170, width: 180, height: 180 },
      1
    );
    areas.push(canvasAlphaArea(canvas));
    bounds.push(morphology.alphaBounds(canvasAlpha(canvas), 520, 520, 8));
  }
  assert.ok(
    areas[0] < areas[1] && areas[1] < areas[2],
    `${metric.key} intensity must change ink area monotonically; received ${areas.join(', ')}`
  );
  for (const bound of bounds.slice(1)) {
    assert.ok(Math.abs(bound.left - bounds[0].left) <= 2 && Math.abs(bound.top - bounds[0].top) <= 2
      && Math.abs(bound.right - bounds[0].right) <= 2 && Math.abs(bound.bottom - bounds[0].bottom) <= 2,
    `${metric.key}: normalized exterior bbox must stay fixed`);
  }
  assert.equal(JSON.stringify(asset), assetBefore, `${metric.key} source asset must remain immutable`);
}

/* K48 export has three stricter cross-resolution limits than K24. */
for (const [letter, weight, expectedMaximumIntensity] of [
  ['ה', 1.45, 97],
  ['מ', .55, 60],
  ['ק', .55, 60]
]) {
  const object = makeLetterObject(letter, 'beitYosef');
  object.letterWeight = weight;
  const asset = letters.traditions.beitYosef[letter];
  const base = context.buildLetterUnionMask(
    object, { x: 0, y: 0, width: 180, height: 180 }, asset, 1, 48
  );
  const resolved = context.resolveLetterWeightOffset(base, weight);
  const effectiveIntensity = Math.round(Math.abs((resolved.effective - 1) / .45 * 100));
  assert.ok(effectiveIntensity <= expectedMaximumIntensity,
    `${letter} K48 must use its stricter cross-resolution cap`);
  const alpha = morphology.renderSignedDistance(base.signed, resolved.appliedOffset);
  assertTopologyRetained(
    base.masterAlpha,
    alpha,
    base.width,
    base.height,
    base.topology.significantArea,
    weight < 1 ? 'low' : 'high',
    `beit-yosef:${letter} K48 endpoint`
  );
}

/* Materialized masters must be checked against the actual K48 export mask. */
for (const [letter, weight, direction, expectedMaximumIntensity] of [
  ['ה', 1.45, 'high', 97],
  ['ק', .55, 'low', 60]
]) {
  const object = makeLetterObject(letter, 'beitYosef');
  engine.materializeObjectVector(object, { asset: letters.traditions.beitYosef[letter] });
  object.letterWeight = weight;
  object.letterVector.weight = weight;
  const asset = letters.traditions.beitYosef[letter];
  context.drawLetterTemplateForExport(createCanvas(240, 240).getContext('2d'), object);
  const base = context.buildLetterUnionMask(
    object, { x: 0, y: 0, width: 180, height: 180 }, asset, 1, 48
  );
  const resolved = context.resolveLetterWeightOffset(base, weight);
  const effectiveIntensity = Math.round(Math.abs((resolved.effective - 1) / .45 * 100));
  assert.equal(resolved.exactValidated, true,
    `${letter} materialized K48 offset must receive exact-current validation`);
  assert.ok(effectiveIntensity <= expectedMaximumIntensity,
    `${letter} materialized K48 must back off before its unsafe output`);
  assert.equal(base.exactTopologyAnalyzer, null,
    `${letter} materialized K48 analyzer must be transient after validation`);
  const alpha = morphology.renderSignedDistance(base.signed, resolved.appliedOffset);
  assertTopologyRetained(
    base.masterAlpha,
    alpha,
    base.width,
    base.height,
    base.topology.significantArea,
    direction,
    `beit-yosef:${letter} materialized K48 endpoint`
  );
}

/* Cold slider input builds K8; commit alone builds and validates K24. */
const sliderObject = makeLetterObject('ד', 'beitYosef');
engine.materializeObjectVector(sliderObject, { asset: letters.traditions.beitYosef['ד'] });
const sliderCanvas = createCanvas(520, 520);
const drawSliderObject = () => context.drawLetterTemplateShape(
  sliderCanvas.getContext('2d'),
  sliderObject,
  { x: 170, y: 170, width: 180, height: 180 },
  1
);
context.sliderPreviewObject = sliderObject;
vm.runInContext('letterWeightPreviewId = sliderPreviewObject.id', context);
sliderObject.letterWeight = .55;
const sliderColdStart = performance.now();
drawSliderObject();
const sliderColdDuration = performance.now() - sliderColdStart;
assert.ok(sliderColdDuration < 100,
  `cold materialized slider input took ${sliderColdDuration.toFixed(1)}ms`);
const sliderPreviewTimes = [];
for (let intensity = -100; intensity <= 100; intensity += 2) {
  sliderObject.letterWeight = 1 + intensity / 100 * .45;
  const started = performance.now();
  drawSliderObject();
  sliderPreviewTimes.push(performance.now() - started);
}
const sliderPreviewBase = context.buildLetterUnionMask(
  sliderObject,
  { x: 0, y: 0, width: 180, height: 180 },
  letters.traditions.beitYosef['ד'],
  1,
  8
);
assert.equal(sliderPreviewBase.pixelsPerNib, 8,
  'materialized slider input must use the canonical K8 preview base');
assert.equal(sliderPreviewBase.exactTopologyAnalyzer, null,
  'slider input previews must not create a full-resolution topology analyzer per frame');
sliderPreviewTimes.sort((a, b) => a - b);
const sliderPreviewP95 = sliderPreviewTimes[Math.floor((sliderPreviewTimes.length - 1) * .95)];
assert.ok(sliderPreviewP95 < 100,
  `materialized slider preview p95 took ${sliderPreviewP95.toFixed(1)}ms`);
sliderObject.letterWeight = 1 - .65 * .45;
vm.runInContext('letterWeightPreviewId = null', context);
const sliderCommitStart = performance.now();
drawSliderObject();
const sliderCommitDuration = performance.now() - sliderCommitStart;
const sliderBase = context.buildLetterUnionMask(
  sliderObject,
  { x: 0, y: 0, width: 180, height: 180 },
  letters.traditions.beitYosef['ד'],
  1,
  24
);
const sliderCommit = context.renderedLetterMask(
  sliderBase, sliderObject, { outlinePixels: 0 }
).weightInfo;
assert.equal(sliderCommit.exactValidated, true,
  'slider commit must run exact K24 topology validation');
assert.equal(sliderCommit.capped, true,
  'slider commit must cap Dalet before the known -65 unsafe band');
assert.equal(sliderBase.exactTopologyAnalyzer.safeAt(sliderCommit.appliedOffset), true,
  'slider commit must resolve to a topology-safe K24 output');
assert.equal(sliderBase.exactTopologyOffsets.size, 1,
  'one committed intensity must cache one exact-current resolution');
context.renderedLetterMask(sliderBase, sliderObject, { outlinePixels: 0 });
assert.equal(sliderBase.exactTopologyOffsets.size, 1,
  'redrawing a committed intensity must reuse its exact resolution');
assert.ok(sliderCommitDuration < 500,
  `materialized slider exact commit took ${sliderCommitDuration.toFixed(1)}ms`);
delete context.sliderPreviewObject;

const sortedCold = [...coldBuildTimes].sort((a, b) => a - b);
const coldP95 = sortedCold[Math.floor((sortedCold.length - 1) * .95)];
const sortedLow = [...effectiveLow].sort((a, b) => a - b);
const sortedHigh = [...effectiveHigh].sort((a, b) => a - b);
const effectiveLowMedian = sortedLow[Math.floor(sortedLow.length / 2)];
const effectiveHighMedian = sortedHigh[Math.floor(sortedHigh.length / 2)];
assert.ok(coldP95 < 250, `canonical cold-build p95 must stay interactive; received ${coldP95.toFixed(1)}ms`);
const warmObject = makeLetterObject('ש', 'beitYosef');
const warmAsset = letters.traditions.beitYosef['ש'];
const warmBase = context.buildLetterUnionMask(warmObject, { x: 0, y: 0, width: 180, height: 180 }, warmAsset, 1, 24);
const warmStart = performance.now();
for (let iteration = 0; iteration < 250; iteration += 1) {
  assert.strictEqual(
    context.buildLetterUnionMask(
      warmObject,
      { x: 0, y: 0, width: 180 + iteration * 3, height: 180 + iteration },
      warmAsset,
      1 + iteration / 50,
      24
    ),
    warmBase
  );
}
const warmDuration = performance.now() - warmStart;
assert.ok(warmDuration < 250, `250 resize/zoom cache hits took ${warmDuration.toFixed(1)}ms`);
const cappedObject = makeLetterObject('א', 'beitYosef');
const cappedBase = context.buildLetterUnionMask(
  cappedObject,
  { x: 0, y: 0, width: 180, height: 180 },
  letters.traditions.beitYosef['א'],
  1,
  24
);
cappedObject.letterWeight = .55;
context.renderedLetterMask(cappedBase, cappedObject, { outlinePixels: 0 });
cappedObject.letterWeight = .6;
const cappedAgain = context.renderedLetterMask(cappedBase, cappedObject, { outlinePixels: 0 });
assert.equal(cappedAgain.weightInfo.requested, .6,
  'a shared capped canvas must still report the current requested intensity');
warmObject.letterWeight = .55;
const retinaCanvas = createCanvas(1024, 768);
const retinaContext = retinaCanvas.getContext('2d');
retinaContext.setTransform(2, 0, 0, 2, 0, 0);
context.drawLetterTemplateShape(
  retinaContext,
  warmObject,
  { x: 120, y: 80, width: 180, height: 180 },
  1
);
const retinaStart = performance.now();
for (let iteration = 0; iteration < 120; iteration += 1) {
  context.drawLetterTemplateShape(
    retinaContext,
    warmObject,
    { x: 80 + iteration / 4, y: 60, width: 150 + iteration, height: 160 + iteration / 2 },
    .7 + iteration / 100,
    {}
  );
}
const retinaDuration = performance.now() - retinaStart;
assert.ok(retinaDuration < 500, `120 Retina resize/zoom draws took ${retinaDuration.toFixed(1)}ms`);
const derivedObject = makeLetterObject('ל', 'beitYosef');
const derivedBase = context.buildLetterUnionMask(
  derivedObject,
  { x: 0, y: 0, width: 180, height: 180 },
  letters.traditions.beitYosef['ל'],
  1,
  24
);
const derivedTimes = [];
for (let intensity = -100; intensity <= 100; intensity += 2) {
  derivedObject.letterWeight = 1 + intensity / 100 * .45;
  const started = performance.now();
  context.renderedLetterMask(derivedBase, derivedObject, { outlinePixels: 0 });
  derivedTimes.push(performance.now() - started);
}
derivedTimes.sort((a, b) => a - b);
const derivedP95 = derivedTimes[Math.floor((derivedTimes.length - 1) * .95)];
assert.ok(derivedP95 < 100, `new K24 Lamed mask p95 took ${derivedP95.toFixed(1)}ms`);

/* Materialized anchor geometry also remains byte-for-byte unchanged by weight rendering. */
const editable = makeLetterObject('ש', 'beitYosef');
engine.materializeObjectVector(editable, { asset: letters.traditions.beitYosef['ש'] });
const editablePathsBefore = JSON.stringify(editable.letterVector.paths);
editable.letterWeight = .55;
context.state = {
  selectedId: editable.id,
  dragging: { type: 'letterVectorHandle', id: editable.id }
};
const editPreviewCanvas = createCanvas(520, 520);
const editPreviewStart = performance.now();
for (let iteration = 0; iteration < 60; iteration += 1) {
  context.drawLetterTemplateShape(
    editPreviewCanvas.getContext('2d'),
    editable,
    { x: 170, y: 170, width: 180, height: 180 },
    1
  );
}
const editPreviewDuration = performance.now() - editPreviewStart;
assert.ok(editPreviewDuration < 250, `60 active anchor previews took ${editPreviewDuration.toFixed(1)}ms`);
delete context.state;
editable.letterWeight = .55;
editable.letterVector.weight = .55;
const anchorReleaseCanvas = createCanvas(520, 520);
const anchorReleaseStart = performance.now();
context.drawLetterTemplateShape(
  anchorReleaseCanvas.getContext('2d'),
  editable,
  { x: 170, y: 170, width: 180, height: 180 },
  1
);
const anchorReleaseDuration = performance.now() - anchorReleaseStart;
assert.ok(anchorReleaseDuration < 500,
  `materialized K24 rebuild after anchor release took ${anchorReleaseDuration.toFixed(1)}ms`);
editable.letterWeight = 1.45;
editable.letterVector.weight = 1.45;
context.drawLetterTemplateShape(
  createCanvas(520, 520).getContext('2d'),
  editable,
  { x: 170, y: 170, width: 180, height: 180 },
  1
);
assert.equal(
  JSON.stringify(editable.letterVector.paths),
  editablePathsBefore,
  'morphology must never rewrite the editable Bézier master'
);

/* Export uses the same renderer at K48; its explicit high-quality path is deterministic. */
const exportObject = makeLetterObject('פ', 'beitYosef');
exportObject.letterWeight = 1.45;
exportObject.points = [
  { x: 100, y: 100 },
  { x: 280, y: 100 },
  { x: 280, y: 280 },
  { x: 100, y: 280 }
];
const screenCanvas = createCanvas(400, 400);
context.drawLetterTemplateShape(
  screenCanvas.getContext('2d'),
  exportObject,
  { x: 100, y: 100, width: 180, height: 180 },
  1
);
const exportReadout = { value: '', textContent: '' };
const originalDollar = context.$;
context.$ = id => id === 'letterWeightValue' ? exportReadout : null;
context.state = { selectedId: exportObject.id };
const diagnosticSentinel = {
  requested: .731,
  effective: .719,
  capped: true,
  marker: 'screen-only'
};
context.updateLetterWeightReadout(exportObject, diagnosticSentinel);
const readoutBeforeExport = { ...exportReadout };
context.exportDiagnosticObject = exportObject;
const highQualityScreenCanvas = createCanvas(400, 400);
context.drawLetterTemplateShape(
  highQualityScreenCanvas.getContext('2d'),
  exportObject,
  { x: 100, y: 100, width: 180, height: 180 },
  1,
  { exportQuality: true }
);
const exportCanvas = createCanvas(400, 400);
context.drawLetterTemplateForExport(exportCanvas.getContext('2d'), exportObject);
const diagnosticAfterExport = vm.runInContext(
  'LETTER_WEIGHT_DIAGNOSTICS.get(exportDiagnosticObject)',
  context
);
assert.strictEqual(diagnosticAfterExport, diagnosticSentinel,
  'K48 export must not replace the selected object screen diagnostics');
assert.deepEqual(exportReadout, readoutBeforeExport,
  'K48 export must not mutate the selected object weight readout');
delete context.exportDiagnosticObject;
delete context.state;
context.$ = originalDollar;
assert.deepEqual(
  exportCanvas.getContext('2d').getImageData(0, 0, 400, 400).data,
  highQualityScreenCanvas.getContext('2d').getImageData(0, 0, 400, 400).data,
  'PNG export must deterministically use the high-quality weighted union mask'
);
const screenArea = canvasAlphaArea(screenCanvas);
const exportArea = canvasAlphaArea(exportCanvas);
assert.ok(Math.abs(screenArea - exportArea) / exportArea < .04,
  'K24 screen preview and K48 export must preserve the same visual weight');

const opacityObject = makeLetterObject('ש', 'beitYosef');
opacityObject.letterWeight = 1.45;
opacityObject.letterOpacity = .5;
const opacityCanvas = createCanvas(400, 400);
context.drawLetterTemplateShape(
  opacityCanvas.getContext('2d'),
  opacityObject,
  { x: 100, y: 100, width: 180, height: 180 },
  1
);
const opacityPixels = opacityCanvas.getContext('2d').getImageData(0, 0, 400, 400).data;
let maximumAlpha = 0;
for (let index = 3; index < opacityPixels.length; index += 4) {
  maximumAlpha = Math.max(maximumAlpha, opacityPixels[index]);
}
assert.ok(maximumAlpha >= 126 && maximumAlpha <= 128, 'opacity must be applied once after unioning paths');

/* Drawing a thinned letter over an opaque background must never erase it. */
const protectedCanvas = createCanvas(320, 320);
const protectedContext = protectedCanvas.getContext('2d');
protectedContext.fillStyle = '#d11b1b';
protectedContext.fillRect(0, 0, 320, 320);
const protectedObject = makeLetterObject('ס', 'beitYosef');
protectedObject.letterWeight = .55;
context.drawLetterTemplateShape(
  protectedContext,
  protectedObject,
  { x: 70, y: 70, width: 180, height: 180 },
  1
);
const protectedPixel = protectedContext.getImageData(76, 76, 1, 1).data;
assert.equal(protectedPixel[3], 255, 'isolated morphology must not reduce background alpha');

console.log('✓ anisotropic union-mask morphology has no overlap seam and preserves counters');
console.log(`✓ 34/34 glyphs retain major anatomy in a fixed bbox (cold p95 ${coldP95.toFixed(1)}ms)`);
console.log(`✓ topology-safe endpoint medians: ${Math.round(effectiveLowMedian * 100)} / ${Math.round(effectiveHighMedian * 100)} internal weight`);
console.log(`✓ canonical cache reuses geometry across 250 resize/zoom frames in ${warmDuration.toFixed(1)}ms`);
console.log(`✓ 120 Retina draws ${retinaDuration.toFixed(1)}ms; 60 active anchor previews ${editPreviewDuration.toFixed(1)}ms`);
console.log(`✓ materialized K24 anchor-release rebuild ${anchorReleaseDuration.toFixed(1)}ms; K48 current outputs validated exactly`);
console.log(`✓ cold K8 slider ${sliderColdDuration.toFixed(1)}ms; preview p95 ${sliderPreviewP95.toFixed(1)}ms; exact commit ${sliderCommitDuration.toFixed(1)}ms`);
console.log(`✓ new K24 Lamed derived-mask p95 ${derivedP95.toFixed(1)}ms; slider draws coalesce per frame`);
console.log('✓ K24 screen/K48 export share the renderer; editable paths and background stay intact');
