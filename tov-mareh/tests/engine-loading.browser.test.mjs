import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const contentTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml'
};
const server = createServer(async (request, response) => {
  // Match the GitHub Pages subdirectory and serve the real files, including sw.js.
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/Mare-sofer/tov-mareh/__worker-test.html') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Worker fixture</title>');
    return;
  }
  if (!pathname.startsWith('/Mare-sofer/')) {
    response.writeHead(404).end();
    return;
  }
  const filename = resolve(root, '.' + pathname.slice('/Mare-sofer'.length),
    pathname.endsWith('/') ? 'index.html' : '');
  if (!filename.startsWith(resolve(root) + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filename);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filename)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

let browser;
let url;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/Mare-sofer/tov-mareh/`;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
});
after(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

async function newPage(t) {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Rendering catches some errors itself; pageerror alone would miss those.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    window.loadingProbe = {
      controlledAtStart: Boolean(navigator.serviceWorker.controller),
      scripts: []
    };
    document.addEventListener('load', (event) => {
      if (event.target.tagName === 'SCRIPT' && event.target.src) {
        window.loadingProbe.scripts.push(new URL(event.target.src).pathname.split('/').pop());
      }
    }, true);
  });
  return { context, page, errors };
}

async function load(page, reload = false) {
  const appResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/tov-mareh/app.js') &&
    response.request().resourceType() === 'script');
  const navigation = await (reload ? page.reload() : page.goto(url));
  return { navigation, app: await appResponse };
}

async function waitForControl(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => {
    if (navigator.serviceWorker.controller) return;
    return new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    });
  }));
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
}

async function assertLivePreview(page) {
  // The version marker alone can remain 4.0 even after engine-v21 overwrites functions.
  const engine = await page.evaluate(() => ({
    version: window.TOV_MAREH_ENGINE_VERSION,
    schedule: scheduleRender.name,
    render: render.name,
    draw: drawBase.name,
    process: processLocal.name,
    export: exportImage.name
  }));
  assert.deepEqual(engine, {
    version: '4.0', schedule: 'scheduleRenderV4', render: 'renderV4',
    draw: 'drawBaseV4', process: 'processLocalV4', export: 'exportImageV4'
  });
  assert.deepEqual(await page.evaluate(() => window.loadingProbe.scripts),
    ['app.js', 'engine-v21.js', 'live-preview-v4.js']);

  const preview = await page.evaluate(async () => {
    const fixture = document.createElement('canvas');
    fixture.width = 2400;
    fixture.height = 240;
    const ctx = fixture.getContext('2d');
    ctx.fillStyle = '#ebe1cb';
    ctx.fillRect(0, 0, fixture.width, fixture.height);
    ctx.fillStyle = '#202020';
    ctx.fillRect(100, 80, 1000, 40);
    state.image = fixture;
    state.autoFit = false;
    state.settings.sharpness = 0;
    await render();
    window.sharpnessBaseline = actx.getImageData(0, 0, after.width, after.height);
    return { width: after.width, image: after.toDataURL(), token: state.renderToken };
  });
  assert.equal(preview.width, 720, 'initial rendering uses the live-preview width');
  await page.locator('#sharpness').evaluate((input) => {
    input.value = '40';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(({ token, image }) =>
    state.renderToken > token && after.width === 720 && after.toDataURL() !== image, preview);
  const changedPixels = await page.evaluate(() => {
    const result = actx.getImageData(0, 0, after.width, after.height).data;
    return result.reduce((count, value, i) =>
      count + Number(i % 4 !== 3 && value !== window.sharpnessBaseline.data[i]), 0);
  });
  assert.ok(changedPixels > 0, 'sharpness alone changes RGB values in the preview');
  const sharpenedPreview = await page.evaluate(() => ({
    token: state.renderToken, image: after.toDataURL()
  }));
  await page.locator('#brightness').evaluate((input) => {
    input.value = '90';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(({ token, image }) =>
    state.renderToken > token && after.width === 720 && after.toDataURL() !== image, sharpenedPreview);

  const fullBaseline = await page.evaluate(async () => {
    state.settings.sharpness = 0;
    await render(false, true);
    const image = after.toDataURL();
    state.settings.sharpness = 40;
    return { image, token: state.renderToken };
  });

  await page.locator('#applyBtn').click();
  await page.waitForFunction(({ token, image }) => state.renderToken > token &&
    after.width === 1800 && $('busyOverlay').hidden && after.toDataURL() !== image, fullBaseline);
  assert.equal(await page.evaluate(() => before.width), 1800, 'Apply uses full quality');
}

test('positive sharpening reuses the real masked helper and preserves fixture geometry',
  { timeout: 30_000 }, async (t) => {
    const { page, errors } = await newPage(t);
    await load(page);
    const results = await page.evaluate(() => {
      const width = 64, height = 48;
      before.width = after.width = width;
      before.height = after.height = height;
      const source = new ImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Unsaturated strokes, a corner, and an interior gap: no all-black/white no-op fixture.
          const ink = (x >= 8 && x < 42 && y >= 8 && y < 16) ||
            (x >= 34 && x < 42 && y >= 16 && y < 38);
          const i = (y * width + x) * 4;
          source.data.set(ink ? [85, 80, 75, 255] : [235, 225, 203, 255], i);
        }
      }
      bctx.putImageData(source, 0, 0);
      Object.assign(state.settings, {
        sharpness: 0, black: 0, uniformity: 0, gloss: 0, depth: 0,
        warmth: 0, texture: 0, brightness: 50, denoise: 0, deglare: 0
      });
      const geometry = () => [before.width, before.height, after.width, after.height,
        state.settings.rotation, state.settings.perspective, state.settings.crop];
      const originalGeometry = geometry();
      const read = () => actx.getImageData(0, 0, width, height);
      const helper = maskedUnsharp;
      let calls = 0;
      maskedUnsharp = function (...args) { calls++; return helper(...args); };
      try {
        processLocal(1, true);
        const baseline = read();
        const zeroCalls = calls;
        const rows = [];
        for (const [sharpness, multiplier] of [[2, 1], [40, 1], [100, 1], [40, 1.12]]) {
          calls = 0;
          state.settings.sharpness = sharpness;
          processLocal(multiplier, true);
          const output = read();
          let changedRgb = 0, changedAlpha = 0, changedInkMask = 0;
          for (let i = 0; i < output.data.length; i += 4) {
            for (let c = 0; c < 3; c++) changedRgb += Number(output.data[i + c] !== baseline.data[i + c]);
            changedAlpha += Number(output.data[i + 3] !== baseline.data[i + 3]);
            const inkAt = (data) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 170;
            changedInkMask += Number(inkAt(output.data) !== inkAt(baseline.data));
          }
          rows.push({ sharpness, multiplier, calls, changedRgb, changedAlpha, changedInkMask,
            geometryUnchanged: JSON.stringify(geometry()) === JSON.stringify(originalGeometry),
            sourceUnchanged: bctx.getImageData(0, 0, width, height).data.every((v, i) => v === source.data[i]),
            deltaCorrect: $('deltaLabel').textContent === estimateDelta(source, output).toFixed(1) + '%' });
        }
        return { zeroCalls, rows };
      } finally {
        maskedUnsharp = helper;
      }
    });
    assert.equal(results.zeroCalls, 0, 'zero sharpness skips sharpening');
    for (const result of results.rows) {
      assert.equal(result.calls, 1, 'one call to the existing helper per image');
      assert.ok(result.changedRgb > 0, `sharpness ${result.sharpness} changes actual RGB values`);
      assert.equal(result.changedAlpha, 0);
      assert.equal(result.changedInkMask, 0, 'fixture stroke positions, thickness and gap stay fixed');
      assert.equal(result.geometryUnchanged, true);
      assert.equal(result.sourceUnchanged, true);
      assert.equal(result.deltaCorrect, true, 'delta describes the final sharpened pixels');
    }
    assert.deepEqual(errors, []);
  });

test('cold load ends with live-preview before the first Service Worker controls navigation',
  { timeout: 30_000 }, async (t) => {
    const { page, errors } = await newPage(t);
    const { navigation, app } = await load(page);
    assert.equal(navigation.fromServiceWorker(), false);
    assert.equal(await page.evaluate(() => window.loadingProbe.controlledAtStart), false);
    await assertLivePreview(page);
    const fullQualityImage = await page.evaluate(() => after.toDataURL());
    await page.evaluate(() => render());
    assert.equal(await page.evaluate(() => after.width), 720);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#exportBtn').click()
    ]);
    const png = await readFile(await download.path());
    assert.equal(png.readUInt32BE(16), 1800, 'export rerenders at full width');
    const exportedMatchesCanvas = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + base64;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const exported = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const processed = actx.getImageData(0, 0, after.width, after.height).data;
      return exported.length === processed.length && exported.every((v, i) => v === processed[i]);
    }, png.toString('base64'));
    assert.equal(exportedMatchesCanvas, true, 'download contains the sharpened pixels');
    assert.equal(await page.evaluate(() => after.toDataURL()), fullQualityImage);
    assert.ok(await app.text() === appSource, 'app.js is served without appended engines');
    assert.deepEqual(errors, []);
  });

test('an unavailable AI endpoint falls back to local positive sharpening',
  { timeout: 30_000 }, async (t) => {
    const { page, errors } = await newPage(t);
    await load(page);
    await assertLivePreview(page);
    const result = await page.evaluate(async () => {
      // Same-origin missing fixture returns 404; no request is sent to an AI provider.
      state.engine = 'ai';
      state.aiEndpoint = new URL('__unavailable-ai-fixture', location.href).href;
      state.settings.sharpness = 0;
      await render(false, true);
      const baseline = actx.getImageData(0, 0, after.width, after.height).data;
      state.settings.sharpness = 40;
      await render(false, true);
      const output = actx.getImageData(0, 0, after.width, after.height).data;
      return {
        changed: output.some((v, i) => i % 4 !== 3 && v !== baseline[i]),
        status: $('aiStatus').textContent,
        busy: !$('busyOverlay').hidden,
        width: after.width
      };
    });
    assert.equal(result.changed, true, 'the fallback sharpens actual RGB pixels');
    assert.match(result.status, /הופעל המנוע המקומי/);
    assert.equal(result.busy, false);
    assert.equal(result.width, 1800);
    assert.deepEqual(errors, []);
  });

for (const offline of [false, true]) {
  test(`controlled ${offline ? 'offline' : 'online'} reload preserves the live-preview engine`,
    { timeout: 30_000 }, async (t) => {
      const { context, page, errors } = await newPage(t);
      await load(page);
      await waitForControl(page);

      // Offline mode starts immediately after activation, before a reload can fill cache gaps.
      await context.setOffline(offline);
      const { navigation, app } = await load(page, true);
      assert.equal(navigation.fromServiceWorker(), true);
      assert.equal(app.fromServiceWorker(), true);
      assert.equal(await page.evaluate(() => window.loadingProbe.controlledAtStart), true);
      await assertLivePreview(page);
      assert.ok(await app.text() === appSource, 'the Service Worker serves only app.js');
      assert.deepEqual(errors, []);
    });
}

test('late preview initialization keeps the already installed offline cache',
  { timeout: 30_000 }, async (t) => {
    const { context, page, errors } = await newPage(t);
    // Existing clients may have an active worker without ever having run live-preview.
    await page.goto(new URL('__worker-test.html', url).href);
    await page.evaluate(() => navigator.serviceWorker.register('./sw.js'));
    await waitForControl(page);
    await page.evaluate(async () => {
      const sibling = await caches.open('tov-mareh-v5-test-sibling');
      await sibling.put('./sibling-marker', new Response('keep'));
    });
    await load(page);
    await assertLivePreview(page);
    assert.ok(await page.evaluate(async () =>
      (await caches.keys()).includes('tov-mareh-v5-test-sibling')),
      'preview initialization must not delete another app cache');
    await context.setOffline(true);
    await load(page, true);
    await assertLivePreview(page);
    assert.deepEqual(errors, []);
  });
