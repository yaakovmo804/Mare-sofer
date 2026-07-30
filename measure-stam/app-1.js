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

const BUILTIN_VARIABLES = [
  { id: 'common-gap', name: 'מרווח מצוי / קלאסי', builtin: true },
  { id: 'roof-seat', name: 'מרווח גג–מושב', builtin: true },
  { id: 'between-letters', name: 'מרווח בין אות לאות', builtin: true },
  { id: 'between-words', name: 'מרווח בין מילים', builtin: true },
  { id: 'between-lines', name: 'מרווח בין שורות', builtin: true },
  { id: 'between-heads', name: 'מרווח בין ראשים', builtin: true },
  { id: 'shin-teeth', name: 'מרווח בין שיני שי״ן', builtin: true },
  { id: 'bet-seat-line', name: 'תחתית מושב ב׳–שורה/שרטוט', builtin: true },
  { id: 'roof-length', name: 'אורך הגג', builtin: true },
  { id: 'root-weight', name: 'משקל השורש', builtin: true },
  { id: 'max-weight', name: 'נקודת שיא העובי', builtin: true },
  { id: 'balcony-width', name: 'רוחב מרפסת', builtin: true }
];

const TOOL_COLORS = {
  area: '#ef4444', nib: '#7c3aed', nibRegion: '#9333ea', gap: '#0f766e', length: '#2563eb',
  angle: '#d97706', kastel: '#e11d48', thirds: '#16a34a'
};

const SEMANTIC_CATEGORIES = [
  { id: 'nib', name: 'עובי קולמוס' },
  { id: 'white-space', name: 'לובן ושטחים' },
  { id: 'roof', name: 'גגות' },
  { id: 'seat', name: 'מושבים' },
  { id: 'stem', name: 'ירכות ודפנות' },
  { id: 'root', name: 'שורשים ומשקלים' },
  { id: 'balcony', name: 'מרפסות' },
  { id: 'letter-gap', name: 'מרווח בין אותיות' },
  { id: 'word-gap', name: 'מרווח בין מילים' },
  { id: 'line-gap', name: 'מרווח בין שורות' },
  { id: 'thirds', name: 'חוק השלישים' },
  { id: 'angle', name: 'זוויות' },
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
  draftHistory: [],
  view: { x: 0, y: 0, scale: 1 },
  dragging: null,
  history: [],
  future: [],
  nextId: 1,
  pointers: new Map(),
  pinchStart: null,
  formula: {
    nibPx: null,
    commonGapPx: null,
    calibration: null,
    selectedVariable: 'common-gap',
    variables: structuredCloneSafe(BUILTIN_VARIABLES),
    analysis: { status: 'idle', nibConfidence: 0, gapConfidence: 0, threshold: null }
  },
  projectMeta: {
    id: null,
    title: '',
    createdAt: null,
    updatedAt: null
  },
  projectDocument: null,
  referenceDataset: []
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
  roofGuide: $('roofGuideInput'),
  seatGuide: $('seatGuideInput')
};

let dpr = Math.max(1, window.devicePixelRatio || 1);

function structuredCloneSafe(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function isEditableTarget(target) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"]');
}

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

function captureSnapshot() {
  return {
    objects: structuredCloneSafe(state.objects),
    formula: structuredCloneSafe(state.formula),
    nextId: state.nextId
  };
}
function restoreSnapshot(snapshotData) {
  state.objects = structuredCloneSafe(snapshotData.objects || []);
  state.formula = mergeFormula(snapshotData.formula || {});
  state.nextId = snapshotData.nextId || nextAvailableId();
  state.selectedId = null;
  state.selectedPoint = null;
  state.selectedSegment = null;
  renderAll();
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
  return {
    nibPx: Number.isFinite(+saved.nibPx) && +saved.nibPx > 0 ? +saved.nibPx : null,
    commonGapPx: Number.isFinite(+saved.commonGapPx) && +saved.commonGapPx > 0 ? +saved.commonGapPx : null,
    calibration: saved.calibration || null,
    selectedVariable: variables.some(v => v.id === saved.selectedVariable) ? saved.selectedVariable : 'common-gap',
    variables,
    analysis: { status: 'idle', nibConfidence: 0, gapConfidence: 0, threshold: null, ...(saved.analysis || {}) }
  };
}

