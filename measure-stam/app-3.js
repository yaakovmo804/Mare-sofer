'use strict';
function commitDraft(message) {
  if (!state.draft) return;
  snapshot();
  const object = state.draft;
  state.objects.push(object);
  state.draft = null;
  state.selectedPoint = null;
  state.selectedId = object.id;
  syncFormulaFromObject(object);
  statusText.textContent = message;
  renderAll();
}

function pointerMove(event) {
  event.preventDefault();
  if (!state.pointers.has(event.pointerId)) return;
  state.pointers.set(event.pointerId, getPos(event));

  if (state.pointers.size === 2 && state.pinchStart) {
    const points = [...state.pointers.values()];
    const ratio = distance(points[0], points[1]) / (state.pinchStart.distance || 1);
    const newScale = clamp(state.pinchStart.scale * ratio, 0.03, 12);
    const mid = state.pinchStart.midpoint;
    const imageX = (mid.x - state.pinchStart.view.x) / state.pinchStart.scale;
    const imageY = (mid.y - state.pinchStart.view.y) / state.pinchStart.scale;
    state.view.scale = newScale;
    state.view.x = mid.x - imageX * newScale;
    state.view.y = mid.y - imageY * newScale;
    zoomText.textContent = `${Math.round(newScale * 100)}%`;
    draw();
    return;
  }

  if (!state.dragging) return;
  const screenPoint = getPos(event);
  const imagePoint = screenToImage(screenPoint);
  const drag = state.dragging;

  if (drag.type === 'pan') {
    state.view.x = drag.view.x + (screenPoint.x - drag.start.x);
    state.view.y = drag.view.y + (screenPoint.y - drag.start.y);
  } else if (drag.type === 'drawKastel') {
    const a = drag.start;
    state.draft.points = [a, { x: imagePoint.x, y: a.y }, imagePoint, { x: a.x, y: imagePoint.y }];
  } else if (drag.type === 'draftHandle' && state.draft) {
    state.draft.points[drag.handle] = imagePoint;
    state.selectedPoint = { target: 'draft', index: drag.handle };
  } else if (drag.type === 'handle') {
    const object = state.objects.find(item => item.id === drag.id);
    if (object) {
      object.points[drag.handle] = imagePoint;
      object.auto = false;
      state.selectedPoint = { target: 'object', id: object.id, index: drag.handle };
      syncFormulaFromObject(object);
    }
  } else if (drag.type === 'object') {
    const object = state.objects.find(item => item.id === drag.id);
    if (object) {
      const dx = imagePoint.x - drag.start.x;
      const dy = imagePoint.y - drag.start.y;
      object.points = drag.original.map(point => ({ x: point.x + dx, y: point.y + dy }));
      object.auto = false;
      syncFormulaFromObject(object);
    }
  }
  draw();
  renderResults();
  renderFormulaUI();
}

function pointerUp(event) {
  event.preventDefault();
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) state.pinchStart = null;

  if (state.dragging?.type === 'drawKastel' && state.draft) {
    const width = distance(state.draft.points[0], state.draft.points[1]);
    const height = distance(state.draft.points[0], state.draft.points[3]);
    if (width * state.view.scale < 12 || height * state.view.scale < 12) {
      state.draft = null;
      statusText.textContent = 'הקעסטעל קטן מדי ובוטל';
      state.dragging = null;
      renderAll();
      return;
    }
    state.draft.closed = true;
    commitDraft('הקעסטעל נוצר. עבור לבחירה כדי לעוות את הפינות');
  }
  state.dragging = null;
}
function pointerCancel(event) {
  state.pointers.delete(event.pointerId);
  if (state.pointers.size < 2) state.pinchStart = null;
  state.dragging = null;
}

canvas.addEventListener('pointerdown', pointerDown, { passive: false });
canvas.addEventListener('pointermove', pointerMove, { passive: false });
canvas.addEventListener('pointerup', pointerUp, { passive: false });
canvas.addEventListener('pointercancel', pointerCancel, { passive: false });
canvas.addEventListener('wheel', event => {
  if (!state.image) return;
  event.preventDefault();
  const point = getPos(event);
  const oldScale = state.view.scale;
  const newScale = clamp(oldScale * (event.deltaY < 0 ? 1.12 : 0.89), 0.03, 12);
  const imagePoint = screenToImage(point);
  state.view.scale = newScale;
  state.view.x = point.x - imagePoint.x * newScale;
  state.view.y = point.y - imagePoint.y * newScale;
  zoomText.textContent = `${Math.round(newScale * 100)}%`;
  draw();
}, { passive: false });

