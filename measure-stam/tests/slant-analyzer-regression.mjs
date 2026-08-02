#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  IRREGULAR_SLANT_EXPECTATIONS,
  irregularFixtureRoleForRootX,
  irregularSlantRowFixture,
  paddedIrregularSlantFixture
} from './slant-fixtures.mjs';

const require = createRequire(import.meta.url);
const analyzer = require('../slant-analyzer.js');

function grayRaster(width, height, background = 255) {
  return { width, height, format: 'gray', data: new Uint8Array(width * height).fill(background) };
}

function inkPixel(raster, x, y, value = 0) {
  if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) return;
  raster.data[y * raster.width + x] = value;
}

function rectangle(raster, x, y, width, height, value = 0) {
  for (let row = Math.floor(y); row < Math.ceil(y + height); row++) {
    for (let column = Math.floor(x); column < Math.ceil(x + width); column++) {
      inkPixel(raster, column, row, value);
    }
  }
}

function slantedStem(raster, rootX, rootY, tipX, tipY, thickness = 6, value = 0) {
  const start = Math.min(rootY, tipY);
  const end = Math.max(rootY, tipY);
  for (let y = start; y <= end; y++) {
    const t = (y - rootY) / ((tipY - rootY) || 1);
    const centerX = rootX + (tipX - rootX) * t;
    const left = Math.round(centerX - (thickness - 1) / 2);
    for (let x = left; x < left + thickness; x++) inkPixel(raster, x, y, value);
  }
}

function roofAndStem(raster, { roofX, roofY, roofWidth, rootX, tipX, tipY, thickness = 6 }) {
  rectangle(raster, roofX, roofY, roofWidth, thickness);
  slantedStem(raster, rootX, roofY, tipX, tipY, thickness);
}

function syntheticStamRow() {
  const raster = grayRaster(250, 110);
  roofAndStem(raster, { roofX: 12, roofY: 20, roofWidth: 58, rootX: 62, tipX: 70, tipY: 91 });
  roofAndStem(raster, { roofX: 92, roofY: 19, roofWidth: 58, rootX: 99, tipX: 91, tipY: 90 });
  roofAndStem(raster, { roofX: 172, roofY: 21, roofWidth: 60, rootX: 225, tipX: 225, tipY: 92 });

  // Short tagin attached above roofs and isolated short noise below them must
  // not become downward-stem candidates.
  rectangle(raster, 26, 9, 2, 11);
  rectangle(raster, 117, 7, 2, 12);
  rectangle(raster, 205, 11, 2, 10);
  rectangle(raster, 78, 73, 2, 8);
  rectangle(raster, 157, 60, 3, 9);
  inkPixel(raster, 238, 100);
  return raster;
}

