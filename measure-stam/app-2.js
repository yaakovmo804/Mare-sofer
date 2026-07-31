'use strict';

// During a service-worker upgrade, an already installed copy can briefly load
// the previous HTML shell with the new scripts. Keep that transition usable
// until the new shell (which loads letter-tools.js) takes control.
if (typeof globalThis.isLetterTemplate !== 'function') {
  globalThis.isLetterTemplate = object => object?.type === 'letterTemplate';
  globalThis.letterObjectRect = object => {
    const xs = (object?.points || []).map(point => point.x);
    const ys = (object?.points || []).map(point => point.y);
    const left = xs.length ? Math.min(...xs) : 0;
    const right = xs.length ? Math.max(...xs) : left;
    const top = ys.length ? Math.min(...ys) : 0;
    const bottom = ys.length ? Math.max(...ys) : top;
    return { x: left, y: top, width: right - left, height: bottom - top, left, right, top, bottom };
  };
  globalThis.syncLetterControls = () => {};
  globalThis.nearestLetterHandle = () => null;
  globalThis.normalizeLetterTemplateObject = object => object;
  globalThis.drawLetterTemplateForExport = () => {};
}

function kastelRegionMetrics(object) {
  if (!object?.guides || object?.points?.length !== 4) return null;
  const heightPx = (distance(object.points[0], object.points[3]) + distance(object.points[1], object.points[2])) / 2;
  const { roofTopT, roofBottomT, seatTopT, seatBottomT } = object.guides;
  const roofPx = Number.isFinite(roofTopT) && Number.isFinite(roofBottomT)
    ? Math.max(0, (roofBottomT - roofTopT) * heightPx)
    : null;
  const spacePx = Number.isFinite(roofBottomT) && Number.isFinite(seatTopT)
    ? Math.max(0, (seatTopT - roofBottomT) * heightPx)
    : null;
  const seatPx = Number.isFinite(seatTopT) && Number.isFinite(seatBottomT)
    ? Math.max(0, (seatBottomT - seatTopT) * heightPx)
    : null;
  return { heightPx, roofPx, spacePx, seatPx };
}

