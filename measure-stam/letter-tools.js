'use strict';

const LETTER_VECTOR_CACHE = new Map();
let activeLetterTradition = 'beitYosef';

function isLetterTemplate(object) {
  return object?.type === 'letterTemplate';
}

function letterTraditionLabel(tradition) {
  return tradition === 'ari' ? 'כתב האר״י' : 'בית יוסף';
}

function letterAsset(objectOrLetter, tradition = 'beitYosef') {
  const letter = typeof objectOrLetter === 'string'
    ? objectOrLetter
    : objectOrLetter?.template?.letter;
  const selectedTradition = typeof objectOrLetter === 'string'
    ? tradition
    : objectOrLetter?.template?.tradition || tradition;
  return globalThis.MEDIDAOT_LETTERS?.traditions?.[selectedTradition]?.[letter] || null;
}

function cachedLetterPaths(asset) {
  if (!asset || typeof Path2D !== 'function') return [];
  const cacheKey = `${asset.style}:${asset.slug}`;
  if (!LETTER_VECTOR_CACHE.has(cacheKey)) {
    LETTER_VECTOR_CACHE.set(cacheKey, asset.paths.map(path => ({
      path: new Path2D(path.d),
      rule: path.rule === 'evenodd' ? 'evenodd' : 'nonzero'
    })));
  }
  return LETTER_VECTOR_CACHE.get(cacheKey);
}

function letterObjectRect(object) {
  const xs = object.points.map(point => point.x);
  const ys = object.points.map(point => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top, left, right, top, bottom };
}

function letterRectPoints(x, y, width, height) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ];
}

function normalizeLetterTemplateObject(object) {
  if (!isLetterTemplate(object)) return object;
  if (!Array.isArray(object.points) || object.points.length !== 4) return object;
  const rect = letterObjectRect(object);
  object.points = letterRectPoints(rect.x, rect.y, Math.max(.1, rect.width), Math.max(.1, rect.height));
  const tradition = object.template?.tradition === 'ari' ? 'ari' : 'beitYosef';
  const letter = globalThis.MEDIDAOT_LETTERS?.order?.includes(object.template?.letter)
    ? object.template.letter
    : 'א';
  const asset = letterAsset(letter, tradition);
  object.template = {
    kind: 'letter',
    vectorAssetVersion: 1,
    ...(object.template || {}),
    letter,
    tradition,
    slug: asset?.slug || object.template?.slug || 'aleph'
  };
  object.letterMode = object.letterMode === 'outline' ? 'outline' : 'solid';
  object.letterOpacity = clamp(Number.isFinite(+object.letterOpacity) ? +object.letterOpacity : .62, .08, 1);
  object.letterOutlineWidth = clamp(Number.isFinite(+object.letterOutlineWidth) ? +object.letterOutlineWidth : 2.5, .5, 30);
  object.letterGridVisible = object.letterGridVisible !== false;
  object.letterLockAspect = object.letterLockAspect !== false;
  object.role = 'reference-overlay';
  object.display = { ...(object.display || {}), resultLabelVisible: false };
  return object;
}

function drawLetterGrid(context, rect, color, opacity, unitScale) {
  context.save();
  context.strokeStyle = color || '#2563eb';
  context.globalAlpha = Math.min(.28, Math.max(.12, opacity * .34));
  context.lineWidth = Math.max(.75, .8 * unitScale);
  context.setLineDash([]);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  for (let column = 1; column < 5; column++) {
    const x = rect.x + rect.width * column / 5;
    context.beginPath();
    context.moveTo(x, rect.y);
    context.lineTo(x, rect.y + rect.height);
    context.stroke();
  }
  for (let row = 1; row < 4; row++) {
    const y = rect.y + rect.height * row / 4;
    context.beginPath();
    context.moveTo(rect.x, y);
    context.lineTo(rect.x + rect.width, y);
    context.stroke();
  }
  context.restore();
}

function drawLetterTemplateShape(context, object, rect, unitScale = 1) {
  const asset = letterAsset(object);
  if (!asset || rect.width <= 0 || rect.height <= 0) return;
  if (object.letterGridVisible) {
    drawLetterGrid(context, rect, object.color, object.letterOpacity ?? .62, unitScale);
  }
  const [, , viewWidth, viewHeight] = asset.viewBox;
  const scaleX = rect.width / Math.max(.001, viewWidth);
  const scaleY = rect.height / Math.max(.001, viewHeight);
  const averageScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2 || 1;
  context.save();
  context.translate(rect.x, rect.y);
  context.scale(scaleX, scaleY);
  context.globalAlpha = clamp(object.letterOpacity ?? .62, .08, 1);
  context.fillStyle = object.color || '#2563eb';
  context.strokeStyle = object.color || '#2563eb';
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = Math.max(.35, (object.letterOutlineWidth || 2.5) * unitScale / averageScale);
  for (const entry of cachedLetterPaths(asset)) {
    if (object.letterMode === 'outline') context.stroke(entry.path);
    else context.fill(entry.path, entry.rule);
  }
  context.restore();
}