function defaultName(type) {
  const names = {
    area: 'שטח ואיזון לובן', length: 'אורך', angle: 'זווית', kastel: 'קעסטעל',
    thirds: 'נקודת חוק השלישים', nib: 'עובי קולמוס', nibRegion: 'אזור כיול קולמוס',
    gap: selectedVariableName()
  };
  return names[type] || 'מדידה';
}
function typeLabel(type) {
  const names = {
    area: 'שטח', length: 'אורך', angle: 'זווית', kastel: 'קעסטעל', thirds: 'שלישים',
    nib: 'קולמוס', nibRegion: 'אזור כיול', gap: 'מרווח'
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
  return {
    id: state.nextId++,
    uid: typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    type,
    points,
    name: defaultName(type),
    color: overrides.color || style.color || TOOL_COLORS[type] || '#ef4444',
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
    ...overrides
  };
}

function defaultCategory(type, formulaKey = state.formula.selectedVariable) {
  if (type === 'nib' || type === 'nibRegion') return 'nib';
  if (type === 'area') return 'white-space';
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
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const object of state.objects) drawObject(object, object.id === state.selectedId, false);
  if (state.draft) drawObject(state.draft, false, true);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (!state.image) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function drawObject(object, selected, draft) {
  const points = object.points.map(imageToScreen);
  if (!points.length) return;
  ctx.save();
  ctx.strokeStyle = object.color;
  ctx.fillStyle = hexToRgba(object.color, object.fillAlpha || 0);
  ctx.lineWidth = object.lineWidth || 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (object.auto) ctx.setLineDash([8, 6]);

  if (object.type === 'area') {
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
    if (!draft && points.length >= 3) {
      const center = imageToScreen(polygonCentroid(flattenedAreaPoints(object)));
      label(center, areaLabel(object), object.color);
    }
  } else if (object.type === 'kastel' || object.type === 'nibRegion') {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    if (points.length >= 3) ctx.closePath();
    if (object.fillEnabled && points.length >= 3) ctx.fill();
    ctx.stroke();
    if (object.type === 'kastel' && !draft && points.length === 4) drawKastelGrid(points, object, object.color);
    if (!draft && points.length >= 3) {
      const center = imageToScreen(centroid(object.points));
      label(center, object.type === 'kastel' ? 'קעסטעל' : 'אזור כיול', object.color);
    }
  } else if (['length', 'nib', 'gap'].includes(object.type)) {
    if (points.length > 1) {
      drawLine(points[0], points[1]);
      drawEndCaps(points[0], points[1], object.color);
      label(midpoint(points[0], points[1]), lineLabel(object), object.color);
    }
  } else if (object.type === 'angle') {
    if (points.length > 1) {
      drawLine(points[0], points[1]);
      drawEndCaps(points[0], points[1], object.color);
      label(midpoint(points[0], points[1]), `${fmt(objectAngle(object), 1)}°`, object.color);
    }
    if (points.length > 2) drawLine(points[1], points[2]);
  } else if (object.type === 'thirds') {
    drawCross(points[0], object.color);
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (kastel) {
      const value = thirdsValues(kastel, object.points[0]);
      const horizontal = state.formula.nibPx ? `${fmt(value.xNibFromRight, 2)} עובי קולמוס מימין` : `${fmt(value.xPct, 1)}%`;
      label(points[0], `גובה ${fmt(value.yPct, 1)}% · ${horizontal}`, object.color);
    }
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
function label(point, text, color) {
  ctx.save();
  ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial';
  const width = ctx.measureText(text).width + 16;
  const x = point.x - width / 2;
  const y = point.y - 30;
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.fillRect(x, y, width, 23);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, 23);
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, point.x, y + 11.5);
  ctx.restore();
}
function drawKastelGrid(points, object, color) {
  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (const t of [1 / 3, 2 / 3]) {
    drawLine(interp(points[0], points[3], t), interp(points[1], points[2], t));
  }
  if (state.formula.nibPx) {
    const topWidthImage = distance(object.points[0], object.points[1]);
    const bottomWidthImage = distance(object.points[3], object.points[2]);
    const divisions = Math.floor(Math.min(topWidthImage, bottomWidthImage) / state.formula.nibPx);
    ctx.save();
    ctx.globalAlpha = .42;
    ctx.setLineDash([3, 7]);
    for (let index = 1; index <= divisions; index++) {
      const topT = index * state.formula.nibPx / topWidthImage;
      const bottomT = index * state.formula.nibPx / bottomWidthImage;
      if (topT >= .995 || bottomT >= .995) break;
      drawLine(interp(points[0], points[1], topT), interp(points[3], points[2], bottomT));
    }
    ctx.restore();
  }
  if (object.guides) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = .9;
    for (const t of [object.guides.roofBottomT, object.guides.seatTopT]) {
      if (!Number.isFinite(t)) continue;
      drawLine(interp(points[0], points[3], t), interp(points[1], points[2], t));
    }
    ctx.restore();
  }
  ctx.restore();
}
function areaLabel(object) {
  return `${fmt(measuredArea(object), 0)} px²`;
}
function lineLabel(object) {
  const px = distance(object.points[0], object.points[1]);
  if (object.type === 'nib') return `עובי קולמוס: ${fmt(px, 1)} px`;
  if (object.type === 'gap') {
    const ratio = state.formula.nibPx ? px / state.formula.nibPx : null;
    return ratio ? `${variableName(object.formulaKey)}: ${fmt(ratio, 2)} עובי קולמוס` : `${fmt(px, 1)} px`;
  }
  if (state.formula.nibPx) return `${fmt(px / state.formula.nibPx, 2)} עובי קולמוס`;
  return `${fmt(px, 1)} פיקסלים`;
}
