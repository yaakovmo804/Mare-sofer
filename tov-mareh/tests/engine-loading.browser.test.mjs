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
    // Isolate engine loading from the existing, unrelated missing unsharp() helper in v2.1.
    // Brightness still exercises the real renderer and its slider scheduling without mocks.
    state.settings.sharpness = 0;
    await render();
    return { width: after.width, image: after.toDataURL(), token: state.renderToken };
  });
  assert.equal(preview.width, 720, 'initial rendering uses the live-preview width');
  await page.locator('#brightness').evaluate((input) => {
    input.value = '90';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(({ token, image }) =>
    state.renderToken > token && after.width === 720 && after.toDataURL() !== image, preview);

  await page.locator('#applyBtn').click();
  await page.waitForFunction(() => after.width === 1800 && $('busyOverlay').hidden);
  assert.equal(await page.evaluate(() => before.width), 1800, 'Apply uses full quality');
}

test('cold load ends with live-preview before the first Service Worker controls navigation',
  { timeout: 30_000 }, async (t) => {
    const { page, errors } = await newPage(t);
    const { navigation, app } = await load(page);
    assert.equal(navigation.fromServiceWorker(), false);
    assert.equal(await page.evaluate(() => window.loadingProbe.controlledAtStart), false);
    await assertLivePreview(page);
    assert.ok(await app.text() === appSource, 'app.js is served without appended engines');
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