function measurementResultModel(object) {
  const fallback = { canvasText: typeLabel(object?.type), primaryText: typeLabel(object?.type), secondaryText: '' };
  if (!object?.points?.length) return fallback;

  if (object.type === 'area') {
    const area = measuredArea(object);
    const value = `${fmt(area, 0)} פיקסלים²`;
    return { canvasText: value, primaryText: value, secondaryText: 'שטח ואיזון לובן' };
  }

  if (['length', 'nib', 'gap'].includes(object.type) && object.points.length >= 2) {
    const px = distance(object.points[0], object.points[1]);
    const ratio = state.formula.nibPx ? px / state.formula.nibPx : null;
    let primaryText = ratio == null ? 'נדרש כיול קולמוס' : `${fmt(ratio, 2)} עובי קולמוס`;
    if (object.type === 'nib' && ratio == null) primaryText = '1 עובי קולמוס';
    if (object.type === 'gap' && ratio != null) primaryText = `${variableName(object.formulaKey)}: ${primaryText}`;
    const canvasText = ratio == null ? primaryText : `${fmt(ratio, 2)} עובי קולמוס`;
    const secondaryParts = [`${fmt(px, 1)} פיקסלים`];
    if (object.sampleAccepted === false) secondaryParts.push('דגימה חריגה');
    return { canvasText, primaryText, secondaryText: secondaryParts.join(' · ') };
  }

  if (object.type === 'angle' && object.points.length >= 2) {
    const primaryText = `${fmt(objectAngle(object), 1)}°`;
    return {
      canvasText: primaryText,
      primaryText,
      secondaryText: `ייחוס: ${angleReferenceLabel(object.angleRef || ui.angleRef.value)}`
    };
  }

  if (object.type === 'kastel' && object.points.length === 4) {
    const widthPx = (distance(object.points[0], object.points[1]) + distance(object.points[3], object.points[2])) / 2;
    const heightPx = (distance(object.points[0], object.points[3]) + distance(object.points[1], object.points[2])) / 2;
    const primaryText = state.formula.nibPx
      ? `רוחב ${fmt(widthPx / state.formula.nibPx, 2)} · גובה ${fmt(heightPx / state.formula.nibPx, 2)} עובי קולמוס`
      : 'נדרש כיול קולמוס';
    const secondaryParts = [`${fmt(widthPx, 1)} × ${fmt(heightPx, 1)} פיקסלים`];
    const regions = object.overlays?.structureVisible === true
      ? kastelRegionMetrics(object)
      : null;
    const formatPart = value => state.formula.nibPx
      ? `${fmt(value / state.formula.nibPx, 2)} עובי קולמוס`
      : `${fmt(value, 1)} פיקסלים`;
    if (regions?.roofPx != null) secondaryParts.push(`גג ${formatPart(regions.roofPx)}`);
    if (regions?.spacePx != null) secondaryParts.push(`חלל ${formatPart(regions.spacePx)}`);
    if (regions?.seatPx != null) secondaryParts.push(`מושב ${formatPart(regions.seatPx)}`);
    return {
      canvasText: state.formula.nibPx
        ? `${fmt(widthPx / state.formula.nibPx, 2)} × ${fmt(heightPx / state.formula.nibPx, 2)} עובי קולמוס`
        : primaryText,
      primaryText,
      secondaryText: secondaryParts.join(' · ')
    };
  }

  if (object.type === 'nibRegion') {
    if (!object.calibrationPx) {
      return { canvasText: 'כיול בבדיקה', primaryText: 'כיול בבדיקה', secondaryText: 'אזור כיול קולמוס' };
    }
    const ratio = state.formula.nibPx ? object.calibrationPx / state.formula.nibPx : 1;
    const primaryText = `${fmt(ratio, 2)} עובי קולמוס`;
    return {
      canvasText: primaryText,
      primaryText,
      secondaryText: `${fmt(object.calibrationPx, 1)} פיקסלים${object.sampleAccepted === false ? ' · דגימה חריגה' : ''}`
    };
  }

  if (object.type === 'thirds') {
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (!kastel) return { canvasText: 'קעסטעל לא נמצא', primaryText: 'קעסטעל לא נמצא', secondaryText: '' };
    const value = thirdsValues(kastel, object.points[0]);
    return {
      canvasText: `רוחב ${fmt(value.xPct, 1)}% · סטייה משליש ${fmt(value.xDev, 1)}%`,
      primaryText: `רוחב ${fmt(value.xPct, 1)}%`,
      secondaryText: `מדידת נקודה ישנה · סטייה משליש ${fmt(value.xDev, 1)}%`
    };
  }

  return fallback;
}

