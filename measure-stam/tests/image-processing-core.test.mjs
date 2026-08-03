import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../image-processing-core.js');

function rgba(width, height, fill = 238) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const p = i * 4;
    data[p] = fill;
    data[p + 1] = fill;
    data[p + 2] = fill;
    data[p + 3] = 255;
  }
  return data;
}

function paintRect(data, width, x0, y0, x1, y1, value = 18) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const p = (y * width + x) * 4;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
    }
  }
}

test('ink mask finds dark glyph regions without expanding them', () => {
  const width = 40;
  const height = 24;
  const data = rgba(width, height);
  paintRect(data, width, 4, 4, 14, 18);
  paintRect(data, width, 24, 7, 34, 20);
  const mask = core.createInkMask(data, width, height);
  const count = mask.binary.reduce((sum, value) => sum + value, 0);
  assert.equal(count, 270);
  assert.equal(mask.binary[0], 0);
  assert.equal(mask.binary[5 * width + 5], 1);
});

test('material rendering reports zero geometry changes', () => {
  const width = 48;
  const height = 32;
  const data = rgba(width, height, 232);
  paintRect(data, width, 6, 7, 41, 16, 26);
  paintRect(data, width, 30, 15, 37, 28, 22);
  const result = core.processImageData({ data }, width, height, core.applyPreset('lacquer'));
  assert.equal(result.metrics.changedGeometryPixels, 0);
  assert.ok(result.metrics.totalInkPixels > 350);
  assert.equal(result.data.length, data.length);
});

test('gloss remains continuous and never creates white speckles', () => {
  const width = 60;
  const height = 36;
  const data = rgba(width, height, 235);
  paintRect(data, width, 8, 8, 52, 28, 20);
  const result = core.processImageData({ data }, width, height, {
    ...core.applyPreset('lacquer'),
    gloss: 0.85,
    depth: 0.6
  });
  let brightestInk = 0;
  for (let i = 0; i < result.mask.length; i += 1) {
    if (!result.mask[i]) continue;
    brightestInk = Math.max(brightestInk, result.data[i * 4]);
  }
  assert.ok(brightestInk < 125, `unexpected white highlight: ${brightestInk}`);
});

test('row angle estimator detects a gently sloped roof', () => {
  const width = 180;
  const height = 90;
  const data = rgba(width, height, 245);
  const slope = Math.tan(3 * Math.PI / 180);
  for (let x = 12; x < width - 12; x += 1) {
    const y = Math.round(36 + slope * (x - width / 2));
    paintRect(data, width, x, y, x + 1, y + 5, 12);
  }
  const angle = core.estimateRowAngle(data, width, height, { maxDegrees: 6, stepDegrees: 0.25 });
  assert.ok(Math.abs(angle - 3) <= 0.5, `expected about 3°, got ${angle}°`);
});
