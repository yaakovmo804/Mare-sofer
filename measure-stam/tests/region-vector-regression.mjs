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

function paintSupersampled(sourceImage, predicate, samplesPerAxis = 4) {
  const background = { r: 235, g: 224, b: 198 };
  const ink = 18;
  const sampleCount = samplesPerAxis * samplesPerAxis;
  for (let y = 0; y < sourceImage.height; y++) {
    for (let x = 0; x < sourceImage.width; x++) {
      let covered = 0;
      for (let sy = 0; sy < samplesPerAxis; sy++) {
        for (let sx = 0; sx < samplesPerAxis; sx++) {
          if (predicate(
            x + (sx + .5) / samplesPerAxis,
            y + (sy + .5) / samplesPerAxis
          )) covered++;
        }
      }
      const coverage = covered / sampleCount;
      const offset = (y * sourceImage.width + x) * 4;
      sourceImage.data[offset] = Math.round(background.r * (1 - coverage) + ink * coverage);
      sourceImage.data[offset + 1] = Math.round(background.g * (1 - coverage) + ink * coverage);
      sourceImage.data[offset + 2] = Math.round(background.b * (1 - coverage) + ink * coverage);
    }
  }
}

function cubicPoint(start, command, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * start.x + 3 * u * u * t * command.x1 +
      3 * u * t * t * command.x2 + t ** 3 * command.x,
    y: u ** 3 * start.y + 3 * u * u * t * command.y1 +
      3 * u * t * t * command.y2 + t ** 3 * command.y
  };
}

function sampleVectorContours(vector, stepsPerSegment = 16) {
  const contours = [];
  for (const entry of vector.paths) {
    let points = null;
    let current = null;
    let start = null;
    for (const command of entry.commands) {
      if (command.type === 'M') {
        points = [{ x: command.x, y: command.y }];
        contours.push(points);
        current = { x: command.x, y: command.y };
        start = { ...current };
      } else if (command.type === 'L' && points) {
        for (let step = 1; step <= stepsPerSegment; step++) {
          const ratio = step / stepsPerSegment;
          points.push({
            x: current.x + (command.x - current.x) * ratio,
            y: current.y + (command.y - current.y) * ratio
          });
        }
        current = { x: command.x, y: command.y };
      } else if (command.type === 'C' && points) {
        for (let step = 1; step <= stepsPerSegment; step++) {
          points.push(cubicPoint(current, command, step / stepsPerSegment));
        }
        current = { x: command.x, y: command.y };
      } else if (command.type === 'Z' && points && current && start) {
        for (let step = 1; step <= stepsPerSegment; step++) {
          const ratio = step / stepsPerSegment;
          points.push({
            x: current.x + (start.x - current.x) * ratio,
            y: current.y + (start.y - current.y) * ratio
          });
        }
        current = start;
      }
    }
  }
  return contours;
}

function percentile(values, ratio) {
  const ordered = values.slice().sort((first, second) => first - second);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
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
  const vectorAreas = sampleVectorContours(result.vector, 12).map(points => points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  assert.ok(vectorAreas.some(area => area > 0), 'the cubic output must retain an exterior contour');
  assert.ok(vectorAreas.some(area => area < 0), 'the cubic output must retain the counter as a hole');
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
  assert.ok(result.vector.handleCounts.controls > 0, 'retained contours should expose smooth cubic controls');
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

test('anti-aliased curved ink becomes a clean cubic contour within the hard anchor budget', () => {
  const sourceImage = image(120, 120);
  const center = { x: 60, y: 60 };
  const radius = 34;
  paintSupersampled(sourceImage, (x, y) => (
    (x - center.x) ** 2 + (y - center.y) ** 2 <= radius ** 2
  ));

  const maximumAnchors = 80;
  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors }
  );
  const commands = result.vector.paths[0].commands;
  const cubicCount = commands.filter(command => command.type === 'C').length;
  assert.ok(cubicCount >= 8, 'a curved photographed edge must not remain a staircase-only M/L path');
  assert.equal(result.vector.handleCounts.controls, cubicCount * 2);
  assert.ok(result.vector.handleCounts.anchors <= maximumAnchors);

  const sampled = sampleVectorContours(result.vector, 20).flat();
  const radialErrors = sampled.map(point => Math.abs(
    Math.hypot(point.x - center.x, point.y - center.y) - radius
  ));
  assert.ok(percentile(radialErrors, .95) < 1, '95% of the cubic boundary should stay within one source pixel');
  assert.ok(Math.max(...radialErrors) < 1.35, 'the fitted curve must not overshoot the photographed edge');
});

