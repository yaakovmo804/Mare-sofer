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
  state.selectedSegment = null;
  const object = state.objects.find(item => item.id === id);
  if (object) {
    ui.name.value = object.name || '';
    ui.color.value = object.color || '#ef4444';
    ui.lineWidth.value = object.lineWidth || 4;
    ui.fillAlpha.value = Math.round((object.fillAlpha || 0) * 100);
    ui.fillEnabled.checked = !!object.fillEnabled;
    if (object.angleRef) ui.angleRef.value = object.angleRef;
    if (ui.category) ui.category.value = object.category || defaultCategory(object.type);
    if (ui.assessment) ui.assessment.value = object.assessment || 'unclassified';
    if (ui.note) ui.note.value = object.note || '';
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
    const area = measuredArea(object);
    html += `<p class="result-emphasis">${fmt(area, 0)} פיקסלים²</p>`;
    html += '<p class="result-note">התחום ניתן להשוואה לשטחים אחרים ברשימה.</p>';
  } else if (object.type === 'length') {
    const px = distance(object.points[0], object.points[1]);
    html += state.formula.nibPx
      ? `<p class="result-emphasis">${fmt(px / state.formula.nibPx, 2)} עובי קולמוס</p><p>${fmt(px, 1)} פיקסלים</p>`
      : `<p class="result-emphasis">${fmt(px, 1)} פיקסלים</p><p class="result-note">כייל עובי קולמוס כדי לקבל את התוצאה בשפת הכתב.</p>`;
  } else if (object.type === 'nib') {
    const px = distance(object.points[0], object.points[1]);
    html += `<p class="result-emphasis">${fmt(px, 1)} פיקסלים</p><p>כיול: 1 עובי קולמוס</p>`;
    if (object.auto) html += '<p class="result-note">הצעה אוטומטית. גרור את הקצוות לאזור מייצג כדי לאמת.</p>';
  } else if (object.type === 'gap') {
    const px = distance(object.points[0], object.points[1]);
    html += state.formula.nibPx
      ? `<p class="result-emphasis">${fmt(px / state.formula.nibPx, 2)} עובי קולמוס</p><p>${fmt(px, 1)} פיקסלים</p>`
      : `<p class="result-emphasis">${fmt(px, 1)} פיקסלים</p><p class="result-note">כייל עובי קולמוס כדי לקבל את המרווח בשפת הכתב.</p>`;
    if (state.formula.commonGapPx) html += `<p>${fmt(px / state.formula.commonGapPx, 2)} מן המרווח המצוי</p>`;
  } else if (object.type === 'angle') {
    html += `<p class="result-emphasis">${fmt(objectAngle(object), 1)}°</p><p>ייחוס: ${angleReferenceLabel(object.angleRef || ui.angleRef.value)}</p>`;
  } else if (object.type === 'kastel') {
    const widthPx = (distance(object.points[0], object.points[1]) + distance(object.points[3], object.points[2])) / 2;
    const heightPx = (distance(object.points[0], object.points[3]) + distance(object.points[1], object.points[2])) / 2;
    html += state.formula.nibPx
      ? `<p class="result-emphasis">רוחב ${fmt(widthPx / state.formula.nibPx, 2)} · גובה ${fmt(heightPx / state.formula.nibPx, 2)} עובי קולמוס</p>`
      : `<p class="result-emphasis">${fmt(widthPx, 1)} × ${fmt(heightPx, 1)} פיקסלים</p><p class="result-note">נדרש כיול קולמוס למדידות המבנה.</p>`;
    html += '<p>חוק השלישים מחלק את גובה האות בלבד; סימוני הרוחב בנויים לפי עובי הקולמוס.</p>';
    if (object.guides) {
      const roofPx = heightPx * object.guides.roofBottomT;
      const seatPx = heightPx * (1 - object.guides.seatTopT);
      const innerPx = Math.max(0, heightPx - roofPx - seatPx);
      const formatGuide = value => state.formula.nibPx ? `${fmt(value / state.formula.nibPx, 2)} עובי קולמוס` : `${fmt(value, 1)} px`;
      html += `<p>עובי גג: <b>${formatGuide(roofPx)}</b></p>`;
      html += `<p>חלל גג–מושב: <b>${formatGuide(innerPx)}</b></p>`;
      html += `<p>עובי מושב: <b>${formatGuide(seatPx)}</b></p>`;
      const guideNote = object.guides.source === 'auto'
        ? 'זיהוי מסייע — ניתן לדייק במחוונים.'
        : object.guides.source === 'manual'
          ? 'קווי העזר תוקנו ידנית.'
          : 'הצעת ברירת מחדל לפי עובי הקולמוס — מומלץ לאמת במחוונים.';
      html += `<p class="result-note">${guideNote}</p>`;
    }
  } else if (object.type === 'nibRegion') {
    html += '<p class="result-emphasis">אזור כיול קולמוס</p>';
    html += object.calibrationPx
      ? `<p>${fmt(object.calibrationPx, 1)} פיקסלים = 1 עובי קולמוס</p><p class="result-note">הכיול הופק מתוך התחום שסומן.</p>`
      : '<p class="result-note">מנתח את העובי בתוך האזור…</p>';
  } else if (object.type === 'thirds') {
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (kastel) {
      const value = thirdsValues(kastel, object.points[0]);
      html += `<p>מיקום בגובה: <b>${fmt(value.yPct, 1)}%</b></p>`;
      html += `<p>סטייה מקו השליש הקרוב: <b>${fmt(value.yDev, 1)}%</b></p>`;
      html += state.formula.nibPx
        ? `<p>מיקום לרוחב: <b>${fmt(value.xNibFromRight, 2)} עובי קולמוס מן הימין</b></p>`
        : '<p class="result-note">כייל קולמוס כדי לקבל מיקום רוחבי מקצועי.</p>';
    }
  }
  if (object.category) html += `<p class="result-note">קטגוריה: ${escapeHtml(categoryName(object.category))}</p>`;
  if (object.assessment && object.assessment !== 'unclassified') {
    html += `<p class="result-note">סיווג: ${object.assessment === 'reference' ? 'דוגמת ייחוס' : object.assessment === 'acceptable' ? 'תקין' : 'חריג'}</p>`;
  }
  results.innerHTML = html;
}

