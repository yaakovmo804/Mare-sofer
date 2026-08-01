'use strict';

/* רגעים / אמן, clean composition canvas, row alignment and correction previews. */

const professionalSuite = state.professionalSuite = mergeProfessionalSuite(state.professionalSuite || {});
try {
  const savedDescriptions = JSON.parse(localStorage.getItem('medidaot-professional-descriptions') || '{}');
  const savedInfo = JSON.parse(localStorage.getItem('medidaot-professional-info') || '{}');
  professionalSuite.descriptions = MASTER_SYSTEM.mergeDescriptions({
    ...professionalSuite.descriptions,
    ...savedDescriptions,
    ...(savedInfo.descriptions || {})
  });
  professionalSuite.measurementNotes = MASTER_SYSTEM.mergeMeasurementNotes({
    ...professionalSuite.measurementNotes,
    ...(savedInfo.measurementNotes || {})
  });
} catch {}

let activeInfoMetricId = null;
let compositionBackgroundImage = null;
let compositionPointer = null;
let compositionDpr = Math.max(1, window.devicePixelRatio || 1);
let currentWorkspaceMode = 'source';
let compositionHistory = [];
let compositionFuture = [];

function captureCompositionState() {
  return {
    composition: structuredCloneSafe(professionalSuite.composition),
    correctionSessions: structuredCloneSafe(professionalSuite.correctionSessions || [])
  };
}

function recordCompositionHistory(previous = captureCompositionState()) {
  compositionHistory.push(previous);
  if (compositionHistory.length > 60) compositionHistory.shift();
  compositionFuture = [];
}

function restoreCompositionState(saved) {
  if (!saved) return;
  professionalSuite.composition = structuredCloneSafe(saved.composition);
  professionalSuite.correctionSessions = structuredCloneSafe(saved.correctionSessions || []);
  $('compositionBackgroundSelect').value = professionalSuite.composition.background.kind;
  loadCompositionBackground(professionalSuite.composition.background.imageSrc);
  drawComposition();
}

function undoComposition() {
  if (!compositionHistory.length) {
    statusText.textContent = 'אין פעולה נוספת לביטול בקנבה';
    return false;
  }
  compositionFuture.push(captureCompositionState());
  restoreCompositionState(compositionHistory.pop());
  statusText.textContent = 'הפעולה האחרונה בקנבה בוטלה';
  return true;
}

function redoComposition() {
  if (!compositionFuture.length) {
    statusText.textContent = 'אין פעולה נוספת לשחזור בקנבה';
    return false;
  }
  compositionHistory.push(captureCompositionState());
  restoreCompositionState(compositionFuture.pop());
  statusText.textContent = 'הפעולה בקנבה שוחזרה';
  return true;
}

function metricDescription(metricId) {
  return professionalSuite.descriptions?.[metricId] || MASTER_SYSTEM.metric(metricId)?.description || '';
}

function metricMeasurementNote(metricId) {
  return professionalSuite.measurementNotes?.[metricId] || MASTER_SYSTEM.metric(metricId)?.measurementDescription || '';
}

function persistProfessionalInfo() {
  try {
    localStorage.setItem('medidaot-professional-descriptions', JSON.stringify(professionalSuite.descriptions));
    localStorage.setItem('medidaot-professional-info', JSON.stringify({
      descriptions: professionalSuite.descriptions,
      measurementNotes: professionalSuite.measurementNotes
    }));
  } catch {}
}

function openMetricInfo(metricId) {
  const metric = MASTER_SYSTEM.metric(metricId);
  if (!metric) return;
  activeInfoMetricId = metricId;
  $('metricInfoTitle').textContent = metric.name;
  $('metricInfoSwatch').style.background = metric.color;
  $('metricInfoText').value = metricDescription(metricId);
  $('metricMeasurementText').value = metricMeasurementNote(metricId);
  $('metricInfoDialog').showModal();
}

function saveMetricInfo() {
  if (!activeInfoMetricId) return;
  const metric = MASTER_SYSTEM.metric(activeInfoMetricId);
  professionalSuite.descriptions[activeInfoMetricId] = $('metricInfoText').value.trim() || metric?.description || '';
  professionalSuite.measurementNotes[activeInfoMetricId] = $('metricMeasurementText').value.trim() || metric?.measurementDescription || '';
  persistProfessionalInfo();
  $('metricInfoDialog').close();
  renderProfessionalPanel();
  statusText.textContent = 'ההסבר המקצועי נשמר';
}

function resetMetricInfo() {
  if (!activeInfoMetricId) return;
  const metric = MASTER_SYSTEM.metric(activeInfoMetricId);
  const description = metric?.description || '';
  const measurementNote = metric?.measurementDescription || '';
  professionalSuite.descriptions[activeInfoMetricId] = description;
  professionalSuite.measurementNotes[activeInfoMetricId] = measurementNote;
  $('metricInfoText').value = description;
  $('metricMeasurementText').value = measurementNote;
  persistProfessionalInfo();
}

function metricEntryLabel(entry) {
  return entry.metricIds.map(id => MASTER_SYSTEM.metric(id)?.name).filter(Boolean).join(' ו');
}

function renderProfessionalPanel() {
  refreshCompositionSourceAvailability();
  const group = MASTER_SYSTEM.GROUPS.find(item => item.id === professionalSuite.activeGroup) || MASTER_SYSTEM.GROUPS[0];
  document.querySelectorAll('[data-master-group]').forEach(button => {
    button.classList.toggle('active', button.dataset.masterGroup === group.id);
    button.setAttribute('aria-selected', button.dataset.masterGroup === group.id ? 'true' : 'false');
  });
  $('masterGroupSummary').textContent = group.summary;
  const grid = $('masterMetricGrid');
  grid.replaceChildren();
  for (const entry of group.entries) {
    const metrics = entry.metricIds.map(MASTER_SYSTEM.metric).filter(Boolean);
    const primary = metrics[0];
    const card = document.createElement('article');
    card.className = `master-metric-card${metrics.every(metric => !metric.tool) ? ' informational' : ''}`;
    card.style.setProperty('--metric-color', primary.color);
    if (metrics.length > 1) card.classList.add('compound');
    const acronym = document.createElement('span');
    acronym.className = 'acronym';
    acronym.textContent = entry.letter;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'metric-action';
    action.textContent = metricEntryLabel(entry);
    const small = document.createElement('small');
    small.textContent = metrics.length > 1 ? 'פתח אפשרויות מדידה והסבר' : primary.tool ? 'הפעל כלי' : 'הסבר והגדרה';
    action.append(small);
    action.addEventListener('click', () => metrics.length > 1 ? showCompoundMetricEntry(entry) : activateProfessionalMetric(primary.id));
    const info = document.createElement('span');
    info.className = 'metric-info-stack';
    for (const metric of metrics) {
      const infoButton = document.createElement('button');
      infoButton.type = 'button';
      infoButton.className = 'metric-info';
      infoButton.textContent = 'i';
      infoButton.title = metric.name;
      infoButton.setAttribute('aria-label', `מידע על ${metric.name}`);
      infoButton.addEventListener('click', () => openMetricInfo(metric.id));
      info.append(infoButton);
    }
    const palette = document.createElement('span');
    palette.className = 'metric-palette';
    palette.setAttribute('aria-label', metrics.map(metric => `${metric.name}: ${metric.color}`).join(' · '));
    for (const metric of metrics) {
      const swatch = document.createElement('i');
      swatch.style.background = metric.color;
      swatch.title = metric.name;
      palette.append(swatch);
    }
    card.append(acronym, action, info, palette);
    grid.append(card);
  }
  const referenceInfo = $('professionalReferenceInfo');
  referenceInfo.replaceChildren();
  for (const metricId of ['thirds', 'roof-seat', 'circle-ellipse']) {
    const metric = MASTER_SYSTEM.metric(metricId);
    const item = document.createElement('div');
    item.className = 'reference-tool-item';
    item.style.setProperty('--metric-color', metric.color);
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'reference-tool-run';
    run.textContent = metricId === 'thirds' ? 'הפעל חוק השלישים' : metricId === 'roof-seat' ? 'מדוד גג–מושב' : 'הפעל עיגול ואליפסה';
    run.addEventListener('click', () => activateProfessionalMetric(metricId));
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'reference-tool-info';
    info.textContent = 'i';
    info.setAttribute('aria-label', `מידע על ${metric.name}`);
    info.addEventListener('click', () => openMetricInfo(metricId));
    item.append(run, info);
    referenceInfo.append(item);
  }
  renderProfessionalReport(professionalSuite.activeMetricId);
}

function showCompoundMetricEntry(entry) {
  professionalSuite.activeMetricId = null;
  const report = $('professionalComparison');
  report.replaceChildren();
  const box = document.createElement('section');
  box.className = 'professional-report';
  const title = document.createElement('h3');
  title.textContent = `${entry.letter} — ${metricEntryLabel(entry)}`;
  box.append(title);
  const actions = document.createElement('div');
  actions.className = 'professional-actions';
  for (const metricId of entry.metricIds) {
    const metric = MASTER_SYSTEM.metric(metricId);
    const run = document.createElement('button');
    run.className = 'btn compact';
    run.type = 'button';
    run.textContent = metric.tool ? `הפעל ${metric.name}` : metric.name;
    run.style.borderColor = metric.color;
    run.addEventListener('click', () => activateProfessionalMetric(metric.id));
    const info = document.createElement('button');
    info.className = 'btn compact';
    info.type = 'button';
    info.textContent = `מידע: ${metric.name}`;
    info.addEventListener('click', () => openMetricInfo(metric.id));
    actions.append(run, info);
  }
  box.append(actions);
  report.append(box);
}

