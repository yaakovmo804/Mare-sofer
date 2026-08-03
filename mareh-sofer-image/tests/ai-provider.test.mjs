import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ai-provider.js', import.meta.url), 'utf8');

test('AI provider keeps credentials out of the browser contract', () => {
  assert.match(source, /class MarehSoferAIProvider/);
  assert.match(source, /fidelityMode:\s*'locked-geometry'/);
  assert.doesNotMatch(source, /api[_-]?key/i);
  assert.doesNotMatch(source, /authorization/i);
});

test('AI provider sends source, mask and structured settings', () => {
  assert.match(source, /form\.append\('image'/);
  assert.match(source, /form\.append\('ink_mask'/);
  assert.match(source, /form\.append\('settings'/);
});
