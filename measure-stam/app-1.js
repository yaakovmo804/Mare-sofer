'use strict';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { alpha: true });
const emptyState = $('emptyState');
const analysisOverlay = $('analysisOverlay');
const statusText = $('statusText');
const zoomText = $('zoomText');
const results = $('results');
const listEl = $('measurementsList');
const MASTER_SYSTEM = globalThis.MEDIDAOT_MASTER_SYSTEM;

const BUILTIN_VARIABLES = [
  { id: 'common-gap', name: 'מרווח מצוי / קלאסי', builtin: true },
  { id: 'roof-seat', name: 'מרווח גג–מושב', builtin: true },
  { id: 'between-letters', name: 'מרווח בין אות לאות', builtin: true },
  { id: 'between-words', name: 'מרווח בין מילים', builtin: true },
  { id: 'between-lines', name: 'בין השיטין — מתחתית האות לשורה הבאה', builtin: true },
  { id: 'between-heads', name: 'מרווח בין ראשים', builtin: true },
  { id: 'shin-teeth', name: 'מרווח בין שיני שי״ן', builtin: true },
  { id: 'bet-seat-line', name: 'תחתית מושב ב׳–שורה/שרטוט', builtin: true },
  { id: 'roof-length', name: 'אורך הגג', builtin: true },
  { id: 'root-weight', name: 'משקל השורש', builtin: true },
  { id: 'max-weight', name: 'נקודת שיא העובי', builtin: true },
  { id: 'balcony-width', name: 'רוחב מרפסת', builtin: true }
];

const TOOL_COLORS = {
  area: MASTER_SYSTEM.colorFor({ semanticMetricId: 'white-balance' }),
  nib: MASTER_SYSTEM.colorFor({ semanticMetricId: 'nib' }),
  nibRegion: MASTER_SYSTEM.colorFor({ semanticMetricId: 'nib' }),
  gap: MASTER_SYSTEM.colorFor({ semanticMetricId: 'gaps' }),
  length: MASTER_SYSTEM.colorFor({ semanticMetricId: 'widths' }),
  angle: MASTER_SYSTEM.colorFor({ semanticMetricId: 'slants-parallels' }),
  kastel: MASTER_SYSTEM.colorFor({ semanticMetricId: 'reference-template' }), thirds: MASTER_SYSTEM.colorFor({ semanticMetricId: 'thirds' }),
  rowAlign: MASTER_SYSTEM.colorFor({ semanticMetricId: 'straightness' }),
  slantScan: MASTER_SYSTEM.colorFor({ semanticMetricId: 'slants-parallels' }),
  ellipse: MASTER_SYSTEM.colorFor({ semanticMetricId: 'circle-ellipse' }),
  circle: MASTER_SYSTEM.colorFor({ semanticMetricId: 'circle-ellipse' })
};
const KASTEL_GUIDE_COLORS = {
  thirds: MASTER_SYSTEM.colorFor({ semanticMetricId: 'thirds' }),
  roof: MASTER_SYSTEM.colorFor({ semanticMetricId: 'roofs' }),
  seat: MASTER_SYSTEM.colorFor({ semanticMetricId: 'seats' }),
  seatTrend: MASTER_SYSTEM.colorFor({ semanticMetricId: 'slants-parallels' })
};

const SEMANTIC_CATEGORIES = [
  { id: 'width', name: 'רוחבים' },
  { id: 'height', name: 'גבהים' },
  { id: 'nib', name: 'עובי קולמוס' },
  { id: 'straightness', name: 'ישרות' },
  { id: 'weight', name: 'משקלים' },
  { id: 'white-space', name: 'לובן ושטחים' },
  { id: 'optical-center', name: 'מרכז אופטי' },
  { id: 'roof', name: 'גגות' },
  { id: 'seat', name: 'מושבים' },
  { id: 'stem', name: 'ירכות ודפנות' },
  { id: 'root', name: 'שורשים ומשקלים' },
  { id: 'balcony', name: 'מרפסות' },
  { id: 'letter-gap', name: 'מרווח בין אותיות' },
  { id: 'word-gap', name: 'מרווח בין מילים' },
  { id: 'line-gap', name: 'מרווח בין השיטין' },
  { id: 'thirds', name: 'חוק השלישים' },
  { id: 'slant', name: 'נטיות ומקבילות' },
  { id: 'angle', name: 'זוויות' },
  { id: 'geometry', name: 'עיגולים ואליפסות' },
  { id: 'reference-template', name: 'תבנית אות' },
  { id: 'other', name: 'אחר' }
];

const state = {
  image: null,
  imageSrc: null,
  sourceMeta: null,
  tool: 'pan',
  objects: [],
  draft: null,
  selectedId: null,
  selectedPoint: null,
  selectedSegment: null,
  letterVectorSelection: null,
  letterVectorLasso: null,
  vectorizeLasso: null,
  vectorWorkflow: 'copy',
  draftHistory: [],
  view: { x: 0, y: 0, scale: 1 },
  dragging: null,
  history: [],
  future: [],
  nextId: 1,
  pointers: new Map(),
  pinchStart: null,
  activePointerId: null,
  touchEditPointerId: null,
  interactionBefore: null,
  loadGeneration: 0,
  calibrationAnalysisToken: 0,
  activeCalibrationRegionId: null,
  formula: {
    nibPx: null,
    commonGapPx: null,
    betweenLinesPx: null,
    calibration: null,
    nibSamples: [],
    selectedVariable: 'common-gap',
    variables: structuredCloneSafe(BUILTIN_VARIABLES),
    analysis: {
      status: 'idle',
      nibConfidence: 0,
      gapConfidence: 0,
      threshold: null,
      roofCandidates: [],
      textRows: [],
      interlineProposals: []
    }
  },
  projectMeta: {
    id: null,
    title: '',
    createdAt: null,
    updatedAt: null
  },
  projectDocument: null,
  referenceDataset: [],
  professionalSuite: {
    activeGroup: 'regaim',
    activeMetricId: null,
    descriptions: MASTER_SYSTEM.mergeDescriptions(),
    measurementNotes: MASTER_SYSTEM.mergeMeasurementNotes(),
    pendingMeasurement: null,
    composition: {
      background: { kind: 'parchment-light', color: '#f3e4bf', imageSrc: null },
      items: [],
      selectedId: null,
      nextId: 1
    },
    correctionSessions: []
  }
};

const ui = {
  name: $('nameInput'),
  color: $('colorInput'),
  lineWidth: $('lineWidthInput'),
  fillAlpha: $('fillAlphaInput'),
  fillEnabled: $('fillEnabledInput'),
  unit: $('unitSelect'),
  scale: $('scaleInput'),
  angleRef: $('angleRefSelect'),
  nibPx: $('nibPxInput'),
  gapVariable: $('gapVariableSelect'),
  newVariable: $('newVariableInput'),
  category: $('categorySelect'),
  assessment: $('assessmentSelect'),
  note: $('noteInput'),
  roofTopGuide: $('roofTopGuideInput'),
  roofGuide: $('roofGuideInput'),
  seatGuide: $('seatGuideInput'),
  seatBottomGuide: $('seatBottomGuideInput')
};

