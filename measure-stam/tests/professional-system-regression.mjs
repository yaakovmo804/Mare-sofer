#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  IRREGULAR_SLANT_EXPECTATIONS,
  grayRasterCanvas,
  irregularFixtureRoleForRootX,
  paddedIrregularSlantFixture
} from './slant-fixtures.mjs';

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
    constructor(tagName, { type = null, label = null, parent = null, contenteditable = null } = {}) {
      this.tagName = tagName.toLowerCase();
      this.type = type;
      this.label = label;
      this.parent = parent;
      this.contenteditable = contenteditable;
      this.control = null;
      this.blurCount = 0;
    }
    getAttribute(name) {
      if (name === 'type') return this.type;
      if (name === 'contenteditable') return this.contenteditable;
      return null;
    }
    hasAttribute(name) {
      return name === 'contenteditable' && this.contenteditable !== null;
    }
    matches(selector) {
      return selector.split(',').some(part => {
        const candidate = part.trim();
        if (candidate === this.tagName) return true;
        if (candidate === '[contenteditable="true"]') return this.contenteditable === 'true';
        if (candidate === '[contenteditable]') return this.hasAttribute('contenteditable');
        if (candidate === '[contenteditable]:not([contenteditable="false"])') {
          return this.hasAttribute('contenteditable') && this.contenteditable !== 'false';
        }
        return false;
      });
    }
    closest(selector) {
      if (selector === 'label' && this.label) return this.label;
      for (let node = this; node; node = node.parent) {
        if (node.matches(selector)) return node;
      }
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
  const start = source.indexOf('function drawDetectedStemBodyToContext');
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

function loadHitTestHarness(objects, selectedId = null) {
  const source = read('app-2.js');
  const start = source.indexOf('function hitTest(imagePoint)');
  const end = source.indexOf('function ensureCompatibleDraft', start);
  assert.ok(start >= 0 && end > start, 'canvas hit testing must remain available');
  const state = { objects, selectedId, view: { scale: 1 } };
  const context = vm.createContext({
    state,
    isLetterTemplate: () => false,
    nearestLetterHandle: () => null,
    nearestLetterVectorHandle: () => null,
    pointInLetterTemplate: () => false,
    nearestPointIndex: () => -1,
    selectedAreaEditHit: () => null,
    flattenedAreaPoints: object => object.points,
    pointInPolygon: () => true,
    pointLineDistance: () => Infinity,
    distance: () => Infinity
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.hitTest = hitTest;`, context);
  return { hitTest: context.hitTest, state };
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

function loadSlantScanHarness(image, nibPx, scan) {
  const source = read('professional-tools.js');
  const fullScanStart = source.indexOf('function runFullImageSlantScan');
  const fullScanEnd = source.indexOf('function activateProfessionalMetric', fullScanStart);
  const start = source.indexOf('function slantCandidateIsLinkedToScan');
  const end = source.indexOf('function drawSlantScanObject', start);
  assert.ok(fullScanStart >= 0 && fullScanEnd > fullScanStart, 'direct full-image slant workflow must remain available');
  assert.ok(start >= 0 && end > start, 'complete slant scan workflow must remain available');
  const system = loadMasterSystem();
  const analyzer = require('../slant-analyzer.js');
  const panel = { hidden: true };
  const statusText = { textContent: '' };
  const state = {
    image,
    formula: { nibPx },
    objects: scan ? [scan] : [],
    nextId: 100,
    draft: null,
    selectedId: null
  };
  const professionalSuite = {};
  const calls = { snapshots: 0, panels: 0 };
  const context = vm.createContext({
    console,
    Math,
    Number,
    Set,
    Map,
    Date,
    Infinity,
    state,
    professionalSuite,
    MASTER_SYSTEM: system,
    MEDIDAOT_SLANT_ANALYZER: analyzer,
    document: {
      createElement(tagName) {
        assert.equal(tagName, 'canvas');
        return createCanvas(1, 1);
      }
    },
    $: id => id === 'professionalSuitePanel' ? panel : null,
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    midpoint: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    structuredCloneSafe: value => JSON.parse(JSON.stringify(value)),
    enforceSemanticStyle() {},
    markObjectModified() {},
    renderAll() {},
    renderProfessionalPanel() { calls.panels++; },
    switchWorkspaceMode() {},
    cancelDraft() { state.draft = null; },
    setTool(tool) { state.tool = tool; },
    snapshot() { calls.snapshots++; },
    statusText,
    makeObject(type, points, extra = {}) {
      const id = state.nextId++;
      return { id, uid: `fixture-object-${id}`, type, points, ...extra };
    }
  });
  context.globalThis = context;
  vm.runInContext(
    `${source.slice(fullScanStart, fullScanEnd)}\n${source.slice(start, end)}\n` +
      'this.analyzeSlantScan = analyzeSlantScan; this.runFullImageSlantScan = runFullImageSlantScan;',
    context
  );
  return {
    analyzeSlantScan: context.analyzeSlantScan,
    runFullImageSlantScan: context.runFullImageSlantScan,
    state,
    professionalSuite,
    panel,
    statusText,
    calls
  };
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

function loadBoundFeatureRefreshHelper(handles) {
  const source = read('letter-tools.js');
  const start = source.indexOf('function refreshBoundVectorFeaturePoints');
  const end = source.indexOf('function updateSemanticFeatureAfterHandleMove', start);
  assert.ok(start >= 0 && end > start, 'bound feature refresh helper must remain available');
  const engine = { enumerateHandles: () => handles };
  const context = vm.createContext({
    Math,
    Map,
    letterAsset: () => null,
    letterVectorEngine: () => engine,
    midpoint: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.refreshBoundVectorFeaturePoints = refreshBoundVectorFeaturePoints;`, context);
  return context.refreshBoundVectorFeaturePoints;
}

function loadLetterMasterSignature() {
  const source = read('letter-tools.js');
  const start = source.indexOf('function letterMasterSignature');
  const end = source.indexOf('function createLetterMaskCanvas', start);
  assert.ok(start >= 0 && end > start, 'letter render signature helper must remain available');
  const calls = [];
  const engine = {
    getRenderVector(object, options) {
      calls.push({ object, options });
      return { paths: object.topologyRenderPaths };
    }
  };
  const context = vm.createContext({
    Math,
    Number,
    letterVectorEngine: () => engine
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.letterMasterSignature = letterMasterSignature;`, context);
  return { letterMasterSignature: context.letterMasterSignature, calls };
}

function loadPhotographedResetHarness() {
  const source = read('letter-tools.js');
  const start = source.indexOf('function resetSelectedLetterRatio');
  const end = source.indexOf('function samePhotographedSourceRegion', start);
  assert.ok(start >= 0 && end > start, 'photographed reset helper must remain available');
  const object = {
    id: 71,
    type: 'letterTemplate',
    editTarget: 'source-region',
    role: 'editable-source-region',
    color: '#111111',
    letterOpacity: 1,
    correctionHandleIds: ['o:stem:p0:c1:anchor'],
    points: [{ x: 5, y: 6 }, { x: 60, y: 70 }],
    letterVector: { revision: 9, paths: [{ commands: [{ type: 'M', x: 1, y: 2 }] }] },
    sourceOriginalPoints: [{ x: 10, y: 20 }, { x: 90, y: 120 }],
    sourceOriginalVector: { revision: 1, paths: [{ commands: [{ type: 'M', x: 4, y: 8 }] }] },
    sourceOverlayColor: '#2244aa'
  };
  const state = {
    selectedId: object.id,
    objects: [object],
    letterVectorSelection: { id: object.id, handleIds: object.correctionHandleIds.slice() }
  };
  const calls = { snapshots: 0, renders: 0, modifications: 0 };
  const context = vm.createContext({
    state,
    statusText: { textContent: '' },
    selectedLetterTemplate: () => object,
    isPhotographedVector: candidate => candidate === object,
    isSourceRegionEdit: candidate => candidate.editTarget === 'source-region',
    structuredCloneSafe: value => JSON.parse(JSON.stringify(value)),
    snapshot: () => { calls.snapshots++; },
    markObjectModified: () => { calls.modifications++; },
    renderAll: () => { calls.renders++; }
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.resetSelectedLetterRatio = resetSelectedLetterRatio;`, context);
  return { resetSelectedLetterRatio: context.resetSelectedLetterRatio, object, state, calls, statusText: context.statusText };
}

function loadNibActivationHarness() {
  const source = read('professional-tools.js');
  const start = source.indexOf('function activateProfessionalMetric');
  const end = source.indexOf('function measurementValueNib', start);
  assert.ok(start >= 0 && end > start, 'professional metric activation must remain available');
  const state = {
    image: null,
    draft: { type: 'length', semanticMetricId: 'widths' },
    formula: { analysis: { status: 'idle' } },
    tool: 'length'
  };
  const professionalSuite = {
    activeMetricId: 'widths',
    pendingMeasurement: { semanticMetricId: 'widths', tool: 'length' }
  };
  const calls = [];
  const context = vm.createContext({
    state,
    professionalSuite,
    statusText: { textContent: '' },
    MASTER_SYSTEM: { metric: id => id === 'nib' ? { id: 'nib', name: 'עובי קולמוס' } : null },
    switchWorkspaceMode: mode => calls.push(['workspace', mode]),
    startAutomaticNibAnalysis: options => calls.push(['startAutomaticNibAnalysis', options]),
    renderProfessionalReport: id => calls.push(['report', id])
  });
  context.globalThis = context;
  vm.runInContext(`${source.slice(start, end)}\nthis.activateProfessionalMetric = activateProfessionalMetric;`, context);
  return { activateProfessionalMetric: context.activateProfessionalMetric, state, professionalSuite, calls };
}

function loadSnapshotHarness(options = {}) {
  const source = read('app-1.js');
  const start = source.indexOf('function captureSnapshot');
  const end = source.indexOf('function mergeProfessionalSuite', start);
  assert.ok(start >= 0 && end > start, 'snapshot capture and restore helpers must remain available');
  const state = {
    objects: [{ id: 1, type: 'kastel' }],
    formula: { analysis: { status: 'idle' }, calibration: {} },
    tool: options.tool || 'thirds',
    professionalSuite: {
      activeGroup: 'regaim',
      activeMetricId: 'thirds',
      descriptions: {}, measurementNotes: {}, composition: {}, correctionSessions: [],
      pendingMeasurement: options.pendingMeasurement || null
    },
    nextId: 2,
    calibrationAnalysisToken: 0,
    activeCalibrationRegionId: null,
    selectedId: 1,
    selectedPoint: { index: 0 },
    selectedSegment: 0,
    letterVectorSelection: { id: 1 }
  };
  const syncedTools = [];
  const autoCancelCalls = [];
  const context = vm.createContext({
    state,
    analysisOverlay: { hidden: false },
    ui: { color: { value: '#000000' } },
    TOOL_COLORS: { thirds: '#16a34a', length: '#2563eb', circle: '#db2777', pan: '#000000' },
    MASTER_SYSTEM: {
      metric(id) {
        if (id === 'widths') return { id, tool: 'length', axisConstraint: 'horizontal' };
        if (id === 'heights') return { id, tool: 'length', axisConstraint: 'vertical' };
        if (id === 'thirds') return { id, tool: 'thirds' };
        if (id === 'circle-ellipse') return { id, tool: 'ellipse' };
        return null;
      },
      colorFor: () => '#16a34a'
    },
    structuredCloneSafe: value => JSON.parse(JSON.stringify(value)),
    mergeFormula: value => JSON.parse(JSON.stringify(value)),
    restoreProfessionalSuite(saved) {
      state.professionalSuite = { ...state.professionalSuite, ...saved, pendingMeasurement: null };
    },
    nextAvailableId: () => 99,
    syncToolControlState: tool => syncedTools.push(tool),
    renderAll: () => {},
    MEDIDAOT_AUTO_MEASURE: {
      cancelActiveRun: options => autoCancelCalls.push(options)
    }
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.snapshotHelpers = { captureSnapshot, restoreSnapshot, cancelCalibrationAnalysis };`, context);
  return { ...context.snapshotHelpers, state, syncedTools, autoCancelCalls };
}

function loadProfessionalArmHarness() {
  const source = read('professional-tools.js');
  const start = source.indexOf('function armProfessionalMeasurement');
  const end = source.indexOf('function activateProfessionalMetric', start);
  assert.ok(start >= 0 && end > start, 'professional measurement arming must remain available');
  const state = { draft: null };
  const professionalSuite = { pendingMeasurement: null };
  const context = vm.createContext({ state, professionalSuite });
  vm.runInContext(`${source.slice(start, end)}\nthis.armProfessionalMeasurement = armProfessionalMeasurement;`, context);
  return { armProfessionalMeasurement: context.armProfessionalMeasurement, state, professionalSuite };
}

function loadProjectProfessionalMerge() {
  const source = read('app-1.js');
  const start = source.indexOf('function mergeProfessionalSuite');
  const end = source.indexOf('function restoreProfessionalSuite', start);
  assert.ok(start >= 0 && end > start, 'project professional-state merge must remain available');
  const context = vm.createContext({
    Number,
    MASTER_SYSTEM: {
      metric: id => ['widths', 'heights'].includes(id) ? { id, tool: 'length' } : null,
      mergeDescriptions: value => ({ ...(value || {}) }),
      mergeMeasurementNotes: value => ({ ...(value || {}) })
    },
    structuredCloneSafe: value => JSON.parse(JSON.stringify(value))
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.mergeProfessionalSuite = mergeProfessionalSuite;`, context);
  return context.mergeProfessionalSuite;
}

function loadCommitDraftHarness() {
  const source = read('app-3.js');
  const start = source.indexOf('function commitDraft');
  const end = source.indexOf('function replaceCalibrationOverlays', start);
  assert.ok(start >= 0 && end > start, 'draft commit helper must remain available');
  const draft = {
    id: 81, type: 'length', semanticMetricId: 'widths', axisConstraint: 'horizontal',
    points: [{ x: 0, y: 12 }, { x: 40, y: 12 }]
  };
  const state = {
    draft,
    objects: [], draftHistory: [{}], selectedPoint: { index: 1 }, selectedSegment: 0,
    letterVectorSelection: { id: 81 }, formula: {},
    professionalSuite: {
      pendingMeasurement: { semanticMetricId: 'widths', tool: 'length', axisConstraint: 'horizontal' }
    },
    tool: 'length'
  };
  const toolCalls = [];
  const context = vm.createContext({
    state,
    statusText: { textContent: '' },
    snapshot: () => {},
    setTool: tool => { state.tool = tool; toolCalls.push(tool); },
    syncFormulaFromObject: () => {},
    selectObject: id => { state.selectedId = id; }
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.commitDraft = commitDraft;`, context);
  return { commitDraft: context.commitDraft, state, toolCalls };
}

function loadGenericToolbarHarness() {
  const source = read('app-3.js');
  const start = source.indexOf("document.querySelectorAll('.tool[data-tool]').forEach");
  const end = source.indexOf("$('thirdsToggleBtn')", start);
  assert.ok(start >= 0 && end > start, 'generic toolbar handler must remain available');
  const listeners = new Map();
  const button = {
    dataset: { tool: 'length' },
    addEventListener(name, listener) { listeners.set(name, listener); }
  };
  const state = {
    draft: {
      id: 79, type: 'length', semanticMetricId: 'widths', axisConstraint: 'horizontal',
      points: [{ x: 0, y: 4 }]
    },
    professionalSuite: {
      pendingMeasurement: { semanticMetricId: 'widths', tool: 'length', axisConstraint: 'horizontal' }
    }
  };
  const toolCalls = [];
  const cancelCalls = [];
  const context = vm.createContext({
    state,
    document: { querySelectorAll: () => [button] },
    cancelDraft() { cancelCalls.push(state.draft?.id); state.draft = null; },
    setTool: tool => toolCalls.push(tool),
    MEDIDAOT_PROFESSIONAL_TOOLS: { switchWorkspaceMode: () => {} }
  });
  context.globalThis = context;
  vm.runInContext(source.slice(start, end), context);
  return { state, button, click: listeners.get('click'), toolCalls, cancelCalls };
}

function loadSetToolHarness() {
  const source = read('app-3.js');
  const start = source.indexOf('function setTool');
  const end = source.indexOf("document.querySelectorAll('.tool[data-tool]')", start);
  assert.ok(start >= 0 && end > start, 'tool status helper must remain available');
  const state = {
    tool: 'pan', vectorizeLasso: null, letterVectorLasso: null,
    professionalSuite: { pendingMeasurement: null }
  };
  const lassoButton = { classList: { remove() {} } };
  const context = vm.createContext({
    state,
    ui: { color: { value: '#000000' } },
    statusText: { textContent: '' },
    TOOL_COLORS: { length: '#2563eb', thirds: '#16a34a', pan: '#000000' },
    MASTER_SYSTEM: {
      metric: id => ['widths', 'heights'].includes(id) ? { id, tool: 'length' } : null,
      colorFor: () => '#2563eb'
    },
    settleDraftBeforeToolChange: () => null,
    syncToolControlState: () => {},
    selectedVariableName: () => 'מרווח',
    activateFormulaTab: () => {},
    renderAll: () => {},
    $: () => lassoButton
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.setTool = setTool;`, context);
  return { setTool: context.setTool, state, statusText: context.statusText };
}

function loadProfessionalDraftTransitionHarness() {
  const source = read('app-3.js');
  const commitStart = source.indexOf('function commitDraft');
  const commitEnd = source.indexOf('function replaceCalibrationOverlays', commitStart);
  const settleStart = source.indexOf('function settleDraftBeforeToolChange');
  const setToolStart = source.indexOf('function setTool', settleStart);
  const setToolEnd = source.indexOf("document.querySelectorAll('.tool[data-tool]')", setToolStart);
  assert.ok(commitStart >= 0 && commitEnd > commitStart && settleStart >= 0 &&
    setToolStart > settleStart && setToolEnd > setToolStart,
  'draft commit, settling and tool transition helpers must remain available');
  const descriptor = {
    semanticMetricId: 'widths', category: 'width', name: 'קו רוחב אופקי',
    tool: 'length', axisConstraint: 'horizontal'
  };
  const state = {
    tool: 'length',
    draft: {
      id: 91, type: 'length', semanticMetricId: 'widths', axisConstraint: 'horizontal',
      points: [{ x: 5, y: 20 }, { x: 45, y: 20 }]
    },
    objects: [], draftHistory: [], selectedPoint: { target: 'draft', index: 1 },
    selectedSegment: null, letterVectorSelection: null, vectorizeLasso: null,
    letterVectorLasso: null, activePointerId: null, interactionBefore: null, dragging: null,
    formula: { analysis: {}, selectedVariable: 'common-gap' },
    professionalSuite: { pendingMeasurement: descriptor },
    history: []
  };
  const toolCalls = [];
  const context = vm.createContext({
    Math,
    state,
    ui: { color: { value: '#000000' }, angleRef: { value: 'nearest' } },
    statusText: { textContent: '' },
    TOOL_COLORS: { length: '#2563eb', thirds: '#16a34a', pan: '#000000' },
    MASTER_SYSTEM: {
      metric: id => id === 'widths' ? { id, tool: 'length' } : null,
      colorFor: () => '#2563eb'
    },
    canvas: { releasePointerCapture() {} },
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    snapshot() {
      state.history.push({
        tool: state.tool,
        professionalSuite: {
          pendingMeasurement: JSON.parse(JSON.stringify(state.professionalSuite.pendingMeasurement))
        }
      });
    },
    syncFormulaFromObject: () => {},
    selectObject: id => { state.selectedId = id; },
    syncToolControlState: tool => toolCalls.push(tool),
    selectedVariableName: () => 'מרווח',
    activateFormulaTab: () => {},
    renderAll: () => {},
    $: () => ({ classList: { remove() {} } })
  });
  vm.runInContext(`
    ${source.slice(commitStart, commitEnd)}
    ${source.slice(settleStart, setToolEnd)}
    this.setTool = setTool;
  `, context);
  return { setTool: context.setTool, state, descriptor, toolCalls, statusText: context.statusText };
}

function loadAutomaticNibStartHarness() {
  const source = read('app-3.js');
  const start = source.indexOf('function startAutomaticNibAnalysis');
  const end = source.indexOf("$('analyzeBtn')", start);
  assert.ok(start >= 0 && end > start, 'automatic nib coordinator must remain available');
  const state = {
    image: { width: 20, height: 20 },
    draft: { type: 'length', semanticMetricId: 'widths' },
    formula: { analysis: { status: 'running' } },
    professionalSuite: {
      pendingMeasurement: { semanticMetricId: 'widths', tool: 'length', axisConstraint: 'horizontal' }
    },
    calibrationAnalysisToken: 5,
    tool: 'length'
  };
  const calls = [];
  const completedTask = Promise.resolve({ valuePx: 7 });
  const context = vm.createContext({
    state,
    statusText: { textContent: '' },
    cancelDraft() { calls.push('cancelDraft'); state.draft = null; },
    cancelCalibrationAnalysis() {
      calls.push('cancelCalibrationAnalysis');
      state.calibrationAnalysisToken++;
      state.formula.analysis.status = 'idle';
    },
    setTool(tool) { calls.push(`setTool:${tool}`); state.tool = tool; },
    activateFormulaTab(tab) { calls.push(`formulaTab:${tab}`); },
    renderFormulaUI: () => {},
    MEDIDAOT_AUTO_MEASURE: {
      runNib(options) { calls.push(['runNib', options]); return completedTask; }
    }
  });
  context.globalThis = context;
  vm.runInContext(`${source.slice(start, end)}\nthis.startAutomaticNibAnalysis = startAutomaticNibAnalysis;`, context);
  return { startAutomaticNibAnalysis: context.startAutomaticNibAnalysis, state, calls, completedTask };
}

function loadStandardMeasurementToolHarness() {
  const source = read('app-3.js');
  const start = source.indexOf('function startStandardMeasurementTool');
  const end = source.indexOf("$('startNibBtn')", start);
  assert.ok(start >= 0 && end > start, 'standard manual tool coordinator must remain available');
  const descriptor = { semanticMetricId: 'balconies', tool: 'gap', formulaKey: 'balcony' };
  const state = {
    draft: {
      id: 101, type: 'gap', semanticMetricId: 'balconies', formulaKey: 'balcony',
      points: [{ x: 5, y: 5 }]
    },
    professionalSuite: { pendingMeasurement: descriptor }
  };
  const calls = [];
  const context = vm.createContext({
    state,
    cancelDraft() {
      calls.push({ name: 'cancelDraft', pendingAtCancel: state.professionalSuite.pendingMeasurement });
      state.draft = null;
    },
    cancelCalibrationAnalysis: () => calls.push({ name: 'cancelCalibrationAnalysis' }),
    setTool: tool => calls.push({ name: 'setTool', tool }),
    MEDIDAOT_PROFESSIONAL_TOOLS: { switchWorkspaceMode: () => {} }
  });
  context.globalThis = context;
  vm.runInContext(`${source.slice(start, end)}\nthis.startStandardMeasurementTool = startStandardMeasurementTool;`, context);
  return { startStandardMeasurementTool: context.startStandardMeasurementTool, state, descriptor, calls };
}

function loadThirdsToggleHarness(kastel) {
  const source = read('app-3.js');
  const start = source.indexOf('function prepareKastelAction');
  const end = source.indexOf('function detectActiveKastelStructure', start);
  assert.ok(start >= 0 && end > start, 'thirds toggle helper must remain available');
  const state = { objects: [kastel], tool: 'thirds' };
  const toolCalls = [];
  const context = vm.createContext({
    state,
    statusText: { textContent: '' },
    activeKastelForAction: () => kastel,
    setTool: tool => { state.tool = tool; toolCalls.push(tool); },
    snapshot: () => {},
    markObjectModified: () => {},
    selectObject: () => {},
    renderAll: () => {}
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.toggleKastelThirds = toggleKastelThirds;`, context);
  return { toggleKastelThirds: context.toggleKastelThirds, state, toolCalls, statusText: context.statusText };
}

function loadDeleteSelectedHarness(objects, selectedId) {
  const source = read('app-3.js');
  const start = source.indexOf('function deleteSelectedObject');
  const end = source.indexOf('function activateFormulaTab', start);
  assert.ok(start >= 0 && end > start, 'selected-object deletion helper must remain available');
  const state = {
    objects,
    selectedId,
    selectedPoint: null,
    selectedSegment: null,
    letterVectorSelection: null,
    formula: { nibSamples: [] },
    activeCalibrationRegionId: null
  };
  const withdrawn = [];
  const context = vm.createContext({
    state,
    statusText: { textContent: '' },
    snapshot: () => {},
    isLetterTemplate: () => false,
    withdrawNibFromKastelRoof: object => withdrawn.push(object.id),
    renderAll: () => {}
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.deleteSelectedObject = deleteSelectedObject;`, context);
  return { deleteSelectedObject: context.deleteSelectedObject, state, withdrawn };
}

function loadThirdsMeasurementHarness() {
  const source = read('app-2.js');
  const resultStart = source.indexOf('function measurementResultModel');
  const resultEnd = source.indexOf('function renderList', resultStart);
  const pointerStart = source.indexOf('function handleThirdsPointer');
  assert.ok(resultStart >= 0 && resultEnd > resultStart && pointerStart >= 0,
    'thirds result and pointer helpers must remain available');
  const kastel = {
    id: 12,
    type: 'kastel',
    points: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }]
  };
  const state = {
    objects: [kastel], selectedId: kastel.id, draft: null,
    formula: { nibPx: 9 }
  };
  const context = vm.createContext({
    Math,
    state,
    statusText: { textContent: '' },
    TOOL_COLORS: { thirds: '#16a34a' },
    typeLabel: type => type,
    fmt: value => Number(value).toFixed(1),
    thirdsValues: () => ({ xPct: 42, xDev: 8.666 }),
    pointInPolygon: () => true,
    snapshot: () => {},
    makeObject: (type, points, extra) => ({ id: 13, type, points, ...extra }),
    selectObject: id => { state.selectedId = id; }
  });
  vm.runInContext(`${source.slice(resultStart, resultEnd)}\n${source.slice(pointerStart)}\nthis.thirdsHelpers = { measurementResultModel, handleThirdsPointer };`, context);
  return { ...context.thirdsHelpers, state, kastel, statusText: context.statusText };
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

test('manual organ feature refresh recognizes both exact and prefixed terminal roles', () => {
  const handles = [
    ['root-a', 0, 0], ['root-b', 10, 0],
    ['terminal', 7, 100], ['terminal-left', 3, 96], ['terminal-right', 11, 104]
  ].map(([id, x, y]) => ({ id, kind: 'anchor', point: { x, y } }));
  const refresh = loadBoundFeatureRefreshHelper(handles);
  const makeObject = terminalRoles => ({
    letterVector: {
      features: [{
        id: 'manual-axis', type: 'stem-axis', organId: 'manual-stem',
        root: { x: -1, y: -1 }, point: { x: -1, y: -1 }, tip: { x: -1, y: -1 }
      }, {
        id: 'root-a-feature', type: 'stem-landmark', role: 'root-a',
        stemId: 'manual-axis', organId: 'manual-stem', anchorIds: ['root-a']
      }, {
        id: 'root-b-feature', type: 'stem-landmark', role: 'root-b',
        stemId: 'manual-axis', organId: 'manual-stem', anchorIds: ['root-b']
      }, ...terminalRoles.map((role, index) => ({
        id: `terminal-${index}`, type: 'stem-landmark', role,
        stemId: 'manual-axis', organId: 'manual-stem', anchorIds: [role]
      })), {
        id: 'manual-stem', type: 'stem-organ', stemId: 'manual-axis', organId: 'manual-stem',
        anchorIds: handles.map(handle => handle.id)
      }]
    }
  });

  const singleTerminal = makeObject(['terminal']);
  refresh(singleTerminal, 'manual-stem');
  const exactAxis = singleTerminal.letterVector.features.find(feature => feature.type === 'stem-axis');
  assert.deepEqual({ ...exactAxis.root }, { x: 5, y: 0 });
  assert.deepEqual({ ...exactAxis.tip }, { x: 7, y: 100 },
    'the unsuffixed terminal created for a single tip must refresh the axis');

  const pairedTerminals = makeObject(['terminal-left', 'terminal-right']);
  refresh(pairedTerminals, 'manual-stem');
  const prefixedAxis = pairedTerminals.letterVector.features.find(feature => feature.type === 'stem-axis');
  assert.deepEqual({ ...prefixedAxis.tip }, { x: 7, y: 100 },
    'prefixed terminal roles must still refresh to their mean point');
});

test('weighted preview signatures hash the current topology render, not immutable source paths', () => {
  const { letterMasterSignature, calls } = loadLetterMasterSignature();
  const sourcePaths = [{ rule: 'evenodd', commands: [
    { type: 'M', x: 0, y: 0 }, { type: 'L', x: 20, y: 0 }, { type: 'Z' }
  ] }];
  const asset = { style: 'photographed-letter', slug: 'selection' };
  const first = {
    letterVector: { paths: sourcePaths },
    topologyRenderPaths: [{ rule: 'evenodd', commands: [
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 20, y: 0 }, { type: 'Z' }
    ] }]
  };
  const second = {
    letterVector: { paths: sourcePaths },
    topologyRenderPaths: [{ rule: 'evenodd', commands: [
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 24, y: 4 }, { type: 'Z' }
    ] }]
  };

  const firstSignature = letterMasterSignature(first, asset);
  const secondSignature = letterMasterSignature(second, asset);
  assert.notEqual(firstSignature, secondSignature,
    'two independent-organ layouts with identical source contours need different weight caches');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.options.weight), [1, 1],
    'the signature must be based on the neutral-weight topology render');
});

test('resetting a photographed vector clears stale correction handles and restores its source lifecycle', () => {
  const harness = loadPhotographedResetHarness();
  harness.resetSelectedLetterRatio();

  assert.deepEqual(Array.from(harness.object.correctionHandleIds), []);
  assert.equal(harness.state.letterVectorSelection, null);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.object.letterVector)), harness.object.sourceOriginalVector);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.object.points)), harness.object.sourceOriginalPoints);
  assert.equal(harness.object.editTarget, 'overlay-copy', 'reset reveals the photograph instead of leaving a source patch');
  assert.equal(harness.object.role, 'reference-overlay');
  assert.equal(harness.calls.snapshots, 1);
  assert.equal(harness.calls.modifications, 1);
  assert.equal(harness.calls.renders, 1);
});

