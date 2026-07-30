'use strict';
function renderList() {
  listEl.replaceChildren();
  for (const object of state.objects) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `measurement-item${object.id === state.selectedId ? ' selected' : ''}`;
    const main = document.createElement('span');
    main.className = 'measurement-main';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = object.color;
    const name = document.createElement('span');
    name.textContent = object.name;
    const type = document.createElement('span');
    type.className = 'measurement-type';
    type.textContent = object.auto ? `${typeLabel(object.type)} · מוצע` : typeLabel(object.type);
    main.append(dot, name);
    item.append(main, type);
    item.addEventListener('click', () => selectObject(object.id));
    listEl.append(item);
  }
  if (!state.objects.length) {
    const empty = document.createElement('p');
    empty.className = 'microcopy';
    empty.textContent = 'אין עדיין מדידות.';
    listEl.append(empty);
  }
}

function selectObject(id) {
  state.selectedId = id;
  state.selectedPoint = null;
  const object = state.objects.find(item => item.id === id);
  if (object) {
    ui.name.value = object.name || '';
    ui.color.value = object.color || '#ef4444';
    ui.lineWidth.value = object.lineWidth || 4;
    ui.fillAlpha.value = Math.round((object.fillAlpha || 0) * 100);
    ui.fillEnabled.checked = !!object.fillEnabled;
    if (object.angleRef) ui.angleRef.value = object.angleRef;
    if (object.type === 'gap' && object.formulaKey) {
      state.formula.selectedVariable = object.formulaKey;
      ui.gapVariable.value = object.formulaKey;
    }
  }
  renderAll();
}