let dpr = Math.max(1, window.devicePixelRatio || 1);
const TOUCH_CAPABLE_DEVICE = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;

function structuredCloneSafe(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function isEditableTarget(target) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

/* Menus are deliberately pointer-agnostic: buttons, tabs, selects, sliders,
 * checkboxes, colours and file pickers all accept Pencil, finger and mouse.
 * Only controls that actually accept free text are protected from Pencil
 * focus, because iPadOS otherwise treats the stroke as Scribble and opens a
 * keyboard. Finger/mouse/keyboard focus remains untouched. */
const penTextEntryBlock = { until: 0, nodes: new Set() };

function eventPath(event) {
  return typeof event.composedPath === 'function'
    ? event.composedPath().filter(node => node instanceof Element)
    : event.target instanceof Element ? [event.target] : [];
}

function textEntryControl(target) {
  if (!(target instanceof Element)) return null;
  const direct = target.closest('textarea, [contenteditable]:not([contenteditable="false"]), input');
  const control = direct || target.closest('label')?.control || target.control || null;
  if (!(control instanceof Element)) return null;
  if (control.matches('textarea, [contenteditable]:not([contenteditable="false"])')) return control;
  if (!control.matches('input')) return null;
  const type = (control.getAttribute('type') || 'text').toLowerCase();
  return ['text', 'number', 'search', 'email', 'url', 'tel', 'password'].includes(type)
    ? control
    : null;
}

function rememberBlockedPenTextEntry(event, control) {
  const nodes = new Set(eventPath(event));
  nodes.add(control);
  for (const node of [...nodes]) {
    const label = node.closest?.('label');
    if (label) nodes.add(label);
    if (label?.control) nodes.add(label.control);
    if (node.control) nodes.add(node.control);
  }
  penTextEntryBlock.nodes = nodes;
  penTextEntryBlock.until = performance.now() + 900;
}

function matchesBlockedPenTextEntry(event) {
  if (performance.now() > penTextEntryBlock.until) return false;
  return eventPath(event).some(node => penTextEntryBlock.nodes.has(node));
}

function clearBlockedPenTextEntry() {
  penTextEntryBlock.until = 0;
  penTextEntryBlock.nodes.clear();
}

function syncToolControlState(tool = state.tool) {
  document.querySelectorAll('.tool[data-tool]').forEach(button => {
    button.classList.toggle('active', button.dataset.tool === tool);
  });
  $('gapsPanelBtn')?.classList.toggle('active', tool === 'gap');
  $('autoNibToolBtn')?.classList.remove('active');
}

function handleDocumentPointerDown(event) {
  if (event.pointerType === 'touch' || event.pointerType === 'mouse') {
    clearBlockedPenTextEntry();
    return;
  }
  if (event.pointerType !== 'pen') return;
  const activeTextEntry = textEntryControl(document.activeElement);
  if (activeTextEntry instanceof HTMLElement) activeTextEntry.blur();
  const control = textEntryControl(event.target);
  if (!control) {
    clearBlockedPenTextEntry();
    return;
  }
  rememberBlockedPenTextEntry(event, control);
  event.preventDefault();
  event.stopImmediatePropagation();
  if (control instanceof HTMLElement) control.blur();
  statusText.textContent = 'העט לא פותח שדה כתיבה כדי למנוע Scribble; כפתורים, תפריטים וסרגלים כן פועלים בעט ובאצבע';
}
document.addEventListener('pointerdown', handleDocumentPointerDown, { capture: true, passive: false });

function handleBlockedPenFocus(event) {
  if (!matchesBlockedPenTextEntry(event) || !textEntryControl(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.target instanceof HTMLElement) event.target.blur();
}
document.addEventListener('focusin', handleBlockedPenFocus, { capture: true, passive: false });

function handleBlockedPenClick(event) {
  if (event.detail === 0 || !matchesBlockedPenTextEntry(event) || !textEntryControl(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}
document.addEventListener('click', handleBlockedPenClick, { capture: true, passive: false });

document.addEventListener('keydown', clearBlockedPenTextEntry, { capture: true });

for (const eventName of ['contextmenu', 'selectstart', 'dragstart']) {
  document.addEventListener(eventName, event => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  }, { capture: true });
}
for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(eventName, event => event.preventDefault(), { passive: false });
}
canvas.addEventListener('dblclick', event => event.preventDefault());
canvas.addEventListener('touchstart', event => event.preventDefault(), { passive: false });
canvas.addEventListener('touchmove', event => event.preventDefault(), { passive: false });

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const standaloneHint = $('standaloneHint');
let hideInstallHint = false;
try { hideInstallHint = localStorage.getItem('medidaot-hide-install-hint') === '1'; } catch {}
if (!isStandalone && !hideInstallHint) standaloneHint.hidden = false;
$('dismissStandaloneHint').addEventListener('click', () => {
  standaloneHint.hidden = true;
  try { localStorage.setItem('medidaot-hide-install-hint', '1'); } catch {}
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  draw();
}
new ResizeObserver(resizeCanvas).observe(canvas);

function getPos(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function screenToImage(point) {
  return { x: (point.x - state.view.x) / state.view.scale, y: (point.y - state.view.y) / state.view.scale };
}
function imageToScreen(point) {
  return { x: point.x * state.view.scale + state.view.x, y: point.y * state.view.scale + state.view.y };
}
function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function measurementLengthPx(object) {
  const detected = +object?.gapDetection?.medianPx;
  if (object?.type === 'gap' && Number.isFinite(detected) && detected > 0 && object.gapDetection?.manualCorrected !== true) {
    return detected;
  }
  return object?.points?.length >= 2 ? distance(object.points[0], object.points[1]) : 0;
}
function capturedNibPxForMeasurement(object) {
  const normalization = object?.normalization;
  if (normalization && Object.prototype.hasOwnProperty.call(normalization, 'nibPxAtMeasurement')) {
    const captured = +normalization.nibPxAtMeasurement;
    return Number.isFinite(captured) && captured > 0 ? captured : null;
  }
  const automaticPx = +object?.autoMeasurement?.valuePx;
  const automaticNib = +object?.autoMeasurement?.valueNib;
  if (object?.type === 'gap' && Number.isFinite(automaticPx) && automaticPx > 0 &&
      Number.isFinite(automaticNib) && automaticNib > 0) {
    return automaticPx / automaticNib;
  }
  return undefined;
}
function measurementRatioNib(object) {
  const lengthPx = measurementLengthPx(object);
  if (!Number.isFinite(lengthPx) || lengthPx <= 0) return null;
  const capturedNibPx = capturedNibPxForMeasurement(object);
  const nibPx = capturedNibPx === undefined ? +state.formula.nibPx : capturedNibPx;
  return Number.isFinite(nibPx) && nibPx > 0 ? lengthPx / nibPx : null;
}
function captureGapNormalization(object, nibPx = state.formula.nibPx, source = 'measurement') {
  if (object?.type !== 'gap') return null;
  const capturedNibPx = Number.isFinite(+nibPx) && +nibPx > 0 ? +nibPx : null;
  object.normalization = {
    ...(object.normalization || {}),
    nibPxAtMeasurement: capturedNibPx,
    calibrationId: state.formula.calibration?.id || null,
    calibrationVersion: state.formula.calibration?.algorithmVersion ||
      state.formula.calibration?.version || null,
    calibrationMethod: state.formula.calibration?.method || null,
    measuredAt: new Date().toISOString(),
    source
  };
  return object.normalization;
}
function gapMeasurementSource(object) {
  if (object?.type !== 'gap') return null;
  if (object.gapDetection?.manualCorrected === true ||
      object.autoMeasurement?.supersededByManualEndpoints === true) return 'manual';
  if (object.gapDetection || object.autoMeasurement) return 'automatic';
  const origin = object.provenance?.origin;
  const originalOrigin = object.provenance?.originalOrigin;
  if (object.auto === true || ['automatic', 'assisted'].includes(origin) ||
      ['automatic', 'assisted'].includes(originalOrigin)) return 'automatic';
  return 'manual';
}
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function fmt(value, digits = 2) {
  return Number(value).toLocaleString('he-IL', { maximumFractionDigits: digits });
}
function polygonArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
  }
  return Math.abs(area / 2);
}
function centroid(points) {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length
  };
}
function polygonCentroid(points) {
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    crossSum += cross;
    xSum += (current.x + next.x) * cross;
    ySum += (current.y + next.y) * cross;
  }
  if (Math.abs(crossSum) < 1e-9) return centroid(points);
  return { x: xSum / (3 * crossSum), y: ySum / (3 * crossSum) };
}
function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a.y > point.y) !== (b.y > point.y)) &&
        point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}