function rgbaFromGray(raster) {
  const data = new Uint8ClampedArray(raster.width * raster.height * 4);
  for (let index = 0; index < raster.data.length; index++) {
    const value = raster.data[index];
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { width: raster.width, height: raster.height, data };
}

function assertIrregularFixtureCandidates(result) {
  assert.equal(result.diagnostics.reason, 'ok');
  assert.deepEqual(
    result.candidates.map(candidate => irregularFixtureRoleForRootX(candidate.root.x)),
    IRREGULAR_SLANT_EXPECTATIONS.map(expected => expected.id),
    'the exact candidate set must contain only the three connected full-height thighs'
  );
  assert.equal(result.candidates.length, IRREGULAR_SLANT_EXPECTATIONS.length,
    `expected only the three attached thighs; received ${result.candidates.length}`);
  for (const [index, candidate] of result.candidates.entries()) {
    const expected = IRREGULAR_SLANT_EXPECTATIONS[index];
    assert.ok(Math.abs(candidate.root.x - expected.rootX) <= 6,
      `candidate root ${candidate.root.x} is not the expected attached thigh near x=${expected.rootX}`);
    assert.ok(Math.abs(candidate.tip.x - expected.tipX) <= 7,
      `candidate tip ${candidate.tip.x} is not the expected attached thigh near x=${expected.tipX}`);
    assert.ok(Math.abs(candidate.signedVerticalAngleDeg - expected.angleDeg) <= .4,
      `expected ${expected.angleDeg}°, received ${candidate.signedVerticalAngleDeg}°`);
    assert.equal(candidate.roofSupport.connectedToStem, true);
    assert.equal(candidate.axisFit?.method, 'trimmed-outline-midpoints-linear-v1');
    assert.ok(candidate.axisFit.fittedRowCount < candidate.axisFit.sampledRowCount,
      'terminal and junction rows must be trimmed before fitting the thigh axis');
    const outline = candidate.bodyOutline;
    assert.equal(outline?.method, 'sampled-row-edge-envelope-v1');
    assert.equal(outline.sampleCount, outline.roi.leftEdge.length);
    assert.equal(outline.sampleCount, outline.roi.rightEdge.length);
    assert.ok(outline.sampleCount <= 48);
    for (let row = 0; row < outline.sampleCount; row++) {
      const left = outline.roi.leftEdge[row];
      const right = outline.roi.rightEdge[row];
      assert.equal(left.y, right.y);
      assert.ok(left.x <= right.x);
      if (row) assert.ok(left.y >= outline.roi.leftEdge[row - 1].y);
    }
  }
  assert.ok(result.candidates.every(candidate => Math.abs(candidate.root.x - 184) > 15),
    'the disconnected he leg must not be promoted to a roof-attached thigh');
  assert.ok(result.candidates.every(candidate => candidate.root.x < 330),
    'the nearby short vav must not be promoted to a full-height thigh');
}

test('detects multiple long roof-attached stems and ignores tagin and short noise', () => {
  const raster = syntheticStamRow();
  const result = analyzer.analyze(raster, { x: 0, y: 0, width: raster.width, height: raster.height });
  assert.equal(result.diagnostics.reason, 'ok');
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates.map(candidate => candidate.letterClassification.status), ['pending', 'pending', 'pending']);
  for (const candidate of result.candidates) {
    assert.equal(candidate.letterClassification.letter, null);
    assert.deepEqual(candidate.letterClassification.allowed, ['ד', 'ה', 'ת', 'exclude']);
    assert.ok(candidate.endpoints.root.source.y < candidate.endpoints.tip.source.y);
    assert.deepEqual(candidate.endpoints.topRoot, candidate.endpoints.root);
    assert.deepEqual(candidate.endpoints.bottomTip, candidate.endpoints.tip);
    assert.ok(candidate.roofSupport.found);
    assert.ok(candidate.confidence >= .42);
    assert.ok(candidate.lengthPx > 60);
  }

  const angles = result.candidates.map(candidate => candidate.signedVerticalAngleDeg);
  assert.ok(angles[0] * angles[1] < 0, 'opposite slants retain opposite signs');
  assert.ok(Math.abs(angles[2]) < .5, 'the vertical stem remains near zero');
});

test('returns stable ids and matching ROI/source endpoints for an offset ROI', () => {
  const raster = syntheticStamRow();
  const roi = { x: 5, y: 5, width: 235, height: 98 };
  const first = analyzer.analyze(raster, roi);
  const second = analyzer.analyze(raster, roi);
  assert.deepEqual(second, first);
  assert.equal(first.candidates.length, 3);
  assert.equal(new Set(first.candidates.map(candidate => candidate.id)).size, 3);
  for (const candidate of first.candidates) {
    assert.equal(candidate.root.x, candidate.roiRoot.x + first.roi.x);
    assert.equal(candidate.root.y, candidate.roiRoot.y + first.roi.y);
    assert.equal(candidate.tip.x, candidate.roiTip.x + first.roi.x);
    assert.equal(candidate.tip.y, candidate.roiTip.y + first.roi.y);
    assert.equal(candidate.bounds.source.left, candidate.bounds.roi.left + first.roi.x);
    assert.equal(candidate.bounds.source.top, candidate.bounds.roi.top + first.roi.y);
  }
});