test('the professional nib card delegates to the shared automatic-analysis coordinator', () => {
  const harness = loadNibActivationHarness();
  harness.activateProfessionalMetric('nib');

  const coordinatorCalls = harness.calls.filter(([name]) => name === 'startAutomaticNibAnalysis');
  assert.equal(coordinatorCalls.length, 1);
  assert.match(coordinatorCalls[0][1].missingImageMessage, /יש להעלות צילום/);
  assert.ok(harness.calls.some(([name, value]) => name === 'report' && value === 'nib'));
});

test('automatic nib coordination cancels draft, pending workflow and legacy analysis before running', async () => {
  const harness = loadAutomaticNibStartHarness();
  const result = harness.startAutomaticNibAnalysis();

  assert.equal(result, harness.completedTask);
  assert.equal(harness.state.draft, null);
  assert.equal(harness.state.professionalSuite.pendingMeasurement, null);
  assert.equal(harness.state.calibrationAnalysisToken, 6);
  assert.equal(harness.state.formula.analysis.status, 'idle');
  assert.equal(harness.state.tool, 'pan');
  assert.ok(harness.calls.includes('cancelDraft'));
  assert.ok(harness.calls.includes('cancelCalibrationAnalysis'));
  assert.ok(harness.calls.includes('setTool:pan'));
  assert.ok(harness.calls.includes('formulaTab:nib'));
  const runNibCall = harness.calls.find(call => Array.isArray(call) && call[0] === 'runNib');
  assert.equal(runNibCall?.[0], 'runNib');
  assert.equal(runNibCall?.[1]?.userInitiated, true);
  await result;
});