function categoryName(id) {
  return SEMANTIC_CATEGORIES.find(category => category.id === id)?.name || id || 'אחר';
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function angleReferenceLabel(value) {
  return value === 'horizontal' ? 'קו אופקי' : value === 'vertical' ? 'קו אנכי' : 'הציר הקרוב';
}
function thirdsValues(kastel, point) {
  const mapped = pointToQuadUV(kastel.points, point);
  const x = mapped.u;
  const y = mapped.v;
  const deviation = t => Math.min(Math.abs(t - 1 / 3), Math.abs(t - 2 / 3)) * 100;
  const localLeft = interp(kastel.points[0], kastel.points[3], y);
  const localRight = interp(kastel.points[1], kastel.points[2], y);
  const widthPx = distance(localLeft, localRight);
  return {
    xPct: x * 100,
    yPct: y * 100,
    xDev: deviation(x),
    yDev: deviation(y),
    xNibFromRight: state.formula.nibPx ? (1 - x) * widthPx / state.formula.nibPx : null
  };
}

function pointToQuadUV(points, point) {
  const [a, b, c, d] = points;
  const affineU = { x: b.x - a.x, y: b.y - a.y };
  const affineV = { x: d.x - a.x, y: d.y - a.y };
  const target = { x: point.x - a.x, y: point.y - a.y };
  const determinant = affineU.x * affineV.y - affineU.y * affineV.x;
  let u = determinant
    ? (target.x * affineV.y - target.y * affineV.x) / determinant
    : .5;
  let v = determinant
    ? (affineU.x * target.y - affineU.y * target.x) / determinant
    : .5;

  for (let iteration = 0; iteration < 8; iteration++) {
    const mapped = {
      x: a.x * (1 - u) * (1 - v) + b.x * u * (1 - v) + c.x * u * v + d.x * (1 - u) * v,
      y: a.y * (1 - u) * (1 - v) + b.y * u * (1 - v) + c.y * u * v + d.y * (1 - u) * v
    };
    const du = {
      x: (b.x - a.x) * (1 - v) + (c.x - d.x) * v,
      y: (b.y - a.y) * (1 - v) + (c.y - d.y) * v
    };
    const dv = {
      x: (d.x - a.x) * (1 - u) + (c.x - b.x) * u,
      y: (d.y - a.y) * (1 - u) + (c.y - b.y) * u
    };
    const error = { x: mapped.x - point.x, y: mapped.y - point.y };
    const jacobian = du.x * dv.y - du.y * dv.x;
    if (Math.abs(jacobian) < 1e-8) break;
    const deltaU = (error.x * dv.y - error.y * dv.x) / jacobian;
    const deltaV = (du.x * error.y - du.y * error.x) / jacobian;
    u -= deltaU;
    v -= deltaV;
    if (Math.abs(deltaU) + Math.abs(deltaV) < 1e-7) break;
  }
  return { u, v };
}

function renderFormulaUI() {
  $('nibMetric').textContent = state.formula.nibPx ? `${fmt(state.formula.nibPx, 1)} px` : '—';
  $('commonGapMetric').textContent = state.formula.commonGapPx
    ? state.formula.nibPx
      ? `${fmt(state.formula.commonGapPx / state.formula.nibPx, 2)} עובי קולמוס`
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
      valueText.textContent = state.formula.nibPx ? `${fmt(average / state.formula.nibPx, 2)} עובי קולמוס` : `${fmt(average, 1)} px`;
      row.append(labelText, valueText);
      summary.append(row);
    }
  }
}

