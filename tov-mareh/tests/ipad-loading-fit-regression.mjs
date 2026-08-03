import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../app.js', import.meta.url);
const cssUrl = new URL('../styles.css', import.meta.url);

const app = await readFile(appUrl, 'utf8');
const css = await readFile(cssUrl, 'utf8');

test('loading overlay is hidden by author CSS when hidden is set', () => {
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(css, /\.busy-overlay\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
});

test('local image loading does not force the busy overlay', () => {
  assert.match(app, /const useRemoteAi = state\.engine === 'ai' && Boolean\(state\.aiEndpoint\)/);
  assert.match(app, /setBusy\(useRemoteAi\)/);
  assert.doesNotMatch(app, /function render\([^)]*\)\s*\{[^}]*\$\('busyOverlay'\)\.hidden=false/s);
});

test('the image is fitted to both available width and height', () => {
  assert.match(app, /function fitImageToStage\(\)/);
  assert.match(app, /availableWidth \/ before\.width/);
  assert.match(app, /availableHeight \/ before\.height/);
  assert.match(app, /Math\.min\([\s\S]*availableWidth \/ before\.width,[\s\S]*availableHeight \/ before\.height/);
});

test('fit mode is restored after image and project loads', () => {
  const occurrences = app.match(/state\.autoFit = true/g) || [];
  assert.ok(occurrences.length >= 2, 'expected auto-fit on image and project loading');
});

test('remote AI processing has a timeout and always clears the busy overlay', () => {
  assert.match(app, /new AbortController\(\)/);
  assert.match(app, /controller\.abort\(\)/);
  assert.match(app, /finally\s*\{[\s\S]*setBusy\(false\)/);
});