test('accepts a compact binary raster and keeps endpoint-order-independent signed angles', () => {
  const width = 90;
  const height = 80;
  const binary = new Uint8Array(width * height);
  const raster = { width, height, format: 'binary', data: binary };
  rectangle(raster, 10, 12, 58, 5, 1);
  slantedStem(raster, 62, 12, 55, 70, 5, 1);
  const result = analyzer.analyze(raster, null, { minimumStemLengthPx: 30 });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  const forward = analyzer.signedVerticalAngle(candidate.root, candidate.tip);
  const reverse = analyzer.signedVerticalAngle(candidate.tip, candidate.root);
  assert.ok(Math.abs(forward - reverse) < 1e-9);
  assert.ok(Math.abs(forward - candidate.signedVerticalAngleDeg) < 1e-3);
  assert.equal(candidate.signedAngleDeg, candidate.signedVerticalAngleDeg);
  assert.equal(candidate.angleConvention, 'signed-deviation-from-vertical');
});

test('accepts an ImageData-like RGBA raster with the same deterministic geometry', () => {
  const gray = syntheticStamRow();
  const grayResult = analyzer.analyze(gray);
  const rgbaResult = analyzer.analyze(rgbaFromGray(gray));
  assert.equal(rgbaResult.candidates.length, 3);
  assert.deepEqual(
    rgbaResult.candidates.map(candidate => ({
      root: candidate.root,
      tip: candidate.tip,
      angle: candidate.signedVerticalAngleDeg,
      bounds: candidate.bounds
    })),
    grayResult.candidates.map(candidate => ({
      root: candidate.root,
      tip: candidate.tip,
      angle: candidate.signedVerticalAngleDeg,
      bounds: candidate.bounds
    }))
  );
});

test('irregular attached thighs survive page-height ROI while a disconnected he leg and short vav are rejected', () => {
  const tight = analyzer.analyze(irregularSlantRowFixture());
  assertIrregularFixtureCandidates(tight);

  // The same ink is placed unchanged at the top of a page-height scan.
  // Detector scale must not depend on the amount of surrounding page.
  const padded = analyzer.analyze(paddedIrregularSlantFixture());
  assertIrregularFixtureCandidates(padded);
  assert.deepEqual(
    padded.candidates.map(candidate => candidate.id),
    tight.candidates.map(candidate => candidate.id),
    'padding the ROI must not change candidate identity'
  );
});

test('fails safely on invalid, blank, low-contrast and short-noise inputs', () => {
  assert.deepEqual(analyzer.analyze(null).candidates, []);
  assert.equal(analyzer.analyze(null).diagnostics.reason, 'invalid-raster');

  const blank = grayRaster(80, 60);
  const blankResult = analyzer.analyze(blank);
  assert.deepEqual(blankResult.candidates, []);
  assert.equal(blankResult.diagnostics.reason, 'insufficient-contrast');

  const lowContrast = grayRaster(80, 60, 130);
  rectangle(lowContrast, 10, 10, 50, 5, 124);
  rectangle(lowContrast, 52, 10, 5, 42, 124);
  const lowContrastResult = analyzer.analyze(lowContrast);
  assert.deepEqual(lowContrastResult.candidates, []);
  assert.equal(lowContrastResult.diagnostics.reason, 'insufficient-contrast');

  const noise = grayRaster(80, 60);
  rectangle(noise, 8, 15, 50, 5);
  rectangle(noise, 52, 7, 2, 8);
  rectangle(noise, 62, 34, 3, 7);
  const noiseResult = analyzer.analyze(noise);
  assert.deepEqual(noiseResult.candidates, []);
  assert.equal(noiseResult.diagnostics.reason, 'no-candidates');
});