function pointLineDistance(point, a, b) {
  const lengthSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!lengthSq) return distance(point, a);
  let t = ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSq;
  t = clamp(t, 0, 1);
  return distance(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
function interp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function quadPoint(points, u, v) {
  const [a, b, c, d] = points;
  return {
    x: a.x * (1 - u) * (1 - v) + b.x * u * (1 - v) + c.x * u * v + d.x * (1 - u) * v,
    y: a.y * (1 - u) * (1 - v) + b.y * u * (1 - v) + c.y * u * v + d.y * (1 - u) * v
  };
}
function normalizeQuadPoints(points) {
  if (!Array.isArray(points) || points.length !== 4) return points;
  const sorted = points.map(point => ({ x: +point.x, y: +point.y })).sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}
function normalizeQuadObject(object) {
  if (object && ['kastel', 'nibRegion', 'rowAlign', 'slantScan', 'ellipse', 'circle'].includes(object.type) && object.points?.length === 4) {
    object.points = normalizeQuadPoints(object.points);
  }
  return object;
}
function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '');
  const n = Number.parseInt(clean, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
function angleFromLine(a, b, reference = 'nearest') {
  let degrees = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  degrees = ((degrees % 180) + 180) % 180;
  const horizontal = Math.min(degrees, 180 - degrees);
  const vertical = Math.abs(90 - degrees);
  if (reference === 'horizontal') return horizontal;
  if (reference === 'vertical') return vertical;
  return Math.min(horizontal, vertical);
}
function smallAngle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1;
  const cosine = clamp((v1.x * v2.x + v1.y * v2.y) / denominator, -1, 1);
  const angle = Math.acos(cosine) * 180 / Math.PI;
  return Math.min(angle, 180 - angle);
}
function objectAngle(object) {
  if (object.points.length >= 3) return smallAngle(object.points[0], object.points[1], object.points[2]);
  return angleFromLine(object.points[0], object.points[1], object.angleRef || ui.angleRef.value);
}

function currentRowDeviation(candidate, nibPx = state.formula.nibPx) {
  const px = Number.isFinite(+candidate?.deviationPx) ? +candidate.deviationPx : null;
  const calibrated = px != null && Number.isFinite(+nibPx) && +nibPx > 0;
  return {
    px,
    nib: calibrated ? px / +nibPx : null,
    value: calibrated ? px / +nibPx : px,
    unitLabel: calibrated ? 'עובי קולמוס' : 'פיקסלים'
  };
}

function captureSnapshot() {
  return {
    objects: structuredCloneSafe(state.objects),
    formula: structuredCloneSafe(state.formula),
    tool: state.tool,
    // Source undo keeps only lightweight source-facing UI state. Composition
    // vectors, uploaded backgrounds and editable professional copy have their
    // own lifecycle and must not be duplicated into as many as 80 snapshots.
    professionalSuite: {
      activeGroup: state.professionalSuite?.activeGroup || 'regaim',
      activeMetricId: state.professionalSuite?.activeMetricId || null,
      // This descriptor belongs to in-memory Undo/Redo only. Project export
      // strips it so opening a saved file never starts an unfinished tool.
      pendingMeasurement: structuredCloneSafe(state.professionalSuite?.pendingMeasurement || null)
    },
    nextId: state.nextId
  };
}
function cancelCalibrationAnalysis() {
  state.calibrationAnalysisToken++;
  // The legacy region analyzer and the automatic CV engine have independent
  // run tokens. Every lifecycle reset must invalidate both or a late promise
  // can repopulate measurements after Undo/Clear.
  globalThis.MEDIDAOT_AUTO_MEASURE?.cancelActiveRun?.({ render: false });
  analysisOverlay.hidden = true;
  if (state.formula.analysis?.status === 'running') state.formula.analysis.status = 'idle';
}
function restoreSnapshot(snapshotData) {
  state.objects = structuredCloneSafe(snapshotData.objects || []);
  state.formula = mergeFormula(snapshotData.formula || {});
  if (snapshotData.professionalSuite) {
    const independentProfessionalState = {
      descriptions: state.professionalSuite?.descriptions,
      measurementNotes: state.professionalSuite?.measurementNotes,
      composition: state.professionalSuite?.composition,
      correctionSessions: state.professionalSuite?.correctionSessions
    };
    restoreProfessionalSuite({
      ...snapshotData.professionalSuite,
      ...independentProfessionalState
    });
  }
  cancelCalibrationAnalysis();
  state.activeCalibrationRegionId = state.formula.calibration?.regionObjectId || null;
  state.nextId = snapshotData.nextId || nextAvailableId();
  state.tool = typeof snapshotData.tool === 'string' ? snapshotData.tool : 'pan';
  const savedPending = snapshotData.professionalSuite?.pendingMeasurement;
  const pendingMetric = MASTER_SYSTEM.metric(savedPending?.semanticMetricId);
  const pendingTool = savedPending?.tool || pendingMetric?.tool || null;
  state.professionalSuite.pendingMeasurement = savedPending && pendingMetric && pendingTool === state.tool
    ? structuredCloneSafe(savedPending)
    : null;
  state.selectedId = null;
  state.selectedPoint = null;
  state.selectedSegment = null;
  state.letterVectorSelection = null;
  analysisOverlay.hidden = true;
  syncToolControlState(state.tool);
  const pendingMetricId = state.professionalSuite?.pendingMeasurement?.semanticMetricId;
  if (pendingMetricId) ui.color.value = MASTER_SYSTEM.colorFor({ semanticMetricId: pendingMetricId });
  else if (TOOL_COLORS[state.tool]) ui.color.value = TOOL_COLORS[state.tool];
  renderAll();
}