function syncFormulaFromObject(object) {
  if (!object || object.points.length < 2) return;
  const value = distance(object.points[0], object.points[1]);
  if (object.type === 'nib' && value > 0) state.formula.nibPx = value;
  if (object.type === 'gap' && object.formulaKey === 'common-gap' && value > 0) state.formula.commonGapPx = value;
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  if (TOOL_COLORS[tool]) ui.color.value = TOOL_COLORS[tool];
  const messages = {
    pan: 'בחירה ועריכה: גע במדידה או בנקודה וגרור',
    area: 'מדידת שטח ואיזון לובן: סמן נקודות סביב התחום',
    nib: 'עובי קולמוס: סמן שתי נקודות לרוחב עובי מייצג',
    gap: `מרווחים: ${selectedVariableName()} — סמן שתי נקודות`,
    length: 'אורך חופשי: סמן שתי נקודות',
    angle: 'זווית: סמן שתי נקודות לאורך הקו',
    kastel: 'קעסטעל: גרור מסגרת סביב האות',
    thirds: 'חוק השלישים: סמן נקודה בתוך הקעסטעל'
  };
  statusText.textContent = messages[tool] || 'מוכן';
  if (tool === 'nib') activateFormulaTab('nib');
  if (tool === 'gap') activateFormulaTab('gaps');
  renderControls();
}

document.querySelectorAll('.tool[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('deletePointBtn').addEventListener('click', deleteSelectedPoint);
$('cancelDraftBtn').addEventListener('click', cancelDraft);
$('deleteBtn').addEventListener('click', deleteSelectedObject);
$('clearBtn').addEventListener('click', () => {
  if (!state.objects.length && !state.draft) return;
  snapshot();
  state.objects = [];
  state.draft = null;
  state.selectedId = null;
  state.selectedPoint = null;
  state.formula.nibPx = null;
  state.formula.commonGapPx = null;
  statusText.textContent = 'כל הסימונים נוקו';
  renderAll();
});

function deleteSelectedPoint() {
  const selection = state.selectedPoint;
  if (!selection) return;
  if (selection.target === 'draft' && state.draft) {
    state.draft.points.splice(selection.index, 1);
    if (!state.draft.points.length) state.draft = null;
    state.selectedPoint = null;
    statusText.textContent = 'הנקודה נמחקה מן הסימון הנוכחי';
    renderAll();
    return;
  }
  const object = state.objects.find(item => item.id === selection.id);
  if (!object) return;
  if (object.type === 'kastel') {
    statusText.textContent = 'בקעסטעל מזיזים את ארבע הפינות; אין למחוק פינה';
    return;
  }
  const minimum = { area: 3, length: 2, angle: 2, nib: 2, gap: 2, thirds: 1 }[object.type] || 1;
  snapshot();
  if (object.points.length - 1 < minimum) {
    state.objects = state.objects.filter(item => item.id !== object.id);
    state.selectedId = null;
    statusText.textContent = 'המדידה נמחקה משום שלא נותרו בה די נקודות';
  } else {
    object.points.splice(selection.index, 1);
    statusText.textContent = 'הנקודה נמחקה';
  }
  state.selectedPoint = null;
  renderAll();
}

function cancelDraft() {
  if (!state.draft) return;
  state.draft = null;
  state.selectedPoint = null;
  state.dragging = null;
  statusText.textContent = 'הסימון הנוכחי בוטל';
  renderAll();
}
function deleteSelectedObject() {
  if (!state.selectedId) return;
  snapshot();
  const deleted = state.objects.find(item => item.id === state.selectedId);
  state.objects = state.objects.filter(item => item.id !== state.selectedId);
  if (deleted?.type === 'nib') {
    const lastNib = [...state.objects].reverse().find(item => item.type === 'nib');
    state.formula.nibPx = lastNib ? distance(lastNib.points[0], lastNib.points[1]) : null;
  }
  if (deleted?.type === 'gap' && deleted.formulaKey === 'common-gap') {
    const lastGap = [...state.objects].reverse().find(item => item.type === 'gap' && item.formulaKey === 'common-gap');
    state.formula.commonGapPx = lastGap ? distance(lastGap.points[0], lastGap.points[1]) : null;
  }
  state.selectedId = null;
  state.selectedPoint = null;
  statusText.textContent = 'המדידה נמחקה';
  renderAll();
}

function activateFormulaTab(tab) {
  document.querySelectorAll('[data-formula-tab]').forEach(button => button.classList.toggle('active', button.dataset.formulaTab === tab));
  $('nibTab').classList.toggle('active', tab === 'nib');
  $('gapsTab').classList.toggle('active', tab === 'gaps');
}
document.querySelectorAll('[data-formula-tab]').forEach(button => button.addEventListener('click', () => activateFormulaTab(button.dataset.formulaTab)));
$('startNibBtn').addEventListener('click', () => setTool('nib'));
$('startGapBtn').addEventListener('click', () => setTool('gap'));
$('analyzeBtn').addEventListener('click', () => analyzeImage(true));

ui.gapVariable.addEventListener('change', () => {
  state.formula.selectedVariable = ui.gapVariable.value;
  statusText.textContent = `משתנה פעיל: ${selectedVariableName()}`;
  if (state.tool === 'gap') statusText.textContent += ' — סמן שתי נקודות';
});
$('addVariableBtn').addEventListener('click', addVariable);
ui.newVariable.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); addVariable(); }
});
function addVariable() {
  const name = ui.newVariable.value.trim();
  if (!name) return;
  const id = `custom-${Date.now().toString(36)}`;
  state.formula.variables.push({ id, name, builtin: false });
  state.formula.selectedVariable = id;
  ui.newVariable.value = '';
  renderFormulaUI();
  statusText.textContent = `המשתנה „${name}” נוסף ונבחר`;
}

