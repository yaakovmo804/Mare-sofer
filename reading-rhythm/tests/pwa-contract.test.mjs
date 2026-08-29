import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('../', import.meta.url);

test('האפליקציה כוללת manifest התקנה תקין', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', base), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});

test('העלאת התמונה מחוברת ישירות ל-file input', async () => {
  const html = await readFile(new URL('index.html', base), 'utf8');
  assert.match(html, /<label[^>]+for="imageInput"[^>]*>העלאת צילום כתב<\/label>/);
  assert.match(html, /id="imageInput"[^>]+type="file"[^>]+accept="image\/\*"/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /id="installAppBtn"/);
});

test('מעטפת האפליקציה ניתנת לעבודה במצב לא מקוון', async () => {
  const worker = await readFile(new URL('service-worker.js', base), 'utf8');
  assert.match(worker, /manifest\.webmanifest/);
  assert.match(worker, /app\.mjs/);
  assert.match(worker, /caches\.open/);
});