function mergeProfessionalSuite(saved = {}) {
  const composition = saved.composition || {};
  return {
    activeGroup: saved.activeGroup === 'aman' ? 'aman' : 'regaim',
    activeMetricId: MASTER_SYSTEM.metric(saved.activeMetricId) ? saved.activeMetricId : null,
    descriptions: MASTER_SYSTEM.mergeDescriptions(saved.descriptions),
    measurementNotes: MASTER_SYSTEM.mergeMeasurementNotes(saved.measurementNotes),
    // A pending tool choice is transient UI state, never project data.
    pendingMeasurement: null,
    composition: {
      width: Number.isFinite(+composition.width) && +composition.width > 0 ? +composition.width : 1600,
      height: Number.isFinite(+composition.height) && +composition.height > 0 ? +composition.height : 900,
      background: {
        kind: composition.background?.kind || 'parchment-light',
        color: composition.background?.color || '#f3e4bf',
        imageSrc: composition.background?.imageSrc || null
      },
      items: Array.isArray(composition.items) ? structuredCloneSafe(composition.items) : [],
      selectedId: composition.selectedId || null,
      nextId: Number.isSafeInteger(+composition.nextId) && +composition.nextId > 0 ? +composition.nextId : 1
    },
    correctionSessions: Array.isArray(saved.correctionSessions)
      ? structuredCloneSafe(saved.correctionSessions)
      : []
  };
}
function restoreProfessionalSuite(saved = {}) {
  const merged = mergeProfessionalSuite(saved);
  if (!state.professionalSuite || typeof state.professionalSuite !== 'object') {
    state.professionalSuite = merged;
    return state.professionalSuite;
  }
  for (const key of Object.keys(state.professionalSuite)) delete state.professionalSuite[key];
  Object.assign(state.professionalSuite, merged);
  return state.professionalSuite;
}
function snapshot() {
  state.history.push(captureSnapshot());
  if (state.history.length > 80) state.history.shift();
  state.future = [];
}
function undo() {
  if (state.draft) {
    if (state.draftHistory.length) {
      state.draft = structuredCloneSafe(state.draftHistory.pop());
      state.selectedPoint = null;
      state.selectedSegment = null;
      statusText.textContent = 'השינוי האחרון בסימון הנוכחי בוטל';
      renderAll();
    } else if (state.selectedPoint?.target === 'draft') {
      state.draft.points.pop();
      if (!state.draft.points.length) state.draft = null;
      state.selectedPoint = null;
      state.selectedSegment = null;
      statusText.textContent = 'הנקודה האחרונה בסימון הנוכחי בוטלה';
      renderAll();
    } else {
      state.draft.points.pop();
      if (!state.draft.points.length) state.draft = null;
      state.selectedPoint = null;
      state.selectedSegment = null;
      statusText.textContent = 'הנקודה האחרונה בסימון הנוכחי בוטלה';
      renderAll();
    }
    return;
  }
  if (!state.history.length) return;
  state.future.push(captureSnapshot());
  restoreSnapshot(state.history.pop());
}
function redo() {
  if (!state.future.length || state.draft) return;
  state.history.push(captureSnapshot());
  restoreSnapshot(state.future.pop());
}
function nextAvailableId() {
  return state.objects.reduce((max, object) => Math.max(max, object.id || 0), 0) + 1;
}

function mergeFormula(saved) {
  const variables = structuredCloneSafe(BUILTIN_VARIABLES);
  for (const variable of saved.variables || []) {
    if (!variables.some(v => v.id === variable.id)) variables.push(variable);
  }
  const nibSamples = (saved.nibSamples || saved.calibration?.samples || [])
    .filter(sample => Number.isFinite(+sample?.valuePx) && +sample.valuePx > 0)
    .map(sample => ({ ...sample, valuePx: +sample.valuePx }))
    .slice(-60);
  return {
    nibPx: Number.isFinite(+saved.nibPx) && +saved.nibPx > 0 ? +saved.nibPx : null,
    commonGapPx: Number.isFinite(+saved.commonGapPx) && +saved.commonGapPx > 0 ? +saved.commonGapPx : null,
    betweenLinesPx: Number.isFinite(+saved.betweenLinesPx) && +saved.betweenLinesPx > 0 ? +saved.betweenLinesPx : null,
    calibration: saved.calibration || null,
    nibSamples,
    selectedVariable: variables.some(v => v.id === saved.selectedVariable) ? saved.selectedVariable : 'common-gap',
    variables,
    analysis: {
      status: 'idle',
      nibConfidence: 0,
      gapConfidence: 0,
      threshold: null,
      roofCandidates: [],
      textRows: [],
      interlineProposals: [],
      ...(saved.analysis || {})
    }
  };
}