function renderControls() {
  $('deletePointBtn').disabled = !state.selectedPoint;
  $('closeAreaBtn').disabled = !(state.draft?.type === 'area' && state.draft.points.length >= 3);
  $('curveSegmentBtn').disabled = !state.selectedSegment;
  $('straightenSegmentBtn').disabled = !state.selectedSegment;
  $('cancelDraftBtn').disabled = !state.draft;
  $('deleteBtn').disabled = !state.selectedId;
  const selected = state.objects.find(item => item.id === state.selectedId);
  ui.fillEnabled.disabled = !selected || !['area', 'kastel', 'nibRegion'].includes(selected.type);
  ui.fillAlpha.disabled = !selected || !['area', 'kastel', 'nibRegion'].includes(selected.type);
  if (ui.category) ui.category.disabled = !selected;
  if (ui.assessment) ui.assessment.disabled = !selected;
  if (ui.note) ui.note.disabled = !selected;
  const guidesPanel = $('kastelGuidesPanel');
  if (guidesPanel) guidesPanel.hidden = selected?.type !== 'kastel';
  if (selected?.type === 'kastel' && selected.guides) {
    if (document.activeElement !== ui.roofGuide) ui.roofGuide.value = Math.round(selected.guides.roofBottomT * 1000);
    if (document.activeElement !== ui.seatGuide) ui.seatGuide.value = Math.round(selected.guides.seatTopT * 1000);
  }
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
function nearestAreaSegmentIndex(object, imagePoint, thresholdScreen = 20) {
  if (object?.type !== 'area') return -1;
  ensureAreaSegments(object);
  const target = imageToScreen(imagePoint);
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < areaSegmentCount(object); index++) {
    const handle = imageToScreen(segmentDisplayPoint(object, index));
    let current = distance(target, handle);
    const start = object.points[index];
    const end = object.points[segmentEndIndex(object, index)];
    const segment = object.segments[index];
    if (segment?.curved && segment.control) {
      let previous = imageToScreen(start);
      for (let step = 1; step <= 12; step++) {
        const next = imageToScreen(quadraticPoint(start, segment.control, end, step / 12));
        current = Math.min(current, pointLineDistance(target, previous, next));
        previous = next;
      }
    } else {
      current = Math.min(current, pointLineDistance(target, imageToScreen(start), imageToScreen(end)));
    }
    if (current <= thresholdScreen && current < bestDistance) {
      best = index;
      bestDistance = current;
    }
  }
  return best;
}
function hitTest(imagePoint) {
  const threshold = 10 / state.view.scale;
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const object = state.objects[i];
    const handle = nearestPointIndex(object.points, imagePoint, 22);
    if (handle >= 0) return { object, handle, segment: null };
    if (object.type === 'area' && object.id === state.selectedId) {
      const segment = nearestAreaSegmentIndex(object, imagePoint, 18);
      if (segment >= 0) return { object, handle: null, segment };
    }
    const contour = object.type === 'area' ? flattenedAreaPoints(object) : object.points;
    if (['area', 'kastel', 'nibRegion'].includes(object.type) && object.points.length >= 3 && pointInPolygon(imagePoint, contour)) {
      return { object, handle: null, segment: null };
    }
    if (['length', 'nib', 'gap'].includes(object.type) && object.points.length >= 2 && pointLineDistance(imagePoint, object.points[0], object.points[1]) < threshold) {
      return { object, handle: null, segment: null };
    }
    if (object.type === 'angle' && object.points.length >= 2) {
      if (pointLineDistance(imagePoint, object.points[0], object.points[1]) < threshold) return { object, handle: null, segment: null };
      if (object.points.length >= 3 && pointLineDistance(imagePoint, object.points[1], object.points[2]) < threshold) {
        return { object, handle: null, segment: null };
      }
    }
    if (object.type === 'thirds' && distance(imagePoint, object.points[0]) < threshold * 1.5) return { object, handle: 0, segment: null };
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
  const hit = hitTest(imagePoint);
  const canEditHit = hit && (state.tool === 'pan' || Number.isInteger(hit.handle) || Number.isInteger(hit.segment));
  if (canEditHit) {
    selectObject(hit.object.id);
    const dragBase = {
      id: hit.object.id,
      originScreen: screenPoint,
      before: captureSnapshot(),
      historyCommitted: false,
      moved: false
    };
    if (hit.handle !== null) {
      state.selectedPoint = { target: 'object', id: hit.object.id, index: hit.handle };
      state.selectedSegment = null;
      state.dragging = { ...dragBase, type: 'handle', handle: hit.handle };
      statusText.textContent = 'הנקודה נבחרה. גרור למיקום המדויק';
    } else if (Number.isInteger(hit.segment)) {
      state.selectedPoint = null;
      state.selectedSegment = { target: 'object', id: hit.object.id, index: hit.segment };
      state.dragging = { ...dragBase, type: 'curveHandle', segment: hit.segment };
      statusText.textContent = 'גרור את היהלום כדי לעגל את המקטע';
    } else {
      state.dragging = {
        ...dragBase,
        type: 'object',
        start: imagePoint,
        original: structuredCloneSafe(hit.object.points),
        originalSegments: structuredCloneSafe(hit.object.segments || [])
      };
    }
    renderAll();
    return;
  }
  if (state.tool === 'pan') {
    if (!hit) {
      state.selectedPoint = null;
      state.selectedSegment = null;
      state.dragging = { type: 'pan', start: screenPoint, view: { ...state.view } };
      renderControls();
    }
    return;
  }

  if (state.tool === 'area') handleAreaPointer(imagePoint);
  else if (state.tool === 'length') handleFixedPointTool('length', imagePoint, 2);
  else if (state.tool === 'nib') handleFixedPointTool('nib', imagePoint, 2);
  else if (state.tool === 'nibRegion') handleRectPointer('nibRegion', imagePoint);
  else if (state.tool === 'gap') handleFixedPointTool('gap', imagePoint, 2);
  else if (state.tool === 'angle') handleFixedPointTool('angle', imagePoint, 2);
  else if (state.tool === 'kastel') handleRectPointer('kastel', imagePoint);
  else if (state.tool === 'thirds') handleThirdsPointer(imagePoint);
}