test('undo snapshots restore the active tool and disabling thirds leaves a neutral pan tool', () => {
  const snapshotHarness = loadSnapshotHarness();
  const captured = snapshotHarness.captureSnapshot();
  assert.equal(captured.tool, 'thirds');
  snapshotHarness.state.tool = 'length';
  snapshotHarness.restoreSnapshot(captured);
  assert.equal(snapshotHarness.state.tool, 'thirds');
  assert.deepEqual(snapshotHarness.syncedTools, ['thirds']);

  const kastel = { id: 22, type: 'kastel', overlays: { thirdsVisible: true } };
  const thirdsHarness = loadThirdsToggleHarness(kastel);
  thirdsHarness.toggleKastelThirds();
  assert.equal(kastel.overlays.thirdsVisible, false);
  assert.equal(thirdsHarness.state.tool, 'pan');
  assert.deepEqual(thirdsHarness.toolCalls, ['pan'],
    'disabling the guide must not silently leave the point-probe tool armed');
});

test('in-memory history preserves professional width and height descriptors with their axis locks', () => {
  for (const descriptor of [{
    semanticMetricId: 'widths', category: 'width', name: 'קו רוחב אופקי',
    tool: 'length', axisConstraint: 'horizontal'
  }, {
    semanticMetricId: 'heights', category: 'height', name: 'קו גובה אנכי',
    tool: 'length', axisConstraint: 'vertical'
  }]) {
    const harness = loadSnapshotHarness({ tool: 'length', pendingMeasurement: descriptor });
    const captured = harness.captureSnapshot();
    assert.deepEqual(JSON.parse(JSON.stringify(captured.professionalSuite.pendingMeasurement)), descriptor);

    harness.state.tool = 'pan';
    harness.state.professionalSuite.pendingMeasurement = null;
    harness.restoreSnapshot(captured);
    assert.equal(harness.state.tool, 'length');
    assert.deepEqual(JSON.parse(JSON.stringify(harness.state.professionalSuite.pendingMeasurement)), descriptor);
    assert.equal(harness.state.professionalSuite.pendingMeasurement.axisConstraint, descriptor.axisConstraint);
  }
});