function renderResults() {
  const object = state.objects.find(item => item.id === state.selectedId);
  if (!object) {
    results.innerHTML = '<p>טרם נבחרה מדידה.</p>';
    return;
  }
  let html = `<p><b>${escapeHtml(object.name)}</b></p>`;
  if (object.type === 'area') {
    const area = polygonArea(object.points);
    html += `<p class="result-emphasis">${fmt(area, 0)} פיקסלים²</p>`;
    if (state.formula.nibPx) html += `<p>${fmt(area / state.formula.nibPx ** 2, 2)} קולמוס²</p>`;
    html += '<p class="result-note">התחום ניתן להשוואה לשטחים אחרים ברשימה.</p>';
  } else if (object.type === 'length') {
    const px = distance(object.points[0], object.points[1]);
    html += `<p class="result-emphasis">${fmt(scaledLength(px))} ${unitLabel()}</p><p>${fmt(px, 1)} פיקסלים</p>`;
    if (state.formula.nibPx) html += `<p>${fmt(px / state.formula.nibPx, 2)} קולמוסים</p>`;
  } else if (object.type === 'nib') {
    const px = distance(object.points[0], object.points[1]);
    html += `<p class="result-emphasis">${fmt(px, 1)} פיקסלים</p><p>כיול: 1 קולמוס</p>`;
    if (object.auto) html += '<p class="result-note">הצעה אוטומטית. גרור את הקצוות לאזור מייצג כדי לאמת.</p>';
  } else if (object.type === 'gap') {
    const px = distance(object.points[0], object.points[1]);
    html += `<p class="result-emphasis">${state.formula.nibPx ? `${fmt(px / state.formula.nibPx, 2)} קולמוסים` : `${fmt(px, 1)} פיקסלים`}</p>`;
    html += `<p>${fmt(px, 1)} פיקסלים</p>`;
    if (state.formula.commonGapPx) html += `<p>${fmt(px / state.formula.commonGapPx, 2)} מן המרווח המצוי</p>`;
  } else if (object.type === 'angle') {
    html += `<p class="result-emphasis">${fmt(objectAngle(object), 1)}°</p><p>ייחוס: ${angleReferenceLabel(object.angleRef || ui.angleRef.value)}</p>`;
  } else if (object.type === 'kastel') {
    html += `<p class="result-emphasis">${fmt(polygonArea(object.points), 0)} פיקסלים²</p><p>חלוקה אוטומטית לשלישים אופקיים ואנכיים.</p>`;
  } else if (object.type === 'thirds') {
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (kastel) {
      const value = thirdsValues(kastel, object.points[0]);
      html += `<p>מיקום אופקי: <b>${fmt(value.xPct, 1)}%</b></p><p>מיקום אנכי: <b>${fmt(value.yPct, 1)}%</b></p>`;
      html += `<p>סטייה משליש קרוב: X ${fmt(value.xDev, 1)}%, Y ${fmt(value.yDev, 1)}%</p>`;
    }
  }
  results.innerHTML = html;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function angleReferenceLabel(value) {
  return value === 'horizontal' ? 'קו אופקי' : value === 'vertical' ? 'קו אנכי' : 'הציר הקרוב';
}
function thirdsValues(kastel, point) {
  const [a, b, , d] = kastel.points;
  const ux = { x: b.x - a.x, y: b.y - a.y };
  const uy = { x: d.x - a.x, y: d.y - a.y };
  const v = { x: point.x - a.x, y: point.y - a.y };
  const dot = (q, r) => q.x * r.x + q.y * r.y;
  const x = dot(v, ux) / (dot(ux, ux) || 1);
  const y = dot(v, uy) / (dot(uy, uy) || 1);
  const deviation = t => Math.min(Math.abs(t - 1 / 3), Math.abs(t - 2 / 3)) * 100;
  return { xPct: x * 100, yPct: y * 100, xDev: deviation(x), yDev: deviation(y) };
}

function renderFormulaUI() {
  $('nibMetric').textContent = state.formula.nibPx ? `${fmt(state.formula.nibPx, 1)} px` : '—';
  $('commonGapMetric').textContent = state.formula.commonGapPx
    ? state.formula.nibPx
      ? `${fmt(state.formula.commonGapPx / state.formula.nibPx, 2)} קולמוסים`
      : `${fmt(state.formula.commonGapPx, 1)} px`
    : '—';
  if (document.activeElement !== ui.nibPx) ui.nibPx.value = state.formula.nibPx ? state.formula.nibPx.toFixed(1) : '';

  const badge = $('analysisBadge');
  const analysis = state.formula.analysis;
  badge.className = 'badge neutral';
  if (analysis.status === 'running') {
    badge.textContent = 'מנתח';
    badge.className = 'badge warn';
  } else if (analysis.status === 'done') {
    const confidence = Math.min(analysis.nibConfidence || 0, analysis.gapConfidence || 1);
    badge.textContent = confidence >= 0.55 ? 'נותח' : 'דורש אימות';
    badge.className = confidence >= 0.55 ? 'badge good' : 'badge warn';
  } else if (analysis.status === 'failed') {
    badge.textContent = 'לא זוהה';
    badge.className = 'badge bad';
  } else {
    badge.textContent = 'טרם נותח';
  }

  const current = ui.gapVariable.value;
  ui.gapVariable.replaceChildren();
  for (const variable of state.formula.variables) {
    const option = document.createElement('option');
    option.value = variable.id;
    option.textContent = variable.name;
    ui.gapVariable.append(option);
  }
  ui.gapVariable.value = state.formula.variables.some(v => v.id === state.formula.selectedVariable)
    ? state.formula.selectedVariable
    : current || 'common-gap';

  const gapGroups = new Map();
  for (const object of state.objects.filter(item => item.type === 'gap')) {
    if (!gapGroups.has(object.formulaKey)) gapGroups.set(object.formulaKey, []);
    gapGroups.get(object.formulaKey).push(distance(object.points[0], object.points[1]));
  }
  const summary = $('formulaSummary');
  summary.replaceChildren();
  if (!gapGroups.size) {
    const note = document.createElement('p');
    note.className = 'microcopy';
    note.textContent = 'לאחר סימון מרווחים יוצג כאן ממוצע לכל משתנה.';
    summary.append(note);
  } else {
    for (const [key, values] of gapGroups) {
      const row = document.createElement('div');
      row.className = 'summary-row';
      const labelText = document.createElement('span');
      labelText.textContent = variableName(key);
      const valueText = document.createElement('strong');
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      valueText.textContent = state.formula.nibPx ? `${fmt(average / state.formula.nibPx, 2)} קו׳` : `${fmt(average, 1)} px`;
      row.append(labelText, valueText);
      summary.append(row);
    }
  }
}

function renderControls() {
  $('deletePointBtn').disabled = !state.selectedPoint;
  $('cancelDraftBtn').disabled = !state.draft;
  $('deleteBtn').disabled = !state.selectedId;
  const selected = state.objects.find(item => item.id === state.selectedId);
  ui.fillEnabled.disabled = !selected || !['area', 'kastel'].includes(selected.type);
  ui.fillAlpha.disabled = !selected || !['area', 'kastel'].includes(selected.type);
  $('scaleLabel').firstChild.textContent = ui.unit.value === 'kulmus'
    ? 'פיקסלים לקולמוס — גיבוי ידני'
    : ui.unit.value === 'mm'
      ? 'פיקסלים למ״מ'
      : 'פיקסלים ליחידה ידנית';
}
function renderAll() {
  draw();
  renderList();
  renderResults();
  renderFormulaUI();
  renderControls();
}

function nearestPointIndex(points, imagePoint, thresholdScreen = 18) {
  let best = -1;
  let bestDistance = Infinity;
  const screenPoint = imageToScreen(imagePoint);
  points.forEach((point, index) => {
    const current = distance(imageToScreen(point), screenPoint);
    if (current <= thresholdScreen && current < bestDistance) {
      best = index;
      bestDistance = current;
    }
  });
  return best;
}
function hitTest(imagePoint) {
  const threshold = 10 / state.view.scale;
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const object = state.objects[i];
    const handle = nearestPointIndex(object.points, imagePoint, 17);
    if (handle >= 0) return { object, handle };
    if (['area', 'kastel'].includes(object.type) && object.points.length >= 3 && pointInPolygon(imagePoint, object.points)) return { object, handle: null };
    if (['length', 'nib', 'gap'].includes(object.type) && object.points.length >= 2 && pointLineDistance(imagePoint, object.points[0], object.points[1]) < threshold) return { object, handle: null };
    if (object.type === 'angle' && object.points.length >= 2) {
      if (pointLineDistance(imagePoint, object.points[0], object.points[1]) < threshold) return { object, handle: null };
      if (object.points.length >= 3 && pointLineDistance(imagePoint, object.points[1], object.points[2]) < threshold) return { object, handle: null };
    }
    if (object.type === 'thirds' && distance(imagePoint, object.points[0]) < threshold * 1.5) return { object, handle: 0 };
  }
  return null;
}