function handleAreaPointer(imagePoint) {
  if (!ensureCompatibleDraft('area')) return;
  if (!state.draft) {
    state.draft = makeObject('area', [imagePoint], { color: TOOL_COLORS.area, closed: false });
    state.draftHistory = [];
    state.selectedPoint = { target: 'draft', index: 0 };
    statusText.textContent = 'סמן נקודות סביב התחום. בסיום לחץ „סגירת השטח”';
    renderAll();
    return;
  }
  const index = nearestPointIndex(state.draft.points, imagePoint, 19);
  if (index >= 0) {
    state.selectedPoint = { target: 'draft', index };
    state.selectedSegment = null;
    state.dragging = {
      type: 'draftHandle',
      handle: index,
      originScreen: imageToScreen(imagePoint),
      originalPoint: { ...state.draft.points[index] },
      beforeDraft: structuredCloneSafe(state.draft),
      moved: false
    };
    statusText.textContent = 'הנקודה נבחרה. גרור למיקום המדויק';
    renderAll();
    return;
  }
  const segment = nearestAreaSegmentIndex(state.draft, imagePoint, 18);
  if (segment >= 0) {
    state.selectedPoint = null;
    state.selectedSegment = { target: 'draft', index: segment };
    state.dragging = {
      type: 'draftCurveHandle',
      segment,
      originScreen: imageToScreen(imagePoint),
      originalSegment: structuredCloneSafe(state.draft.segments?.[segment] || { curved: false, control: null }),
      beforeDraft: structuredCloneSafe(state.draft),
      moved: false
    };
    statusText.textContent = 'גרור את היהלום כדי לעגל את המקטע';
    renderAll();
    return;
  }
  state.draftHistory.push(structuredCloneSafe(state.draft));
  if (state.draftHistory.length > 80) state.draftHistory.shift();
  state.draft.points.push(imagePoint);
  ensureAreaSegments(state.draft);
  state.selectedPoint = { target: 'draft', index: state.draft.points.length - 1 };
  state.selectedSegment = null;
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

function handleRectPointer(type, imagePoint) {
  if (!ensureCompatibleDraft(type)) return;
  state.draft = makeObject(type, [imagePoint, imagePoint, imagePoint, imagePoint], {
    color: TOOL_COLORS[type],
    closed: false
  });
  state.dragging = { type: 'drawRect', objectType: type, start: imagePoint };
  state.selectedPoint = null;
  state.selectedSegment = null;
  draw();
}

function handleThirdsPointer(imagePoint) {
  if (state.draft) {
    statusText.textContent = 'יש להשלים או לבטל את הסימון הנוכחי תחילה';
    return;
  }
  const selectedKastel = state.objects.find(item =>
    item.id === state.selectedId && item.type === 'kastel' && pointInPolygon(imagePoint, item.points)
  );
  const kastel = selectedKastel || [...state.objects].reverse().find(item =>
    item.type === 'kastel' && pointInPolygon(imagePoint, item.points)
  );
  if (!kastel) {
    statusText.textContent = state.objects.some(item => item.type === 'kastel')
      ? 'יש לסמן את נקודת השלישים בתוך הקעסטעל'
      : 'יש ליצור קעסטעל תחילה';
    return;
  }
  snapshot();
  const object = makeObject('thirds', [imagePoint], { color: TOOL_COLORS.thirds, kastelId: kastel.id });
  state.objects.push(object);
  selectObject(object.id);
  statusText.textContent = 'נמדד מיקום הנקודה ביחס לחוק השלישים';
}