function renderList() {
  listEl.replaceChildren();
  const measurementObjects = state.objects.filter(object => !isLetterTemplate(object));
  measurementObjects.forEach((object, index) => {
    const item = document.createElement('article');
    item.className = `measurement-item${object.id === state.selectedId ? ' selected' : ''}`;
    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'measurement-select';
    const main = document.createElement('span');
    main.className = 'measurement-main';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = object.color;
    const identity = document.createElement('span');
    identity.className = 'measurement-identity';
    const name = document.createElement('strong');
    name.textContent = `${index + 1}. ${object.name}`;
    const type = document.createElement('span');
    type.className = 'measurement-type';
    type.textContent = object.auto ? `${typeLabel(object.type)} · מוצע` : typeLabel(object.type);
    identity.append(name, type);
    main.append(dot, identity);
    const resultModel = measurementResultModel(object);
    const value = document.createElement('span');
    value.className = 'measurement-value';
    value.textContent = resultModel.primaryText;
    const detail = document.createElement('span');
    detail.className = 'measurement-detail';
    detail.textContent = resultModel.secondaryText;
    selectButton.append(main, value);
    if (resultModel.secondaryText) selectButton.append(detail);
    selectButton.addEventListener('click', () => selectObject(object.id));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `measurement-label-toggle${isResultLabelVisible(object) ? ' active' : ''}`;
    toggle.setAttribute('aria-pressed', isResultLabelVisible(object) ? 'true' : 'false');
    toggle.setAttribute('aria-label', `${isResultLabelVisible(object) ? 'הסתר' : 'הצג'} את תוצאת ${object.name} על התמונה`);
    toggle.title = isResultLabelVisible(object) ? 'הסתר תוצאה מהתמונה' : 'הצג תוצאה על התמונה';
    toggle.textContent = isResultLabelVisible(object) ? 'תוצאה מוצגת' : 'תוצאה מוסתרת';
    toggle.addEventListener('click', () => {
      snapshot();
      object.display = {
        ...(object.display || {}),
        resultLabelVisible: !isResultLabelVisible(object)
      };
      draw();
      renderList();
      renderResults();
    });

    item.append(selectButton, toggle);
    listEl.append(item);
  });
  if (!measurementObjects.length) {
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
    if (isLetterTemplate(object)) syncLetterControls(object);
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
  if (object.type === 'letterTemplate') {
    const rect = letterObjectRect(object);
    html += `<p class="result-emphasis">תבנית ${escapeHtml(object.template?.letter || '')} · ${letterTraditionLabel(object.template?.tradition)}</p>`;
    html += `<p>${fmt(rect.width, 1)} × ${fmt(rect.height, 1)} פיקסלים</p>`;
    html += `<p class="result-note">שכבה וקטורית להשוואה; אינה נכללת ברשימת המדידות.</p>`;
  } else if (object.type === 'area') {
    const area = measuredArea(object);
    html += `<p class="result-emphasis">${fmt(area, 0)} פיקסלים²</p>`;
    html += '<p class="result-note">התחום ניתן להשוואה לשטחים אחרים ברשימה.</p>';
  } else if (object.type === 'length') {
    const px = distance(object.points[0], object.points[1]);
    html += state.formula.nibPx
      ? `<p class="result-emphasis">${fmt(px / state.formula.nibPx, 2)} עובי קולמוס</p>${technicalPixelDetails(px)}`
      : `<p class="result-emphasis">נדרש כיול קולמוס</p>${technicalPixelDetails(px)}`;
  } else if (object.type === 'nib') {
    const px = distance(object.points[0], object.points[1]);
    const ratio = state.formula.nibPx ? px / state.formula.nibPx : 1;
    html += `<p class="result-emphasis">${fmt(ratio, 2)} עובי קולמוס</p>${technicalPixelDetails(px)}`;
    if (object.sampleAccepted === false) html += '<p class="result-note">הדגימה חריגה ולא שינתה את הכיול הפעיל.</p>';
    if (object.auto) html += '<p class="result-note">הצעה אוטומטית. גרור את הקצוות לאזור מייצג כדי לאמת.</p>';
  } else if (object.type === 'gap') {
    const px = distance(object.points[0], object.points[1]);
    html += state.formula.nibPx
      ? `<p class="result-emphasis">${fmt(px / state.formula.nibPx, 2)} עובי קולמוס</p>${technicalPixelDetails(px)}`
      : `<p class="result-emphasis">נדרש כיול קולמוס</p>${technicalPixelDetails(px)}`;
    if (state.formula.commonGapPx) html += `<p>${fmt(px / state.formula.commonGapPx, 2)} מן המרווח המצוי</p>`;
  } else if (object.type === 'angle') {
    html += `<p class="result-emphasis">${fmt(objectAngle(object), 1)}°</p><p>ייחוס: ${angleReferenceLabel(object.angleRef || ui.angleRef.value)}</p>`;
  } else if (object.type === 'kastel') {
    const widthPx = (distance(object.points[0], object.points[1]) + distance(object.points[3], object.points[2])) / 2;
    const heightPx = (distance(object.points[0], object.points[3]) + distance(object.points[1], object.points[2])) / 2;
    html += state.formula.nibPx
      ? `<p class="result-emphasis">רוחב ${fmt(widthPx / state.formula.nibPx, 2)} עובי קולמוס · גובה ${fmt(heightPx / state.formula.nibPx, 2)} עובי קולמוס</p>`
      : '<p class="result-emphasis">נדרש כיול קולמוס</p>';
    html += technicalPixelDetails(`${fmt(widthPx, 1)} × ${fmt(heightPx, 1)}`);
    html += `<p>חוק השלישים מחלק את רוחב הקעסטעל לשלושה טורים אנכיים${object.overlays?.thirdsVisible ? ' — מוצג כעת' : ''}.</p>`;
    const guideSpecs = kastelGuideSpecs(object.guides);
    if (object.overlays?.structureVisible === true && guideSpecs.length) {
      const regions = kastelRegionMetrics(object);
      const formatGuide = value => state.formula.nibPx ? `${fmt(value / state.formula.nibPx, 2)} עובי קולמוס` : 'נדרש כיול';
      if (regions?.roofPx != null) html += `<p>עובי גג: <b>${formatGuide(regions.roofPx)}</b></p>`;
      if (regions?.spacePx != null) html += `<p>חלל גג–מושב: <b>${formatGuide(regions.spacePx)}</b></p>`;
      if (regions?.seatPx != null) html += `<p>עובי מושב: <b>${formatGuide(regions.seatPx)}</b></p>`;
      if (Number.isFinite(object.guides?.seatTrend?.angleDeg)) {
        html += `<p>זווית המושב בנקודה הממוצעת: <b>${fmt(object.guides.seatTrend.angleDeg, 1)}°</b></p>`;
      }
      if (Number.isFinite(object.guides?.roofDerivedNibPx)) {
        html += `<p>עובי קולמוס שנגזר מן הגג: <b>${fmt(object.guides.roofDerivedNibPx / (state.formula.nibPx || object.guides.roofDerivedNibPx), 2)} עובי קולמוס</b></p>`;
        if (object.guides.roofCalibrationAccepted === false) {
          const deviation = object.guides.roofCalibrationDeviation;
          html += `<p class="result-note">הערך מן הגג${Number.isFinite(deviation) ? ` חרג ב־${fmt(deviation * 100, 1)}%` : ' חרג ביותר מ־10%'} ולכן לא שינה את הכיול הפעיל.</p>`;
        } else if (state.formula.calibration?.verified === true) {
          html += '<p class="result-note">הגג שימש לבדיקת התאמה בלבד; הכיול הידני המאומת נשאר נעול.</p>';
        }
      }
      const hasAuto = guideSpecs.some(guide => guide.source === 'auto');
      const hasManual = guideSpecs.some(guide => guide.source === 'manual');
      const guideNote = hasAuto && hasManual
        ? 'חלק מן הגבולות תוקנו ידנית והאחרים נשארו מן הזיהוי.'
        : hasAuto
          ? 'ארבעת גבולות האזורים זוהו אוטומטית — ניתן לדייק במחוונים.'
          : 'גבולות האזורים נקבעו ידנית.';
      html += `<p class="result-note">${guideNote}</p>`;
    } else {
      html += '<p class="result-note">גג ומושב לא זוהו בוודאות. לחץ „זהה גג, חלל ומושב” או קבע את הגבולות ידנית.</p>';
    }
  } else if (object.type === 'nibRegion') {
    const ratio = object.calibrationPx && state.formula.nibPx ? object.calibrationPx / state.formula.nibPx : 1;
    html += object.calibrationPx
      ? `<p class="result-emphasis">${fmt(ratio, 2)} עובי קולמוס</p>${technicalPixelDetails(object.calibrationPx)}<p class="result-note">${object.sampleAccepted === false ? 'הדגימה חריגה ולא החליפה את הכיול הפעיל.' : 'הכיול הופק מחציון של חתכים יציבים בתוך התחום.'}</p>`
      : '<p class="result-note">מנתח את העובי בתוך האזור…</p>';
  } else if (object.type === 'thirds') {
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (kastel) {
      const value = thirdsValues(kastel, object.points[0]);
      html += `<p>מיקום לרוחב: <b>${fmt(value.xPct, 1)}%</b></p>`;
      html += `<p>סטייה מקו השליש הקרוב: <b>${fmt(value.xDev, 1)}%</b></p>`;
      html += '<p class="result-note">זו מדידת נקודה מגרסה קודמת. חוק השלישים החדש פועל ישירות על הקעסטעל.</p>';
    }
  }
  if (object.category) html += `<p class="result-note">קטגוריה: ${escapeHtml(categoryName(object.category))}</p>`;
  if (object.assessment && object.assessment !== 'unclassified') {
    html += `<p class="result-note">סיווג: ${object.assessment === 'reference' ? 'דוגמת ייחוס' : object.assessment === 'acceptable' ? 'תקין' : 'חריג'}</p>`;
  }
  html += `<p class="result-note">תוצאה על התמונה: ${isResultLabelVisible(object) ? 'מוצגת' : 'מוסתרת'}</p>`;
  results.innerHTML = html;
}

function technicalPixelDetails(value) {
  const text = typeof value === 'number' ? `${fmt(value, 1)} פיקסלים` : `${value} פיקסלים`;
  return `<details class="technical-details"><summary>פרטים חישוביים</summary><p>${text}</p></details>`;
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
  $('nibMetric').textContent = state.formula.nibPx ? '1.00 עובי קולמוס' : '—';
  const nibMetricDetail = $('nibMetricDetail');
  if (nibMetricDetail) {
    const accepted = (state.formula.nibSamples || []).filter(sample => sample.active !== false && sample.accepted !== false);
    const rejected = (state.formula.nibSamples || []).filter(sample => sample.active !== false && sample.accepted === false);
    nibMetricDetail.textContent = state.formula.nibPx
      ? `${accepted.length || 1} דגימות עקביות${rejected.length ? ` · ${rejected.length} חריגות` : ''}`
      : 'טרם כויל';
  }
  $('commonGapMetric').textContent = state.formula.commonGapPx
    ? state.formula.nibPx
      ? `${fmt(state.formula.commonGapPx / state.formula.nibPx, 2)} עובי קולמוס`
      : 'נדרש כיול'
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
      valueText.textContent = state.formula.nibPx ? `${fmt(average / state.formula.nibPx, 2)} עובי קולמוס` : 'נדרש כיול';
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
  const selectedLetter = isLetterTemplate(selected);
  const measurementPropertiesPanel = $('measurementPropertiesPanel');
  const selectedResultPanel = $('selectedResultPanel');
  if (measurementPropertiesPanel) measurementPropertiesPanel.hidden = selectedLetter;
  if (selectedResultPanel) selectedResultPanel.hidden = selectedLetter;
  syncLetterControls(selectedLetter ? selected : null);
  ui.fillEnabled.disabled = !selected || !['area', 'kastel', 'nibRegion'].includes(selected.type);
  ui.fillAlpha.disabled = !selected || !['area', 'kastel', 'nibRegion'].includes(selected.type);
  if (ui.category) ui.category.disabled = !selected;
  if (ui.assessment) ui.assessment.disabled = !selected;
  if (ui.note) ui.note.disabled = !selected;
  const activeKastel = selected?.type === 'kastel'
    ? selected
    : selected?.type === 'thirds'
      ? state.objects.find(item => item.id === selected.kastelId && item.type === 'kastel')
      : null;
  const kastels = state.objects.filter(item => item.type === 'kastel');
  const actionKastel = activeKastel || (kastels.length === 1 ? kastels[0] : null);
  const guidesPanel = $('kastelGuidesPanel');
  if (guidesPanel) guidesPanel.hidden = !activeKastel;
  const thirdsButton = $('thirdsToggleBtn');
  if (thirdsButton) {
    thirdsButton.disabled = !state.objects.some(item => item.type === 'kastel');
    thirdsButton.classList.toggle('active', actionKastel?.overlays?.thirdsVisible === true);
  }
  const structureButton = $('detectStructureBtn');
  if (structureButton) {
    structureButton.disabled = !state.objects.some(item => item.type === 'kastel');
    structureButton.classList.toggle('active', actionKastel?.overlays?.structureVisible === true);
  }
  for (const input of [ui.roofTopGuide, ui.roofGuide, ui.seatGuide, ui.seatBottomGuide]) {
    if (input) input.disabled = selected?.type !== 'kastel';
  }
  if (activeKastel?.guides) {
    const roofTopValue = Number.isFinite(activeKastel.guides.roofTopT)
      ? activeKastel.guides.roofTopT
      : activeKastel.guides.suggestedRoofTopT ?? .02;
    const roofValue = Number.isFinite(activeKastel.guides.roofBottomT)
      ? activeKastel.guides.roofBottomT
      : activeKastel.guides.suggestedRoofBottomT ?? .18;
    const seatValue = Number.isFinite(activeKastel.guides.seatTopT)
      ? activeKastel.guides.seatTopT
      : activeKastel.guides.suggestedSeatTopT ?? .82;
    const seatBottomValue = Number.isFinite(activeKastel.guides.seatBottomT)
      ? activeKastel.guides.seatBottomT
      : activeKastel.guides.suggestedSeatBottomT ?? .98;
    if (document.activeElement !== ui.roofTopGuide) ui.roofTopGuide.value = Math.round(roofTopValue * 1000);
    if (document.activeElement !== ui.roofGuide) ui.roofGuide.value = Math.round(roofValue * 1000);
    if (document.activeElement !== ui.seatGuide) ui.seatGuide.value = Math.round(seatValue * 1000);
    if (document.activeElement !== ui.seatBottomGuide) ui.seatBottomGuide.value = Math.round(seatBottomValue * 1000);
    const guideStatus = $('guideStatus');
    if (guideStatus) {
      const specs = kastelGuideSpecs(activeKastel.guides);
      const resolved = new Set(specs.map(guide => guide.key));
      const allResolved = ['roofTopT', 'roofBottomT', 'seatTopT', 'seatBottomT'].every(key => resolved.has(key));
      const status = activeKastel.overlays?.structureVisible !== true
        ? 'האזורים טרם זוהו. אפשר להפעיל זיהוי או לקבוע כל גבול ידנית.'
        : !specs.length
        ? 'האזורים טרם זוהו. אפשר להפעיל זיהוי או לקבוע כל גבול ידנית.'
        : allResolved
          ? specs.every(guide => guide.source === 'manual')
            ? 'ארבעת הגבולות נקבעו ידנית.'
            : specs.every(guide => guide.source === 'auto')
              ? 'גג, חלל ומושב זוהו אוטומטית — מומלץ לאמת.'
              : 'חלק מן הגבולות ידניים וחלקם מן הזיהוי.'
          : `${resolved.size} מתוך 4 גבולות נקבעו.`;
      guideStatus.textContent = selected?.type === 'thirds'
        ? `${status} כדי לערוך, בחר את מסגרת הקעסטעל.`
        : status;
    }
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
function nearestAreaCurveHandleIndex(object, imagePoint, thresholdScreen = 13) {
  if (object?.type !== 'area') return -1;
  const target = imageToScreen(imagePoint);
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < areaSegmentCount(object); index++) {
    const current = distance(target, imageToScreen(segmentDisplayPoint(object, index)));
    if (current <= thresholdScreen && current < bestDistance) {
      best = index;
      bestDistance = current;
    }
  }
  return best;
}
function selectedAreaEditHit(imagePoint) {
  const object = state.objects.find(item => item.id === state.selectedId && item.type === 'area');
  if (!object) return null;

  const target = imageToScreen(imagePoint);
  const handle = nearestPointIndex(object.points, imagePoint, 22);
  const segmentHandle = nearestAreaCurveHandleIndex(object, imagePoint, 18);
  const handleDistance = handle >= 0
    ? distance(target, imageToScreen(object.points[handle]))
    : Infinity;
  const segmentHandleDistance = segmentHandle >= 0
    ? distance(target, imageToScreen(segmentDisplayPoint(object, segmentHandle)))
    : Infinity;

  // A Pencil tap on the visible diamond should select the segment even when
  // a short segment places that diamond inside an anchor's larger hit target.
  if (segmentHandle >= 0 && segmentHandleDistance < handleDistance) {
    return { object, handle: null, segment: segmentHandle };
  }
  if (handle >= 0) return { object, handle, segment: null };
  if (segmentHandle >= 0) return { object, handle: null, segment: segmentHandle };

  const segment = nearestAreaSegmentIndex(object, imagePoint, 18);
  return segment >= 0 ? { object, handle: null, segment } : null;
}
function hitTest(imagePoint) {
  const selectedLetter = state.objects.find(item => item.id === state.selectedId && isLetterTemplate(item));
  if (selectedLetter) {
    const letterHandle = nearestLetterHandle(selectedLetter, imagePoint, 20);
    if (letterHandle) return { object: selectedLetter, handle: null, segment: null, letterHandle };
    if (pointInPolygon(imagePoint, selectedLetter.points)) {
      return { object: selectedLetter, handle: null, segment: null, letterHandle: null };
    }
  }
  const selectedAreaHit = selectedAreaEditHit(imagePoint);
  if (selectedAreaHit) return selectedAreaHit;

  const threshold = 10 / state.view.scale;
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const object = state.objects[i];
    if (isLetterTemplate(object)) {
      if (pointInPolygon(imagePoint, object.points)) {
        return { object, handle: null, segment: null, letterHandle: null };
      }
      continue;
    }
    const handle = nearestPointIndex(object.points, imagePoint, 22);
    if (handle >= 0) return { object, handle, segment: null };
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

function captureInteractionState() {
  return {
    objects: structuredCloneSafe(state.objects),
    formula: structuredCloneSafe(state.formula),
    draft: structuredCloneSafe(state.draft),
    draftHistory: structuredCloneSafe(state.draftHistory),
    selectedId: state.selectedId,
    selectedPoint: structuredCloneSafe(state.selectedPoint),
    selectedSegment: structuredCloneSafe(state.selectedSegment),
    nextId: state.nextId,
    view: { ...state.view },
    history: state.history.slice(),
    future: state.future.slice(),
    activeCalibrationRegionId: state.activeCalibrationRegionId
  };
}

function restoreInteractionState(saved) {
  if (!saved) return;
  state.objects = structuredCloneSafe(saved.objects);
  state.formula = mergeFormula(saved.formula || {});
  state.draft = structuredCloneSafe(saved.draft);
  state.draftHistory = structuredCloneSafe(saved.draftHistory || []);
  state.selectedId = saved.selectedId;
  state.selectedPoint = structuredCloneSafe(saved.selectedPoint);
  state.selectedSegment = structuredCloneSafe(saved.selectedSegment);
  state.nextId = saved.nextId;
  state.view = { ...saved.view };
  state.history = (saved.history || []).slice();
  state.future = (saved.future || []).slice();
  state.activeCalibrationRegionId = saved.activeCalibrationRegionId || null;
}

function isMeasurementPointer(event) {
  if (event.pointerType === 'pen') return true;
  return event.pointerType === 'mouse' && !TOUCH_CAPABLE_DEVICE;
}

function clearIdleTouchesForPen() {
  if (state.pinchStart || state.pointers.size !== 1) return false;
  for (const pointerId of state.pointers.keys()) {
    try { canvas.releasePointerCapture(pointerId); } catch {}
  }
  state.pointers.clear();
  return true;
}

function rebaseTouchGesture() {
  if (state.pointers.size < 2) {
    state.pinchStart = null;
    return;
  }
  const entries = [...state.pointers.entries()].slice(0, 2);
  const startMidpoint = midpoint(entries[0][1], entries[1][1]);
  state.pinchStart = {
    pointerIds: entries.map(entry => entry[0]),
    distance: Math.max(1, distance(entries[0][1], entries[1][1])),
    scale: state.view.scale,
    anchorImage: screenToImage(startMidpoint)
  };
}

function handleTouchPointerDown(event) {
  event.preventDefault();
  if (state.activePointerId !== null) return;
  try { canvas.setPointerCapture(event.pointerId); } catch {}
  state.pointers.set(event.pointerId, getPos(event));
  if (state.pointers.size === 2) {
    rebaseTouchGesture();
    statusText.textContent = 'הזזה וזום בשתי אצבעות';
  } else if (state.pointers.size === 1) {
    statusText.textContent = 'מדידה ב־Apple Pencil; הזזה וזום בשתי אצבעות';
  }
}

function pointerDown(event) {
  event.preventDefault();
  if (event.pointerType === 'touch') {
    handleTouchPointerDown(event);
    return;
  }
  if (event.pointerType === 'pen') clearIdleTouchesForPen();
  if (!isMeasurementPointer(event)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (state.pointers.size || state.activePointerId !== null) return;
  if (state.formula.analysis.status === 'running') {
    statusText.textContent = 'הכיול עדיין נבדק; אפשר להמשיך מיד בסיום הבדיקה';
    return;
  }
  try { canvas.setPointerCapture(event.pointerId); } catch {}
  state.activePointerId = event.pointerId;
  const screenPoint = getPos(event);
  if (!state.image) {
    state.activePointerId = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    return;
  }
  state.interactionBefore = captureInteractionState();

  const imagePoint = screenToImage(screenPoint);
  const hit = hitTest(imagePoint);
  const canEditHit = !!hit && state.tool === 'pan';
  if (canEditHit) {
    selectObject(hit.object.id);
    const dragBase = {
      id: hit.object.id,
      originScreen: screenPoint,
      pointerId: event.pointerId,
      before: captureSnapshot(),
      historyCommitted: false,
      moved: false
    };
    if (hit.letterHandle) {
      state.selectedPoint = null;
      state.selectedSegment = null;
      state.dragging = {
        ...dragBase,
        type: 'letterResize',
        letterHandle: hit.letterHandle,
        original: structuredCloneSafe(hit.object.points),
        lockAspect: hit.object.letterLockAspect !== false
      };
      statusText.textContent = ['n', 'e', 's', 'w'].includes(hit.letterHandle)
        ? 'גרור לשינוי רוחב או גובה'
        : 'גרור להגדלה או הקטנה';
    } else if (hit.handle !== null) {
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
      state.dragging = { type: 'pan', pointerId: event.pointerId, start: screenPoint, view: { ...state.view } };
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
  if (state.dragging && state.dragging.pointerId == null) state.dragging.pointerId = event.pointerId;
}

function handleAreaPointer(imagePoint) {
  if (!ensureCompatibleDraft('area')) return;
  if (!state.draft) {
    state.draft = makeObject('area', [imagePoint], { color: TOOL_COLORS.area, closed: false });
    state.draftHistory = [];
    state.selectedPoint = { target: 'draft', index: 0 };
    statusText.textContent = 'סמן נקודות סביב התחום. בסיום גע בנקודה הראשונה או לחץ „סגירת השטח”';
    renderAll();
    return;
  }
  const closePointIndex = state.draft.points.length >= 3
    ? nearestPointIndex([state.draft.points[0]], imagePoint, 24)
    : -1;
  if (closePointIndex === 0) {
    state.selectedPoint = { target: 'draft', index: 0 };
    state.selectedSegment = null;
    state.dragging = {
      type: 'draftHandle',
      handle: 0,
      originScreen: imageToScreen(imagePoint),
      originalPoint: { ...state.draft.points[0] },
      beforeDraft: structuredCloneSafe(state.draft),
      moved: false,
      closeOnTap: true
    };
    statusText.textContent = 'שחרר כדי לסגור את השטח, או גרור כדי להזיז את נקודת הפתיחה';
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
      moved: false,
      closeOnTap: false
    };
    statusText.textContent = 'הנקודה נבחרה. גרור למיקום המדויק';
    renderAll();
    return;
  }
  const segment = nearestAreaCurveHandleIndex(state.draft, imagePoint, 13);
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
    state.dragging = {
      type: 'draftHandle',
      handle: index,
      originScreen: imageToScreen(imagePoint),
      beforeDraft: structuredCloneSafe(state.draft),
      moved: false
    };
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
    closed: false,
    fillEnabled: false,
    fillAlpha: 0
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
      ? 'יש לסמן את נקודת הבדיקה בתוך הקעסטעל'
      : 'יש ליצור קעסטעל תחילה';
    return;
  }
  snapshot();
  const object = makeObject('thirds', [imagePoint], { color: TOOL_COLORS.thirds, kastelId: kastel.id });
  state.objects.push(object);
  selectObject(object.id);
  statusText.textContent = 'נמדד מיקום בגובה ביחס לשלישים, וברוחב ביחידות עובי קולמוס';
}