function switchWorkspaceMode(mode) {
  const composition = mode === 'composition';
  currentWorkspaceMode = composition ? 'composition' : 'source';
  document.querySelectorAll('[data-workspace-mode]').forEach(button => {
    const active = button.dataset.workspaceMode === currentWorkspaceMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const propertiesPanel = document.querySelector('.properties');
  propertiesPanel?.classList.toggle('composition-mode', composition);
  $('compositionInspector').hidden = !composition;
  $('compositionWorkspace').hidden = !composition;
  canvas.style.visibility = composition ? 'hidden' : '';
  if (composition) {
    for (const id of ['deletePointBtn', 'closeAreaBtn', 'curveSegmentBtn', 'straightenSegmentBtn', 'cancelDraftBtn', 'deleteBtn', 'clearBtn']) {
      const control = $(id);
      if (control) control.disabled = true;
    }
    emptyState.style.display = 'none';
    analysisOverlay.hidden = true;
    $('letterDrawer').hidden = true;
    resizeCompositionCanvas();
    drawComposition();
    $('compositionCanvas').focus({ preventScroll: true });
    statusText.textContent = 'קנבה נקייה — גרור אות באצבע; גרור את ידית הפינה לשינוי גודל';
  } else {
    emptyState.style.display = state.image ? 'none' : '';
    draw();
    renderControls();
    statusText.textContent = state.image ? 'מקור ומדידה' : 'העלה צילום כדי להתחיל';
  }
}

function armProfessionalMeasurement(metric, options = {}) {
  const next = {
    semanticMetricId: metric.id,
    category: metric.category,
    formulaKey: metric.formulaKey || null,
    name: options.name || metric.name,
    letter: options.letter || null,
    tool: options.tool || metric.tool || null
  };
  if (state.draft) {
    const draftMetricId = state.draft.semanticMetricId || null;
    const draftLetter = state.draft.letterRole || null;
    if (draftMetricId !== next.semanticMetricId || draftLetter !== next.letter) cancelDraft();
  }
  professionalSuite.pendingMeasurement = next;
  return next;
}

function activateProfessionalMetric(metricId, options = {}) {
  const metric = MASTER_SYSTEM.metric(metricId);
  if (!metric) return;
  professionalSuite.activeMetricId = metricId;
  switchWorkspaceMode('source');
  if (metricId === 'balconies') {
    renderProfessionalReport(metricId);
    statusText.textContent = 'בחר ו׳ או ת׳ והפעל מדידת מרפסת';
    return;
  }
  if (metricId === 'slants-parallels') {
    if (ui.angleRef) ui.angleRef.value = 'vertical';
    renderProfessionalReport(metricId);
    if (!state.image) {
      statusText.textContent = 'יש להעלות צילום לפני סריקת ירכות ונטיות';
      return;
    }
    if (state.formula.analysis.status === 'running') {
      statusText.textContent = 'ניתוח התמונה עדיין פועל; מיד בסיומו ניתן לסמן אזור ירכות';
      return;
    }
    armProfessionalMeasurement(metric, { name: 'סריקת ירכות ונטיות', tool: 'slantScan' });
    setTool('slantScan');
    statusText.textContent = 'גרור מסגרת סביב שורה או אזור הכולל את הירכות לבדיקה';
    return;
  }
  if (metricId === 'optical-center') {
    renderProfessionalReport(metricId);
    statusText.textContent = 'המרכז האופטי פתוח כעת להגדרת דרך המדידה; לא נקבע כלל מספרי';
    return;
  }
  if (metricId === 'roof-seat') {
    measureRoofSeatFromActiveKastel();
    return;
  }
  if (metricId === 'thirds') {
    toggleKastelThirds();
    renderProfessionalReport(metricId);
    return;
  }
  if (metricId === 'circle-ellipse') {
    renderProfessionalReport(metricId);
    statusText.textContent = 'בחר עיגול או אליפסה ולאחר מכן גרור מסגרת על הכתב';
    return;
  }
  if (metric.formulaKey) {
    state.formula.selectedVariable = metric.formulaKey;
    if (ui.gapVariable?.querySelector(`option[value="${metric.formulaKey}"]`)) ui.gapVariable.value = metric.formulaKey;
  }
  armProfessionalMeasurement(metric, options);
  if (metric.tool) setTool(metric.tool);
  renderProfessionalReport(metricId);
}

function measurementValueNib(object) {
  if (!object) return null;
  if (object.type === 'gap') return measurementRatioNib(object);
  if (object.type === 'angle') return objectAngle(object);
  if (object.type === 'length' && object.points.length >= 2 && state.formula.nibPx) {
    return distance(object.points[0], object.points[1]) / state.formula.nibPx;
  }
  return null;
}

function signedSlantAngle(object) {
  if (!object?.points || object.points.length < 2) return null;
  return MASTER_SYSTEM.signedVerticalAngle(object.points[0], object.points[1]);
}

function formatSignedAngle(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.abs(value) < 10 ** (-digits) / 2 ? 0 : value;
  return `${rounded > 0 ? '+' : ''}${fmt(rounded, digits)}°`;
}

function createMeasurementButton(label, metricId, letter) {
  const metric = MASTER_SYSTEM.metric(metricId);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn compact';
  button.textContent = label;
  button.disabled = !state.image || state.formula.analysis.status === 'running';
  button.addEventListener('click', () => {
    armProfessionalMeasurement(metric, { name: `${metric.name} — ${letter}׳`, letter });
    if (metric.formulaKey) {
      state.formula.selectedVariable = metric.formulaKey;
      ui.gapVariable.value = metric.formulaKey;
    }
    if (metricId === 'slants-parallels' && ui.angleRef) ui.angleRef.value = 'vertical';
    setTool(metric.tool);
    if (metricId === 'slants-parallels') statusText.textContent = `סמן שתי נקודות לאורך ירך ${letter}׳`;
  });
  return button;
}

function appendMetricInfoButton(container, metricId) {
  const metric = MASTER_SYSTEM.metric(metricId);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn compact';
  button.textContent = `מידע והגדרה — ${metric.name}`;
  button.addEventListener('click', () => openMetricInfo(metricId));
  container.append(button);
}

function renderProfessionalReport(metricId) {
  const report = $('professionalComparison');
  report.replaceChildren();
  if (!metricId) return;
  const metric = MASTER_SYSTEM.metric(metricId);
  if (!metric) return;
  const box = document.createElement('section');
  box.className = 'professional-report';
  const title = document.createElement('h3');
  title.textContent = metric.name;
  box.append(title);
  const note = document.createElement('p');
  note.className = 'microcopy';
  note.textContent = metricDescription(metricId);
  box.append(note);

  if (metricId === 'balconies') {
    const samples = state.objects
      .filter(object => object.semanticMetricId === metricId && object.type === 'gap')
      .map(object => ({
        letter: object.letterRole,
        valueNib: measurementRatioNib(object),
        valuePx: measurementLengthPx(object),
        object
      }));
    const compareInNib = samples.length > 0 && samples.every(sample => Number.isFinite(sample.valueNib));
    const comparisonUnit = compareInNib ? 'עובי קולמוס' : 'פיקסלים';
    const comparison = MASTER_SYSTEM.compareBalconies(samples.map(sample => ({
      ...sample,
      value: compareInNib ? sample.valueNib : sample.valuePx
    })));
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>מופע</th><th>אות</th><th>ערך</th></tr></thead>';
    const body = document.createElement('tbody');
    samples.forEach((sample, index) => {
      const row = document.createElement('tr');
      const valueText = Number.isFinite(sample.valueNib)
        ? `${fmt(sample.valueNib, 2)} עובי קולמוס · ${fmt(sample.valuePx, 1)} פיקסלים`
        : `${fmt(sample.valuePx, 1)} פיקסלים · נדרש כיול להצגה בקולמוס`;
      row.innerHTML = `<td>${index + 1}</td><td>${escapeHtml(sample.letter || '—')}׳</td><td>${valueText}</td>`;
      body.append(row);
    });
    if (!samples.length) {
      const empty = document.createElement('tr');
      empty.innerHTML = '<td colspan="3">טרם נוספו מדידות</td>';
      body.append(empty);
    }
    table.append(body);
    box.append(table);
    const medians = document.createElement('p');
    medians.className = 'microcopy';
    medians.textContent = `חציון ו׳: ${comparison.vav.median == null ? '—' : `${fmt(comparison.vav.median, 2)} ${comparisonUnit}`} · חציון ת׳: ${comparison.tav.median == null ? '—' : `${fmt(comparison.tav.median, 2)} ${comparisonUnit}`}`;
    box.append(medians);
    if (comparison.difference != null) {
      const difference = document.createElement('p');
      difference.className = 'microcopy';
      difference.textContent = `הפרש מספרי: ${fmt(Math.abs(comparison.difference), 2)} ${comparisonUnit}. טרם נקבע כלל חריגה.`;
      box.append(difference);
    }
    const actions = document.createElement('div');
    actions.className = 'professional-actions';
    actions.append(
      createMeasurementButton('מדוד מרפסת ו׳', metricId, 'ו'),
      createMeasurementButton('מדוד מרפסת ת׳', metricId, 'ת')
    );
    appendMetricInfoButton(actions, metricId);
    box.append(actions);
  } else if (metricId === 'straightness') {
    const rowObjects = state.objects.filter(object => object.type === 'rowAlign');
    const selected = rowObjects.find(object => object.id === state.selectedId) || rowObjects.at(-1) || null;
    if (selected) {
      const instruction = document.createElement('p');
      instruction.className = 'microcopy';
      instruction.textContent = selected.rowAlignment?.baselineY == null
        ? 'אשר אילו מועמדים הם מושבים של ב׳, כ׳ או נ׳ רגילה. עד לאישור לא ייווצר קו ייחוס.'
        : `קו הייחוס נקבע לפי ${selected.rowAlignment.referenceCandidateIds?.length || 0} מושבים מאושרים.`;
      box.append(instruction);
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>מועמד</th><th>סיווג</th><th>סטייה מן הקו</th></tr></thead>';
      const body = document.createElement('tbody');
      for (const [index, candidate] of (selected.rowAlignment?.candidates || []).entries()) {
        const row = document.createElement('tr');
        const number = document.createElement('td');
        number.textContent = String(index + 1);
        const classification = document.createElement('td');
        const select = document.createElement('select');
        select.setAttribute('aria-label', `סיווג מועמד ${index + 1}`);
        select.innerHTML = '<option value="">בחר אות</option><option value="ב">ב׳</option><option value="כ">כ׳</option><option value="נ">נ׳ רגילה</option><option value="exclude">לא לייחוס — כגון ן׳ או י׳</option>';
        select.value = candidate.eligible && ['ב', 'כ', 'נ'].includes(candidate.letter)
          ? candidate.letter
          : candidate.confirmed === true
            ? 'exclude'
            : '';
        select.addEventListener('change', () => setRowCandidateClassification(selected.id, candidate.id, select.value));
        classification.append(select);
        const deviation = document.createElement('td');
        const currentDeviation = currentRowDeviation(candidate);
        deviation.textContent = candidate.eligible && selected.rowAlignment?.baselineY != null
          ? `${fmt(currentDeviation.value, 2)} ${currentDeviation.unitLabel}`
          : '—';
        row.append(number, classification, deviation);
        body.append(row);
      }
      if (!selected.rowAlignment?.candidates?.length) {
        const empty = document.createElement('tr');
        empty.innerHTML = '<td colspan="3">לא נמצאו תחתיות מושב יציבות בתחום שסומן.</td>';
        body.append(empty);
      }
      table.append(body);
      box.append(table);
    }
    const actions = document.createElement('div');
    actions.className = 'professional-actions';
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn compact primary';
    run.textContent = selected ? 'סמן שורה אחרת' : 'סמן שורה';
    run.addEventListener('click', () => activateProfessionalMetric(metricId));
    actions.append(run);
    appendMetricInfoButton(actions, metricId);
    box.append(actions);
  } else if (metricId === 'slants-parallels') {
    const scans = state.objects.filter(object => object.type === 'slantScan' && MASTER_SYSTEM.metricIdFor(object) === metricId);
    const samples = state.objects.filter(object => object.type === 'angle' && MASTER_SYSTEM.metricIdFor(object) === metricId);
    const comparisonSamples = samples.filter(object => {
      if (object.excludedFromComparison === true) return false;
      return ['ד', 'ה', 'ת'].includes(object.letterRole);
    });
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>מועמד</th><th>סיווג אנושי</th><th>זווית</th><th>ביטחון</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const [index, object] of samples.entries()) {
      const row = document.createElement('tr');
      const source = document.createElement('td');
      source.textContent = object.sourceScanId != null || object.sourceScanUid
        ? `אוטומטי ${index + 1}`
        : `ידני ${index + 1}`;
      const classification = document.createElement('td');
      const select = document.createElement('select');
      select.setAttribute('aria-label', `סיווג ירך מועמדת ${index + 1}`);
      select.innerHTML = '<option value="">בחר אות</option><option value="ד">ד׳</option><option value="ה">ה׳</option><option value="ת">ת׳</option><option value="exclude">לא לכלול</option>';
      select.value = object.excludedFromComparison === true
        ? 'exclude'
        : ['ד', 'ה', 'ת'].includes(object.letterRole) ? object.letterRole : '';
      select.addEventListener('change', () => setSlantCandidateClassification(object.id, select.value));
      classification.append(select);
      const angle = document.createElement('td');
      angle.textContent = `${formatSignedAngle(signedSlantAngle(object))}${object.excludedFromComparison === true ? ' · לא נכלל' : ''}`;
      const confidence = document.createElement('td');
      confidence.textContent = Number.isFinite(+object.candidateConfidence)
        ? `${Math.round(+object.candidateConfidence * 100)}%`
        : '—';
      row.append(source, classification, angle, confidence);
      body.append(row);
    }
    if (!samples.length) {
      const empty = document.createElement('tr');
      const completedScan = scans.find(scan => scan.slantAnalysis?.status === 'done');
      empty.innerHTML = `<td colspan="4">${completedScan
        ? 'לא זוהו ירכות בתחום שסומן. אפשר לסמן אזור אחר או להשתמש במדידה הידנית.'
        : 'טרם סומנה שורה או אזור לסריקת ירכות.'}</td>`;
      body.append(empty);
    }
    table.append(body);
    box.append(table);
    const pendingCount = samples.filter(object =>
      object.excludedFromComparison !== true && !['ד', 'ה', 'ת'].includes(object.letterRole)
    ).length;
    if (pendingCount) {
      const pending = document.createElement('p');
      pending.className = 'microcopy';
      pending.textContent = `${pendingCount} מועמדים ממתינים לסיווג ד׳, ה׳, ת׳ או „לא לכלול”. רק מועמדים שסווגו נכנסים להשוואה.`;
      box.append(pending);
    }
    if (comparisonSamples.length) {
      const signedAngles = comparisonSamples.map(signedSlantAngle).filter(Number.isFinite);
      const median = MASTER_SYSTEM.median(signedAngles);
      const spread = signedAngles.length ? Math.max(...signedAngles) - Math.min(...signedAngles) : null;
      const summary = document.createElement('p');
      summary.className = 'microcopy';
      summary.textContent = `חציון חתום: ${formatSignedAngle(median)} · פיזור כיווני: ${fmt(spread, 1)}°. כל מופע נשמר בנפרד; סימנים מנוגדים אינם נחשבים מקבילים.`;
      box.append(summary);
    }
    const actions = document.createElement('div');
    actions.className = 'professional-actions';
    const scan = document.createElement('button');
    scan.type = 'button';
    scan.className = 'btn compact primary';
    scan.textContent = scans.length ? 'סרוק שורה או אזור נוסף' : 'סמן שורה או אזור לסריקה';
    scan.disabled = !state.image || state.formula.analysis.status === 'running';
    scan.addEventListener('click', () => activateProfessionalMetric(metricId));
    actions.append(scan);
    for (const letter of ['ד', 'ה', 'ת']) actions.append(createMeasurementButton(`מדוד ירך ${letter}׳`, metricId, letter));
    appendMetricInfoButton(actions, metricId);
    box.append(actions);
    if (comparisonSamples.length) box.append(buildCorrectionPanel(comparisonSamples));
  } else if (metricId === 'circle-ellipse') {
    const actions = document.createElement('div');
    actions.className = 'professional-actions';
    for (const [type, labelText] of [['circle', 'צור עיגול'], ['ellipse', 'צור אליפסה']]) {
      const run = document.createElement('button');
      run.type = 'button';
      run.className = 'btn compact primary';
      run.textContent = labelText;
      run.addEventListener('click', () => {
        armProfessionalMeasurement(metric, { name: type === 'circle' ? 'עיגול' : 'אליפסה' });
        setTool(type);
      });
      actions.append(run);
    }
    appendMetricInfoButton(actions, metricId);
    box.append(actions);
  } else {
    const actions = document.createElement('div');
    actions.className = 'professional-actions';
    if (metric.tool) {
      const run = document.createElement('button');
      run.type = 'button';
      run.className = 'btn compact primary';
      run.textContent = `הפעל ${metric.name}`;
      run.addEventListener('click', () => activateProfessionalMetric(metricId));
      actions.append(run);
    }
    appendMetricInfoButton(actions, metricId);
    box.append(actions);
  }
  const colorNote = document.createElement('p');
  colorNote.className = 'fixed-color-note';
  colorNote.style.setProperty('--fixed-color', metric.color);
  colorNote.textContent = 'זהו הצבע הקבוע של המדד בכל שכבות האפליקציה.';
  box.append(colorNote);
  report.append(box);
}

function buildCorrectionPanel(angleMeasurements) {
  const panel = document.createElement('section');
  panel.className = 'correction-panel';
  panel.innerHTML = '<h3>הדמיית תיקון מן המדידה</h3>';
  const measurementLabel = document.createElement('label');
  measurementLabel.textContent = 'מדידת מקור';
  const measurementSelect = document.createElement('select');
  measurementSelect.id = 'correctionMeasurementSelect';
  for (const object of angleMeasurements) {
    const option = document.createElement('option');
    option.value = object.id;
    option.textContent = `${object.letterRole || 'ירך'} — ${formatSignedAngle(signedSlantAngle(object))}`;
    measurementSelect.append(option);
  }
  measurementLabel.append(measurementSelect);
  const vectorLabel = document.createElement('label');
  vectorLabel.textContent = 'אות וקטורית';
  const vectorSelect = document.createElement('select');
  vectorSelect.id = 'correctionVectorSelect';
  for (const object of state.objects.filter(isLetterTemplate)) {
    const option = document.createElement('option');
    option.value = object.id;
    option.textContent = object.template?.letter ? `${object.template.letter}׳ — ${object.name}` : object.name;
    vectorSelect.append(option);
  }
  vectorLabel.append(vectorSelect);
  const targetLabel = document.createElement('label');
  targetLabel.textContent = 'זווית יעד חתומה מן האנך';
  const targetInput = document.createElement('input');
  targetInput.id = 'correctionTargetAngle';
  targetInput.type = 'number';
  targetInput.min = '-35';
  targetInput.max = '35';
  targetInput.step = '0.5';
  targetInput.value = angleMeasurements.length
    ? fmt(signedSlantAngle(angleMeasurements[0]), 1)
    : '10';
  targetLabel.append(targetInput);
  const note = document.createElement('p');
  note.className = 'microcopy';
  note.textContent = 'הסימן + או − קובע את כיוון הסטייה מן האנך. אם סומנה קבוצת עוגנים היא תשמש לתיקון; אחרת תיבחר קבוצת האיברים הקרובה למדידה. ההדמיה נוצרת כעותק בקנבה והמקור אינו משתנה. תיקון אוטומטי לפי קעסטעל, רוחב, מקום יציאה ומשקל יופעל רק לאחר הגדרת מערכת הכללים.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn compact primary full';
  button.textContent = 'צור הדמיית תיקון בקנבה';
  button.disabled = !angleMeasurements.length || !vectorSelect.options.length;
  button.addEventListener('click', () => createCorrectionPreview(+measurementSelect.value, +vectorSelect.value, +targetInput.value));
  panel.append(measurementLabel, vectorLabel, targetLabel, note, button);
  return panel;
}

function measureRoofSeatFromActiveKastel() {
  const selected = state.objects.find(object => object.id === state.selectedId && object.type === 'kastel');
  const kastels = state.objects.filter(object => object.type === 'kastel');
  const kastel = selected || (kastels.length === 1 ? kastels[0] : null);
  if (!kastel) {
    state.formula.selectedVariable = 'roof-seat';
    ui.gapVariable.value = 'roof-seat';
    armProfessionalMeasurement(MASTER_SYSTEM.metric('roof-seat'), { name: 'מרווח גג–מושב' });
    setTool('gap');
    statusText.textContent = kastels.length > 1
      ? 'בחר קעסטעל מסוים או סמן ידנית את מרווח הגג–מושב'
      : 'לא נמצא קעסטעל; סמן ידנית מן הגבול התחתון של הגג עד הגבול העליון של המושב';
    renderProfessionalReport('roof-seat');
    return null;
  }
  if (!kastel.guides) initializeKastelGuides(kastel, true);
  const roof = kastel.guides?.roofBottomT;
  const seat = kastel.guides?.seatTopT;
  if (!Number.isFinite(roof) || !Number.isFinite(seat) || seat <= roof) {
    selectObject(kastel.id);
    statusText.textContent = 'יש לזהות או לקבוע את גבולות הגג והמושב לפני המדידה הישירה';
    return null;
  }
  if (state.draft) cancelDraft();
  snapshot();
  const object = makeObject('gap', [quadPoint(kastel.points, .5, roof), quadPoint(kastel.points, .5, seat)], {
    semanticMetricId: 'roof-seat', category: 'letter-gap', formulaKey: 'roof-seat',
    name: 'מרווח גג–מושב', linkedKastelId: kastel.id
  });
  object.formulaKey = 'roof-seat';
  object.name = 'מרווח גג–מושב';
  captureGapNormalization(object, state.formula.nibPx, 'kastel-structure');
  state.objects.push(object);
  selectObject(object.id);
  renderProfessionalReport('roof-seat');
  statusText.textContent = 'מרווח הגג–מושב נמדד מן הגבולות הפעילים של הקעסטעל';
  return object;
}

function resolveRowAlignmentCandidates(object) {
  const analysis = object?.rowAlignment;
  if (!analysis) return null;
  const candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
  const awaitingConfirmation = candidates.some(candidate => candidate.confirmed !== true);
  const resolved = awaitingConfirmation
    ? { baselineY: null, candidates: [] }
    : MASTER_SYSTEM.rowAlignmentFromCandidates(candidates, state.formula.nibPx);
  const referenceById = new Map(resolved.candidates.map(candidate => [candidate.id, candidate]));
  analysis.baselineY = resolved.baselineY;
  analysis.referenceCandidateIds = resolved.candidates.map(candidate => candidate.id);
  analysis.candidates = candidates.map(candidate => {
    const reference = referenceById.get(candidate.id);
    return {
      ...candidate,
      deviationPx: reference?.deviationPx ?? null,
      deviationNib: reference?.deviationNib ?? null
    };
  });
  analysis.needsHumanLetterConfirmation = awaitingConfirmation;
  return analysis;
}

function setRowCandidateClassification(objectId, candidateId, value) {
  const object = state.objects.find(item => item.id === objectId && item.type === 'rowAlign');
  const candidate = object?.rowAlignment?.candidates?.find(item => item.id === candidateId);
  if (!object || !candidate) return;
  snapshot();
  if (['ב', 'כ', 'נ'].includes(value)) {
    candidate.letter = value;
    candidate.eligible = true;
    candidate.confirmed = true;
  } else if (value === 'exclude') {
    candidate.letter = 'אחר';
    candidate.eligible = false;
    candidate.confirmed = true;
  } else {
    candidate.letter = null;
    candidate.eligible = false;
    candidate.confirmed = false;
  }
  resolveRowAlignmentCandidates(object);
  markObjectModified(object);
  selectObject(object.id);
  renderProfessionalReport('straightness');
  statusText.textContent = object.rowAlignment.baselineY == null
    ? 'טרם אושר מושב של ב׳, כ׳ או נ׳ רגילה; לא נוצר קו ייחוס'
    : 'קו הייחוס עודכן לפי המושבים המאושרים בלבד';
}

function analyzeRowAlignment(object) {
  if (!state.image || object?.points?.length !== 4) return null;
  professionalSuite.activeGroup = 'regaim';
  professionalSuite.activeMetricId = 'straightness';
  $('professionalSuitePanel').hidden = false;
  const xs = object.points.map(point => point.x);
  const ys = object.points.map(point => point.y);
  const left = clamp(Math.floor(Math.min(...xs)), 0, state.image.width - 1);
  const top = clamp(Math.floor(Math.min(...ys)), 0, state.image.height - 1);
  const right = clamp(Math.ceil(Math.max(...xs)), left + 1, state.image.width);
  const bottom = clamp(Math.ceil(Math.max(...ys)), top + 1, state.image.height);
  const sourceWidth = right - left;
  const sourceHeight = bottom - top;
  const factor = Math.min(1, 1000 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(2, Math.round(sourceWidth * factor));
  const height = Math.max(2, Math.round(sourceHeight * factor));
  const raster = document.createElement('canvas');
  raster.width = width;
  raster.height = height;
  const context = raster.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(state.image, left, top, sourceWidth, sourceHeight, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const threshold = typeof sourceInkThreshold === 'function' ? sourceInkThreshold() : 150;
  const bottomProfile = new Int32Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    for (let y = height - 1; y >= 0; y--) {
      const index = (y * width + x) * 4;
      const gray = .2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2];
      if (gray < threshold) { bottomProfile[x] = y; break; }
    }
  }
  const nib = Math.max(2, (state.formula.nibPx || sourceHeight * .035) * factor);
  const tolerance = Math.max(1.5, nib * .22);
  const minimumWidth = Math.max(5, nib * 1.25);
  const candidates = [];
  let start = -1;
  let values = [];
  const finish = end => {
    if (start < 0 || end - start < minimumWidth || !values.length) { start = -1; values = []; return; }
    const y = MASTER_SYSTEM.median(values);
    if (y >= height * .42) {
      candidates.push({
        id: `seat-${candidates.length + 1}`,
        x1: left + start / factor,
        x2: left + end / factor,
        y: top + y / factor,
        letter: null,
        eligible: false,
        confirmed: false,
        detection: 'stable-horizontal-bottom-profile'
      });
    }
    start = -1;
    values = [];
  };
  for (let x = 0; x <= width; x++) {
    const y = x < width ? bottomProfile[x] : -1;
    const center = values.length ? MASTER_SYSTEM.median(values) : y;
    if (y >= 0 && (start < 0 || Math.abs(y - center) <= tolerance)) {
      if (start < 0) start = x;
      values.push(y);
    } else {
      finish(x);
      if (y >= 0) { start = x; values = [y]; }
    }
  }
  object.rowAlignment = {
    baselineY: null,
    candidates,
    referenceCandidateIds: [],
    threshold,
    method: 'stable-seat-bottom-profile-v1',
    referenceRule: 'lowest-eligible-seat',
    intendedLetters: ['ב', 'כ', 'נ'],
    excludedLetters: ['ן', 'י'],
    needsHumanLetterConfirmation: true
  };
  resolveRowAlignmentCandidates(object);
  object.semanticMetricId = 'straightness';
  object.category = 'straightness';
  enforceSemanticStyle(object);
  markObjectModified(object);
  renderAll();
  renderProfessionalReport('straightness');
  statusText.textContent = candidates.length
    ? 'נמצאו מועמדי מושב; אשר ב׳, כ׳ או נ׳ רגילה לפני יצירת קו הייחוס'
    : 'לא נמצאו תחתיות מושב יציבות בתחום שסומן';
  return object.rowAlignment;
}

function drawRowAlignmentObject(context, object, { selected, draft, points }) {
  const color = semanticColorForObject(object);
  context.save();
  context.strokeStyle = color;
  context.lineWidth = object.lineWidth || 3;
  context.setLineDash([7, 5]);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.stroke();
  context.setLineDash([]);
  const analysis = object.rowAlignment;
  if (!draft && analysis) {
    const left = Math.min(...object.points.map(point => point.x));
    const right = Math.max(...object.points.map(point => point.x));
    const hasBaseline = Number.isFinite(analysis.baselineY);
    const baselineStart = hasBaseline ? imageToScreen({ x: left, y: analysis.baselineY }) : null;
    const baselineEnd = hasBaseline ? imageToScreen({ x: right, y: analysis.baselineY }) : null;
    if (hasBaseline) {
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(baselineStart.x, baselineStart.y);
      context.lineTo(baselineEnd.x, baselineEnd.y);
      context.stroke();
    }
    for (const [index, candidate] of (analysis.candidates || []).entries()) {
      const first = imageToScreen({ x: candidate.x1, y: candidate.y });
      const second = imageToScreen({ x: candidate.x2, y: candidate.y });
      context.lineWidth = candidate.eligible ? 5 : 3;
      context.globalAlpha = candidate.eligible ? .9 : .5;
      context.setLineDash(candidate.confirmed ? [] : [4, 4]);
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;
      const center = midpoint(first, second);
      if (candidate.eligible && hasBaseline && candidate.deviationPx > .25) {
        context.setLineDash([3, 3]);
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(center.x, center.y);
        context.lineTo(center.x, baselineStart.y);
        context.stroke();
        context.setLineDash([]);
      }
      const currentDeviation = currentRowDeviation(candidate);
      const candidateLabel = candidate.eligible && hasBaseline
        ? `${candidate.letter}׳ · ${fmt(currentDeviation.value, 2)} ${currentDeviation.unitLabel}`
        : candidate.confirmed
          ? `מועמד ${index + 1} · לא לייחוס`
          : `מועמד ${index + 1} · דורש אישור`;
      label(center, candidateLabel, color);
    }
  }
  context.restore();
}

function slantCandidateIsLinkedToScan(candidate, scan) {
  if (!candidate || !scan || candidate.type !== 'angle') return false;
  const scanUid = scan.uid || String(scan.id);
  return candidate.sourceScanId === scan.id || candidate.sourceScanUid === scanUid;
}

function slantCandidateSpatialScore(previous, root, tip, bounds) {
  if (!previous?.points?.[0] || !previous?.points?.[1] || !root || !tip) return Infinity;
  const previousRoot = previous.points[0];
  const previousTip = previous.points[1];
  const center = midpoint(root, tip);
  const previousCenter = midpoint(previousRoot, previousTip);
  const centerDistance = distance(center, previousCenter);
  const endpointDistance = (distance(root, previousRoot) + distance(tip, previousTip)) / 2;
  const length = Math.max(1, distance(root, tip), distance(previousRoot, previousTip));
  const strokeScale = Math.max(
    2,
    +previous.candidateStrokeWidthPx || 0,
    Math.min(length * .12, 14)
  );
  const angle = MASTER_SYSTEM.signedVerticalAngle(root, tip);
  const previousAngle = MASTER_SYSTEM.signedVerticalAngle(previousRoot, previousTip);
  const angleDifference = Math.abs(angle - previousAngle);
  if (centerDistance > Math.max(12, length * .24, strokeScale * 3.5)) return Infinity;
  if (endpointDistance > Math.max(18, length * .34, strokeScale * 4.5)) return Infinity;
  if (angleDifference > 12) return Infinity;

  let overlapPenalty = .5;
  const previousBounds = previous.candidateBounds;
  if (bounds && previousBounds) {
    const overlapWidth = Math.max(0, Math.min(bounds.right, previousBounds.right) - Math.max(bounds.left, previousBounds.left));
    const overlapHeight = Math.max(0, Math.min(bounds.bottom, previousBounds.bottom) - Math.max(bounds.top, previousBounds.top));
    const intersection = overlapWidth * overlapHeight;
    const firstArea = Math.max(0, bounds.width) * Math.max(0, bounds.height);
    const secondArea = Math.max(0, previousBounds.width) * Math.max(0, previousBounds.height);
    const union = firstArea + secondArea - intersection;
    overlapPenalty = union > 0 ? 1 - intersection / union : .5;
  }
  return endpointDistance / strokeScale + centerDistance / strokeScale + angleDifference / 4 + overlapPenalty;
}

function matchPreviousSlantCandidate(previousCandidates, root, tip, bounds, usedPrevious = new Set()) {
  let best = null;
  for (const previous of previousCandidates || []) {
    const identity = previous.uid || String(previous.id);
    if (usedPrevious.has(identity)) continue;
    const score = slantCandidateSpatialScore(previous, root, tip, bounds);
    if (!Number.isFinite(score) || score > 6) continue;
    if (!best || score < best.score) best = { previous, score, identity };
  }
  return best;
}

function setSlantCandidateClassification(objectId, value) {
  const object = state.objects.find(item => item.id === objectId && item.type === 'angle');
  if (!object || MASTER_SYSTEM.metricIdFor(object) !== 'slants-parallels') return null;
  snapshot();
  if (['ד', 'ה', 'ת'].includes(value)) {
    object.letterRole = value;
    object.excludedFromComparison = false;
    object.slantClassification = { status: 'confirmed', letter: value, source: 'human' };
    object.display = { ...(object.display || {}), resultLabelVisible: true };
  } else if (value === 'exclude') {
    object.letterRole = null;
    object.excludedFromComparison = true;
    object.slantClassification = { status: 'excluded', letter: null, source: 'human' };
    object.display = { ...(object.display || {}), resultLabelVisible: false };
  } else {
    object.letterRole = null;
    object.excludedFromComparison = false;
    object.slantClassification = { status: 'pending', letter: null, source: 'human' };
    object.display = { ...(object.display || {}), resultLabelVisible: true };
  }
  markObjectModified(object);
  renderAll();
  statusText.textContent = object.excludedFromComparison
    ? 'המועמד נשמר באבחון אך לא ייכלל בהשוואת הנטיות'
    : object.letterRole
      ? `המועמד סווג כירך ${object.letterRole}׳ ונכלל בהשוואה`
      : 'המועמד הוחזר למצב ממתין ואינו נכלל עדיין בהשוואה';
  return object;
}

function analyzeSlantScan(object) {
  if (!state.image || object?.type !== 'slantScan' || object.points?.length !== 4) return null;
  professionalSuite.activeGroup = 'aman';
  professionalSuite.activeMetricId = 'slants-parallels';
  $('professionalSuitePanel').hidden = false;
  object.semanticMetricId = 'slants-parallels';
  object.category = 'slant';
  enforceSemanticStyle(object);

  const xs = object.points.map(point => point.x);
  const ys = object.points.map(point => point.y);
  const left = clamp(Math.floor(Math.min(...xs)), 0, state.image.width - 1);
  const top = clamp(Math.floor(Math.min(...ys)), 0, state.image.height - 1);
  const right = clamp(Math.ceil(Math.max(...xs)), left + 1, state.image.width);
  const bottom = clamp(Math.ceil(Math.max(...ys)), top + 1, state.image.height);
  const sourceWidth = right - left;
  const sourceHeight = bottom - top;
  const maximumRasterDimension = 1800;
  const maximumRasterArea = 2_000_000;
  const factor = Math.min(
    1,
    maximumRasterDimension / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(maximumRasterArea / Math.max(1, sourceWidth * sourceHeight))
  );
  const width = Math.max(2, Math.round(sourceWidth * factor));
  const height = Math.max(2, Math.round(sourceHeight * factor));
  const scanUid = object.uid || String(object.id);
  const previousCandidates = state.objects.filter(candidate => slantCandidateIsLinkedToScan(candidate, object));
  const previousByCandidateId = new Map(previousCandidates
    .filter(candidate => candidate.candidateId)
    .map(candidate => [candidate.candidateId, candidate]));
  const usedPreviousCandidates = new Set();
  object.slantAnalysis = {
    status: 'running',
    roi: { left, top, right, bottom, width: sourceWidth, height: sourceHeight },
    candidateCount: 0,
    candidateIds: [],
    diagnostics: null
  };

  const analyzer = globalThis.MEDIDAOT_SLANT_ANALYZER;
  if (!analyzer?.analyze) {
    object.slantAnalysis = {
      ...object.slantAnalysis,
      status: 'failed',
      diagnostics: { reason: 'analyzer-unavailable' }
    };
    markObjectModified(object);
    renderAll();
    statusText.textContent = 'מנתח הירכות אינו זמין; אפשר להשתמש במדידת הזווית הידנית';
    return object.slantAnalysis;
  }

  try {
    const raster = document.createElement('canvas');
    raster.width = width;
    raster.height = height;
    const context = raster.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('canvas-context-unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.save();
    context.scale(factor, factor);
    context.translate(-left, -top);
    context.drawImage(state.image, 0, 0);
    if (typeof drawSourceEditPatches === 'function') drawSourceEditPatches(context, { exportQuality: true });
    if (typeof drawLetterTemplateForExport === 'function') {
      for (const sourceEdit of state.objects.filter(candidate =>
        typeof isSourceRegionEdit === 'function' && isSourceRegionEdit(candidate)
      )) drawLetterTemplateForExport(context, sourceEdit);
    }
    context.restore();
    const imageData = context.getImageData(0, 0, width, height);
    const result = analyzer.analyze(imageData, { x: 0, y: 0, width, height });
    state.objects = state.objects.filter(candidate => !slantCandidateIsLinkedToScan(candidate, object));
    const candidateObjects = [];
    const toSourcePoint = point => ({
      x: left + point.x / factor,
      y: top + point.y / factor
    });
    const toSourceBounds = bounds => bounds ? {
      x: left + bounds.x / factor,
      y: top + bounds.y / factor,
      width: bounds.width / factor,
      height: bounds.height / factor,
      left: left + bounds.left / factor,
      top: top + bounds.top / factor,
      right: left + bounds.right / factor,
      bottom: top + bounds.bottom / factor
    } : null;
    for (const [index, candidate] of (result.candidates || []).entries()) {
      const sourceRoot = toSourcePoint(candidate.roiRoot);
      const sourceTip = toSourcePoint(candidate.roiTip);
      const sourceBounds = toSourceBounds(candidate.bounds?.roi);
      let previous = previousByCandidateId.get(candidate.id) || null;
      let previousIdentity = previous ? previous.uid || String(previous.id) : null;
      if (previousIdentity && usedPreviousCandidates.has(previousIdentity)) previous = null;
      if (!previous) {
        const spatialMatch = matchPreviousSlantCandidate(
          previousCandidates,
          sourceRoot,
          sourceTip,
          sourceBounds,
          usedPreviousCandidates
        );
        previous = spatialMatch?.previous || null;
        previousIdentity = spatialMatch?.identity || null;
      }
      if (previousIdentity) usedPreviousCandidates.add(previousIdentity);
      const letter = ['ד', 'ה', 'ת'].includes(previous?.letterRole) ? previous.letterRole : null;
      const excluded = previous?.excludedFromComparison === true;
      const status = excluded ? 'excluded' : letter ? 'confirmed' : 'pending';
      const angleObject = makeObject('angle', [
        sourceRoot,
        sourceTip
      ], {
        name: `ירך מזוהה ${index + 1}`,
        semanticMetricId: 'slants-parallels',
        category: 'slant',
        angleRef: 'vertical',
        auto: true,
        sourceScanId: object.id,
        sourceScanUid: scanUid,
        candidateId: candidate.id,
        candidateConfidence: candidate.confidence,
        candidateBounds: sourceBounds,
        candidateStrokeWidthPx: Number.isFinite(+candidate.strokeWidthPx) ? +candidate.strokeWidthPx / factor : null,
        candidateLengthPx: Number.isFinite(+candidate.lengthPx) ? +candidate.lengthPx / factor : null,
        candidateRoofSupport: candidate.roofSupport?.found ? {
          ...structuredCloneSafe(candidate.roofSupport),
          sourceY: top + candidate.roofSupport.roiY / factor,
          roiY: candidate.roofSupport.roiY / factor,
          horizontalRunPx: candidate.roofSupport.horizontalRunPx / factor,
          distanceFromRootPx: candidate.roofSupport.distanceFromRootPx / factor
        } : structuredCloneSafe(candidate.roofSupport || null),
        letterRole: letter,
        excludedFromComparison: excluded,
        slantClassification: {
          status,
          letter,
          source: previous?.slantClassification?.source || (previous ? 'restored' : 'pending-human')
        },
        display: {
          resultLabelVisible: excluded ? false : previous?.display?.resultLabelVisible !== false
        }
      });
      state.objects.push(angleObject);
      candidateObjects.push(angleObject);
    }
    object.slantAnalysis = {
      status: 'done',
      analyzerVersion: result.version || analyzer.version || null,
      roi: { left, top, right, bottom, width: sourceWidth, height: sourceHeight },
      raster: { width, height, scale: factor },
      candidateCount: candidateObjects.length,
      candidateIds: candidateObjects.map(candidate => candidate.candidateId),
      measurementUids: candidateObjects.map(candidate => candidate.uid),
      diagnostics: structuredCloneSafe(result.diagnostics || null),
      analyzedAt: new Date().toISOString()
    };
    markObjectModified(object);
    renderAll();
    statusText.textContent = candidateObjects.length
      ? `זוהו ${candidateObjects.length} מועמדי ירך; יש לסווג כל אחד כד׳, ה׳, ת׳ או „לא לכלול”`
      : 'לא זוהו ירכות בתחום שסומן; אפשר לסמן אזור אחר או להשתמש במדידה הידנית';
    return object.slantAnalysis;
  } catch (error) {
    object.slantAnalysis = {
      ...object.slantAnalysis,
      status: 'failed',
      diagnostics: { reason: error?.message || 'analysis-failed' },
      analyzedAt: new Date().toISOString()
    };
    markObjectModified(object);
    renderAll();
    statusText.textContent = 'סריקת הירכות לא הושלמה; אפשר לסמן אזור אחר או להשתמש במדידה הידנית';
    return object.slantAnalysis;
  }
}

function drawSlantScanObject(context, object, { selected, draft, points }) {
  if (!Array.isArray(points) || points.length !== 4) return;
  context.save();
  context.strokeStyle = semanticColorForObject(object, MASTER_SYSTEM.colorFor({ semanticMetricId: 'slants-parallels' }));
  context.lineWidth = Math.max(selected ? 3.5 : 2.5, object.lineWidth || 3);
  context.globalAlpha = draft ? .72 : selected ? .95 : .7;
  context.setLineDash(selected ? [10, 5] : [7, 6]);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.stroke();
  context.restore();
}

function compositionStageTransform() {
  const rect = $('compositionCanvas').getBoundingClientRect();
  const width = professionalSuite.composition.width || 1600;
  const height = professionalSuite.composition.height || 900;
  const scale = Math.min(rect.width / width, rect.height / height);
  return { rect, width, height, scale, x: (rect.width - width * scale) / 2, y: (rect.height - height * scale) / 2 };
}

function resizeCompositionCanvas() {
  const canvasElement = $('compositionCanvas');
  const rect = canvasElement.getBoundingClientRect();
  compositionDpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * compositionDpr));
  const height = Math.max(1, Math.round(rect.height * compositionDpr));
  if (canvasElement.width !== width || canvasElement.height !== height) {
    canvasElement.width = width;
    canvasElement.height = height;
  }
  drawComposition();
}