test('a roofless curved component receives deterministic contour extrema and a principal axis fallback', () => {
  const sourceImage = image(96, 128);
  const center = { x: 48, y: 64 };
  const radius = { x: 22, y: 42 };
  paintSupersampled(sourceImage, (x, y) => (
    ((x - center.x) / radius.x) ** 2 + ((y - center.y) / radius.y) ** 2 <= 1
  ));

  const maximumAnchors = 64;
  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors }
  );
  const fallback = result.vector.features.filter(feature => feature.fallback === true);
  const extrema = fallback.filter(feature => feature.type === 'contour-extremum');
  const axis = fallback.find(feature => feature.type === 'component-axis');

  assert.ok(fallback.length >= 5, 'structural mode must not be empty when roof/stem detection is inapplicable');
  assert.deepEqual(new Set(extrema.map(feature => feature.role)), new Set(['left', 'right', 'top', 'bottom']));
  assert.ok(axis, 'the component must expose a measured principal axis');
  assert.ok(axis.root.y < axis.tip.y, 'the elongated component axis should run from its upper to lower extent');
  assert.ok(Math.abs(axis.root.x - center.x) <= 1.5);
  assert.ok(Math.abs(axis.tip.x - center.x) <= 1.5);
  assert.ok(result.vector.handleCounts.anchors <= maximumAnchors, 'semantic fallback must not spend the contour anchor budget');
});

test('a supersampled diagonal stroke is simplified without Manhattan zigzags', () => {
  const sourceImage = image(180, 130);
  const center = { x: 90, y: 65 };
  const halfLength = 55;
  const halfWidth = 10;
  const angle = 23 * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const localCoordinates = (x, y) => {
    const dx = x - center.x;
    const dy = y - center.y;
    return {
      u: dx * cosine + dy * sine,
      v: -dx * sine + dy * cosine
    };
  };
  paintSupersampled(sourceImage, (x, y) => {
    const { u, v } = localCoordinates(x, y);
    return Math.abs(u) <= halfLength && Math.abs(v) <= halfWidth;
  });

  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors: 64 }
  );
  assert.ok(result.vector.handleCounts.anchors <= 12,
    `diagonal edge retained ${result.vector.handleCounts.anchors} anchors instead of a clean fitted outline`);
  assert.ok(result.vector.paths[0].commands.some(command => command.type === 'C'));
  const boundaryErrors = sampleVectorContours(result.vector, 20).flat().map(point => {
    const { u, v } = localCoordinates(point.x, point.y);
    const outsideU = Math.max(0, Math.abs(u) - halfLength);
    const outsideV = Math.max(0, Math.abs(v) - halfWidth);
    if (outsideU || outsideV) return Math.hypot(outsideU, outsideV);
    return Math.min(halfLength - Math.abs(u), halfWidth - Math.abs(v));
  });
  assert.ok(percentile(boundaryErrors, .95) < 1.5);
  assert.ok(Math.max(...boundaryErrors) < 2.25);
});

test('roof and stem semantics persist exact roof endpoints, axis and junction in vector-local coordinates', () => {
  const sourceImage = image(120, 120);
  fill(sourceImage, 18, 18, 104, 32);
  fill(sourceImage, 68, 18, 82, 105);

  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors: 100 }
  );
  const endpoints = result.vector.features.filter(feature => feature.type === 'roof-endpoint');
  const stems = result.vector.features.filter(feature => feature.type === 'stem-axis');
  const junctions = result.vector.features.filter(feature => feature.type === 'roof-stem-junction');
  assert.equal(endpoints.length, 2);
  assert.equal(stems.length, 1);
  assert.equal(junctions.length, 1);
  assert.ok(Math.abs(endpoints[0].point.x - 18) <= .01);
  assert.ok(Math.abs(endpoints[1].point.x - 104) <= .01);
  assert.ok(Math.abs(stems[0].root.x - 75) <= .5);
  assert.ok(Math.abs(stems[0].root.y - 32) <= .01);
  assert.ok(stems[0].tip.y > 100);
  assert.ok(Math.abs(stems[0].angleDeg) < .1);
  assert.ok(stems[0].confidence > .8);
  assert.equal(junctions[0].point.x, stems[0].root.x);
  assert.equal(junctions[0].point.y, stems[0].root.y);
  assert.equal(result.vector.featureCoordinateSpace, 'vector-local');
  assert.equal(result.vector.featureAngleConvention, 'signed-clockwise-from-vertical');
  assert.equal(result.vector.trace.featureCount, 4);
  assert.equal(result.vector.trace.stemCount, 1);
  assert.equal(JSON.stringify(result.vector.features), JSON.stringify(result.features));
});

test('each distinct stem below one roof receives its own axis and junction', () => {
  const sourceImage = image(120, 120);
  fill(sourceImage, 18, 18, 104, 32);
  fill(sourceImage, 24, 18, 36, 105);
  fill(sourceImage, 86, 18, 98, 105);
  const result = vectorizer.vectorizeImageData(
    sourceImage,
    fullSelection(sourceImage.width, sourceImage.height),
    { maximumAnchors: 100 }
  );
  const stems = result.vector.features.filter(feature => feature.type === 'stem-axis');
  const junctions = result.vector.features.filter(feature => feature.type === 'roof-stem-junction');
  assert.equal(stems.length, 2);
  assert.equal(junctions.length, 2);
  assert.deepEqual(Array.from(stems, feature => feature.root.x), [30, 92]);
  assert.deepEqual(Array.from(junctions, feature => feature.point.x), [30, 92]);
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