test('professional circle arming records circle and survives compatible history restore', () => {
  const arming = loadProfessionalArmHarness();
  const metric = { id: 'circle-ellipse', name: 'עיגול ואליפסה', category: 'geometry', tool: 'ellipse' };
  const descriptor = arming.armProfessionalMeasurement(metric, { name: 'עיגול', tool: 'circle' });
  assert.equal(descriptor.tool, 'circle', 'the explicit circle choice must override the metric default ellipse');
  assert.equal(arming.professionalSuite.pendingMeasurement.tool, 'circle');

  const professional = read('professional-tools.js');
  const circleStart = professional.indexOf("for (const [type, labelText] of [['circle'");
  const circleEnd = professional.indexOf('appendMetricInfoButton(actions, metricId)', circleStart);
  assert.ok(circleStart >= 0 && circleEnd > circleStart);
  assert.match(professional.slice(circleStart, circleEnd), /armProfessionalMeasurement\(metric,[\s\S]*?tool:\s*type/);

  const snapshot = loadSnapshotHarness({
    tool: 'circle',
    pendingMeasurement: JSON.parse(JSON.stringify(descriptor))
  });
  const captured = snapshot.captureSnapshot();
  snapshot.state.tool = 'pan';
  snapshot.state.professionalSuite.pendingMeasurement = null;
  snapshot.restoreSnapshot(captured);
  assert.equal(snapshot.state.tool, 'circle');
  assert.equal(snapshot.state.professionalSuite.pendingMeasurement.tool, 'circle');
});

test('committing a professional measurement clears its descriptor and returns to pan', () => {
  const harness = loadCommitDraftHarness();
  const committed = harness.commitDraft('המדידה נוספה');

  assert.equal(committed.semanticMetricId, 'widths');
  assert.equal(committed.axisConstraint, 'horizontal');
  assert.equal(harness.state.professionalSuite.pendingMeasurement, null);
  assert.equal(harness.state.tool, 'pan');
  assert.deepEqual(harness.toolCalls, ['pan']);
});

test('a direct generic toolbar click clears a professional descriptor even for the same primitive', () => {
  const harness = loadGenericToolbarHarness();
  assert.equal(harness.state.professionalSuite.pendingMeasurement.tool, 'length');
  assert.equal(harness.state.draft.semanticMetricId, 'widths');
  harness.click();
  assert.equal(harness.state.draft, null,
    'the partial constrained line must not survive beneath the generic free-length tool');
  assert.deepEqual(harness.cancelCalls, [79]);
  assert.equal(harness.state.professionalSuite.pendingMeasurement, null,
    'clicking generic length after professional width must produce a free line');
  assert.deepEqual(harness.toolCalls, ['length']);
});

test('setTool preserves a compatible professional arm and clears it on incompatible direct transitions', () => {
  const harness = loadSetToolHarness();
  const widthDescriptor = {
    semanticMetricId: 'widths', tool: 'length', axisConstraint: 'horizontal'
  };
  harness.state.professionalSuite.pendingMeasurement = widthDescriptor;
  harness.setTool('length');
  assert.equal(harness.state.professionalSuite.pendingMeasurement, widthDescriptor,
    'professional activation may arm the same primitive without being canceled by setTool');
  assert.equal(harness.state.professionalSuite.pendingMeasurement.axisConstraint, 'horizontal');

  harness.setTool('thirds');
  assert.equal(harness.state.professionalSuite.pendingMeasurement, null,
    'a direct thirds transition may not leak a pending width descriptor');

  const inferredWidthDescriptor = {
    semanticMetricId: 'widths', axisConstraint: 'horizontal'
  };
  harness.state.professionalSuite.pendingMeasurement = inferredWidthDescriptor;
  harness.setTool('length');
  assert.equal(harness.state.professionalSuite.pendingMeasurement, inferredWidthDescriptor,
    'metric metadata may supply the compatible primitive when the descriptor omits tool');

  harness.setTool('pan');
  assert.equal(harness.state.professionalSuite.pendingMeasurement, null,
    'returning to pan must disarm every unfinished professional primitive');
});

test('tool transition settles a complete professional draft before disarming its descriptor', () => {
  const harness = loadProfessionalDraftTransitionHarness();
  harness.setTool('thirds');

  assert.equal(harness.state.objects.length, 1);
  assert.equal(harness.state.objects[0].semanticMetricId, 'widths');
  assert.equal(harness.state.objects[0].axisConstraint, 'horizontal');
  assert.equal(harness.state.draft, null);
  assert.equal(harness.state.history.length, 1, 'the committed draft must create one undo snapshot');
  assert.deepEqual(
    harness.state.history[0].professionalSuite.pendingMeasurement,
    harness.descriptor,
    'the snapshot must capture the professional descriptor before commit clears it'
  );
  assert.equal(harness.state.professionalSuite.pendingMeasurement, null);
  assert.equal(harness.state.tool, 'thirds');
  assert.deepEqual(harness.toolCalls, ['pan', 'thirds']);
  assert.match(harness.statusText.textContent, /המדידה הקודמת הושלמה/);
});

test('manual standard-tool activation cancels a matching partial professional draft before disarming', () => {
  const harness = loadStandardMeasurementToolHarness();
  harness.startStandardMeasurementTool('gap');

  assert.equal(harness.state.draft, null);
  assert.equal(harness.state.professionalSuite.pendingMeasurement, null);
  assert.deepEqual(harness.calls.map(call => call.name), ['cancelDraft', 'setTool']);
  assert.equal(harness.calls[0].pendingAtCancel, harness.descriptor,
    'cancelDraft must still see the professional descriptor so it can discard the matching partial geometry');
  assert.equal(harness.calls[1].tool, 'gap');
});

test('length tool status distinguishes constrained width, constrained height and a free line', () => {
  const harness = loadSetToolHarness();
  harness.state.professionalSuite.pendingMeasurement = {
    semanticMetricId: 'widths', tool: 'length', axisConstraint: 'horizontal'
  };
  harness.setTool('length');
  assert.match(harness.statusText.textContent, /קו רוחב אופקי/);
  assert.match(harness.statusText.textContent, /הגובה יישמר קבוע/);

  harness.state.professionalSuite.pendingMeasurement = {
    semanticMetricId: 'heights', tool: 'length', axisConstraint: 'vertical'
  };
  harness.setTool('length');
  assert.match(harness.statusText.textContent, /קו גובה אנכי/);
  assert.match(harness.statusText.textContent, /הרוחב יישמר קבוע/);

  harness.state.professionalSuite.pendingMeasurement = null;
  harness.setTool('length');
  assert.equal(harness.statusText.textContent, 'אורך חופשי: סמן שתי נקודות');

  harness.setTool('thirds');
  assert.equal(harness.statusText.textContent,
    'חוק השלישים: גע בנקודה בתוך הקעסטעל למדידת מיקומה היחסי');
});

test('every automatic nib launcher routes through the shared coordinator and region analysis cancels engine work', () => {
  const app3 = read('app-3.js');
  const professional = read('professional-tools.js');
  const app4 = read('app-4.js');
  const analyzeButton = app3.slice(app3.indexOf("$('analyzeBtn')"), app3.indexOf("$('autoNibToolBtn')"));
  const autoTool = app3.slice(app3.indexOf("$('autoNibToolBtn')"), app3.indexOf("$('gapsPanelBtn')"));
  const professionalNib = professional.slice(
    professional.indexOf("if (metricId === 'nib')"),
    professional.indexOf("if (metricId === 'roof-seat')")
  );
  assert.match(analyzeButton, /startAutomaticNibAnalysis\(\)/);
  assert.match(autoTool, /startAutomaticNibAnalysis\(\)/);
  assert.match(professionalNib, /startAutomaticNibAnalysis\(\{/);
  for (const launcher of [analyzeButton, autoTool, professionalNib]) {
    assert.doesNotMatch(launcher, /\.runNib\(|analyzeImage\(/,
      'launchers may not bypass shared cancellation and state cleanup');
  }

  const regionStart = app4.indexOf('async function analyzeCalibrationRegion');
  const regionEnd = app4.indexOf('\nasync function ', regionStart + 1);
  const regionAnalysis = app4.slice(regionStart, regionEnd > regionStart ? regionEnd : undefined);
  assert.match(regionAnalysis, /cancelCalibrationAnalysis\(\)/,
    'region calibration must use the centralized lifecycle cancellation');
  assert.ok(
    regionAnalysis.indexOf('cancelCalibrationAnalysis()') < regionAnalysis.indexOf('++state.calibrationAnalysisToken'),
    'region calibration must cancel engine and legacy work before beginning its new token run'
  );
});

test('legacy calibration cancellation also invalidates the automatic engine run token', () => {
  const harness = loadSnapshotHarness();
  harness.state.calibrationAnalysisToken = 17;
  harness.state.formula.analysis.status = 'running';
  harness.cancelCalibrationAnalysis();

  assert.equal(harness.state.calibrationAnalysisToken, 18);
  assert.equal(harness.state.formula.analysis.status, 'idle');
  assert.equal(harness.autoCancelCalls.length, 1);
  assert.equal(harness.autoCancelCalls[0].render, false);
});

test('deleting a kastel also deletes only its linked thirds probes', () => {
  const objects = [
    { id: 31, type: 'kastel' },
    { id: 32, type: 'thirds', kastelId: 31 },
    { id: 33, type: 'thirds', kastelId: 99 },
    { id: 34, type: 'length', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }
  ];
  const harness = loadDeleteSelectedHarness(objects, 31);
  harness.deleteSelectedObject();

  assert.deepEqual(Array.from(harness.state.objects, object => object.id), [33, 34]);
  assert.deepEqual(harness.withdrawn, [31]);
  assert.equal(harness.state.selectedId, null);
});

test('thirds results and status describe the current horizontal probe without legacy or height claims', () => {
  const harness = loadThirdsMeasurementHarness();
  const result = harness.measurementResultModel({
    id: 13, type: 'thirds', kastelId: harness.kastel.id, points: [{ x: 42, y: 55 }]
  });
  assert.match(result.primaryText, /רוחב/);
  assert.match(result.secondaryText, /נקודה בתוך קעסטעל/);
  assert.doesNotMatch(`${result.primaryText} ${result.secondaryText}`, /ישנה|גרסה קודמת|גובה|עובי קולמוס/);

  harness.state.selectedId = harness.kastel.id;
  harness.handleThirdsPointer({ x: 42, y: 55 });
  assert.equal(harness.statusText.textContent, 'נמדד המיקום הרוחבי ביחס לקווי השלישים בתוך הקעסטעל');
  assert.equal(harness.state.objects.at(-1).type, 'thirds');

  const app2 = read('app-2.js');
  assert.doesNotMatch(app2, /מדידת נקודה ישנה|מגרסה קודמת/);
  assert.doesNotMatch(app2, /נמדד מיקום בגובה ביחס לשלישים, וברוחב ביחידות עובי קולמוס/);
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
    assert.match(html, /master-system\.js\?v=20260802a/);
    assert.match(html, /professional-tools\.js\?v=20260802a/);
    assert.match(html, /slant-analyzer\.js\?v=20260802a/);
    assert.ok(
      html.indexOf('slant-analyzer.js?v=20260802a') < html.indexOf('professional-tools.js?v=20260802a'),
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

test('Pencil blocks every text-entry variant while finger focus remains available', () => {
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

  routing.document.activeElement = firstText;
  const penTextEvent = makeEvent(secondText);
  routing.handleDocumentPointerDown(penTextEvent);
  assert.equal(penTextEvent.defaultPrevented, true);
  assert.equal(firstText.blurCount, 1, 'an already open keyboard field is closed');
  assert.equal(secondText.blurCount, 1, 'the Pencil target never receives text focus');
  const penFocus = makeEvent(secondText, { pointerType: undefined });
  routing.handleBlockedPenFocus(penFocus);
  assert.equal(penFocus.defaultPrevented, true, 'the focus event synthesized by Pencil is rejected');

  const textEntries = [
    new routing.FakeElement('textarea'),
    new routing.FakeElement('div', { contenteditable: 'true' }),
    new routing.FakeElement('div', { contenteditable: '' }),
    new routing.FakeElement('div', { contenteditable: 'plaintext-only' })
  ];
  for (const target of textEntries) {
    const event = makeEvent(target);
    routing.handleDocumentPointerDown(event);
    assert.equal(event.defaultPrevented, true,
      `${target.tagName} contenteditable=${String(target.contenteditable)} rejects Pencil text focus`);
    assert.equal(event.stopped, true, 'a rejected Pencil text entry does not leak to component handlers');
  }

  const fingerEvent = makeEvent(secondText, { pointerType: 'touch' });
  routing.handleDocumentPointerDown(fingerEvent);
  assert.equal(fingerEvent.defaultPrevented, false, 'finger text entry remains available');
  const fingerFocus = makeEvent(secondText, { pointerType: undefined });
  routing.handleBlockedPenFocus(fingerFocus);
  assert.equal(fingerFocus.defaultPrevented, false, 'finger focus is not mistaken for Scribble');
});

test('Pencil blurs an active text field but leaves every menu-control family interactive', () => {
  const routing = loadPointerInputRouting();
  const makeEvent = (target, path = [target]) => ({
    target,
    pointerType: 'pen',
    detail: 1,
    defaultPrevented: false,
    stopped: false,
    composedPath: () => path,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  });
  const fileInput = new routing.FakeElement('input', { type: 'file' });
  const fileLabel = new routing.FakeElement('label');
  fileLabel.control = fileInput;
  fileInput.label = fileLabel;
  const controls = [
    ['button', new routing.FakeElement('button')],
    ['select', new routing.FakeElement('select')],
    ['checkbox', new routing.FakeElement('input', { type: 'checkbox' })],
    ['colour picker', new routing.FakeElement('input', { type: 'color' })],
    ['file label', fileLabel],
    ['range slider', new routing.FakeElement('input', { type: 'range' })],
    ['details summary', new routing.FakeElement('summary')],
    ['non-editable content', new routing.FakeElement('div', { contenteditable: 'false' })]
  ];

  for (const [name, target] of controls) {
    const activeText = new routing.FakeElement('input', { type: 'text' });
    routing.document.activeElement = activeText;
    const path = target === fileLabel ? [fileLabel] : [target];
    const event = makeEvent(target, path);
    routing.handleDocumentPointerDown(event);
    assert.equal(activeText.blurCount, 1, `${name} closes an already open text field`);
    assert.equal(routing.document.activeElement, null, `${name} leaves no text field focused`);
    assert.equal(event.defaultPrevented, false, `${name} keeps its Pencil default action`);
    assert.equal(event.stopped, false, `${name} keeps its component handlers reachable`);
  }
});

test('Pencil distinguishes a file-upload label from a text-entry label', () => {
  const routing = loadPointerInputRouting();
  const makeEvent = (target, path) => ({
    target,
    pointerType: 'pen',
    detail: 1,
    defaultPrevented: false,
    stopped: false,
    composedPath: () => path,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  });
  const makeLabel = type => {
    const label = new routing.FakeElement('label');
    const input = new routing.FakeElement('input', { type, label, parent: label });
    label.control = input;
    const caption = new routing.FakeElement('span', { label, parent: label });
    return { label, input, caption };
  };
  const file = makeLabel('file');
  const text = makeLabel('text');

  const fileEvent = makeEvent(file.caption, [file.caption, file.label]);
  routing.handleDocumentPointerDown(fileEvent);
  assert.equal(fileEvent.defaultPrevented, false, 'Pencil can open a file picker through its visible label');
  assert.equal(fileEvent.stopped, false);

  const textEvent = makeEvent(text.caption, [text.caption, text.label]);
  routing.handleDocumentPointerDown(textEvent);
  assert.equal(textEvent.defaultPrevented, true, 'Pencil cannot focus a text input through its label');
  assert.equal(textEvent.stopped, true);
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

test('the integrated slant workflow creates exactly the attached-thigh angle objects from a page-sized scan', () => {
  const page = grayRasterCanvas(paddedIrregularSlantFixture());
  const scan = {
    id: 41,
    uid: 'real-page-scan',
    type: 'slantScan',
    points: [
      { x: 0, y: 0 }, { x: page.width, y: 0 },
      { x: page.width, y: page.height }, { x: 0, y: page.height }
    ]
  };
  const harness = loadSlantScanHarness(page, 8, scan);
  const result = harness.analyzeSlantScan(scan);
  const angles = harness.state.objects.filter(object => object.type === 'angle');
  const system = loadMasterSystem();

  assert.equal(result.status, 'done');
  assert.deepEqual(
    angles.map(object => irregularFixtureRoleForRootX(object.points[0].x)),
    IRREGULAR_SLANT_EXPECTATIONS.map(expected => expected.id),
    'the integrated workflow must expose exactly the three connected full-height thighs'
  );
  assert.equal(result.candidateCount, IRREGULAR_SLANT_EXPECTATIONS.length,
    `only the three connected thighs may become measurements; received ${result.candidateCount} (${result.diagnostics?.reason})`);
  assert.equal(angles.length, result.candidateCount);
  assert.ok(angles.every(object => object.sourceScanId === scan.id));
  assert.ok(angles.every(object => object.angleRef === 'vertical' && object.points.length === 2));
  for (const [index, expected] of IRREGULAR_SLANT_EXPECTATIONS.entries()) {
    assert.ok(Math.abs(angles[index].points[0].x - expected.rootX) <= 6);
    assert.ok(Math.abs(angles[index].points[1].x - expected.tipX) <= 7);
    assert.ok(Math.abs(system.signedVerticalAngle(...angles[index].points) - expected.angleDeg) <= .4);
    assert.equal(angles[index].candidateRoofSupport?.connectedToStem, true);
    assert.equal(angles[index].candidateAxisFit?.method, 'trimmed-outline-midpoints-linear-v1');
    const outline = angles[index].candidateBodyOutline;
    assert.equal(outline?.method, 'sampled-row-edge-envelope-v1');
    assert.equal(outline.sampleCount, outline.source.leftEdge.length);
    assert.equal(outline.sampleCount, outline.source.rightEdge.length);
    for (let row = 0; row < outline.sampleCount; row++) {
      assert.equal(outline.source.leftEdge[row].y, outline.source.rightEdge[row].y);
      assert.ok(outline.source.leftEdge[row].x <= outline.source.rightEdge[row].x);
      if (row) assert.ok(outline.source.leftEdge[row].y >= outline.source.leftEdge[row - 1].y);
    }
  }
  assert.ok(angles.every(object => Math.abs(object.points[0].x - 184) > 15),
    'the disconnected he leg must not create a visible angle object');
  assert.ok(angles.every(object => object.points[0].x < 330),
    'the nearby short vav must not create a visible angle object');
  assert.match(harness.statusText.textContent, /זוהו/);
});

test('the direct ירכות button creates a full-image scan and visible angle candidates without drawing an ROI', () => {
  const page = grayRasterCanvas(paddedIrregularSlantFixture());
  const harness = loadSlantScanHarness(page, 8, null);
  const result = harness.runFullImageSlantScan();
  const scans = harness.state.objects.filter(object => object.type === 'slantScan');
  const angles = harness.state.objects.filter(object => object.type === 'angle');

  assert.equal(result.status, 'done');
  assert.equal(scans.length, 1);
  assert.equal(scans[0].fullImageAuto, true);
  assert.deepEqual(JSON.parse(JSON.stringify(scans[0].points)), [
    { x: 0, y: 0 }, { x: page.width, y: 0 },
    { x: page.width, y: page.height }, { x: 0, y: page.height }
  ]);
  assert.equal(angles.length, IRREGULAR_SLANT_EXPECTATIONS.length);
  assert.equal(harness.state.selectedId, angles[0].id);
  assert.equal(harness.state.tool, 'pan');
  assert.equal(harness.professionalSuite.activeGroup, 'aman');
  assert.equal(harness.professionalSuite.activeMetricId, 'slants-parallels');
  assert.equal(harness.panel.hidden, false);
  assert.equal(harness.calls.snapshots, 1);
  assert.ok(harness.calls.panels >= 1);
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

test('project restore and project serialization drop in-progress professional arming', () => {
  const app1 = read('app-1.js');
  const app4 = read('app-4.js');
  const mergeProfessionalSuite = loadProjectProfessionalMerge();
  const restored = mergeProfessionalSuite({
    activeMetricId: 'widths',
    pendingMeasurement: {
      semanticMetricId: 'widths', tool: 'length', axisConstraint: 'horizontal'
    }
  });
  assert.equal(restored.pendingMeasurement, null,
    'opening a project may not arm the saved canvas for an unfinished width line');
  assert.match(app1, /A pending tool choice is transient UI state, never project data\.[\s\S]*?pendingMeasurement:\s*null/);
  assert.match(app4, /captured\.professionalSuite\.pendingMeasurement = null/);
});

test('compound information and row candidates describe the action that is actually available', () => {
  const professional = read('professional-tools.js');
  const app2 = read('app-2.js');
  assert.match(professional, /className = 'metric-info-stack'/);
  assert.match(professional, /openMetricInfo\(metric\.id\)/);
  assert.match(professional, /אחרת תיבחר רק ירך שזוהתה כאיבר מתאר/);
  assert.match(app2, /מועמדים ממתינים לסיווג/);
  assert.doesNotMatch(app2, /סטייה חתומה מן האנך/);
  assert.match(app2, /else if \(object\.type === 'angle'\) \{\s*const model = measurementResultModel\(object\);/);
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

test('an automatic thigh angle exports its detected two-sided body outline before the center axis', () => {
  const { drawObjectToContext } = loadExportObjectDrawer();
  const calls = { fills: 0, strokes: 0, lines: 0 };
  const context = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, setLineDash() {},
    moveTo() {}, lineTo() { calls.lines++; },
    fill() { calls.fills++; }, stroke() { calls.strokes++; }
  };
  drawObjectToContext(context, {
    id: 12,
    type: 'angle',
    auto: true,
    points: [{ x: 20, y: 20 }, { x: 24, y: 80 }],
    color: '#d97706',
    lineWidth: 3,
    display: { resultLabelVisible: false },
    candidateBodyOutline: {
      source: {
        leftEdge: [{ x: 17, y: 20 }, { x: 20, y: 80 }],
        rightEdge: [{ x: 23, y: 20 }, { x: 28, y: 80 }]
      }
    }
  });
  assert.equal(calls.fills, 1, 'the detected body envelope is filled once');
  assert.ok(calls.strokes >= 2, 'the body envelope and center axis are both stroked');
  assert.ok(calls.lines >= 4, 'both outline edges and the center axis are drawn');
});

test('a hidden full-image slant scan frame is omitted from export unless the scan itself is selected', () => {
  const { drawObjectToContext, state } = loadExportObjectDrawer();
  const calls = { paths: 0, strokes: 0 };
  const context = {
    save() {}, restore() {}, setLineDash() {}, moveTo() {}, lineTo() {}, closePath() {},
    beginPath() { calls.paths++; },
    stroke() { calls.strokes++; }
  };
  const scan = {
    id: 44,
    type: 'slantScan',
    fullImageAuto: true,
    points: [
      { x: 0, y: 0 }, { x: 300, y: 0 },
      { x: 300, y: 300 }, { x: 0, y: 300 }
    ],
    color: '#d97706',
    lineWidth: 3,
    display: { resultLabelVisible: false }
  };

  state.selectedId = 12;
  drawObjectToContext(context, scan);
  assert.deepEqual(calls, { paths: 0, strokes: 0 }, 'the invisible page-sized scan frame must not leak into PNG export');

  state.selectedId = scan.id;
  drawObjectToContext(context, scan);
  assert.deepEqual(calls, { paths: 1, strokes: 1 }, 'a deliberately selected scan frame remains exportable');
});

test('a hidden full-image slant scan cannot capture a Pencil or mouse pan hit', () => {
  const scan = {
    id: 44,
    type: 'slantScan',
    fullImageAuto: true,
    points: [
      { x: 0, y: 0 }, { x: 300, y: 0 },
      { x: 300, y: 300 }, { x: 0, y: 300 }
    ]
  };
  const harness = loadHitTestHarness([scan], 12);

  assert.equal(harness.hitTest({ x: 150, y: 150 }), null,
    'an invisible page-sized diagnostic ROI must fall through so the pan tool can start');

  harness.state.selectedId = scan.id;
  assert.equal(harness.hitTest({ x: 150, y: 150 })?.object?.id, scan.id,
    'a scan explicitly selected from the object list remains editable');
});

test('touch targets and professional cards disclose their actual interaction mode', () => {
  const styles = read('styles.css');
  const html = read('medidaot.html');
  const professional = read('professional-tools.js');
  const system = loadMasterSystem();
  assert.match(styles, /metric-info[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(styles, /button,[^}]*min-block-size:44px/);
  assert.match(styles, /technical-details summary[^}]*min-block-size:44px/);
  assert.match(styles, /master-metric-grid\{[^}]*minmax\(220px,1fr\)/);
  assert.match(styles, /professional-reference-info\{[^}]*minmax\(132px,1fr\)/);
  assert.match(styles, /standalone-hint button\{[^}]*min-inline-size:44px/);
  assert.match(system.metric('slants-parallels').measurementDescription, /סריקה של כל התמונה/);
  assert.match(system.metric('slants-parallels').measurementDescription, /תחום ממוקד/);
  assert.match(html, /id="autoSlantToolBtn"[^>]*>[\s\S]*?זיהוי ירכות וזוויתן/);
  assert.match(professional, /autoSlantToolBtn[^\n]*runFullImageSlantScan/);
  for (const id of ['roofs', 'seats']) {
    assert.equal(system.metric(id).operationMode, 'label-only');
    assert.match(system.metric(id).measurementDescription, /הכרטיס אינו מפעיל כלי/);
  }
  assert.equal(system.metric('stems').operationMode, 'label-only');
  assert.match(system.metric('stems').measurementDescription, /תיוג ידני/);
  assert.match(system.metric('stems').measurementDescription, /זיהוי אוטומטי/);
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
  assert.match(source, /letterVectorLevelSelect[\s\S]*?object\.letterEditAnchors = true;/,
    'choosing structural view must expose its real contour landmarks');
  assert.match(source, /letterEditAnchorsInput[\s\S]*?object\.letterEditAnchors = event\.target\.checked === true;/,
    'the explicit edit toggle, not the detail level, controls handle visibility');
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

test('organ lasso captures exact anchors before topology validation', () => {
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