function drawCompositionBackground(context, width, height, background, forExport = false) {
  if (background.kind === 'transparent') {
    if (!forExport) {
      const size = 24;
      for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
        context.fillStyle = ((x / size + y / size) % 2) ? '#f1f5f9' : '#fff';
        context.fillRect(x, y, size, size);
      }
    }
    return;
  }
  if (background.kind === 'custom' && compositionBackgroundImage) {
    const imageWidth = compositionBackgroundImage.naturalWidth || compositionBackgroundImage.width || width;
    const imageHeight = compositionBackgroundImage.naturalHeight || compositionBackgroundImage.height || height;
    const scale = Math.max(width / Math.max(1, imageWidth), height / Math.max(1, imageHeight));
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = Math.max(0, (imageWidth - sourceWidth) / 2);
    const sourceY = Math.max(0, (imageHeight - sourceHeight) / 2);
    context.drawImage(
      compositionBackgroundImage,
      sourceX, sourceY, sourceWidth, sourceHeight,
      0, 0, width, height
    );
    return;
  }
  const base = background.kind === 'white' ? '#fff' : background.kind === 'parchment-warm' ? '#ead2a0' : '#f3e4bf';
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
  if (background.kind.startsWith('parchment')) {
    context.save();
    context.globalAlpha = .13;
    for (let y = 18; y < height; y += 34) {
      context.strokeStyle = y % 68 ? '#8b6b36' : '#fff7dc';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(width * .28, y + 3, width * .72, y - 3, width, y + 1);
      context.stroke();
    }
    context.restore();
  }
}

