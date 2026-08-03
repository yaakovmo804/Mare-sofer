import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../image-core.js');

function makeImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 238;
    data[i + 1] = 232;
    data[i + 2] = 220;
    data[i + 3] = 255;
  }
  for (let y = 3; y < height - 3; y += 1) {
    for (let x = 5; x < width - 5; x += 1) {
      const p = (y * width + x) * 4;
      data[p] = 18;
      data[p + 1] = 17;
      data[p + 2] = 16;
    }
  }
  return data;
}

test('processing preserves declared geometry', () => {
  const width = 30;
  const height = 18;
  const source = makeImage(width, height);
  const before = core.createInkMask(source, width, height).binary;
  const result = core.processImageData(source, width, height, core.applyPreset('lacquer'));

  assert.equal(result.metrics.changedGeometryPixels, 0);
  assert.deepEqual(Array.from(result.mask), Array.from(before));
  assert.equal(result.data.length, source.length);
});

test('presets expose all material controls', () => {
  const required = ['sharpness', 'denoise', 'blackness', 'uniformity', 'gloss', 'depth', 'warmth', 'parchmentTexture', 'parchmentBrightness'];
  for (const name of ['faithful', 'liveInk', 'softGloss', 'lacquer', 'naturalParchment']) {
    const preset = core.applyPreset(name);
    for (const key of required) assert.equal(typeof preset[key], 'number', `${name}.${key}`);
  }
});

test('row angle estimator stays close to horizontal on a horizontal sample', () => {
  const width = 80;
  const height = 40;
  const source = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let x = 8; x < width - 8; x += 1) {
    for (let y = 18; y <= 21; y += 1) {
      const p = (y * width + x) * 4;
      source[p] = source[p + 1] = source[p + 2] = 0;
      source[p + 3] = 255;
    }
  }
  const angle = core.estimateRowAngle(source, width, height);
  assert.ok(Math.abs(angle) <= 1, `angle=${angle}`);
});