function ensureCompatibleDraft(type) {
  if (state.draft && state.draft.type !== type) {
    statusText.textContent = 'יש להשלים או לבטל את הסימון הנוכחי לפני התחלת מדידה אחרת';
    return false;
  }
  return true;
}

function pointerDown(event) {
  event.preventDefault();
  if (event.button !== undefined && event.button !== 0) return;
  try { canvas.setPointerCapture(event.pointerId); } catch {}
  const screenPoint = getPos(event);
  state.pointers.set(event.pointerId, screenPoint);

  if (state.pointers.size === 2) {
    const points = [...state.pointers.values()];
    state.dragging = null;
    state.pinchStart = {
      distance: distance(points[0], points[1]),
      scale: state.view.scale,
      midpoint: midpoint(points[0], points[1]),
      view: { ...state.view }
    };
    return;
  }
  if (!state.image) return;

  const imagePoint = screenToImage(screenPoint);
  if (state.tool === 'pan') {
    const hit = hitTest(imagePoint);
    if (hit) {
      snapshot();
      selectObject(hit.object.id);
      if (hit.handle !== null) {
        state.selectedPoint = { target: 'object', id: hit.object.id, index: hit.handle };
        state.dragging = { type: 'handle', id: hit.object.id, handle: hit.handle };
        statusText.textContent = 'הנקודה נבחרה. גרור לתיקון או לחץ מחיקת נקודה';
      } else {
        state.dragging = {
          type: 'object', id: hit.object.id, start: imagePoint,
          original: structuredCloneSafe(hit.object.points)
        };
      }
      renderControls();
    } else {
      state.selectedPoint = null;
      state.dragging = { type: 'pan', start: screenPoint, view: { ...state.view } };
      renderControls();
    }
    return;
  }

  if (state.tool === 'area') handleAreaPointer(imagePoint);
  else if (state.tool === 'length') handleFixedPointTool('length', imagePoint, 2);
  else if (state.tool === 'nib') handleFixedPointTool('nib', imagePoint, 2);
  else if (state.tool === 'gap') handleFixedPointTool('gap', imagePoint, 2);
  else if (state.tool === 'angle') handleFixedPointTool('angle', imagePoint, 2);
  else if (state.tool === 'kastel') handleKastelPointer(imagePoint);
  else if (state.tool === 'thirds') handleThirdsPointer(imagePoint);
}