function drawCompositionItem(context, item, selected = false, options = {}) {
  const width = Math.max(12, item.width);
  const height = Math.max(12, item.height);
  const accent = item.metricColor || '#1d4ed8';
  context.save();
  context.translate(item.x + width / 2, item.y + height / 2);
  context.rotate((item.rotation || 0) * Math.PI / 180);
  drawLetterTemplateShape(context, item.letter, { x: -width / 2, y: -height / 2, width, height }, 1, { suppressWeightReadout: true });
  if (item.correctionSessionId && !options.cleanExport) {
    context.fillStyle = accent;
    context.fillRect(-width / 2, -height / 2 - 7, Math.min(width, 70), 5);
  }
  if (selected) {
    const handleRadius = clamp(11 / Math.max(.12, options.screenScale || 1), 11, 34);
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.setLineDash([8, 6]);
    context.strokeRect(-width / 2, -height / 2, width, height);
    context.setLineDash([]);
    context.fillStyle = '#fff';
    context.strokeStyle = accent;
    context.beginPath();
    context.arc(width / 2, height / 2, handleRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawComposition(options = {}) {
  const canvasElement = $('compositionCanvas');
  if (!canvasElement?.width) return;
  const context = canvasElement.getContext('2d');
  const transform = compositionStageTransform();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvasElement.width, canvasElement.height);
  context.setTransform(compositionDpr * transform.scale, 0, 0, compositionDpr * transform.scale, compositionDpr * transform.x, compositionDpr * transform.y);
  drawCompositionBackground(context, transform.width, transform.height, professionalSuite.composition.background);
  for (const item of professionalSuite.composition.items) {
    drawCompositionItem(
      context,
      item,
      !options.suppressSelection && item.id === professionalSuite.composition.selectedId,
      { screenScale: transform.scale }
    );
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  $('compositionEmptyHint').hidden = professionalSuite.composition.items.length > 0;
  const hasSelection = professionalSuite.composition.items.some(item => item.id === professionalSuite.composition.selectedId);
  $('compositionDuplicateBtn').disabled = !hasSelection;
  $('compositionDeleteBtn').disabled = !hasSelection;
  $('compositionExportBtn').disabled = professionalSuite.composition.items.length === 0;
  canvasElement.setAttribute('aria-label', hasSelection
    ? `קנבה נקייה, נבחרה אות ${professionalSuite.composition.selectedId}`
    : `קנבה נקייה, ${professionalSuite.composition.items.length} אותיות`);
}

function compositionPoint(event) {
  const transform = compositionStageTransform();
  return {
    x: (event.clientX - transform.rect.left - transform.x) / transform.scale,
    y: (event.clientY - transform.rect.top - transform.y) / transform.scale
  };
}

function compositionHit(point) {
  const transform = compositionStageTransform();
  const resizeHitRadius = clamp(22 / Math.max(.12, transform.scale), 24, 72);
  for (const item of [...professionalSuite.composition.items].reverse()) {
    const resize = { x: item.x + item.width, y: item.y + item.height };
    if (distance(point, resize) <= resizeHitRadius) return { item, handle: 'resize' };
    if (point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height) return { item, handle: 'move' };
  }
  return null;
}

function addLetterToComposition(source, options = {}) {
  if (!isLetterTemplate(source)) return null;
  if (!options.skipHistory) recordCompositionHistory();
  const rect = letterObjectRect(source);
  const stageWidth = professionalSuite.composition.width || 1600;
  const stageHeight = professionalSuite.composition.height || 900;
  const height = clamp(options.height || 290, 80, 680);
  const width = clamp(height * (rect.width / Math.max(1, rect.height)), 45, 640);
  const index = professionalSuite.composition.items.length;
  const sourceFrameId = source.sourceSelection?.frameId ?? source.sourceFrameId ?? null;
  const sourceFrame = sourceFrameId == null
    ? null
    : state.objects.find(object => object.id === sourceFrameId);
  const item = {
    id: professionalSuite.composition.nextId++,
    uid: typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `composition-${Date.now()}-${index}`,
    x: clamp(stageWidth - 180 - index * 120 - width, 40, stageWidth - width - 40),
    y: clamp(stageHeight / 2 - height / 2 + (index % 2) * 18, 100, stageHeight - height - 40),
    width,
    height,
    rotation: 0,
    letter: structuredCloneSafe(source),
    sourceRef: {
      objectUid: source.uid || String(source.id),
      sourceFrameUid: sourceFrame?.uid || source.sourceSelection?.frameUid || null
    },
    correctionSessionId: options.correctionSessionId || null,
    semanticMetricId: options.semanticMetricId || null,
    metricColor: options.semanticMetricId
      ? MASTER_SYSTEM.colorFor({ semanticMetricId: options.semanticMetricId })
      : null,
    createdAt: new Date().toISOString()
  };
  item.letter.points = letterRectPoints(0, 0, rect.width, rect.height);
  if (item.letter.sourceSelection) {
    item.letter.sourceSelection = {
      ...item.letter.sourceSelection,
      frameId: null,
      frameUid: item.sourceRef.sourceFrameUid
    };
  }
  item.letter.sourceFrameId = null;
  item.letter.editTarget = 'overlay-copy';
  item.letter.role = 'reference-overlay';
  for (const key of ['sourceOriginalVector', 'sourceOriginalPoints', 'sourceBackgroundColor', 'sourceInkColor', 'sourceEdgeCoverPx']) {
    delete item.letter[key];
  }
  item.letter.letterGridVisible = false;
  item.letter.letterEditAnchors = false;
  item.letter.vectorDetailLevel = 'structural';
  item.letter.letterOpacity = 1;
  item.letter.color = '#111827';
  professionalSuite.composition.items.push(item);
  professionalSuite.composition.selectedId = item.id;
  switchWorkspaceMode('composition');
  drawComposition();
  return item;
}

function transferSelectedLetterToComposition() {
  const source = selectedLetterTemplate();
  if (!source) {
    statusText.textContent = 'יש לבחור תחילה אות וקטורית';
    return null;
  }
  const item = addLetterToComposition(source);
  statusText.textContent = item ? 'האות הועברה כעותק נקי לקנבה; אות המקור נשמרה ללא שינוי' : 'לא ניתן להעביר את האות';
  return item;
}

function correctionHandleSelection(source, measurement) {
  const explicit = [...new Set(source.correctionHandleIds || (
    state.letterVectorSelection?.id === source.id ? state.letterVectorSelection.handleIds || [] : []
  ))];
  if (explicit.length) return { ids: explicit, method: 'manual-selection' };
  const groups = organLevelVectorHandles(allLetterVectorHandles(source));
  if (!groups.length || !measurement?.points?.length) return { ids: [], method: null };
  const target = measurement.points.reduce((sum, point) => ({
    x: sum.x + point.x / measurement.points.length,
    y: sum.y + point.y / measurement.points.length
  }), { x: 0, y: 0 });
  const rect = letterVisualRect(source) || letterObjectRect(source);
  const margin = Math.max(rect.width, rect.height) * .2;
  if (target.x < rect.left - margin || target.x > rect.right + margin || target.y < rect.top - margin || target.y > rect.bottom + margin) {
    return { ids: [], method: null };
  }
  const nearest = groups.reduce((best, group) => (
    distance(group.point, target) < distance(best.point, target) ? group : best
  ), groups[0]);
  return {
    ids: [...new Set(nearest.groupIds?.length ? nearest.groupIds : [nearest.id])],
    method: 'nearest-organ-group'
  };
}

function selectedFeatureAngle(handles) {
  if (!Array.isArray(handles) || handles.length < 2) return null;
  const mean = handles.reduce((sum, handle) => ({
    x: sum.x + handle.point.x / handles.length,
    y: sum.y + handle.point.y / handles.length
  }), { x: 0, y: 0 });
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const handle of handles) {
    const dx = handle.point.x - mean.x;
    const dy = handle.point.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  const trace = xx + yy;
  if (trace < 1e-6) return null;
  const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
  const majorVariance = (trace + discriminant) / 2;
  const minorVariance = (trace - discriminant) / 2;
  if (majorVariance <= 0 || minorVariance / majorVariance > .6) return null;
  const theta = .5 * Math.atan2(2 * xy, xx - yy);
  let vx = Math.cos(theta);
  let vy = Math.sin(theta);
  if (vy < 0) { vx *= -1; vy *= -1; }
  return MASTER_SYSTEM.signedVerticalAngle(
    { x: mean.x - vx * 100, y: mean.y - vy * 100 },
    { x: mean.x + vx * 100, y: mean.y + vy * 100 }
  );
}

function createCorrectionPreview(measurementId, sourceId, targetAngle) {
  const measurement = state.objects.find(object => object.id === measurementId && object.type === 'angle');
  const source = state.objects.find(object => object.id === sourceId && isLetterTemplate(object));
  if (!measurement || !source || !Number.isFinite(targetAngle)) return null;
  const selection = correctionHandleSelection(source, measurement);
  const handleIds = selection.ids;
  if (!handleIds.length) {
    alert('יש לבחור באות קבוצת עוגנים המייצגת את האיבר לתיקון, באמצעות דרגת „איברים” או סימון חופשי.');
    return null;
  }
  const engine = globalThis.MEDIDAOT_VECTOR_ENGINE;
  const clone = structuredCloneSafe(source);
  engine.materializeObjectVector(clone, { asset: letterAsset(source) });
  const handles = engine.enumerateHandles(clone, { asset: letterAsset(source), coordinateSpace: 'image' })
    .filter(handle => handle.kind === 'anchor' && handleIds.includes(handle.id));
  if (handles.length < 2) {
    alert('נדרשות לפחות שתי נקודות עוגן של האיבר. יש לבחור קבוצת „איברים” או להקיף את האיבר בסימון חופשי.');
    return null;
  }
  const selectedIdSet = new Set(handleIds);
  const semanticStem = typeof semanticFeatureHandles === 'function'
    ? semanticFeatureHandles(source, allLetterVectorHandles(source))
      .filter(feature => feature.semanticType === 'stem-axis' && feature.rootImage && feature.tipImage)
      .map(feature => ({
        feature,
        overlap: (feature.groupIds || [feature.id]).filter(id => selectedIdSet.has(id)).length
      }))
      .filter(entry => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)[0]?.feature || null
    : null;
  const topHandle = handles.reduce((best, handle) => handle.point.y < best.point.y ? handle : best, handles[0]);
  const bottomHandle = handles.reduce((best, handle) => handle.point.y > best.point.y ? handle : best, handles[0]);
  const featureRoot = semanticStem?.rootImage || { ...topHandle.point };
  const featureTip = semanticStem?.tipImage || { ...bottomHandle.point };
  const measurementSigned = MASTER_SYSTEM.signedVerticalAngle(measurement.points[0], measurement.points[1]);
  const currentSigned = Number.isFinite(+semanticStem?.axisAngleDeg)
    ? +semanticStem.axisAngleDeg
    : semanticStem
      ? MASTER_SYSTEM.signedVerticalAngle(featureRoot, featureTip)
      : selectedFeatureAngle(handles);
  if (!Number.isFinite(currentSigned) || Math.abs(currentSigned) > 55) {
    alert('לא ניתן לחשב ירך מוארכת מן העוגנים שנבחרו. יש לבחור קבוצה צרה וארוכה יותר לאורך האיבר.');
    return null;
  }
  const signedTarget = clamp(targetAngle, -35, 35);
  const pivot = { ...featureRoot };
  let tiltResult = null;
  if (typeof engine.tiltObjectHandles === 'function') {
    tiltResult = engine.tiltObjectHandles(clone, handleIds, signedTarget, {
      asset: letterAsset(source),
      rootImage: featureRoot,
      tipImage: featureTip,
      pivotImage: pivot,
      currentAngleDeg: currentSigned,
      moveAdjacentControls: true
    });
  } else {
    const moves = handles.map(handle => ({
      id: handle.id,
      y: handle.point.y,
      target: MASTER_SYSTEM.shearPointToAngle(handle.point, pivot.y, currentSigned, signedTarget)
    })).sort((a, b) => a.y - b.y);
    for (const move of moves) {
      engine.moveObjectHandle(clone, move.id, move.target, { asset: letterAsset(source), moveAdjacentControls: true });
    }
  }
  const session = {
    id: typeof crypto?.randomUUID === 'function' ? `correction-${crypto.randomUUID()}` : `correction-${Date.now()}`,
    sourceMeasurementUid: measurement.uid || String(measurement.id),
    sourceVectorUid: source.uid || String(source.id),
    featureHandleIds: handleIds,
    featureSelectionMethod: selection.method,
    semanticMetricId: measurement.semanticMetricId || 'slants-parallels',
    metricColor: semanticColorForObject(measurement, MASTER_SYSTEM.colorFor({ semanticMetricId: 'slants-parallels' })),
    operation: {
      type: tiltResult ? 'vector-axis-tilt-preview' : 'vertical-angle-shear-preview',
      measurementAngleDeg: measurementSigned,
      currentFeatureAngleDeg: currentSigned,
      targetAngleDeg: signedTarget,
      pivot,
      pivotY: pivot.y,
      engineRevision: tiltResult?.revision ?? null
    },
    mode: 'manual',
    constraints: {
      preserveSource: true,
      preserveWeight: true,
      coupledKastelRuleStatus: 'needs-definition'
    },
    createdAt: new Date().toISOString()
  };
  recordCompositionHistory();
  professionalSuite.correctionSessions.push(session);
  const item = addLetterToComposition(clone, {
    correctionSessionId: session.id,
    semanticMetricId: session.semanticMetricId,
    skipHistory: true
  });
  session.previewCompositionUid = item?.uid || null;
  statusText.textContent = 'נוצרה הדמיית תיקון לא־הרסנית בקנבה; המקור והמדידה נשמרו';
  return session;
}

function refreshCompositionSourceAvailability() {
  const sourceUids = new Set(state.objects.map(object => object.uid || String(object.id)));
  for (const item of professionalSuite.composition.items || []) {
    if (!item.sourceRef) continue;
    item.sourceRef.sourceAvailable = item.sourceRef.objectUid == null
      ? null
      : sourceUids.has(item.sourceRef.objectUid);
    item.sourceRef.frameAvailable = item.sourceRef.sourceFrameUid == null
      ? null
      : sourceUids.has(item.sourceRef.sourceFrameUid);
  }
  for (const session of professionalSuite.correctionSessions || []) {
    session.sourceMeasurementAvailable = sourceUids.has(session.sourceMeasurementUid);
    session.sourceVectorAvailable = sourceUids.has(session.sourceVectorUid);
    session.linkStatus = session.sourceMeasurementAvailable && session.sourceVectorAvailable
      ? 'linked'
      : 'source-missing-copy-preserved';
  }
  return sourceUids;
}

function duplicateCompositionItem() {
  const selected = professionalSuite.composition.items.find(item => item.id === professionalSuite.composition.selectedId);
  if (!selected) {
    statusText.textContent = 'בחר אות בקנבה לפני שכפול';
    return false;
  }
  recordCompositionHistory();
  const copy = structuredCloneSafe(selected);
  copy.id = professionalSuite.composition.nextId++;
  copy.uid = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `composition-${Date.now()}`;
  copy.x = clamp(copy.x + 34, 0, Math.max(0, professionalSuite.composition.width - copy.width));
  copy.y = clamp(copy.y + 34, 0, Math.max(0, professionalSuite.composition.height - copy.height));
  if (copy.correctionSessionId) {
    const sourceSession = professionalSuite.correctionSessions.find(session => session.id === copy.correctionSessionId);
    if (sourceSession) {
      const duplicatedSession = structuredCloneSafe(sourceSession);
      duplicatedSession.id = typeof crypto?.randomUUID === 'function'
        ? `correction-${crypto.randomUUID()}`
        : `correction-${Date.now()}-${copy.id}`;
      duplicatedSession.duplicatedFromSessionId = sourceSession.id;
      duplicatedSession.previewCompositionUid = copy.uid;
      duplicatedSession.createdAt = new Date().toISOString();
      copy.correctionSessionId = duplicatedSession.id;
      professionalSuite.correctionSessions.push(duplicatedSession);
    } else {
      copy.correctionSessionId = null;
    }
  }
  professionalSuite.composition.items.push(copy);
  professionalSuite.composition.selectedId = copy.id;
  drawComposition();
  statusText.textContent = 'האות שוכפלה בקנבה';
  return true;
}

function deleteCompositionItem() {
  const id = professionalSuite.composition.selectedId;
  if (!id) {
    statusText.textContent = 'בחר אות בקנבה לפני מחיקה';
    return false;
  }
  recordCompositionHistory();
  const deleted = professionalSuite.composition.items.find(item => item.id === id);
  professionalSuite.composition.items = professionalSuite.composition.items.filter(item => item.id !== id);
  if (deleted?.correctionSessionId) {
    const replacement = professionalSuite.composition.items
      .find(item => item.correctionSessionId === deleted.correctionSessionId);
    if (replacement) {
      const session = professionalSuite.correctionSessions.find(item => item.id === deleted.correctionSessionId);
      if (session) session.previewCompositionUid = replacement.uid;
    } else {
      professionalSuite.correctionSessions = professionalSuite.correctionSessions
        .filter(session => session.id !== deleted.correctionSessionId);
    }
  }
  professionalSuite.composition.selectedId = professionalSuite.composition.items.at(-1)?.id || null;
  drawComposition();
  statusText.textContent = 'האות נמחקה מן הקנבה בלבד';
  return true;
}

function isCompositionMode() {
  return currentWorkspaceMode === 'composition';
}

function handleCompositionKeyboardShortcut(event) {
  if (!isCompositionMode() || isEditableTarget(event.target)) return false;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'z') {
    event.preventDefault();
    event.shiftKey ? redoComposition() : undoComposition();
    return true;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteCompositionItem();
    return true;
  }
  if (event.key === 'Escape') {
    professionalSuite.composition.selectedId = null;
    drawComposition();
    return true;
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    const item = professionalSuite.composition.items.find(candidate => candidate.id === professionalSuite.composition.selectedId);
    if (!item) return false;
    event.preventDefault();
    recordCompositionHistory();
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') item.x -= step;
    if (event.key === 'ArrowRight') item.x += step;
    if (event.key === 'ArrowUp') item.y -= step;
    if (event.key === 'ArrowDown') item.y += step;
    item.x = clamp(item.x, 0, Math.max(0, professionalSuite.composition.width - item.width));
    item.y = clamp(item.y, 0, Math.max(0, professionalSuite.composition.height - item.height));
    drawComposition();
    return true;
  }
  return false;
}

function exportComposition() {
  const width = professionalSuite.composition.width || 1600;
  const height = professionalSuite.composition.height || 900;
  const output = document.createElement('canvas');
  output.width = width * 2;
  output.height = height * 2;
  const context = output.getContext('2d');
  context.scale(2, 2);
  drawCompositionBackground(context, width, height, professionalSuite.composition.background, true);
  for (const item of professionalSuite.composition.items) drawCompositionItem(context, item, false, { cleanExport: true });
  output.toBlob(blob => downloadBlob(blob, 'מדידאות-קנבה-נקייה.png'));
}

function loadCompositionBackground(source) {
  compositionBackgroundImage = null;
  if (!source) { drawComposition(); return; }
  const image = new Image();
  image.onload = () => { compositionBackgroundImage = image; drawComposition(); };
  image.src = source;
}

function initializeCompositionInteractions() {
  const canvasElement = $('compositionCanvas');
  canvasElement.addEventListener('pointerdown', event => {
    if (compositionPointer && compositionPointer.pointerId !== event.pointerId) return;
    if (event.isPrimary === false) return;
    event.preventDefault();
    const point = compositionPoint(event);
    const hit = compositionHit(point);
    professionalSuite.composition.selectedId = hit?.item.id || null;
    if (hit) {
      compositionPointer = {
        pointerId: event.pointerId,
        type: hit.handle,
        start: point,
        itemId: hit.item.id,
        original: { x: hit.item.x, y: hit.item.y, width: hit.item.width, height: hit.item.height },
        before: captureCompositionState(),
        moved: false
      };
      try { canvasElement.setPointerCapture(event.pointerId); } catch {}
    }
    drawComposition();
  }, { passive: false });
  canvasElement.addEventListener('pointermove', event => {
    if (!compositionPointer || compositionPointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    const item = professionalSuite.composition.items.find(candidate => candidate.id === compositionPointer.itemId);
    if (!item) return;
    const point = compositionPoint(event);
    const dx = point.x - compositionPointer.start.x;
    const dy = point.y - compositionPointer.start.y;
    if (compositionPointer.type === 'move') {
      item.x = clamp(compositionPointer.original.x + dx, 0, Math.max(0, professionalSuite.composition.width - item.width));
      item.y = clamp(compositionPointer.original.y + dy, 0, Math.max(0, professionalSuite.composition.height - item.height));
    } else {
      const ratio = compositionPointer.original.width / Math.max(1, compositionPointer.original.height);
      const relativeX = dx / Math.max(1, compositionPointer.original.width);
      const relativeY = dy / Math.max(1, compositionPointer.original.height);
      const relativeChange = Math.abs(relativeX) > Math.abs(relativeY) ? relativeX : relativeY;
      const maximumHeight = Math.max(40, Math.min(
        professionalSuite.composition.height - item.y,
        (professionalSuite.composition.width - item.x) / Math.max(.01, ratio)
      ));
      const height = clamp(compositionPointer.original.height * (1 + relativeChange), 40, maximumHeight);
      item.height = height;
      item.width = Math.max(24, height * ratio);
    }
    compositionPointer.moved = compositionPointer.moved || Math.hypot(dx, dy) > 2;
    drawComposition();
  }, { passive: false });
  const end = event => {
    if (compositionPointer?.pointerId === event.pointerId) {
      if (compositionPointer.moved) recordCompositionHistory(compositionPointer.before);
      compositionPointer = null;
    }
    try { canvasElement.releasePointerCapture(event.pointerId); } catch {}
  };
  canvasElement.addEventListener('pointerup', end, { passive: false });
  canvasElement.addEventListener('pointercancel', end, { passive: false });
}

function refreshProfessionalSuiteAfterProjectLoad(options = {}) {
  const merged = mergeProfessionalSuite(state.professionalSuite || {});
  Object.assign(professionalSuite, merged);
  state.professionalSuite = professionalSuite;
  if (options.resetHistory !== false) {
    compositionHistory = [];
    compositionFuture = [];
    compositionPointer = null;
  }
  $('compositionBackgroundSelect').value = professionalSuite.composition.background.kind;
  loadCompositionBackground(professionalSuite.composition.background.imageSrc);
  renderProfessionalPanel();
  drawComposition();
  if (options.keepMode !== true) switchWorkspaceMode('source');
}

$('professionalMenuBtn').addEventListener('click', () => {
  $('professionalSuitePanel').hidden = false;
  renderProfessionalPanel();
  $('professionalSuitePanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
$('closeProfessionalSuiteBtn').addEventListener('click', () => { $('professionalSuitePanel').hidden = true; });
document.querySelectorAll('[data-master-group]').forEach(button => button.addEventListener('click', () => {
  professionalSuite.activeGroup = button.dataset.masterGroup;
  professionalSuite.activeMetricId = null;
  renderProfessionalPanel();
}));
document.querySelectorAll('[data-workspace-mode]').forEach(button => button.addEventListener('click', () => switchWorkspaceMode(button.dataset.workspaceMode)));
for (const id of ['professionalMenuBtn', 'letterBoardBtn', 'autoNibToolBtn', 'gapsPanelBtn', 'thirdsToggleBtn', 'detectStructureBtn']) {
  $(id)?.addEventListener('click', () => {
    if (isCompositionMode()) switchWorkspaceMode('source');
  }, { capture: true });
}
$('closeMetricInfoBtn').addEventListener('click', () => $('metricInfoDialog').close());
$('saveMetricInfoBtn').addEventListener('click', saveMetricInfo);
$('resetMetricInfoBtn').addEventListener('click', resetMetricInfo);
$('transferLetterBtn').addEventListener('click', transferSelectedLetterToComposition);
$('compositionDuplicateBtn').addEventListener('click', duplicateCompositionItem);
$('compositionDeleteBtn').addEventListener('click', deleteCompositionItem);
$('compositionExportBtn').addEventListener('click', exportComposition);
$('compositionBackgroundButton')?.addEventListener('click', () => $('compositionBackgroundInput').click());
$('compositionBackgroundSelect').addEventListener('change', event => {
  recordCompositionHistory();
  professionalSuite.composition.background.kind = event.target.value;
  loadCompositionBackground(event.target.value === 'custom'
    ? professionalSuite.composition.background.imageSrc
    : null);
  drawComposition();
});
$('compositionBackgroundInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    recordCompositionHistory();
    professionalSuite.composition.background = { kind: 'custom', color: '#f3e4bf', imageSrc: reader.result };
    $('compositionBackgroundSelect').value = 'custom';
    loadCompositionBackground(reader.result);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
});

initializeCompositionInteractions();
new ResizeObserver(resizeCompositionCanvas).observe($('compositionCanvas'));
professionalSuite.composition.width = professionalSuite.composition.width || 1600;
professionalSuite.composition.height = professionalSuite.composition.height || 900;
$('compositionBackgroundSelect').value = professionalSuite.composition.background.kind;
loadCompositionBackground(professionalSuite.composition.background.imageSrc);
renderProfessionalPanel();
resizeCompositionCanvas();

globalThis.MEDIDAOT_PROFESSIONAL_TOOLS = Object.freeze({
  renderProfessionalPanel,
  activateProfessionalMetric,
  openMetricInfo,
  analyzeRowAlignment,
  resolveRowAlignmentCandidates,
  setRowCandidateClassification,
  analyzeSlantScan,
  setSlantCandidateClassification,
  drawSlantScanObject,
  measureRoofSeatFromActiveKastel,
  transferSelectedLetterToComposition,
  createCorrectionPreview,
  correctionHandleSelection,
  refreshCompositionSourceAvailability,
  refreshProfessionalSuiteAfterProjectLoad,
  drawComposition,
  switchWorkspaceMode,
  isCompositionMode,
  handleCompositionKeyboardShortcut,
  undoComposition,
  redoComposition,
  deleteCompositionItem
});
