#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(testDirectory, '..');
const read = filename => fs.readFileSync(path.join(appDirectory, filename), 'utf8');
const require = createRequire(import.meta.url);
const { createCanvas } = require('@napi-rs/canvas');

function loadMasterSystem() {
  const context = vm.createContext({ console, Math, Object, Array, Map, Set });
  context.globalThis = context;
  vm.runInContext(read('master-system.js'), context, { filename: 'master-system.js' });
  return context.MEDIDAOT_MASTER_SYSTEM;
}

function loadPointerInputRouting() {
  const source = read('app-1.js');
  const start = source.indexOf('const penTextEntryBlock');
  const end = source.indexOf('for (const eventName of', start);
  assert.ok(start >= 0 && end > start, 'pointer input routing must remain available');
  const listeners = new Map();
  const document = {
    activeElement: null,
    addEventListener(name, listener) { listeners.set(name, listener); }
  };
  class FakeElement {
    constructor(tagName, { type = null, label = null } = {}) {
      this.tagName = tagName.toLowerCase();
      this.type = type;
      this.label = label;
      this.control = null;
      this.blurCount = 0;
    }
    getAttribute(name) { return name === 'type' ? this.type : null; }
    matches(selector) {
      if (selector === 'input') return this.tagName === 'input';
      if (selector === 'textarea, [contenteditable="true"]') return this.tagName === 'textarea';
      return false;
    }
    closest(selector) {
      if (selector === 'textarea, [contenteditable="true"], input') {
        return ['textarea', 'input'].includes(this.tagName) ? this : null;
      }
      if (selector === 'label') return this.tagName === 'label' ? this : this.label;
      return null;
    }
    blur() {
      this.blurCount++;
      if (document.activeElement === this) document.activeElement = null;
    }
  }
  const context = vm.createContext({
    Set,
    performance: { now: () => 100 },
    Element: FakeElement,
    HTMLElement: FakeElement,
    document,
    statusText: { textContent: '' }
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.routing = { handleDocumentPointerDown, handleBlockedPenFocus, handleBlockedPenClick, clearBlockedPenTextEntry };`, context);
  return { ...context.routing, FakeElement, document, listeners, statusText: context.statusText };
}

function loadExportLabelHelpers() {
  const source = read('app-4.js');
  const start = source.indexOf('function drawExportScaleNote');
  const end = source.indexOf('function drawObjectToContext', start);
  assert.ok(start >= 0 && end > start, 'export label helpers must remain available');
  const state = { image: { width: 300, height: 300 }, objects: [] };
  const context = vm.createContext({
    Math,
    state,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
    midpoint: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    polygonCentroid: points => points[0],
    flattenedAreaPoints: object => object.points
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.helpers = { drawExportScaleNote, exportResultLabelPoint };`, context);
  return context.helpers;
}

function loadRowAlignmentDrawer() {
  const source = read('professional-tools.js');
  const start = source.indexOf('function drawRowAlignmentObject');
  const end = source.indexOf('function slantCandidateIsLinkedToScan', start);
  assert.ok(start >= 0 && end > start, 'row alignment drawer must remain available');
  const labels = [];
  const context = vm.createContext({
    Math,
    semanticColorForObject: () => '#2563eb',
    imageToScreen: point => ({ ...point }),
    midpoint: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    currentRowDeviation: candidate => ({ value: candidate.deviationPx || 0, unitLabel: 'פיקסלים' }),
    fmt: value => String(value),
    label: (...args) => labels.push(args),
    isResultLabelVisible: object => object.display?.resultLabelVisible !== false
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.drawRowAlignmentObject = drawRowAlignmentObject;`, context);
  return { drawRowAlignmentObject: context.drawRowAlignmentObject, labels };
}

function loadExportObjectDrawer() {
  const source = read('app-4.js');
  const start = source.indexOf('function drawObjectToContext');
  const end = source.indexOf('function downloadBlob', start);
  assert.ok(start >= 0 && end > start, 'export object drawer must remain available');
  const state = { selectedId: null, image: { width: 300, height: 300 }, objects: [] };
  const context = vm.createContext({
    Math,
    state,
    enforceSemanticStyle() {},
    hexToRgba: () => 'rgba(0,0,0,0)',
    exportOverlayUnit: () => 1,
    isResultLabelVisible: object => object.display?.resultLabelVisible !== false
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.drawObjectToContext = drawObjectToContext;`, context);
  return { drawObjectToContext: context.drawObjectToContext, state };
}

function loadLetterOrganHelpers() {
  const source = read('letter-tools.js');
  const start = source.indexOf('function representativeOrganHandle');
  const end = source.indexOf('function drawLetterVectorHandles', start);
  assert.ok(start >= 0 && end > start, 'letter organ helpers must remain available');
  const context = vm.createContext({
    Math,
    Map,
    Set,
    String,
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    pointInPolygon(point, polygon) {
      let inside = false;
      for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const a = polygon[index];
        const b = polygon[previous];
        if (((a.y > point.y) !== (b.y > point.y)) &&
            point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
      }
      return inside;
    }
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.organLevelVectorHandles = organLevelVectorHandles; this.anchorIdsInsideLasso = anchorIdsInsideLasso; this.pairedJunctionAnchorHandles = pairedJunctionAnchorHandles; this.semanticFeatureCanEdit = semanticFeatureCanEdit;`, context);
  return context;
}

function loadVectorDragReconcileGuard() {
  const source = read('app-3.js');
  const start = source.indexOf('function shouldReconcileSemanticVectorDrag');
  const end = source.indexOf('function markObjectModified', start);
  assert.ok(start >= 0 && end > start, 'vector semantic reconciliation guard must remain available');
  const context = vm.createContext({});
  vm.runInContext(`${source.slice(start, end)}\nthis.shouldReconcileSemanticVectorDrag = shouldReconcileSemanticVectorDrag;`, context);
  return context.shouldReconcileSemanticVectorDrag;
}

function loadPhotographedSourceIdentityHelper() {
  const source = read('letter-tools.js');
  const start = source.indexOf('function samePhotographedSourceRegion');
  const end = source.indexOf('function setSelectedLetterEditTarget', start);
  assert.ok(start >= 0 && end > start, 'photographed source identity helper must remain available');
  const context = vm.createContext({ Math, Array });
  vm.runInContext(`${source.slice(start, end)}\nthis.samePhotographedSourceRegion = samePhotographedSourceRegion;`, context);
  return context.samePhotographedSourceRegion;
}

function loadRasterizedVectorMaskHelper() {
  const source = read('letter-tools.js');
  const start = source.indexOf('function rasterizedVectorMask');
  const end = source.indexOf('function sourcePatchFallbackRgb', start);
  assert.ok(start >= 0 && end > start, 'source-vector mask helper must remain available');
  const context = vm.createContext({
    Array,
    Number,
    Uint8Array,
    createLetterMaskCanvas: (width, height) => createCanvas(width, height)
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.rasterizedVectorMask = rasterizedVectorMask;`, context);
  return context.rasterizedVectorMask;
}

function loadSlantSpatialMatchingHelpers() {
  const source = read('professional-tools.js');
  const start = source.indexOf('function slantCandidateSpatialScore');
  const end = source.indexOf('function setSlantCandidateClassification', start);
  assert.ok(start >= 0 && end > start, 'slant spatial matching helpers must remain available');
  const system = loadMasterSystem();
  const context = vm.createContext({
    Math,
    Number,
    Set,
    Infinity,
    MASTER_SYSTEM: system,
    midpoint: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.slantCandidateSpatialScore = slantCandidateSpatialScore; this.matchPreviousSlantCandidate = matchPreviousSlantCandidate;`, context);
  return context;
}

function loadSemanticReconcileHelper(handles) {
  const source = read('letter-tools.js');
  const start = source.indexOf('function reconcileSemanticVectorFeatures');
  const end = source.indexOf('function syncLetterControls', start);
  assert.ok(start >= 0 && end > start, 'semantic reconcile helper must remain available');
  const engine = { enumerateHandles: () => handles };
  const context = vm.createContext({
    Math,
    Number,
    letterAsset: () => null,
    letterVectorEngine: () => engine,
    refreshBoundVectorFeaturePoints: () => {},
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.reconcileSemanticVectorFeatures = reconcileSemanticVectorFeatures;`, context);
  return context.reconcileSemanticVectorFeatures;
}

function loadCorrectionGeometryHelpers() {
  const source = read('professional-tools.js');
  const start = source.indexOf('function selectedFeatureAngle');
  const end = source.indexOf('function createCorrectionPreview', start);
  assert.ok(start >= 0 && end > start, 'correction geometry helper must remain available');
  const system = loadMasterSystem();
  const context = vm.createContext({ Math, Number, MASTER_SYSTEM: system });
  vm.runInContext(`${source.slice(start, end)}\nthis.selectedFeatureAngle = selectedFeatureAngle;`, context);
  return context.selectedFeatureAngle;
}

test('רגעים and אמן preserve the approved acronym structure', () => {
  const system = loadMasterSystem();
  const regaim = system.GROUPS.find(group => group.id === 'regaim');
  const aman = system.GROUPS.find(group => group.id === 'aman');
  assert.equal(regaim.name, 'רגעים');
  assert.deepEqual(
    Array.from(regaim.entries, entry => [entry.letter, Array.from(entry.metricIds)]),
    [['ר', ['widths']], ['ג', ['heights']], ['ע', ['nib']], ['י', ['straightness']], ['ם', ['weights', 'gaps']]]
  );
  assert.equal(aman.name, 'אמן');
  assert.deepEqual(
    Array.from(aman.entries, entry => [entry.letter, Array.from(entry.metricIds)]),
    [['א', ['white-balance']], ['מ', ['optical-center', 'balconies']], ['ן', ['slants-parallels']]]
  );
});

test('every professional metric has one stable semantic color', () => {
  const system = loadMasterSystem();
  const professionalIds = system.GROUPS.flatMap(group => group.entries.flatMap(entry => entry.metricIds));
  const colors = professionalIds.map(id => system.metric(id)?.color);
  assert.ok(colors.every(color => /^#[0-9a-f]{6}$/i.test(color)));
  assert.equal(new Set(colors).size, colors.length, 'professional colors must not collide');
  for (const id of professionalIds) {
    assert.equal(system.colorFor({ semanticMetricId: id }), system.metric(id).color);
  }
  const structuralCategories = ['roof', 'seat', 'stem', 'reference-template', 'other'];
  const structuralColors = structuralCategories.map(category => system.colorFor({ category }));
  assert.equal(new Set(structuralColors).size, structuralColors.length, 'selectable structural definitions need distinct colors');
  assert.equal(system.colorFor({ category: 'roof' }), system.metric('roofs').color);
  assert.equal(system.colorFor({ category: 'seat' }), system.metric('seats').color);
});

test('row alignment excludes final nun and yod from the lowest-seat baseline', () => {
  const system = loadMasterSystem();
  const result = system.rowAlignmentFromCandidates([
    { id: 'bet', letter: 'ב', y: 100, eligible: true },
    { id: 'kaf', letter: 'כ', y: 104, eligible: true },
    { id: 'nun', letter: 'נ', y: 102, eligible: true },
    { id: 'final-nun', letter: 'ן', y: 116, eligible: true },
    { id: 'yod', letter: 'י', y: 120, eligible: true },
    { id: 'unconfirmed', y: 130, eligible: false }
  ], 8);
  assert.equal(result.baselineY, 104);
  assert.deepEqual(Array.from(result.candidates, candidate => candidate.id), ['bet', 'kaf', 'nun']);
  assert.equal(result.candidates.find(candidate => candidate.id === 'bet').deviationNib, .5);
});

test('row alignment refuses to invent a baseline before reference letters are confirmed', () => {
  const system = loadMasterSystem();
  const result = system.rowAlignmentFromCandidates([
    { id: 'candidate-1', y: 100, eligible: false },
    { id: 'candidate-2', y: 110, eligible: false }
  ], 8);
  assert.equal(result.baselineY, null);
  assert.deepEqual(Array.from(result.candidates), []);
});

test('balcony comparison stays numeric without inventing a pass/fail rule', () => {
  const system = loadMasterSystem();
  const comparison = system.compareBalconies([
    { letter: 'ו', value: 1.1 }, { letter: 'ו', value: 1.3 },
    { letter: 'ת', value: 1.6 }, { letter: 'ת', value: 1.8 }
  ]);
  assert.ok(Math.abs(comparison.vav.median - 1.2) < 1e-9);
  assert.ok(Math.abs(comparison.tav.median - 1.7) < 1e-9);
  assert.ok(Math.abs(comparison.difference - .5) < 1e-9);
  assert.equal(comparison.classification, null);
  const uncalibrated = system.compareBalconies([
    { letter: 'ו', value: null }, { letter: 'ת', value: undefined }
  ]);
  assert.equal(uncalibrated.vav.count, 0);
  assert.equal(uncalibrated.tav.count, 0);
  assert.equal(uncalibrated.difference, null);
});

test('signed slants preserve direction instead of collapsing opposite angles', () => {
  const system = loadMasterSystem();
  const right = system.signedVerticalAngle({ x: 0, y: 0 }, { x: 10, y: 100 });
  const left = system.signedVerticalAngle({ x: 0, y: 0 }, { x: -10, y: 100 });
  assert.ok(right * left < 0, 'opposite slants must keep opposite signs');
  assert.ok(Math.abs(Math.abs(right) - Math.abs(left)) < 1e-9);
});

test('signed angle shear lands exactly on positive, zero and crossing targets', () => {
  const system = loadMasterSystem();
  const pivot = { x: 0, y: 100 };
  for (const [current, target] of [[10, 20], [10, 0], [-10, 20], [-10, -20]]) {
    const top = { x: Math.tan(current * Math.PI / 180) * 100, y: 0 };
    const moved = system.shearPointToAngle(top, pivot.y, current, target);
    assert.ok(Math.abs(system.signedVerticalAngle(moved, pivot) - target) < 1e-9, `${current}→${target}`);
  }
});

test('correction angle rejects isotropic anchor clouds', () => {
  const selectedFeatureAngle = loadCorrectionGeometryHelpers();
  const square = [
    { point: { x: 0, y: 0 } }, { point: { x: 10, y: 0 } },
    { point: { x: 10, y: 10 } }, { point: { x: 0, y: 10 } }
  ];
  assert.equal(selectedFeatureAngle(square), null);
  const vertical = [{ point: { x: 0, y: 0 } }, { point: { x: 2, y: 50 } }, { point: { x: 4, y: 100 } }];
  assert.ok(Number.isFinite(selectedFeatureAngle(vertical)));
});

test('the integrated shell exposes composition, vector levels, info and active geometry tools', () => {
  for (const filename of ['index.html', 'medidaot.html']) {
    const html = read(filename);
    for (const required of [
      'professionalSuitePanel', 'compositionWorkspace', 'compositionInspector', 'compositionBackgroundSelect',
      'metricInfoDialog', 'metricMeasurementText', 'professionalReferenceInfo',
      'semanticColorHint', 'letterVectorLevelSelect', 'transferLetterBtn',
      'letterEditTargetSection', 'letterAxisTiltSection', 'letterAxisTiltInput'
    ]) assert.match(html, new RegExp(`id="${required}"`));
    for (const tool of ['rowAlign', 'circle', 'ellipse']) {
      assert.match(html, new RegExp(`data-tool="${tool}"`));
    }
    assert.match(html, /master-system\.js\?v=20260801d/);
    assert.match(html, /professional-tools\.js\?v=20260801d/);
    assert.match(html, /slant-analyzer\.js\?v=20260801d/);
    assert.ok(
      html.indexOf('slant-analyzer.js?v=20260801d') < html.indexOf('professional-tools.js?v=20260801d'),
      'the analyzer must load before the professional integration'
    );
    assert.match(html, /id="compositionCanvas"[^>]*tabindex="0"/);
    assert.match(html, /id="canvas"[^>]*data-precision-surface/);
    assert.match(html, /id="compositionCanvas"[^>]*data-precision-surface/);
    assert.match(html, /data-vector-workflow="copy"/);
    assert.match(html, /data-vector-workflow="source-region"/);
    assert.match(html, /id="statusText"[^>]*aria-live="polite"/);
    assert.match(html, /id="metricInfoDialog"[^>]*aria-labelledby="metricInfoTitle"/);
  }
});

test('Pencil activates menus while text-entry focus and source-region editing remain explicit', () => {
  const app1 = read('app-1.js');
  const app2 = read('app-2.js');
  const app3 = read('app-3.js');
  const app4 = read('app-4.js');
  const letters = read('letter-tools.js');
  const engine = read('letter-vector-engine.js');
  assert.match(app1, /function textEntryControl/);
  assert.match(app1, /\['text', 'number', 'search', 'email', 'url', 'tel', 'password'\]/);
  assert.match(app1, /const control = textEntryControl\(event\.target\)/);
  assert.match(app1, /const activeTextEntry = textEntryControl\(document\.activeElement\)/);
  assert.match(app1, /activeTextEntry instanceof HTMLElement/);
  assert.match(app1, /document\.addEventListener\('keydown', clearBlockedPenTextEntry/);
  assert.doesNotMatch(app1, /precisionSurfaceInPath/);
  assert.doesNotMatch(app1, /Apple Pencil מיועד למשטח העבודה/);
  assert.match(app1, /event\.detail === 0/);
  assert.match(app3, /\[data-precision-surface\]/);
  assert.match(app2, /isSourceRegionEdit\(hit\.object\)/);
  assert.match(letters, /editTarget:\s*sourceMode \? 'source-region' : 'overlay-copy'/);
  assert.match(letters, /function drawSourceEditPatches/);
  assert.match(letters, /function rasterizedVectorMask/);
  assert.match(letters, /rasterizedVectorMask\(width, height, object\.sourceOriginalVector\)/);
  assert.match(letters, /const removalSeed = retainedVector\?\.mask \|\| rawInk/);
  assert.match(letters, /sourceOriginalVector/);
  assert.match(letters, /function applySelectedLetterAxisTilt/);
  assert.match(letters, /roof-stem-junction/);
  assert.match(engine, /function tiltObjectHandles/);
  assert.match(engine, /Array\.isArray\(vector\.features\)/);
  assert.match(app4, /drawSourceEditPatches\(context, \{ exportQuality: true \}\)/);
});

test('Pencil pointer events block only text entry and close an already open text field', () => {
  const routing = loadPointerInputRouting();
  const makeEvent = (target, overrides = {}) => ({
    target,
    pointerType: 'pen',
    detail: 1,
    defaultPrevented: false,
    stopped: false,
    composedPath: () => [target],
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...overrides
  });
  const firstText = new routing.FakeElement('input', { type: 'text' });
  const secondText = new routing.FakeElement('input', { type: 'number' });
  const menuButton = new routing.FakeElement('button');
  const slider = new routing.FakeElement('input', { type: 'range' });

  routing.document.activeElement = firstText;
  const penTextEvent = makeEvent(secondText);
  routing.handleDocumentPointerDown(penTextEvent);
  assert.equal(penTextEvent.defaultPrevented, true);
  assert.equal(firstText.blurCount, 1, 'an already open keyboard field is closed');
  assert.equal(secondText.blurCount, 1, 'the Pencil target never receives text focus');
  const penFocus = makeEvent(secondText, { pointerType: undefined });
  routing.handleBlockedPenFocus(penFocus);
  assert.equal(penFocus.defaultPrevented, true, 'the focus event synthesized by Pencil is rejected');

  for (const target of [menuButton, slider]) {
    const event = makeEvent(target);
    routing.handleDocumentPointerDown(event);
    assert.equal(event.defaultPrevented, false, 'Pencil keeps menu controls interactive');
  }

  const fingerEvent = makeEvent(secondText, { pointerType: 'touch' });
  routing.handleDocumentPointerDown(fingerEvent);
  assert.equal(fingerEvent.defaultPrevented, false, 'finger text entry remains available');
  const fingerFocus = makeEvent(secondText, { pointerType: undefined });
  routing.handleBlockedPenFocus(fingerFocus);
  assert.equal(fingerFocus.defaultPrevented, false, 'finger focus is not mistaken for Scribble');
});

test('source replacement mask follows the retained vector and preserves omitted dark components', () => {
  const rasterizedVectorMask = loadRasterizedVectorMaskHelper();
  const vector = {
    viewBox: [0, 0, 20, 20],
    paths: [{
      rule: 'evenodd',
      commands: [
        { type: 'M', x: 0, y: 0 }, { type: 'L', x: 20, y: 0 },
        { type: 'L', x: 20, y: 20 }, { type: 'L', x: 0, y: 20 }, { type: 'Z' },
        { type: 'M', x: 6, y: 6 }, { type: 'L', x: 14, y: 6 },
        { type: 'L', x: 14, y: 14 }, { type: 'L', x: 6, y: 14 }, { type: 'Z' }
      ]
    }]
  };
  const result = rasterizedVectorMask(20, 20, vector);
  assert.ok(result?.pixelCount > 250);
  assert.equal(result.mask[2 * 20 + 2], 1, 'retained ink is selected for replacement');
  assert.equal(result.mask[10 * 20 + 10], 0, 'the even-odd hole and any omitted component remain untouched');
});

test('source-region conflicts distinguish missing frames by the photographed polygon', () => {
  const sameSource = loadPhotographedSourceIdentityHelper();
  const polygonA = [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: 10, y: 60 }];
  const polygonB = polygonA.map(point => ({ x: point.x + 80, y: point.y }));
  assert.equal(sameSource(
    { sourceSelection: { frameId: 7, polygon: polygonA } },
    { sourceSelection: { frameId: 7, polygon: polygonB } }
  ), true, 'a surviving frame id is authoritative');
  assert.equal(sameSource(
    { sourceSelection: { frameId: null, polygon: polygonA } },
    { sourceSelection: { frameId: null, polygon: polygonB } }
  ), false, 'two missing frame ids alone may not create a false conflict');
  assert.equal(sameSource(
    { sourceSelection: { frameId: null, polygon: polygonA } },
    { sourceSelection: { frameId: null, polygon: polygonA.map(point => ({ ...point })) } }
  ), true, 'copies of the same photographed region remain mutually exclusive');
});

test('project data persists the professional suite and accepts legacy schema 3', () => {
  const source = read('app-4.js');
  assert.match(source, /schemaVersion:\s*'4\.0\.0'/);
  assert.match(source, /professionalSuite:\s*captured\.professionalSuite/);
  assert.match(source, /measurementDescription:\s*captured\.professionalSuite\.measurementNotes/);
  assert.match(source, /\^\[34\]/);
  assert.match(source, /linkedKastelId/);
  assert.match(source, /sourceScanId/);
  assert.match(source, /slant-scan-roi\.v1/);
});

test('professional information and deferred letter families are data, not hidden algorithms', () => {
  const system = loadMasterSystem();
  const notes = system.defaultMeasurementNotes();
  assert.ok(system.METRICS.every(metric => notes[metric.id]?.length > 0));
  assert.ok(system.METRICS.every(metric => metric.operationMode && metric.operationLabel),
    'each card must disclose whether it is manual, assisted, informational or label-only');
  assert.equal(system.metric('optical-center').operationMode, 'information');
  assert.equal(system.metric('heights').operationMode, 'manual');
  assert.equal(system.metric('stems').operationMode, 'label-only');
  assert.deepEqual(
    Array.from(system.LETTER_FAMILIES, family => [family.id, Array.from(family.letters), family.status]),
    [
      ['narrow-letters', ['נ', 'י', 'ו', 'ז'], 'definition-pending'],
      ['internal-white', ['ב', 'ד', 'ה', 'ת'], 'definition-pending']
    ]
  );
});

test('every advertised active metric resolves to a real canvas tool', () => {
  const system = loadMasterSystem();
  const html = read('index.html');
  const app3 = read('app-3.js');
  const toolIds = new Set([...html.matchAll(/data-tool="([^"]+)"/g)].map(match => match[1]));
  const messageTable = /function setTool[\s\S]*?const messages = \{([\s\S]*?)\n  \};/.exec(app3)?.[1] || '';
  for (const match of messageTable.matchAll(/^\s*([a-zA-Z]+):/gm)) toolIds.add(match[1]);
  toolIds.add('thirds');
  for (const metric of system.METRICS) {
    if (['information', 'label-only'].includes(metric.operationMode)) {
      assert.equal(metric.tool, null, `${metric.id} must not advertise an inactive tool`);
      continue;
    }
    assert.ok(metric.tool, `${metric.id} must name the tool it activates`);
    assert.ok(toolIds.has(metric.tool), `${metric.id} points to missing tool ${metric.tool}`);
  }
});

test('local information persistence gives saved text priority and correction keeps semantic linkage', () => {
  const source = read('professional-tools.js');
  assert.match(source, /\.\.\.professionalSuite\.descriptions,[\s\S]*\.\.\.savedDescriptions/);
  assert.match(source, /medidaot-professional-info/);
  assert.match(source, /featureSelectionMethod/);
  assert.match(source, /semanticMetricId:\s*measurement\.semanticMetricId/);
  assert.match(source, /nearest-semantic-stem-organ/);
  assert.match(source, /function selectedFeatureAngle/);
  assert.match(source, /currentFeatureAngleDeg/);
  assert.match(source, /measurementAngleDeg/);
  assert.match(source, /signedTarget = clamp\(targetAngle, -35, 35\)/);
  assert.match(source, /engine\.tiltObjectHandles\(clone/);
  assert.match(source, /pivotImage:\s*pivot/);
  assert.match(source, /const topHandle = handles\.reduce/);
  assert.match(source, /function armProfessionalMeasurement/);
  assert.match(source, /draftLetter !== next\.letter\) cancelDraft\(\)/);
  assert.match(source, /function refreshCompositionSourceAvailability/);
  assert.match(source, /source-missing-copy-preserved/);
  assert.match(source, /duplicatedFromSessionId/);
  assert.match(source, /previewCompositionUid = copy\.uid/);
});

test('automatic slant scans stay linked to human-classified signed angle measurements', () => {
  const professional = read('professional-tools.js');
  const app1 = read('app-1.js');
  const app2 = read('app-2.js');
  const app3 = read('app-3.js');
  const app4 = read('app-4.js');
  const serviceWorker = read('sw.js');
  assert.match(professional, /function analyzeSlantScan/);
  assert.match(professional, /MEDIDAOT_SLANT_ANALYZER/);
  assert.match(professional, /sourceScanId:\s*object\.id/);
  assert.match(professional, /candidateId:\s*candidate\.id/);
  assert.match(professional, /angleRef:\s*'vertical'/);
  assert.match(professional, /function setSlantCandidateClassification/);
  assert.match(professional, /לא לכלול/);
  assert.match(app1, /slantScan/);
  assert.match(app2, /measurementResultModel\(object\)/);
  assert.match(app3, /analyzeSlantScan\(object\)/);
  assert.match(app3, /item\.sourceScanId === deleted\.id/);
  assert.match(app4, /'sourceScanId'/);
  assert.match(serviceWorker, /\.\/slant-analyzer\.js/);
});

test('slant classifications survive small ROI changes without crossing to a neighboring thigh', () => {
  const { matchPreviousSlantCandidate } = loadSlantSpatialMatchingHelpers();
  const first = {
    id: 1,
    uid: 'first',
    points: [{ x: 100, y: 30 }, { x: 108, y: 110 }],
    candidateStrokeWidthPx: 7,
    candidateBounds: { left: 96, top: 28, right: 112, bottom: 112, width: 16, height: 84 }
  };
  const neighbor = {
    id: 2,
    uid: 'neighbor',
    points: [{ x: 135, y: 30 }, { x: 143, y: 110 }],
    candidateStrokeWidthPx: 7,
    candidateBounds: { left: 131, top: 28, right: 147, bottom: 112, width: 16, height: 84 }
  };
  const shiftedRoot = { x: 101.2, y: 30.6 };
  const shiftedTip = { x: 109.1, y: 110.4 };
  const shiftedBounds = { left: 97, top: 29, right: 113, bottom: 113, width: 16, height: 84 };
  const match = matchPreviousSlantCandidate([first, neighbor], shiftedRoot, shiftedTip, shiftedBounds, new Set());
  assert.equal(match?.previous?.uid, 'first');
  assert.equal(
    matchPreviousSlantCandidate([first, neighbor], shiftedRoot, shiftedTip, shiftedBounds, new Set(['first']))?.previous?.uid,
    undefined,
    'an already restored candidate may not be reused for a second detected thigh'
  );
  assert.equal(
    matchPreviousSlantCandidate(
      [first, neighbor],
      { x: 210, y: 30 },
      { x: 218, y: 110 },
      { left: 206, top: 28, right: 222, bottom: 112, width: 16, height: 84 },
      new Set()
    ),
    null,
    'a distant thigh must remain pending rather than inherit another classification'
  );
});

test('transient measurement arming is not restored or persisted as project data', () => {
  const app1 = read('app-1.js');
  const app4 = read('app-4.js');
  assert.match(app1, /pendingMeasurement:\s*null/);
  assert.doesNotMatch(app1, /pendingMeasurement:\s*saved\.pendingMeasurement/);
  assert.match(app4, /captured\.professionalSuite\.pendingMeasurement = null/);
});

test('compound information and row candidates describe the action that is actually available', () => {
  const professional = read('professional-tools.js');
  const app2 = read('app-2.js');
  assert.match(professional, /className = 'metric-info-stack'/);
  assert.match(professional, /openMetricInfo\(metric\.id\)/);
  assert.match(professional, /אחרת תיבחר רק ירך שזוהתה כאיבר מתאר/);
  assert.match(app2, /מועמדים ממתינים לסיווג/);
});

test('composition is isolated, undoable and exported without diagnostic overlays', () => {
  const professional = read('professional-tools.js');
  const app1 = read('app-1.js');
  const app3 = read('app-3.js');
  const app4 = read('app-4.js');
  assert.match(professional, /function undoComposition/);
  assert.match(professional, /function handleCompositionKeyboardShortcut/);
  assert.match(professional, /propertiesPanel\?\.classList\.toggle\('composition-mode'/);
  assert.match(professional, /cleanExport: true/);
  assert.match(professional, /sourceFrameUid: sourceFrame\?\.uid/);
  assert.match(app1, /independentProfessionalState[\s\S]*composition:[\s\S]*correctionSessions:/);
  assert.doesNotMatch(app1, /professionalSuite:\s*structuredCloneSafe\(state\.professionalSuite\)/);
  assert.match(app3, /restoreProfessionalSuite\(retainedProfessionalInfo\)/);
  assert.doesNotMatch(app3, /removeCorrectionLinksForSources/);
  assert.match(app4, /handleCompositionKeyboardShortcut/);
  assert.match(app4, /signedAngleDeg/);
  assert.match(app4, /refreshCompositionSourceAvailability/);
});

test('source image export includes the same visible measurement result labels as the canvas', () => {
  const app4 = read('app-4.js');
  assert.match(app4, /function exportResultLabelPoint/);
  assert.match(app4, /isResultLabelVisible\(object\)/);
  assert.match(app4, /measurementResultModel\(object\)\.canvasText/);
  assert.match(app4, /drawExportScaleNote\(/);
  assert.match(app4, /placement === 'below'/);
  assert.match(app4, /candidateLabel = candidate\.eligible && hasBaseline/);
  assert.match(app4, /currentRowDeviation\(candidate\)/);
  assert.doesNotMatch(app4, /'slantScan', 'rowAlign'\]\.includes\(object\.type\)/);
});

test('export label placement keeps below-label measurements outside their geometry', () => {
  const { drawExportScaleNote, exportResultLabelPoint } = loadExportLabelHelpers();
  const placements = [];
  const context = {
    save() {}, restore() {}, setLineDash() {}, strokeRect() {}, fillText() {},
    measureText: () => ({ width: 40 }),
    fillRect(x, y, width, height) { placements.push({ x, y, width, height }); }
  };
  drawExportScaleNote(context, { x: 100, y: 100 }, 'above', '#000', 1, 'above');
  drawExportScaleNote(context, { x: 100, y: 100 }, 'below', '#000', 1, 'below');
  assert.equal(placements[0].y, 72);
  assert.equal(placements[1].y, 108);
  const ellipse = exportResultLabelPoint({
    type: 'ellipse',
    points: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 70 }, { x: 20, y: 70 }]
  });
  assert.equal(ellipse.placement, 'below');
  assert.equal(ellipse.point.y, 70);
  const kastel = exportResultLabelPoint({
    type: 'kastel',
    points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }]
  });
  assert.equal(kastel.placement, 'below');
  assert.equal(kastel.point.y, 90);
});

test('row alignment candidate labels obey the same visible toggle on canvas and export', () => {
  const { drawRowAlignmentObject, labels } = loadRowAlignmentDrawer();
  const context = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}
  };
  const object = {
    lineWidth: 3,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    display: { resultLabelVisible: false },
    rowAlignment: {
      baselineY: 42,
      candidates: [{ x1: 20, x2: 40, y: 40, eligible: true, confirmed: true, letter: 'ב', deviationPx: 2 }]
    }
  };
  drawRowAlignmentObject(context, object, { selected: false, draft: false, points: object.points });
  assert.equal(labels.length, 0, 'hidden result labels must stay hidden on the canvas');
  object.display.resultLabelVisible = true;
  drawRowAlignmentObject(context, object, { selected: false, draft: false, points: object.points });
  assert.equal(labels.length, 1, 'one visible candidate produces one canvas label');
});

test('an unselected thirds probe exports its visible dot instead of an orphan label', () => {
  const { drawObjectToContext } = loadExportObjectDrawer();
  const calls = { arcs: 0, fills: 0 };
  const context = {
    save() {}, restore() {}, beginPath() {}, setLineDash() {},
    arc() { calls.arcs++; }, fill() { calls.fills++; }
  };
  drawObjectToContext(context, {
    id: 7,
    type: 'thirds',
    points: [{ x: 40, y: 50 }],
    color: '#16a34a',
    lineWidth: 3,
    display: { resultLabelVisible: false }
  });
  assert.deepEqual(calls, { arcs: 1, fills: 1 });
});

test('touch targets and professional cards disclose their actual interaction mode', () => {
  const styles = read('styles.css');
  const system = loadMasterSystem();
  assert.match(styles, /metric-info[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(styles, /button,[^}]*min-block-size:44px/);
  assert.match(styles, /technical-details summary[^}]*min-block-size:44px/);
  assert.match(system.metric('slants-parallels').measurementDescription, /תחום סריקה/);
  for (const id of ['roofs', 'seats', 'stems']) {
    assert.equal(system.metric(id).operationMode, 'label-only');
    assert.match(system.metric(id).measurementDescription, /הכרטיס אינו מפעיל כלי/);
  }
});

test('asynchronous source loads are generation-guarded and row deviations use current calibration', () => {
  const app1 = read('app-1.js');
  const app2 = read('app-2.js');
  const app3 = read('app-3.js');
  const app4 = read('app-4.js');
  assert.match(app1, /loadGeneration:\s*0/);
  assert.match(app3, /const loadGeneration = requestedGeneration \?\? \+\+state\.loadGeneration/);
  assert.match(app3, /if \(loadGeneration !== state\.loadGeneration\) return/);
  assert.match(app4, /const loadGeneration = \+\+state\.loadGeneration/);
  assert.match(app1, /function currentRowDeviation/);
  assert.match(app2, /currentRowDeviation\(candidate\)/);
  assert.match(app4, /deviationNib:\s*currentRowDeviation\(candidate\)\.nib/);
});

test('four vector control levels keep a full editable source under the coarse views', () => {
  const source = read('letter-tools.js');
  for (const level of ['structural', 'organs', 'curves', 'full']) {
    assert.match(source, new RegExp(`['"]${level}['"]`));
  }
  assert.match(source, /function organLevelVectorHandles/);
  assert.match(source, /groupIds:\s*group\.map/);
  assert.match(source, /vectorDetailLevel:\s*'structural'/);
  assert.match(source, /maximumAnchors:\s*220/);
  assert.match(source, /sampleScale = Math\.min\([\s\S]*?2,/);
});

test('organ controls expose only explicit organ definitions and never invent sqrt groups', () => {
  const { organLevelVectorHandles } = loadLetterOrganHelpers();
  const handles = [];
  for (let commandIndex = 0; commandIndex < 9; commandIndex++) {
    handles.push({
      id: `p0:c${commandIndex}:anchor`, kind: 'anchor', pathIndex: 0, commandIndex,
      point: { x: commandIndex % 2 ? 100 : 0, y: commandIndex * 10 }
    });
  }
  for (const commandIndex of [12, 13]) {
    handles.push({
      id: `p0:c${commandIndex}:anchor`, kind: 'anchor', pathIndex: 0, commandIndex,
      point: { x: 50, y: commandIndex * 10 }
    });
  }
  for (let commandIndex = 0; commandIndex < 4; commandIndex++) {
    handles.push({
      id: `p1:c${commandIndex}:anchor`, kind: 'anchor', pathIndex: 1, commandIndex,
      point: { x: commandIndex % 2 ? 0 : 100, y: commandIndex * 10 }
    });
  }
  handles.push({
    id: 'p0:c1:control-in', kind: 'control', pathIndex: 0, commandIndex: 1,
    point: { x: 50, y: 5 }
  });

  assert.deepEqual(Array.from(organLevelVectorHandles(handles)), [], 'no topology means no alleged organs');
  assert.deepEqual(Array.from(organLevelVectorHandles(handles, [{
    id: 'legacy-group', type: 'stem', topologyStatus: 'bound-contour',
    anchorIds: ['p0:c1:anchor', 'p0:c2:anchor']
  }])), [], 'a legacy flat anchor group is not advertised as an independent organ');
  const definitions = [{
    id: 'stem-right', type: 'stem', label: 'ירך ימנית', topologyStatus: 'exclusive-contour-arc',
    paths: [{ rule: 'nonzero', commands: [{ type: 'M', x: 0, y: 0 }, { type: 'Z' }] }],
    anchorIds: ['p0:c1:anchor', 'p0:c2:anchor', 'p0:c12:anchor', 'missing-anchor']
  }];
  const groups = Array.from(organLevelVectorHandles(handles, definitions));
  assert.equal(groups.length, 1);
  assert.deepEqual(Array.from(groups[0].groupIds), ['p0:c1:anchor', 'p0:c2:anchor', 'p0:c12:anchor']);
  assert.equal(groups[0].organId, 'stem-right');
  assert.equal(groups[0].semanticType, 'stem-organ');
  assert.equal(groups[0].topologyStatus, 'exclusive-contour-arc');
  const source = read('letter-tools.js');
  assert.doesNotMatch(source, /Math\.round\(Math\.sqrt\(run\.length\)\)/);
});

test('organ-level freeform lasso selects exact full anchors instead of coarse representatives', () => {
  const { anchorIdsInsideLasso } = loadLetterOrganHelpers();
  const handles = [
    { id: 'p0:c0:anchor', kind: 'anchor', pathIndex: 0, commandIndex: 0, point: { x: 2, y: 2 } },
    { id: 'p0:c1:anchor', kind: 'anchor', pathIndex: 0, commandIndex: 1, point: { x: 8, y: 2 } },
    { id: 'p0:c2:anchor', kind: 'anchor', pathIndex: 0, commandIndex: 2, point: { x: 16, y: 2 } },
    { id: 'p1:c0:anchor', kind: 'anchor', pathIndex: 1, commandIndex: 0, point: { x: 5, y: 6 } },
    { id: 'p0:c1:control-in', kind: 'control', pathIndex: 0, commandIndex: 1, point: { x: 4, y: 4 } }
  ];
  const polygon = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.deepEqual(
    Array.from(anchorIdsInsideLasso(handles, polygon)),
    ['p0:c0:anchor', 'p0:c1:anchor', 'p1:c0:anchor']
  );
  const source = read('letter-tools.js');
  assert.match(source, /anchorIdsInsideLasso\(allHandles, points\)/);
  assert.match(source, /semanticType === 'stem-organ'/);
  assert.match(source, /overlap \/ ids\.length >= \.35/);
});

test('roof-stem junction editing uses an opposing outline pair instead of jumping one edge to the center', () => {
  const { pairedJunctionAnchorHandles, semanticFeatureCanEdit } = loadLetterOrganHelpers();
  const features = [
    {
      id: 'stem-0', type: 'stem-axis', widthPx: 14,
      root: { x: 75, y: 32 }, tip: { x: 75, y: 105 }
    },
    {
      id: 'junction-0', type: 'roof-stem-junction', stemId: 'stem-0',
      point: { x: 75, y: 32 }
    }
  ];
  const localAnchors = [
    { handle: { id: 'left-root' }, local: { x: 68, y: 32 } },
    { handle: { id: 'right-root' }, local: { x: 82, y: 32 } },
    { handle: { id: 'left-tip' }, local: { x: 68, y: 105 } },
    { handle: { id: 'right-tip' }, local: { x: 82, y: 105 } }
  ];
  assert.deepEqual(
    Array.from(pairedJunctionAnchorHandles(features[1], features, localAnchors, 5), handle => handle.id).sort(),
    ['left-root', 'right-root']
  );
  assert.deepEqual(
    Array.from(pairedJunctionAnchorHandles(features[1], features, localAnchors.filter(entry => entry.local.x >= 75), 5)),
    []
  );
  assert.equal(semanticFeatureCanEdit(features[0], [{ id: 'left-root' }]), false,
    'a stem axis needs two distinct outline anchors before it can be dragged');
  assert.equal(semanticFeatureCanEdit(features[1], [{ id: 'left-root' }, { id: 'right-root' }]), true);
  assert.equal(semanticFeatureCanEdit({ type: 'roof-endpoint' }, [{ id: 'roof-corner' }]), false,
    'a virtual roof midpoint is a reference point, not an absolute drag target');
  assert.equal(semanticFeatureCanEdit({ type: 'component-axis' }, [{ id: 'outline-corner' }]), false,
    'a component centerline is reference-only until it has a real outline pair');
  assert.equal(semanticFeatureCanEdit(
    { type: 'contour-extremum', point: { x: 18, y: 25 } },
    [{ id: 'outline-extreme', local: { x: 18.4, y: 25.2 } }]
  ), true, 'a real contour extremum remains editable when its backing anchor is colocated');
  assert.equal(semanticFeatureCanEdit(
    { type: 'contour-extremum', point: { x: 18, y: 25 } },
    [{ id: 'distant-anchor', local: { x: 18, y: 32 } }]
  ), false, 'a displayed point may not drag a distant backing anchor by absolute coordinates');
  const pointerSource = read('app-2.js');
  assert.match(pointerSource, /letterVectorHandle\.editable === false/);
  assert.match(pointerSource, /נקודת ייחוס/);
});

test('Bezier control edits do not refit semantic axes from unchanged anchors', () => {
  const shouldReconcile = loadVectorDragReconcileGuard();
  assert.equal(shouldReconcile({ type: 'letterVectorHandle', vectorHandleKind: 'control' }, null), false);
  assert.equal(shouldReconcile({ type: 'letterVectorHandle', vectorHandleKind: 'anchor' }, null), true);
  assert.equal(shouldReconcile({ type: 'letterVectorGroup' }, null), true);
  assert.equal(shouldReconcile(
    { type: 'letterVectorHandle', vectorHandleKind: 'anchor' },
    { featureId: 'component-0-stem-0' }
  ), false, 'semantic handles update their own linked feature and must not trigger a second global refit');
  const pointerSource = read('app-2.js');
  assert.match(pointerSource, /vectorHandleKind:\s*hit\.letterVectorHandle\.kind/);
});

test('semantic stem reconciliation keeps a vertical centerline and fails stale instead of inventing an axis', () => {
  const verticalOutline = [
    { x: 18, y: 18 }, { x: 104, y: 18 }, { x: 104, y: 32 },
    { x: 82, y: 32 }, { x: 82, y: 105 }, { x: 68, y: 105 },
    { x: 68, y: 32 }, { x: 18, y: 32 }
  ].map((point, index) => ({ id: `p0:c${index}:anchor`, kind: 'anchor', point }));
  const makeObject = () => ({
    letterVector: {
      revision: 2,
      viewBox: [0, 0, 120, 120],
      features: [
        {
          id: 'stem-0', type: 'stem-axis', widthPx: 14,
          point: { x: 75, y: 32 }, root: { x: 75, y: 32 },
          tip: { x: 75, y: 104.5 }, angleDeg: 0
        },
        {
          id: 'junction-0', type: 'roof-stem-junction', stemId: 'stem-0',
          point: { x: 75, y: 32 }, root: { x: 75, y: 32 }, tip: { x: 75, y: 104.5 }
        }
      ]
    }
  });

  const object = makeObject();
  loadSemanticReconcileHelper(verticalOutline)(object);
  const stem = object.letterVector.features[0];
  assert.ok(Math.abs(stem.root.x - 75) < 1e-9);
  assert.ok(Math.abs(stem.tip.x - 75) < 1e-9);
  assert.ok(Math.abs(stem.root.y - 32) < 1e-9);
  assert.ok(Math.abs(stem.tip.y - 104.5) < 1e-9);
  assert.ok(Math.abs(stem.angleDeg) < 1e-9);
  assert.equal(stem.geometryStatus, 'current');

  const unpaired = verticalOutline.filter(handle => handle.point.x >= 75);
  const staleObject = makeObject();
  loadSemanticReconcileHelper(unpaired)(staleObject);
  const staleStem = staleObject.letterVector.features[0];
  assert.deepEqual(staleStem.root, { x: 75, y: 32 });
  assert.deepEqual(staleStem.tip, { x: 75, y: 104.5 });
  assert.equal(staleStem.geometryStatus, 'stale');
  assert.equal(staleStem.staleReason, 'unpaired-outline-after-edit');
});

test('semantic roof reconciliation keeps endpoint centerlines and fails stale without an opposing edge pair', () => {
  const verticalOutline = [
    { x: 18, y: 18 }, { x: 104, y: 18 }, { x: 104, y: 32 },
    { x: 82, y: 32 }, { x: 82, y: 105 }, { x: 68, y: 105 },
    { x: 68, y: 32 }, { x: 18, y: 32 }
  ].map((point, index) => ({ id: `p0:c${index}:anchor`, kind: 'anchor', point }));
  const makeObject = () => ({
    letterVector: {
      revision: 2,
      viewBox: [0, 0, 120, 120],
      features: [
        {
          id: 'roof-left', type: 'roof-endpoint', componentIndex: 0,
          point: { x: 18, y: 25 }
        },
        {
          id: 'roof-right', type: 'roof-endpoint', componentIndex: 0,
          point: { x: 104, y: 25 }
        }
      ]
    }
  });

  const object = makeObject();
  loadSemanticReconcileHelper(verticalOutline)(object);
  const [left, right] = object.letterVector.features;
  assert.equal(left.point.x, 18);
  assert.equal(left.point.y, 25);
  assert.equal(right.point.x, 104);
  assert.equal(right.point.y, 25);
  assert.equal(left.geometryStatus, 'current');
  assert.equal(right.geometryStatus, 'current');

  const missingLeftLowerEdge = verticalOutline.filter(handle => !(
    handle.point.x === 18 && handle.point.y === 32
  ));
  const staleObject = makeObject();
  loadSemanticReconcileHelper(missingLeftLowerEdge)(staleObject);
  const staleLeft = staleObject.letterVector.features[0];
  assert.deepEqual(staleLeft.point, { x: 18, y: 25 });
  assert.equal(staleLeft.geometryStatus, 'stale');
  assert.equal(staleLeft.staleReason, 'unpaired-roof-outline-after-edit');
});