function defaultName(type) {
  const names = {
    area: 'שטח ואיזון לובן', length: 'אורך', angle: 'זווית', kastel: 'קעסטעל',
    thirds: 'חוק השלישים — בדיקת מיקום', nib: 'עובי קולמוס', nibRegion: 'אזור כיול קולמוס',
    gap: selectedVariableName(), letterTemplate: 'תבנית אות', rowAlign: 'יישור השורה',
    slantScan: 'סריקת ירכות ונטיות',
    ellipse: 'אליפסה', circle: 'עיגול'
  };
  return names[type] || 'מדידה';
}
function typeLabel(type) {
  const names = {
    area: 'שטח', length: 'אורך', angle: 'זווית', kastel: 'קעסטעל', thirds: 'חוק השלישים',
    nib: 'קולמוס', nibRegion: 'אזור כיול', gap: 'מרווח', letterTemplate: 'תבנית אות',
    rowAlign: 'יישור שורה', slantScan: 'סריקת ירכות', ellipse: 'אליפסה', circle: 'עיגול'
  };
  return names[type] || 'מדידה';
}
function selectedVariableName() {
  return variableName(state.formula.selectedVariable) || 'מרווח';
}
function variableName(id) {
  return state.formula.variables.find(variable => variable.id === id)?.name || id || 'מרווח';
}
function styleFromUI() {
  return {
    color: ui.color.value,
    lineWidth: +ui.lineWidth.value,
    fillAlpha: +ui.fillAlpha.value / 100,
    fillEnabled: ui.fillEnabled.checked,
    name: ui.name.value.trim()
  };
}
function makeObject(type, points, overrides = {}) {
  const style = styleFromUI();
  const lineOnly = ['length', 'angle', 'nib', 'gap', 'thirds'].includes(type);
  const category = overrides.category || defaultCategory(type, overrides.formulaKey);
  const semanticMetricId = MASTER_SYSTEM.metricIdFor({
    semanticMetricId: overrides.semanticMetricId,
    formulaKey: overrides.formulaKey || (type === 'gap' ? state.formula.selectedVariable : null),
    category,
    type
  });
  const clonedPoints = (points || []).map(point => ({ x: +point.x, y: +point.y }));
  const object = {
    id: state.nextId++,
    uid: typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    points: clonedPoints,
    name: defaultName(type),
    semanticMetricId,
    color: semanticMetricId
      ? MASTER_SYSTEM.colorFor({ semanticMetricId })
      : overrides.color || style.color || TOOL_COLORS[type] || '#64748b',
    lineWidth: overrides.lineWidth || style.lineWidth || 4,
    fillAlpha: lineOnly ? 0 : style.fillAlpha,
    fillEnabled: lineOnly ? false : style.fillEnabled,
    formulaKey: type === 'gap' ? state.formula.selectedVariable : undefined,
    angleRef: type === 'angle' ? ui.angleRef.value : undefined,
    category,
    assessment: 'unclassified',
    note: '',
    segments: type === 'area' ? [] : undefined,
    provenance: {
      origin: overrides.auto ? 'automatic' : 'human',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString()
    },
    ...overrides,
    points: clonedPoints,
    display: {
      resultLabelVisible: true,
      ...(overrides.display || {})
    }
  };
  return enforceSemanticStyle(object);
}

function defaultCategory(type, formulaKey = state.formula.selectedVariable) {
  if (type === 'nib' || type === 'nibRegion') return 'nib';
  if (type === 'area') return 'white-space';
  if (type === 'letterTemplate') return 'reference-template';
  if (type === 'rowAlign') return 'straightness';
  if (type === 'slantScan') return 'slant';
  if (type === 'ellipse' || type === 'circle') return 'geometry';
  if (type === 'kastel' || type === 'thirds') return 'thirds';
  if (type === 'angle') return 'angle';
  if (type === 'gap') {
    if (formulaKey === 'between-words') return 'word-gap';
    if (formulaKey === 'between-lines') return 'line-gap';
    if (formulaKey === 'balcony-width') return 'balcony';
    if (formulaKey === 'roof-length') return 'roof';
    if (['root-weight', 'max-weight'].includes(formulaKey)) return 'root';
    return 'letter-gap';
  }
  return 'other';
}

function semanticColorForObject(object, fallback = '#64748b') {
  if (!object) return fallback;
  const semanticMetricId = MASTER_SYSTEM.metricIdFor({
    semanticMetricId: object.semanticMetricId,
    formulaKey: object.formulaKey,
    category: object.category,
    type: object.type
  });
  return semanticMetricId
    ? MASTER_SYSTEM.colorFor({ semanticMetricId }, fallback)
    : object.color || fallback;
}

function enforceSemanticStyle(object) {
  if (!object) return object;
  if (object.type === 'letterTemplate' || object.role === 'vector-source-frame') return object;
  const semanticMetricId = MASTER_SYSTEM.metricIdFor({
    semanticMetricId: object.semanticMetricId,
    formulaKey: object.formulaKey,
    category: object.category,
    type: object.type
  });
  if (semanticMetricId) {
    object.semanticMetricId = semanticMetricId;
    object.color = MASTER_SYSTEM.colorFor({ semanticMetricId });
  }
  return object;
}

function areaSegmentCount(object) {
  if (!object || object.type !== 'area') return 0;
  return object.closed ? object.points.length : Math.max(0, object.points.length - 1);
}

function ensureAreaSegments(object) {
  if (!object || object.type !== 'area') return [];
  if (!Array.isArray(object.segments)) object.segments = [];
  const count = areaSegmentCount(object);
  while (object.segments.length < count) object.segments.push({ curved: false, control: null });
  if (object.segments.length > count) object.segments.length = count;
  return object.segments;
}

function segmentEndIndex(object, index) {
  return object.closed ? (index + 1) % object.points.length : index + 1;
}

function segmentDisplayPoint(object, index) {
  ensureAreaSegments(object);
  const start = object.points[index];
  const end = object.points[segmentEndIndex(object, index)];
  const segment = object.segments[index];
  return segment?.curved && segment.control ? segment.control : midpoint(start, end);
}

function quadraticPoint(a, control, b, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * a.x + 2 * mt * t * control.x + t * t * b.x,
    y: mt * mt * a.y + 2 * mt * t * control.y + t * t * b.y
  };
}

function flattenedAreaPoints(object, steps = 20) {
  if (!object || object.type !== 'area' || !object.points.length) return object?.points || [];
  ensureAreaSegments(object);
  const flattened = [{ ...object.points[0] }];
  const count = areaSegmentCount(object);
  for (let index = 0; index < count; index++) {
    const start = object.points[index];
    const end = object.points[segmentEndIndex(object, index)];
    const segment = object.segments[index];
    if (segment?.curved && segment.control) {
      for (let step = 1; step <= steps; step++) flattened.push(quadraticPoint(start, segment.control, end, step / steps));
    } else {
      flattened.push({ ...end });
    }
  }
  if (object.closed && flattened.length > 1) flattened.pop();
  return flattened;
}

function measuredArea(object) {
  if (object.type !== 'area' || !object.closed) return polygonArea(object.points);
  ensureAreaSegments(object);
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  let signedArea = 0;
  for (let index = 0; index < areaSegmentCount(object); index++) {
    const start = object.points[index];
    const end = object.points[segmentEndIndex(object, index)];
    const segment = object.segments[index];
    signedArea += segment?.curved && segment.control
      ? (2 * cross(start, segment.control) + 2 * cross(segment.control, end) + cross(start, end)) / 6
      : cross(start, end) / 2;
  }
  return Math.abs(signedArea);
}