function letterHandlePositions(object) {
  const rect = letterObjectRect(object);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    nw: { x: rect.left, y: rect.top },
    n: { x: centerX, y: rect.top },
    ne: { x: rect.right, y: rect.top },
    e: { x: rect.right, y: centerY },
    se: { x: rect.right, y: rect.bottom },
    s: { x: centerX, y: rect.bottom },
    sw: { x: rect.left, y: rect.bottom },
    w: { x: rect.left, y: centerY }
  };
}

function drawLetterTemplateSelection(object) {
  const rect = letterObjectRect(object);
  const topLeft = imageToScreen({ x: rect.left, y: rect.top });
  const bottomRight = imageToScreen({ x: rect.right, y: rect.bottom });
  const screenRect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y
  };
  ctx.save();
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);
  ctx.setLineDash([]);
  for (const [handle, point] of Object.entries(letterHandlePositions(object))) {
    const screenPoint = imageToScreen(point);
    ctx.beginPath();
    ctx.fillStyle = ['n', 'e', 's', 'w'].includes(handle) ? '#dbeafe' : '#fff';
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    if (['n', 'e', 's', 'w'].includes(handle)) {
      ctx.rect(screenPoint.x - 6, screenPoint.y - 6, 12, 12);
    } else {
      ctx.arc(screenPoint.x, screenPoint.y, 7, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawLetterTemplateOnScreen(object, selected) {
  normalizeLetterTemplateObject(object);
  const rect = letterObjectRect(object);
  const topLeft = imageToScreen({ x: rect.x, y: rect.y });
  drawLetterTemplateShape(ctx, object, {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * state.view.scale,
    height: rect.height * state.view.scale
  }, state.view.scale);
  if (selected) drawLetterTemplateSelection(object);
}

function drawLetterTemplateForExport(context, object) {
  normalizeLetterTemplateObject(object);
  drawLetterTemplateShape(context, object, letterObjectRect(object), 1);
}

function nearestLetterHandle(object, imagePoint, thresholdScreen = 20) {
  if (!isLetterTemplate(object)) return null;
  const target = imageToScreen(imagePoint);
  let best = null;
  let bestDistance = Infinity;
  for (const [handle, point] of Object.entries(letterHandlePositions(object))) {
    const current = distance(target, imageToScreen(point));
    if (current <= thresholdScreen && current < bestDistance) {
      best = handle;
      bestDistance = current;
    }
  }
  return best;
}

function resizeLetterFromHandle(originalPoints, handle, imagePoint, lockAspect) {
  const original = letterObjectRect({ points: originalPoints });
  const minimum = 24 / Math.max(.2, state.view.scale);
  let left = original.left;
  let right = original.right;
  let top = original.top;
  let bottom = original.bottom;

  if (handle === 'e') right = Math.max(left + minimum, imagePoint.x);
  else if (handle === 'w') left = Math.min(right - minimum, imagePoint.x);
  else if (handle === 'n') top = Math.min(bottom - minimum, imagePoint.y);
  else if (handle === 's') bottom = Math.max(top + minimum, imagePoint.y);
  else {
    const anchors = {
      nw: { x: original.right, y: original.bottom, sx: -1, sy: -1 },
      ne: { x: original.left, y: original.bottom, sx: 1, sy: -1 },
      se: { x: original.left, y: original.top, sx: 1, sy: 1 },
      sw: { x: original.right, y: original.top, sx: -1, sy: 1 }
    };
    const anchor = anchors[handle] || anchors.se;
    let width = Math.max(minimum, Math.abs(imagePoint.x - anchor.x));
    let height = Math.max(minimum, Math.abs(imagePoint.y - anchor.y));
    if (lockAspect) {
      const aspect = original.width / Math.max(.001, original.height);
      if (width / Math.max(.001, height) > aspect) height = width / aspect;
      else width = height * aspect;
    }
    left = anchor.sx < 0 ? anchor.x - width : anchor.x;
    right = anchor.sx < 0 ? anchor.x : anchor.x + width;
    top = anchor.sy < 0 ? anchor.y - height : anchor.y;
    bottom = anchor.sy < 0 ? anchor.y : anchor.y + height;
  }
  return letterRectPoints(left, top, Math.max(minimum, right - left), Math.max(minimum, bottom - top));
}

function setActiveLetterTradition(tradition) {
  activeLetterTradition = tradition === 'ari' ? 'ari' : 'beitYosef';
  document.querySelectorAll('[data-letter-tradition]').forEach(button => {
    const active = button.dataset.letterTradition === activeLetterTradition;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const note = $('letterDrawerNote');
  if (note) {
    note.textContent = activeLetterTradition === 'ari'
      ? 'כתב האר״י משתמש בצורות המשותפות של בית יוסף ומחליף את א, ו, ח, ט, צ, ק וש.'
      : 'בחר אות בית יוסף והנח אותה כתבנית וקטורית על הצילום.';
  }
  renderLetterKeyboard();
}

function renderLetterKeyboard() {
  const keyboard = $('letterKeyboard');
  if (!keyboard || !globalThis.MEDIDAOT_LETTERS) return;
  keyboard.replaceChildren();
  for (const letter of globalThis.MEDIDAOT_LETTERS.order) {
    const asset = letterAsset(letter, activeLetterTradition);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'letter-key';
    const isAriOverride = activeLetterTradition === 'ari' &&
      Object.prototype.hasOwnProperty.call(globalThis.MEDIDAOT_LETTERS.ariOverrides, letter);
    button.setAttribute('aria-label', `הנחת האות ${letter} — ${letterTraditionLabel(activeLetterTradition)}`);
    button.title = isAriOverride ? `${letter} — צורת האר״י` : `${letter} — ${letterTraditionLabel(activeLetterTradition)}`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', asset.viewBox.join(' '));
    svg.setAttribute('aria-hidden', 'true');
    for (const sourcePath of asset.paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', sourcePath.d);
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('fill-rule', sourcePath.rule || 'nonzero');
      svg.append(path);
    }
    const label = document.createElement('span');
    label.className = 'letter-key-label';
    label.textContent = letter;
    button.append(svg, label);
    if (isAriOverride) {
      const badge = document.createElement('span');
      badge.className = 'ari-badge';
      badge.textContent = 'אר״י';
      button.append(badge);
    }
    button.addEventListener('click', () => addLetterTemplate(letter, activeLetterTradition));
    keyboard.append(button);
  }
}

function addLetterTemplate(letter, tradition = activeLetterTradition) {
  if (!state.image) {
    statusText.textContent = 'יש להעלות צילום לפני הנחת תבנית אות';
    return;
  }
  const asset = letterAsset(letter, tradition);
  if (!asset) return;
  const canvasRect = canvas.getBoundingClientRect();
  const center = screenToImage({ x: canvasRect.width / 2, y: canvasRect.height / 2 });
  const targetScreenHeight = clamp(canvasRect.height * .31, 120, 210);
  const height = Math.min(state.image.height * .48, targetScreenHeight / Math.max(.03, state.view.scale));
  const aspect = asset.viewBox[2] / Math.max(.001, asset.viewBox[3]);
  const width = height * aspect;
  const x = clamp(center.x - width / 2, -width * .25, state.image.width - width * .75);
  const y = clamp(center.y - height / 2, -height * .25, state.image.height - height * .75);
  const object = makeObject('letterTemplate', letterRectPoints(x, y, width, height), {
    name: `תבנית ${letter} — ${letterTraditionLabel(tradition)}`,
    color: '#2563eb',
    lineWidth: 2.5,
    fillEnabled: false,
    fillAlpha: 0,
    role: 'reference-overlay',
    category: 'reference-template',
    template: {
      kind: 'letter',
      letter,
      tradition,
      slug: asset.slug,
      vectorAssetVersion: 1
    },
    letterMode: 'solid',
    letterOpacity: .62,
    letterOutlineWidth: 2.5,
    letterGridVisible: true,
    letterLockAspect: true,
    display: { resultLabelVisible: false }
  });
  normalizeLetterTemplateObject(object);
  snapshot();
  state.objects.push(object);
  setTool('pan');
  selectObject(object.id);
  statusText.textContent = `תבנית ${letter} הונחה. גרור להזזה; ידיות הצד משנות רוחב או גובה`;
}

function selectedLetterTemplate() {
  return state.objects.find(object => object.id === state.selectedId && isLetterTemplate(object)) || null;
}

function syncLetterControls(object = selectedLetterTemplate()) {
  const panel = $('letterControlsPanel');
  if (!panel) return;
  const active = isLetterTemplate(object);
  panel.hidden = !active;
  if (!active) return;
  normalizeLetterTemplateObject(object);
  const mode = object.letterMode === 'outline' ? 'outline' : 'solid';
  $('letterSelectedLabel').textContent = `${object.template.letter} · ${letterTraditionLabel(object.template.tradition)}`;
  $('letterModeSolidBtn').classList.toggle('active', mode === 'solid');
  $('letterModeOutlineBtn').classList.toggle('active', mode === 'outline');
  $('letterColorInput').value = object.color || '#2563eb';
  $('letterOpacityInput').value = Math.round((object.letterOpacity ?? .62) * 100);
  $('letterOutlineWidthInput').value = object.letterOutlineWidth || 2.5;
  $('letterOutlineWidthLabel').hidden = mode !== 'outline';
  $('letterGridInput').checked = object.letterGridVisible !== false;
  $('letterLockAspectInput').checked = object.letterLockAspect !== false;
  const rect = letterObjectRect(object);
  const nibText = state.formula.nibPx
    ? ` · ${fmt(rect.width / state.formula.nibPx, 2)} × ${fmt(rect.height / state.formula.nibPx, 2)} עובי קולמוס`
    : '';
  $('letterSizeReadout').textContent = `רוחב ${fmt(rect.width, 1)} · גובה ${fmt(rect.height, 1)} פיקסלים${nibText}`;
}

function updateSelectedLetterProperty(property, value) {
  const object = selectedLetterTemplate();
  if (!object) return;
  object[property] = value;
  object.auto = false;
  markObjectModified(object);
  syncLetterControls(object);
  draw();
}

function duplicateSelectedLetter() {
  const source = selectedLetterTemplate();
  if (!source) return;
  const copy = structuredCloneSafe(source);
  const offset = 18 / Math.max(.2, state.view.scale);
  snapshot();
  copy.id = state.nextId++;
  copy.uid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  copy.points = copy.points.map(point => ({ x: point.x + offset, y: point.y + offset }));
  copy.name = `${source.name} — עותק`;
  copy.provenance = {
    origin: 'human',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };
  state.objects.push(copy);
  selectObject(copy.id);
  statusText.textContent = `תבנית ${copy.template.letter} שוכפלה`;
}

function resetSelectedLetterRatio() {
  const object = selectedLetterTemplate();
  if (!object) return;
  const asset = letterAsset(object);
  if (!asset) return;
  const rect = letterObjectRect(object);
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const width = rect.height * asset.viewBox[2] / Math.max(.001, asset.viewBox[3]);
  snapshot();
  object.points = letterRectPoints(center.x - width / 2, rect.y, width, rect.height);
  markObjectModified(object);
  renderAll();
  statusText.textContent = 'יחסי הרוחב והגובה של האות הוחזרו למקור';
}

$('letterBoardBtn')?.addEventListener('click', () => {
  const drawer = $('letterDrawer');
  drawer.hidden = !drawer.hidden;
  $('letterBoardBtn').classList.toggle('active', !drawer.hidden);
  if (!drawer.hidden) renderLetterKeyboard();
});
$('closeLetterDrawerBtn')?.addEventListener('click', () => {
  $('letterDrawer').hidden = true;
  $('letterBoardBtn').classList.remove('active');
});
document.querySelectorAll('[data-letter-tradition]').forEach(button => {
  button.addEventListener('click', () => setActiveLetterTradition(button.dataset.letterTradition));
});
$('letterModeSolidBtn')?.addEventListener('click', () => {
  const object = selectedLetterTemplate();
  if (!object || object.letterMode === 'solid') return;
  snapshot();
  updateSelectedLetterProperty('letterMode', 'solid');
});
$('letterModeOutlineBtn')?.addEventListener('click', () => {
  const object = selectedLetterTemplate();
  if (!object || object.letterMode === 'outline') return;
  snapshot();
  updateSelectedLetterProperty('letterMode', 'outline');
});
$('letterColorInput')?.addEventListener('input', event => updateSelectedLetterProperty('color', event.target.value));
$('letterOpacityInput')?.addEventListener('input', event => updateSelectedLetterProperty('letterOpacity', +event.target.value / 100));
$('letterOutlineWidthInput')?.addEventListener('input', event => updateSelectedLetterProperty('letterOutlineWidth', +event.target.value));
$('letterGridInput')?.addEventListener('change', event => {
  snapshot();
  updateSelectedLetterProperty('letterGridVisible', event.target.checked);
});
$('letterLockAspectInput')?.addEventListener('change', event => {
  snapshot();
  updateSelectedLetterProperty('letterLockAspect', event.target.checked);
});
$('duplicateLetterBtn')?.addEventListener('click', duplicateSelectedLetter);
$('resetLetterRatioBtn')?.addEventListener('click', resetSelectedLetterRatio);
$('deleteLetterBtn')?.addEventListener('click', () => {
  if (selectedLetterTemplate()) deleteSelectedObject();
});

renderLetterKeyboard();