ui.nibPx.addEventListener('change', () => {
  const value = +ui.nibPx.value;
  if (!Number.isFinite(value) || value <= 0) return;
  snapshot();
  state.formula.nibPx = value;
  let object = [...state.objects].reverse().find(item => item.type === 'nib');
  if (!object && state.image) {
    object = makeObject('nib', defaultCenteredLine(value), { color: TOOL_COLORS.nib, name: 'עובי קולמוס — כיול ידני' });
    state.objects.push(object);
  } else if (object) {
    resizeLineToLength(object, value);
    object.auto = false;
  }
  statusText.textContent = 'עובי הקולמוס עודכן';
  renderAll();
});
function defaultCenteredLine(length) {
  const x = state.image.width / 2;
  const y = state.image.height / 2;
  return [{ x: x - length / 2, y }, { x: x + length / 2, y }];
}
function resizeLineToLength(object, targetLength) {
  const [a, b] = object.points;
  const center = midpoint(a, b);
  const current = distance(a, b) || 1;
  const ux = (b.x - a.x) / current;
  const uy = (b.y - a.y) / current;
  object.points = [
    { x: center.x - ux * targetLength / 2, y: center.y - uy * targetLength / 2 },
    { x: center.x + ux * targetLength / 2, y: center.y + uy * targetLength / 2 }
  ];
}

for (const element of [ui.name, ui.color, ui.lineWidth, ui.fillAlpha, ui.fillEnabled]) {
  element.addEventListener('input', updateSelectedStyle);
  element.addEventListener('change', updateSelectedStyle);
}
function updateSelectedStyle() {
  const object = state.objects.find(item => item.id === state.selectedId);
  if (!object) return;
  object.name = ui.name.value.trim() || defaultName(object.type);
  object.color = ui.color.value;
  object.lineWidth = +ui.lineWidth.value;
  if (['area', 'kastel'].includes(object.type)) {
    object.fillAlpha = +ui.fillAlpha.value / 100;
    object.fillEnabled = ui.fillEnabled.checked;
  }
  object.auto = false;
  renderList();
  renderResults();
  draw();
}
ui.unit.addEventListener('change', renderAll);
ui.scale.addEventListener('input', renderAll);
ui.angleRef.addEventListener('change', () => {
  const object = state.objects.find(item => item.id === state.selectedId && item.type === 'angle');
  if (object) object.angleRef = ui.angleRef.value;
  renderAll();
});

$('imageInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => loadImageSource(reader.result, true);
  reader.readAsDataURL(file);
  event.target.value = '';
});

function loadImageSource(source, resetProject) {
  const image = new Image();
  image.onload = () => {
    state.image = image;
    state.imageSrc = source;
    emptyState.style.display = 'none';
    if (resetProject) {
      state.objects = [];
      state.draft = null;
      state.selectedId = null;
      state.selectedPoint = null;
      state.nextId = 1;
      state.history = [];
      state.future = [];
      state.formula = mergeFormula({});
    }
    fitImage();
    renderAll();
    if (resetProject) analyzeImage(false);
  };
  image.onerror = () => alert('לא ניתן לפתוח את התמונה');
  image.src = source;
}

async function analyzeImage(userInitiated) {
  if (!state.image) {
    statusText.textContent = 'יש להעלות תמונה תחילה';
    return;
  }
  if (userInitiated) snapshot();
  state.formula.analysis.status = 'running';
  analysisOverlay.hidden = false;
  renderFormulaUI();
  statusText.textContent = 'מנתח עובי קולמוס ומרווחים…';
  await new Promise(resolve => setTimeout(resolve, 40));
  try {
    const analysis = computeImageMetrics(state.image);
    applyAnalysis(analysis);
  } catch (error) {
    console.error(error);
    state.formula.analysis.status = 'failed';
    statusText.textContent = 'הזיהוי האוטומטי לא הצליח. ניתן לסמן ידנית';
  } finally {
    analysisOverlay.hidden = true;
    renderAll();
  }
}