function removeAreaPoint(object, index) {
  if (!object || object.type !== 'area' || index < 0 || index >= object.points.length) return;
  ensureAreaSegments(object);
  const oldPoints = object.points.map(point => ({ ...point }));
  const oldSegments = structuredCloneSafe(object.segments);
  const oldIndices = oldPoints.map((_, pointIndex) => pointIndex).filter(pointIndex => pointIndex !== index);
  object.points = oldIndices.map(pointIndex => oldPoints[pointIndex]);
  const nextSegments = [];
  const count = object.closed ? oldIndices.length : Math.max(0, oldIndices.length - 1);
  for (let segmentIndex = 0; segmentIndex < count; segmentIndex++) {
    const oldStart = oldIndices[segmentIndex];
    const oldEnd = object.closed
      ? oldIndices[(segmentIndex + 1) % oldIndices.length]
      : oldIndices[segmentIndex + 1];
    const followedOriginalEdge = oldEnd === (oldStart + 1) % oldPoints.length;
    nextSegments.push(followedOriginalEdge
      ? structuredCloneSafe(oldSegments[oldStart] || { curved: false, control: null })
      : { curved: false, control: null });
  }
  object.segments = nextSegments;
  ensureAreaSegments(object);
}

function moveAreaAnchor(object, index, nextPoint) {
  const previous = object.points[index];
  const dx = nextPoint.x - previous.x;
  const dy = nextPoint.y - previous.y;
  object.points[index] = nextPoint;
  ensureAreaSegments(object);
  const affected = [];
  if (index < areaSegmentCount(object)) affected.push(index);
  const previousSegment = index - 1 >= 0 ? index - 1 : object.closed ? areaSegmentCount(object) - 1 : -1;
  if (previousSegment >= 0) affected.push(previousSegment);
  for (const segmentIndex of new Set(affected)) {
    const segment = object.segments[segmentIndex];
    if (segment?.curved && segment.control) {
      segment.control = { x: segment.control.x + dx / 2, y: segment.control.y + dy / 2 };
    }
  }
}

function pixelsPerUnit() {
  if (ui.unit.value === 'px') return 1;
  if (ui.unit.value === 'kulmus' && state.formula.nibPx) return state.formula.nibPx;
  return Math.max(0.0001, +ui.scale.value || 1);
}
function unitLabel() {
  if (ui.unit.value === 'px') return 'פיקסלים';
  if (ui.unit.value === 'kulmus') return 'עובי קולמוס';
  return 'מ״מ';
}
function scaledLength(px) { return px / pixelsPerUnit(); }
function scaledArea(pxSquared) { return pxSquared / (pixelsPerUnit() ** 2); }

