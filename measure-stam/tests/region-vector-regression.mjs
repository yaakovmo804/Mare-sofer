#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(directory, '..', 'region-vector.js'), 'utf8');
const context = vm.createContext({
  console,
  Uint8Array,
  Uint32Array,
  Int32Array,
  Map,
  Set,
  Math,
  Number,
  Object,
  Array,
  Error,
  TypeError
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'region-vector.js' });
const vectorizer = context.MEDIDAOT_REGION_VECTOR;

function image(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    data[index * 4] = 235;
    data[index * 4 + 1] = 224;
    data[index * 4 + 2] = 198;
    data[index * 4 + 3] = 255;
  }
  return { width, height, data };
}

function fill(sourceImage, left, top, right, bottom, value = 18) {
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * sourceImage.width + x) * 4;
      sourceImage.data[offset] = value;
      sourceImage.data[offset + 1] = value;
      sourceImage.data[offset + 2] = value;
    }
  }
}

const fullSelection = (width, height) => [
  { x: 0, y: 0 }, { x: width, y: 0 },
  { x: width, y: height }, { x: 0, y: height }
];

test('photographed ring keeps its interior hole in one even-odd editable path', () => {
  const sourceImage = image(42, 32);
  fill(sourceImage, 5, 4, 37, 28);
  fill(sourceImage, 13, 10, 29, 22, 235);
  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors: 120 }
  );

  assert.equal(result.vector.paths.length, 1);
  assert.equal(result.vector.paths[0].rule, 'evenodd');
  assert.ok(result.contours.length >= 2, 'outer contour and hole contour must both survive');
  assert.ok(result.vector.handleCounts.anchors >= 8);
  assert.ok(result.vector.handleCounts.anchors <= 120);
  assert.equal(result.vector.viewBox[2], sourceImage.width);
  assert.equal(result.vector.viewBox[3], sourceImage.height);
});

test('two meaningful ink components survive while an isolated grain is removed', () => {
  const sourceImage = image(50, 32);
  fill(sourceImage, 5, 7, 17, 25);
  fill(sourceImage, 30, 5, 44, 26);
  fill(sourceImage, 24, 15, 25, 16);
  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors: 100 }
  );

  assert.equal(result.contours.length, 2);
  assert.equal(result.inkPixelCount, 12 * 18 + 14 * 21);
  assert.equal(result.vector.handleCounts.controls, 0);
});

test('freeform selection excludes dark ink outside its polygon', () => {
  const sourceImage = image(48, 36);
  fill(sourceImage, 4, 8, 18, 28);
  fill(sourceImage, 30, 8, 44, 28);
  const selection = [
    { x: 1, y: 4 }, { x: 23, y: 5 }, { x: 21, y: 31 }, { x: 2, y: 30 }
  ];
  const result = vectorizer.vectorizeImageData(sourceImage, selection, { maximumAnchors: 80 });
  assert.equal(result.contours.length, 1);
  assert.equal(result.inkPixelCount, 14 * 20);
});

test('many disconnected grains obey the hard anchor budget without collapsing to one component', () => {
  const sourceImage = image(180, 180);
  for (let y = 1; y < 178; y += 4) {
    for (let x = 1; x < 178; x += 4) fill(sourceImage, x, y, x + 2, y + 2);
  }
  const maximumAnchors = 80;
  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors }
  );
  assert.ok(result.contours.length > 1, 'several equally meaningful components should survive');
  assert.ok(result.vector.handleCounts.anchors <= maximumAnchors,
    `anchor count ${result.vector.handleCounts.anchors} exceeds ${maximumAnchors}`);
  assert.ok(result.droppedContourCount > 0, 'excess components must be dropped deterministically');
});

test('a meaningful ring keeps its hole when small competing components exceed the budget', () => {
  const sourceImage = image(120, 100);
  fill(sourceImage, 8, 8, 72, 78);
  fill(sourceImage, 25, 24, 55, 61, 235);
  for (let y = 4; y < 96; y += 7) {
    for (let x = 82; x < 116; x += 7) fill(sourceImage, x, y, x + 2, y + 2);
  }
  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors: 32 }
  );
  const signedAreas = result.contours.map(points => points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  assert.ok(signedAreas.some(area => area > 0), 'the ring exterior must survive');
  assert.ok(signedAreas.some(area => area < 0), 'the ring hole must survive');
  assert.ok(result.vector.handleCounts.anchors <= 32);
});

test('dense freeform lassos are bounded and rasterized within a practical time', () => {
  const sourceImage = image(220, 220);
  fill(sourceImage, 55, 38, 165, 182);
  const selection = [];
  for (let index = 0; index < 640; index++) {
    const angle = index / 640 * Math.PI * 2;
    selection.push({
      x: 110 + Math.cos(angle) * 103,
      y: 110 + Math.sin(angle) * 103
    });
  }
  const started = performance.now();
  const result = vectorizer.vectorizeImageData(sourceImage, selection, {
    maximumAnchors: 120,
    maximumSelectionVertices: 128
  });
  const elapsed = performance.now() - started;
  assert.ok(result.selectionVertexCount <= 128);
  assert.ok(result.vector.handleCounts.anchors <= 120);
  assert.ok(elapsed < 3000, `dense lasso tracing took ${elapsed.toFixed(1)}ms`);
});