function handleAreaPointer(imagePoint) {
  if (!ensureCompatibleDraft('area')) return;
  if (!state.draft) {
    state.draft = makeObject('area', [imagePoint], { color: TOOL_COLORS.area, closed: false });
    state.selectedPoint = { target: 'draft', index: 0 };
    statusText.textContent = 'סמן נקודות סביב התחום. לחץ על הנקודה הראשונה לסגירה';
    renderAll();
    return;
  }
  const index = nearestPointIndex(state.draft.points, imagePoint, 19);
  if (index === 0 && state.draft.points.length >= 3) {
    state.draft.closed = true;
    commitDraft('השטח נסגר ונמדד');
    return;
  }
  if (index >= 0) {
    state.selectedPoint = { target: 'draft', index };
    state.dragging = { type: 'draftHandle', handle: index };
    statusText.textContent = 'הנקודה נבחרה. גרור לתיקון או לחץ מחיקת נקודה';
    renderAll();
    return;
  }
  state.draft.points.push(imagePoint);
  state.selectedPoint = { target: 'draft', index: state.draft.points.length - 1 };
  renderAll();
}

function handleFixedPointTool(type, imagePoint, count) {
  if (!ensureCompatibleDraft(type)) return;
  if (!state.draft) state.draft = makeObject(type, [], { color: TOOL_COLORS[type] });
  const index = nearestPointIndex(state.draft.points, imagePoint, 19);
  if (index >= 0) {
    state.selectedPoint = { target: 'draft', index };
    state.dragging = { type: 'draftHandle', handle: index };
    statusText.textContent = 'הנקודה נבחרה. גרור לתיקון או לחץ מחיקת נקודה';
    renderAll();
    return;
  }
  state.draft.points.push(imagePoint);
  state.selectedPoint = { target: 'draft', index: state.draft.points.length - 1 };
  if (state.draft.points.length >= count) {
    if (type === 'gap') {
      state.draft.formulaKey = state.formula.selectedVariable;
      state.draft.name = selectedVariableName();
    }
    if (type === 'angle') state.draft.angleRef = ui.angleRef.value;
    commitDraft(type === 'nib' ? 'עובי הקולמוס כויל' : 'המדידה נוספה');
  } else {
    statusText.textContent = 'סמן נקודה שנייה';
    renderAll();
  }
}

function handleKastelPointer(imagePoint) {
  if (!ensureCompatibleDraft('kastel')) return;
  state.draft = makeObject('kastel', [imagePoint, imagePoint, imagePoint, imagePoint], { color: TOOL_COLORS.kastel, closed: false });
  state.dragging = { type: 'drawKastel', start: imagePoint };
  state.selectedPoint = null;
  draw();
}

function handleThirdsPointer(imagePoint) {
  if (state.draft) {
    statusText.textContent = 'יש להשלים או לבטל את הסימון הנוכחי תחילה';
    return;
  }
  const selectedKastel = state.objects.find(item => item.id === state.selectedId && item.type === 'kastel');
  const kastel = selectedKastel || [...state.objects].reverse().find(item => item.type === 'kastel');
  if (!kastel) {
    statusText.textContent = 'יש ליצור קעסטעל תחילה';
    return;
  }
  snapshot();
  const object = makeObject('thirds', [imagePoint], { color: TOOL_COLORS.thirds, kastelId: kastel.id });
  state.objects.push(object);
  selectObject(object.id);
  statusText.textContent = 'נמדד מיקום הנקודה ביחס לחוק השלישים';
}