function fitImage() {
  if (!state.image) return;
  const rect = canvas.getBoundingClientRect();
  const pad = 34;
  const scale = Math.min((rect.width - pad * 2) / state.image.width, (rect.height - pad * 2) / state.image.height);
  state.view.scale = clamp(scale, 0.03, 10);
  state.view.x = (rect.width - state.image.width * state.view.scale) / 2;
  state.view.y = (rect.height - state.image.height * state.view.scale) / 2;
  zoomText.textContent = `${Math.round(state.view.scale * 100)}%`;
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.image) {
    ctx.setTransform(
      dpr * state.view.scale, 0, 0, dpr * state.view.scale,
      dpr * state.view.x, dpr * state.view.y
    );
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.image, 0, 0);
    if (typeof drawSourceEditPatches === 'function') drawSourceEditPatches(ctx);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const object of state.objects) drawObject(object, object.id === state.selectedId, false);
  if (state.draft) drawObject(state.draft, false, true);
  if (typeof drawLetterInteractionOverlays === 'function') drawLetterInteractionOverlays();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (!state.image) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawGapDetectionBoundaries(object) {
  if (!object?.gapDetection || object.gapDetection.manualCorrected === true) return;
  const boundaries = [
    object.gapDetection.upperBoundary,
    object.gapDetection.lowerBoundary
  ].filter(points => Array.isArray(points) && points.length >= 2);
  if (!boundaries.length) return;
  ctx.save();
  ctx.strokeStyle = object.color || TOOL_COLORS.gap;
  ctx.globalAlpha = .72;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  for (const boundary of boundaries) {
    const screenPoints = boundary.map(imageToScreen);
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (const point of screenPoints.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDetectedStemBody(object) {
  if (object?.auto !== true) return;
  const outline = object.candidateBodyOutline?.source;
  if (!Array.isArray(outline?.leftEdge) || !Array.isArray(outline?.rightEdge) ||
      outline.leftEdge.length < 2 || outline.rightEdge.length < 2) return;
  const left = outline.leftEdge.map(imageToScreen);
  const right = outline.rightEdge.map(imageToScreen);
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1.25, Math.min(2.25, (object.lineWidth || 4) * .48));
  ctx.strokeStyle = object.color;
  ctx.fillStyle = hexToRgba(object.color, .13);
  ctx.globalAlpha = .92;
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (const point of left.slice(1)) ctx.lineTo(point.x, point.y);
  for (const point of right.slice().reverse()) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawObject(object, selected, draft) {
  enforceSemanticStyle(object);
  const points = object.points.map(imageToScreen);
  if (!points.length) return;
  const resultLabelVisible = draft || isResultLabelVisible(object);
  ctx.save();
  ctx.strokeStyle = object.color;
  ctx.fillStyle = hexToRgba(object.color, object.fillAlpha || 0);
  ctx.lineWidth = object.lineWidth || 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (object.auto) ctx.setLineDash([8, 6]);

  if (object.type === 'letterTemplate') {
    drawLetterTemplateOnScreen(object, selected);
    ctx.restore();
    return;
  } else if (object.type === 'area') {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ensureAreaSegments(object);
    const count = areaSegmentCount(object);
    for (let index = 0; index < count; index++) {
      const end = imageToScreen(object.points[segmentEndIndex(object, index)]);
      const segment = object.segments[index];
      if (segment?.curved && segment.control) {
        const control = imageToScreen(segment.control);
        ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
      } else {
        ctx.lineTo(end.x, end.y);
      }
    }
    if ((!draft || object.closed) && points.length >= 3) ctx.closePath();
    if (object.fillEnabled && points.length >= 3) ctx.fill();
    ctx.stroke();
    if (!draft && resultLabelVisible && points.length >= 3) {
      const center = imageToScreen(polygonCentroid(flattenedAreaPoints(object)));
      label(center, measurementResultModel(object).canvasText, object.color);
    }
  } else if (object.type === 'kastel' || object.type === 'nibRegion') {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    if (points.length >= 3) ctx.closePath();
    if (object.fillEnabled && points.length >= 3) ctx.fill();
    ctx.stroke();
    const selectedObject = state.objects.find(item => item.id === state.selectedId);
    const linkedProbeSelected = selectedObject?.type === 'thirds' && selectedObject.kastelId === object.id;
    const overlayVisible = object.overlays?.thirdsVisible === true || object.overlays?.structureVisible === true;
    if (object.type === 'kastel' && (selected || linkedProbeSelected || overlayVisible) && !draft && points.length === 4) {
      drawKastelGrid(points, object, object.color, selected || linkedProbeSelected);
    }
    if (!draft && resultLabelVisible && points.length === 4) {
      const anchor = object.type === 'kastel'
        ? midpoint(points[3], points[2])
        : midpoint(points[0], points[1]);
      label(anchor, measurementResultModel(object).canvasText, object.color, object.type === 'kastel' ? 'below' : 'above');
    }
  } else if (object.type === 'rowAlign') {
    if (typeof drawRowAlignmentObject === 'function') {
      drawRowAlignmentObject(ctx, object, { selected, draft, points });
    } else {
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(points[0].x, points[0].y, points[2].x - points[0].x, points[2].y - points[0].y);
    }
  } else if (object.type === 'slantScan') {
    if (typeof drawSlantScanObject === 'function') {
      drawSlantScanObject(ctx, object, { selected, draft, points });
    } else {
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
      ctx.stroke();
    }
    if (!draft && resultLabelVisible) {
      label(midpoint(points[0], points[1]), measurementResultModel(object).canvasText, object.color, 'above');
    }
  } else if (object.type === 'ellipse' || object.type === 'circle') {
    const left = Math.min(points[0].x, points[2].x);
    const right = Math.max(points[0].x, points[2].x);
    const top = Math.min(points[0].y, points[2].y);
    const bottom = Math.max(points[0].y, points[2].y);
    ctx.beginPath();
    ctx.ellipse((left + right) / 2, (top + bottom) / 2, (right - left) / 2, (bottom - top) / 2, 0, 0, Math.PI * 2);
    if (object.fillEnabled) ctx.fill();
    ctx.stroke();
    if (!draft && resultLabelVisible) label({ x: (left + right) / 2, y: bottom }, measurementResultModel(object).canvasText, object.color, 'below');
  } else if (['length', 'nib', 'gap'].includes(object.type)) {
    if (points.length > 1) {
      if (object.type === 'gap') drawGapDetectionBoundaries(object);
      drawLine(points[0], points[1]);
      drawEndCaps(points[0], points[1], object.color);
      if (resultLabelVisible) {
        const text = draft ? lineLabel(object) : measurementResultModel(object).canvasText;
        label(midpoint(points[0], points[1]), text, object.color);
      }
    }
  } else if (object.type === 'angle') {
    if (points.length > 1) {
      drawDetectedStemBody(object);
      drawLine(points[0], points[1]);
      drawEndCaps(points[0], points[1], object.color);
      if (resultLabelVisible) label(midpoint(points[0], points[1]), measurementResultModel(object).canvasText, object.color);
    }
    if (points.length > 2) drawLine(points[1], points[2]);
  } else if (object.type === 'thirds') {
    if (selected) drawCross(points[0], object.color);
    else drawProbeDot(points[0], object.color);
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (resultLabelVisible && kastel) label(points[0], measurementResultModel(object).canvasText, object.color);
  }

  if (selected || draft) {
    points.forEach((point, index) => {
      const pointSelected = state.selectedPoint &&
        ((draft && state.selectedPoint.target === 'draft' && state.selectedPoint.index === index) ||
         (!draft && state.selectedPoint.target === 'object' && state.selectedPoint.id === object.id && state.selectedPoint.index === index));
      drawHandle(point, object.color, pointSelected);
    });
    if (object.type === 'area' && points.length >= 2) {
      ensureAreaSegments(object);
      for (let index = 0; index < areaSegmentCount(object); index++) {
        const segment = object.segments[index];
        const displayPoint = imageToScreen(segmentDisplayPoint(object, index));
        const segmentSelected = state.selectedSegment &&
          ((draft && state.selectedSegment.target === 'draft' && state.selectedSegment.index === index) ||
           (!draft && state.selectedSegment.target === 'object' && state.selectedSegment.id === object.id && state.selectedSegment.index === index));
        if (segmentSelected && segment?.curved && segment.control) {
          const start = imageToScreen(object.points[index]);
          const end = imageToScreen(object.points[segmentEndIndex(object, index)]);
          ctx.save();
          ctx.setLineDash([4, 5]);
          ctx.globalAlpha = .65;
          ctx.lineWidth = 1;
          drawLine(start, displayPoint);
          drawLine(displayPoint, end);
          ctx.restore();
        }
        if (points.length <= 24 || segmentSelected) {
          drawCurveHandle(displayPoint, object.color, segmentSelected, !!segment?.curved);
        }
      }
    }
  }
  ctx.restore();
}

function drawLine(a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function drawEndCaps(a, b, color) {
  const length = distance(a, b) || 1;
  const nx = -(b.y - a.y) / length * 6;
  const ny = (b.x - a.x) / length * 6;
  ctx.save();
  ctx.strokeStyle = color;
  drawLine({ x: a.x - nx, y: a.y - ny }, { x: a.x + nx, y: a.y + ny });
  drawLine({ x: b.x - nx, y: b.y - ny }, { x: b.x + nx, y: b.y + ny });
  ctx.restore();
}
function drawHandle(point, color, selected) {
  ctx.beginPath();
  ctx.fillStyle = selected ? color : '#fff';
  ctx.strokeStyle = selected ? '#fff' : color;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.arc(point.x, point.y, selected ? 9 : 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function drawCurveHandle(point, color, selected, curved) {
  const radius = selected ? 8 : 6;
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.fillStyle = selected ? color : curved ? '#fff' : 'rgba(255,255,255,.86)';
  ctx.strokeStyle = selected ? '#fff' : color;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.rect(-radius / 2, -radius / 2, radius, radius);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
function drawCross(point, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  drawLine({ x: point.x - 10, y: point.y }, { x: point.x + 10, y: point.y });
  drawLine({ x: point.x, y: point.y - 10 }, { x: point.x, y: point.y + 10 });
  ctx.restore();
}
function drawProbeDot(point, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = .72;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function label(point, text, color, placement = 'above') {
  ctx.save();
  ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  const width = ctx.measureText(text).width + 16;
  const canvasWidth = canvas.width / dpr;
  const canvasHeight = canvas.height / dpr;
  const x = clamp(point.x - width / 2, 4, Math.max(4, canvasWidth - width - 4));
  const preferredY = placement === 'below' ? point.y + 7 : point.y - 30;
  const y = clamp(preferredY, 4, Math.max(4, canvasHeight - 27));
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.fillRect(x, y, width, 23);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, 23);
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + width / 2, y + 11.5);
  ctx.restore();
}
function isResultLabelVisible(object) {
  return object?.display?.resultLabelVisible !== false;
}
function kastelNibTickLayout(object, displayScale = state.view.scale) {
  if (!state.formula.nibPx || !object?.points?.length) return null;
  const topWidthImage = distance(object.points[0], object.points[1]);
  if (!topWidthImage) return null;
  const divisions = Math.floor(topWidthImage / state.formula.nibPx);
  const screenSpacing = state.formula.nibPx * displayScale;
  const step = Math.max(1, Math.ceil(18 / Math.max(1, screenSpacing)), Math.ceil(divisions / 12));
  return { topWidthImage, divisions, step };
}
function kastelHasManualGuide(guides) {
  if (!guides) return false;
  if (guides.source === 'manual') return true;
  return ['roofTopSource', 'roofBottomSource', 'seatTopSource', 'seatBottomSource', 'roofSource', 'seatSource']
    .some(key => guides[key] === 'manual');
}
function kastelGuideSpecs(guides) {
  if (!guides) return [];
  const sharedSource = ['auto', 'manual'].includes(guides.source) ? guides.source : null;
  const roofSource = guides.roofSource || sharedSource;
  const seatSource = guides.seatSource || sharedSource;
  return [
    {
      key: 'roofTopT',
      t: guides.roofTopT,
      color: KASTEL_GUIDE_COLORS.roof,
      dash: (guides.roofTopSource || roofSource) === 'manual' ? [] : [5, 5],
      label: `הגבול העליון של הגג${(guides.roofTopSource || roofSource) === 'auto' ? ' — זוהה' : ''}`,
      source: guides.roofTopSource || roofSource
    },
    {
      key: 'roofBottomT',
      t: guides.roofBottomT,
      color: KASTEL_GUIDE_COLORS.roof,
      dash: (guides.roofBottomSource || roofSource) === 'manual' ? [] : [5, 5],
      label: `הגבול התחתון של הגג${(guides.roofBottomSource || roofSource) === 'auto' ? ' — זוהה' : ''}`,
      source: guides.roofBottomSource || roofSource
    },
    {
      key: 'seatTopT',
      t: guides.seatTopT,
      color: KASTEL_GUIDE_COLORS.seat,
      dash: (guides.seatTopSource || seatSource) === 'manual' ? [] : [5, 5],
      label: `הגבול העליון של המושב${(guides.seatTopSource || seatSource) === 'auto' ? ' — זוהה' : ''}`,
      source: guides.seatTopSource || seatSource
    },
    {
      key: 'seatBottomT',
      t: guides.seatBottomT,
      color: KASTEL_GUIDE_COLORS.seat,
      dash: (guides.seatBottomSource || seatSource) === 'manual' ? [] : [5, 5],
      label: `הגבול התחתון של המושב${(guides.seatBottomSource || seatSource) === 'auto' ? ' — זוהה' : ''}`,
      source: guides.seatBottomSource || seatSource
    }
  ].filter(guide => Number.isFinite(guide.t) && ['auto', 'manual'].includes(guide.source));
}
function seatTrendGeometry(points, trend) {
  if (!trend || !Array.isArray(points) || points.length !== 4) return null;
  const path = Array.isArray(trend.path)
    ? trend.path
      .filter(point => Number.isFinite(point?.u) && Number.isFinite(point?.t))
      .map(point => quadPoint(points, clamp(point.u, 0, 1), clamp(point.t, 0, 1)))
    : [];
  const fallbackPath = Number.isFinite(trend.leftT) && Number.isFinite(trend.rightT)
    ? [
        quadPoint(points, .12, trend.leftT),
        quadPoint(points, .88, trend.rightT)
      ]
    : [];
  const line = path.length >= 2 ? path : fallbackPath;
  if (line.length < 2) return null;
  const meanU = Number.isFinite(trend.meanU) ? clamp(trend.meanU, 0, 1) : .5;
  const meanT = Number.isFinite(trend.meanT)
    ? clamp(trend.meanT, 0, 1)
    : (trend.leftT + trend.rightT) / 2;
  return {
    line,
    mean: quadPoint(points, meanU, meanT)
  };
}
function drawKastelGrid(points, object, color, selected = false) {
  ctx.save();
  if (object.overlays?.thirdsVisible === true) {
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = KASTEL_GUIDE_COLORS.thirds;
    ctx.lineWidth = 1.8;
    for (const t of [1 / 3, 2 / 3]) {
      const top = interp(points[0], points[1], t);
      const bottom = interp(points[3], points[2], t);
      drawLine(top, bottom);
    }
  }
  const tickLayout = selected ? kastelNibTickLayout(object) : null;
  if (tickLayout) {
    const { topWidthImage, divisions, step } = tickLayout;
    ctx.save();
    ctx.globalAlpha = .68;
    ctx.setLineDash([]);
    ctx.lineWidth = 1.25;
    for (let index = step; index <= divisions; index += step) {
      const topT = index * state.formula.nibPx / topWidthImage;
      if (topT >= .995) break;
      const top = interp(points[0], points[1], topT);
      const topTarget = interp(points[3], points[2], topT);
      const topInside = interp(top, topTarget, Math.min(1, 8 / Math.max(1, distance(top, topTarget))));
      drawLine(top, topInside);
    }
    ctx.restore();
    if (step > 1) {
      label(midpoint(points[0], points[1]), `שנתה = ${step} עובי קולמוס`, color);
    }
  }
  const guideSpecs = kastelGuideSpecs(object.guides);
  const showStructure = object.overlays?.structureVisible === true;
  if (showStructure && guideSpecs.length) {
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = .9;
    for (const { t, color: guideColor, dash } of guideSpecs) {
      const left = interp(points[0], points[3], t);
      const right = interp(points[1], points[2], t);
      ctx.strokeStyle = guideColor;
      ctx.setLineDash(dash);
      drawLine(left, right);
    }
    ctx.restore();
    const trend = object.guides?.seatTrend;
    const trendGeometry = seatTrendGeometry(object.points, trend);
    if (trendGeometry) {
      const trendPath = trendGeometry.line.map(imageToScreen);
      const mean = imageToScreen(trendGeometry.mean);
      ctx.save();
      ctx.strokeStyle = KASTEL_GUIDE_COLORS.seatTrend;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(trendPath[0].x, trendPath[0].y);
      for (const point of trendPath.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.fillStyle = KASTEL_GUIDE_COLORS.seatTrend;
      ctx.beginPath();
      ctx.arc(mean.x, mean.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (Number.isFinite(trend.angleDeg)) {
        label(mean, `זווית המושב ${fmt(trend.angleDeg, 1)}°`, KASTEL_GUIDE_COLORS.seatTrend);
      }
    }
  }
  ctx.restore();
}
function areaLabel(object) {
  return `${fmt(measuredArea(object), 0)} פיקסלים²`;
}
function lineLabel(object) {
  const px = distance(object.points[0], object.points[1]);
  if (object.type === 'nib') {
    const ratio = state.formula.nibPx ? px / state.formula.nibPx : 1;
    return `${fmt(ratio, 2)} עובי קולמוס${object.sampleAccepted === false ? ' · דגימה חריגה' : ''}`;
  }
  if (object.type === 'gap') {
    const ratio = measurementRatioNib(object);
    return ratio != null ? `${variableName(object.formulaKey)}: ${fmt(ratio, 2)} עובי קולמוס` : 'נדרש כיול קולמוס';
  }
  if (state.formula.nibPx) return `${fmt(px / state.formula.nibPx, 2)} עובי קולמוס`;
  return 'נדרש כיול קולמוס';
}
