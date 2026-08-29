import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRhythm,
  calculateUniformity,
  segmentDistance,
} from '../rhythm-core.mjs';

const points = (...xs) => xs.map((x, index) => ({ id: String(index), order: index + 1, x, y: 0.5 }));

test('מרווחים שווים מפיקים פעימות שוות', () => {
  const result = calculateRhythm(points(0.9, 0.6, 0.3), { bpm: 90, mode: 'horizontal' });
  assert.equal(result.segments.length, 2);
  assert.ok(Math.abs(result.segments[0].intervalMs - result.segments[1].intervalMs) < 1e-9);
  assert.equal(result.uniformity, 100);
});

test('מרווח חזותי גדול מפיק השהיה ארוכה יותר', () => {
  const result = calculateRhythm(points(0.9, 0.75, 0.2), { bpm: 90, mode: 'horizontal' });
  assert.ok(result.segments[1].intervalMs > result.segments[0].intervalMs * 3);
  assert.ok(result.uniformity < 100);
});

test('מרחק אופקי מתעלם מן הגובה', () => {
  const from = { x: 0.8, y: 0.1 };
  const to = { x: 0.5, y: 0.9 };
  assert.equal(segmentDistance(from, to, 'horizontal'), 0.30000000000000004);
  assert.ok(segmentDistance(from, to, 'path') > 0.8);
});

test('משך המקצב הנמדד נשמר סביב אותו משך כולל של הקצב האחיד', () => {
  const result = calculateRhythm(points(0.95, 0.7, 0.64, 0.2), { bpm: 120, mode: 'horizontal' });
  const regularTotal = result.regularBeatTimesMs.at(-1);
  assert.ok(Math.abs(result.totalDurationMs - regularTotal) < 1e-7);
});

test('מדד האחידות מוגבל בין אפס למאה', () => {
  assert.equal(calculateUniformity([1, 1, 1]), 100);
  const irregular = calculateUniformity([0.01, 1, 2]);
  assert.ok(irregular >= 0 && irregular <= 100);
});
