'use strict';
function commitDraft(message) {
  if (!state.draft) return;
  snapshot();
  const object = state.draft;
  if (object.type === 'area') ensureAreaSegments(object);
  if (object.type === 'gap' && gapMeasurementSource(object) === 'manual') {
    captureGapNormalization(object, state.formula.nibPx, 'manual-measurement');
  }
  state.objects.push(object);
  if (object.type === 'nib' && !object.regionId) replaceCalibrationOverlays(object);
  state.draft = null;
  state.draftHistory = [];
  state.selectedPoint = null;
  state.selectedSegment = null;
  state.letterVectorSelection = null;
  syncFormulaFromObject(object);
  if (object.type === 'gap' && object.formulaKey === 'between-lines') {
    refreshBetweenLinesSummary();
  }
  statusText.textContent = message;
  selectObject(object.id);
  return object;
}

function replaceCalibrationOverlays(activeObject, cancelPending = true) {
  if (!activeObject || !['nib', 'nibRegion'].includes(activeObject.type)) return;
  if (cancelPending) cancelCalibrationAnalysis();
  const removedIds = new Set(state.objects
    .filter(object => object.id !== activeObject.id && ['nib', 'nibRegion'].includes(object.type))
    .map(object => object.id));
  state.objects = state.objects.filter(object =>
    object.id === activeObject.id || !['nib', 'nibRegion'].includes(object.type)
  );
  if (state.formula.calibration) {
    if (removedIds.has(state.formula.calibration.objectId)) state.formula.calibration.objectId = null;
    if (removedIds.has(state.formula.calibration.regionObjectId)) state.formula.calibration.regionObjectId = null;
  }
  state.activeCalibrationRegionId = activeObject.type === 'nibRegion' ? activeObject.id : null;
}

function commitDragHistory(drag) {
  if (!drag?.before || drag.historyCommitted) return;
  state.history.push(drag.before);
  if (state.history.length > 80) state.history.shift();
  state.future = [];
  drag.historyCommitted = true;
}

function dragPassedThreshold(drag, screenPoint, threshold = 3) {
  if (drag?.moved) return true;
  if (!drag?.originScreen || distance(drag.originScreen, screenPoint) >= threshold) {
    drag.moved = true;
    return true;
  }
  return false;
}

function markObjectModified(object) {
  if (!object) return;
  object.provenance = object.provenance || { origin: object.auto ? 'assisted' : 'human', createdAt: new Date().toISOString() };
  if (['automatic', 'assisted'].includes(object.provenance.origin)) {
    object.provenance.originalOrigin = object.provenance.origin;
    object.provenance.origin = 'human-corrected';
  }
  object.provenance.modifiedAt = new Date().toISOString();
}

function refreshBetweenLinesSummary() {
  const gaps = state.objects
    .filter(object => object.type === 'gap' && object.formulaKey === 'between-lines');
  const proposals = gaps
    .map(object => ({
      measurementId: object.uid || String(object.id),
      valuePx: measurementLengthPx(object),
      valueNib: measurementRatioNib(object),
      source: gapMeasurementSource(object),
      points: structuredCloneSafe(object.points),
      manualCorrected: object.gapDetection?.manualCorrected === true,
      confidence: object.gapDetection?.confidence ?? object.confidence ?? null,
      normalization: structuredCloneSafe(object.normalization || null)
    }))
    .filter(proposal => Number.isFinite(proposal.valuePx) && proposal.valuePx > 0);

  function summarize(source) {
    const matching = proposals.filter(proposal => proposal.source === source);
    if (!matching.length) return null;
    const medianOf = values => {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
      if (!sorted.length) return null;
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    return {
      source,
      count: matching.length,
      medianPx: medianOf(matching.map(proposal => proposal.valuePx)),
      medianNib: medianOf(matching.map(proposal => proposal.valueNib))
    };
  }

  const manualSummary = summarize('manual');
  const automaticSummary = summarize('automatic');
  const activeSummary = manualSummary || automaticSummary;
  if (!activeSummary) {
    state.formula.betweenLinesPx = null;
    state.formula.analysis = {
      ...(state.formula.analysis || {}),
      interlineProposals: [],
      interlineSummaries: { manual: null, automatic: null, activeSource: null },
      manualInterlineMedianPx: null,
      manualInterlineMedianNib: null,
      autoInterlineMedianPx: null,
      autoInterlineMedianNib: null,
      betweenLinesMedianPx: null,
      betweenLinesMedianNib: null
    };
    return null;
  }
  state.formula.betweenLinesPx = activeSummary.medianPx;
  state.formula.analysis = {
    ...(state.formula.analysis || {}),
    interlineProposals: proposals,
    interlineSummaries: {
      manual: manualSummary,
      automatic: automaticSummary,
      activeSource: activeSummary.source
    },
    manualInterlineMedianPx: manualSummary?.medianPx ?? null,
    manualInterlineMedianNib: manualSummary?.medianNib ?? null,
    autoInterlineMedianPx: automaticSummary?.medianPx ?? null,
    autoInterlineMedianNib: automaticSummary?.medianNib ?? null,
    betweenLinesMedianPx: activeSummary.medianPx,
    betweenLinesMedianNib: activeSummary.medianNib
  };
  return activeSummary.medianPx;
}

function clearDraftState() {
  state.draft = null;
  state.draftHistory = [];
  state.selectedPoint = null;
  state.selectedSegment = null;
  state.letterVectorSelection = null;
  state.dragging = null;
}

function releaseActiveMeasurementPointer() {
  const pointerId = state.activePointerId;
  state.activePointerId = null;
  state.interactionBefore = null;
  state.dragging = null;
  if (pointerId !== null) {
    try { canvas.releasePointerCapture(pointerId); } catch {}
  }
}

function finishRectDraft(objectType, rollbackSnapshot) {
  if (!state.draft || state.draft.type !== objectType) return null;
  state.draft.points = normalizeQuadPoints(state.draft.points);
  const width = distance(state.draft.points[0], state.draft.points[1]);
  const height = distance(state.draft.points[0], state.draft.points[3]);
  if (width * state.view.scale < 12 || height * state.view.scale < 12) {
    clearDraftState();
    statusText.textContent = objectType === 'kastel' ? 'הקעסטעל קטן מדי ובוטל' : 'אזור הכיול קטן מדי ובוטל';
    renderAll();
    return null;
  }
  state.draft.closed = true;
  const object = commitDraft(objectType === 'kastel'
    ? 'הקעסטעל נוצר. כעת אפשר להחיל חוק שלישים או לזהות גג, חלל ומושב'
    : 'אזור הכיול נוצר ומנותח כעת');
  if (objectType === 'kastel') {
    initializeKastelGuides(object);
    setTool('pan');
    statusText.textContent = 'הקעסטעל נוצר ונבחר. גרור כל פינה כדי להרחיב או לעצב אותו';
  }
  if (objectType === 'nibRegion') analyzeCalibrationRegion(object, rollbackSnapshot);
  return object;
}

function orientationValue(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsProperlyIntersect(a, b, c, d) {
  const first = orientationValue(a, b, c);
  const second = orientationValue(a, b, d);
  const third = orientationValue(c, d, a);
  const fourth = orientationValue(c, d, b);
  return first * second < 0 && third * fourth < 0;
}

function validEditableKastel(points) {
  return Array.isArray(points) && points.length === 4 &&
    polygonArea(points) * state.view.scale * state.view.scale >= 144 &&
    !segmentsProperlyIntersect(points[0], points[1], points[2], points[3]) &&
    !segmentsProperlyIntersect(points[1], points[2], points[3], points[0]);
}

function handleTouchPointerMove(event) {
  event.preventDefault();
  if (!state.pointers.has(event.pointerId)) return;
  const screenPoint = getPos(event);
  state.pointers.set(event.pointerId, screenPoint);
  if (state.pointers.size < 2) {
    const drag = state.dragging;
    if (state.touchEditPointerId !== event.pointerId || drag?.type !== 'touchLetter') return;
    if (!dragPassedThreshold(drag, screenPoint, 4)) return;
    const imagePoint = screenToImage(screenPoint);
    const object = state.objects.find(item => item.id === drag.id && isLetterTemplate(item));
    if (!object) return;
    const dx = imagePoint.x - drag.start.x;
    const dy = imagePoint.y - drag.start.y;
    object.points = drag.original.map(point => ({ x: point.x + dx, y: point.y + dy }));
    drag.moved = true;
    draw();
    renderResults();
    return;
  }
  const ids = state.pinchStart?.pointerIds || [];
  if (ids.length !== 2 || !ids.every(id => state.pointers.has(id))) {
    rebaseTouchGesture();
    return;
  }
  const first = state.pointers.get(ids[0]);
  const second = state.pointers.get(ids[1]);
  const currentMidpoint = midpoint(first, second);
  const ratio = distance(first, second) / Math.max(1, state.pinchStart.distance);
  const newScale = clamp(state.pinchStart.scale * ratio, 0.03, 12);
  state.view.scale = newScale;
  state.view.x = currentMidpoint.x - state.pinchStart.anchorImage.x * newScale;
  state.view.y = currentMidpoint.y - state.pinchStart.anchorImage.y * newScale;
  zoomText.textContent = `${Math.round(newScale * 100)}%`;
  draw();
}

const MEDIDAOT_INTERFACE_SELECTOR = '.topbar,.toolbar,.properties,.letter-drawer,dialog,.floating-help,.standalone-hint';

function pointerIsOverInterface(event) {
  if (typeof document.elementFromPoint !== 'function') return false;
  const element = document.elementFromPoint(event.clientX, event.clientY);
  return !!element && element !== canvas && !!element.closest?.(MEDIDAOT_INTERFACE_SELECTOR);
}

function pointerMove(event) {
  if (event.pointerType === 'pen' &&
      state.activePointerId === event.pointerId &&
      pointerIsOverInterface(event)) {
    pointerCancel(event);
    statusText.textContent = 'הפעולה על משטח העבודה בוטלה; התפריטים פעילים באצבע';
    return;
  }
  event.preventDefault();
  if (event.pointerType === 'touch') {
    handleTouchPointerMove(event);
    return;
  }
  if (!isMeasurementPointer(event) || state.activePointerId !== event.pointerId) return;
  if (!state.dragging) return;
  if (state.dragging.pointerId !== event.pointerId) return;
  const screenPoint = getPos(event);
  const imagePoint = screenToImage(screenPoint);
  const drag = state.dragging;

  if (drag.type === 'pan') {
    state.view.x = drag.view.x + (screenPoint.x - drag.start.x);
    state.view.y = drag.view.y + (screenPoint.y - drag.start.y);
  } else if (drag.type === 'drawRect') {
    const a = drag.start;
    state.draft.points = [a, { x: imagePoint.x, y: a.y }, imagePoint, { x: a.x, y: imagePoint.y }];
  } else if (drag.type === 'vectorizeLasso') {
    if (appendLassoPoint(state.vectorizeLasso, imagePoint)) drag.moved = true;
  } else if (drag.type === 'letterAnchorLasso') {
    if (appendLassoPoint(state.letterVectorLasso, imagePoint)) drag.moved = true;
  } else if (drag.type === 'draftHandle' && state.draft) {
    if (!dragPassedThreshold(drag, screenPoint, drag.closeOnTap ? 8 : 3)) return;
    if (drag.beforeDraft && !drag.historyCommitted) {
      state.draftHistory.push(drag.beforeDraft);
      if (state.draftHistory.length > 80) state.draftHistory.shift();
      drag.historyCommitted = true;
    }
    if (state.draft.type === 'area') moveAreaAnchor(state.draft, drag.handle, imagePoint);
    else state.draft.points[drag.handle] = imagePoint;
    state.selectedPoint = { target: 'draft', index: drag.handle };
  } else if (drag.type === 'draftCurveHandle' && state.draft?.type === 'area') {
    if (!dragPassedThreshold(drag, screenPoint)) return;
    if (drag.beforeDraft && !drag.historyCommitted) {
      state.draftHistory.push(drag.beforeDraft);
      if (state.draftHistory.length > 80) state.draftHistory.shift();
      drag.historyCommitted = true;
    }
    ensureAreaSegments(state.draft);
    state.draft.segments[drag.segment] = { curved: true, control: imagePoint };
    state.selectedSegment = { target: 'draft', index: drag.segment };
  } else if (drag.type === 'handle') {
    if (!dragPassedThreshold(drag, screenPoint)) return;
    commitDragHistory(drag);
    const object = state.objects.find(item => item.id === drag.id);
    if (object) {
      if (object.type === 'area') moveAreaAnchor(object, drag.handle, imagePoint);
      else object.points[drag.handle] = imagePoint;
      object.auto = false;
      if (object.type === 'gap') {
        captureGapNormalization(object, state.formula.nibPx, 'manual-endpoint-correction');
      }
      if (object.type === 'gap' && object.gapDetection) {
        const correctedLength = distance(object.points[0], object.points[1]);
        object.gapDetection = {
          ...object.gapDetection,
          originalMedianPx: object.gapDetection.originalMedianPx ?? object.gapDetection.medianPx,
          medianPx: correctedLength,
          manualCorrected: true,
          method: 'manual-endpoint-correction',
          verified: true
        };
        if (object.autoMeasurement) {
          object.autoMeasurement = {
            ...object.autoMeasurement,
            originalValuePx: object.autoMeasurement.originalValuePx ?? object.autoMeasurement.valuePx,
            originalValueNib: object.autoMeasurement.originalValueNib ?? object.autoMeasurement.valueNib,
            valuePx: correctedLength,
            valueNib: measurementRatioNib(object),
            supersededByManualEndpoints: true
          };
        }
        if (object.rowBoundaries) {
          object.rowBoundaries = {
            ...object.rowBoundaries,
            supersededByManualEndpoints: true
          };
        }
      }
      markObjectModified(object);
      state.selectedPoint = { target: 'object', id: object.id, index: drag.handle };
      syncFormulaFromObject(object);
      if (object.type === 'gap' && object.formulaKey === 'between-lines') {
        refreshBetweenLinesSummary();
      }
    }
  } else if (drag.type === 'letterResize') {
    if (!dragPassedThreshold(drag, screenPoint)) return;
    commitDragHistory(drag);
    const object = state.objects.find(item => item.id === drag.id && isLetterTemplate(item));
    if (object) {
      object.points = resizeLetterFromHandle(
        drag.original,
        drag.letterHandle,
        imagePoint,
        drag.lockAspect && !['n', 'e', 's', 'w'].includes(drag.letterHandle)
      );
      object.auto = false;
      markObjectModified(object);
      syncLetterControls(object);
    }
  } else if (drag.type === 'letterVectorHandle') {
    if (!dragPassedThreshold(drag, screenPoint)) return;
    commitDragHistory(drag);
    const object = state.objects.find(item => item.id === drag.id && isLetterTemplate(item));
    const engine = globalThis.MEDIDAOT_VECTOR_ENGINE;
    if (object && engine?.moveObjectHandle) {
      engine.moveObjectHandle(object, drag.vectorHandleId, imagePoint, {
        asset: letterAsset(object),
        moveAdjacentControls: true
      });
      object.auto = false;
      markObjectModified(object);
      state.letterVectorSelection = {
        id: object.id,
        handleId: drag.vectorHandleId
      };
      syncLetterControls(object);
    }
  } else if (drag.type === 'letterVectorGroup') {
    if (!dragPassedThreshold(drag, screenPoint)) return;
    commitDragHistory(drag);
    const object = state.objects.find(item => item.id === drag.id && isLetterTemplate(item));
    const engine = globalThis.MEDIDAOT_VECTOR_ENGINE;
    if (object && engine?.translateObjectHandles && drag.originalVector) {
      object.letterVector = engine.cloneVectorData(drag.originalVector);
      object.letterWeight = object.letterVector.weight;
      engine.translateObjectHandles(object, drag.vectorHandleIds, {
        x: imagePoint.x - drag.start.x,
        y: imagePoint.y - drag.start.y
      }, {
        asset: letterAsset(object),
        moveAdjacentControls: true
      });
      object.auto = false;
      markObjectModified(object);
      state.letterVectorSelection = {
        id: object.id,
        handleIds: [...drag.vectorHandleIds],
        primaryHandleId: state.letterVectorSelection?.primaryHandleId || drag.vectorHandleIds[0],
        handleId: state.letterVectorSelection?.primaryHandleId || drag.vectorHandleIds[0]
      };
      syncLetterControls(object);
    }
  } else if (drag.type === 'curveHandle') {
    if (!dragPassedThreshold(drag, screenPoint)) return;
    commitDragHistory(drag);
    const object = state.objects.find(item => item.id === drag.id && item.type === 'area');
    if (object) {
      ensureAreaSegments(object);
      object.segments[drag.segment] = { curved: true, control: imagePoint };
      markObjectModified(object);
      state.selectedSegment = { target: 'object', id: object.id, index: drag.segment };
    }
  } else if (drag.type === 'object') {
    if (!dragPassedThreshold(drag, screenPoint)) return;
    commitDragHistory(drag);
    const object = state.objects.find(item => item.id === drag.id);
    if (object) {
      const dx = imagePoint.x - drag.start.x;
      const dy = imagePoint.y - drag.start.y;
      object.points = drag.original.map(point => ({ x: point.x + dx, y: point.y + dy }));
      if (object.type === 'area') {
        object.segments = (drag.originalSegments || []).map(segment => ({
          ...segment,
          control: segment.control ? { x: segment.control.x + dx, y: segment.control.y + dy } : null
        }));
      }
      if (object.type === 'gap' && object.gapDetection) {
        for (const key of ['upperBoundary', 'lowerBoundary']) {
          if (Array.isArray(object.gapDetection[key])) {
            object.gapDetection[key] = object.gapDetection[key].map(point => ({ x: point.x + dx, y: point.y + dy }));
          }
        }
      }
      object.auto = false;
      markObjectModified(object);
      syncFormulaFromObject(object);
    }
  }
  draw();
  renderResults();
  renderFormulaUI();
}

function endTouchPointer(event) {
  event.preventDefault();
  state.pointers.delete(event.pointerId);
  try { canvas.releasePointerCapture(event.pointerId); } catch {}
  if (state.pointers.size >= 2) rebaseTouchGesture();
  else state.pinchStart = null;
}

function pointerUp(event) {
  event.preventDefault();
  if (event.pointerType === 'touch') {
    if (state.touchEditPointerId === event.pointerId && state.dragging?.type === 'touchLetter') {
      const completed = state.dragging;
      const object = state.objects.find(item => item.id === completed.id && isLetterTemplate(item));
      if (completed.moved && object) {
        state.history.push(completed.before);
        if (state.history.length > 80) state.history.shift();
        state.future = [];
        object.auto = false;
        markObjectModified(object);
        statusText.textContent = 'האות הוזזה באצבע';
      }
      state.touchEditPointerId = null;
      state.dragging = null;
      state.interactionBefore = null;
      renderAll();
    }
    endTouchPointer(event);
    return;
  }
  if (!isMeasurementPointer(event) || state.activePointerId !== event.pointerId) return;

  const completedDrag = state.dragging;
  if (completedDrag?.type === 'vectorizeLasso') {
    finishVectorizeLasso();
    state.dragging = null;
    state.interactionBefore = null;
    state.activePointerId = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    return;
  }
  if (completedDrag?.type === 'letterAnchorLasso') {
    finishLetterAnchorLasso();
    state.dragging = null;
    state.interactionBefore = null;
    state.activePointerId = null;
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    return;
  }
  if (completedDrag?.type === 'draftHandle' &&
      completedDrag.closeOnTap &&
      !completedDrag.moved &&
      state.draft?.type === 'area' &&
      state.draft.points.length >= 3) {
    closeAreaDraft();
    return;
  }
  if (completedDrag?.type === 'drawRect' && state.draft) {
    const objectType = state.dragging.objectType;
    finishRectDraft(objectType, state.interactionBefore);
  }
  if (completedDrag?.moved && ['handle', 'object', 'letterResize', 'letterVectorHandle', 'letterVectorGroup'].includes(completedDrag.type)) {
    const movedObject = state.objects.find(item => item.id === completedDrag.id);
    if (movedObject?.type === 'nibRegion') {
      const rollbackSnapshot = completedDrag.before;
      normalizeQuadObject(movedObject);
      analyzeCalibrationRegion(movedObject, rollbackSnapshot);
    }
    if (movedObject?.type === 'kastel') {
      if (validEditableKastel(movedObject.points)) {
        initializeKastelGuides(movedObject);
      } else {
        const original = completedDrag.before?.objects?.find(item => item.id === movedObject.id);
        if (original?.points?.length === 4) movedObject.points = structuredCloneSafe(original.points);
        statusText.textContent = 'הפינה לא הוזזה משום שהמסגרת הייתה מצטלבת או קורסת';
      }
    }
  }
  if (completedDrag?.moved) renderAll();
  state.dragging = null;
  state.interactionBefore = null;
  state.activePointerId = null;
  try { canvas.releasePointerCapture(event.pointerId); } catch {}
}
function pointerCancel(event) {
  if (event.pointerType === 'touch') {
    if (state.touchEditPointerId === event.pointerId) cancelTouchLetterInteraction();
    endTouchPointer(event);
    return;
  }
  if (state.activePointerId !== event.pointerId) return;
  restoreInteractionState(state.interactionBefore);
  cancelCalibrationAnalysis();
  state.dragging = null;
  state.interactionBefore = null;
  state.activePointerId = null;
  try { canvas.releasePointerCapture(event.pointerId); } catch {}
  statusText.textContent = 'הפעולה בוטלה ללא שינוי במדידות';
  zoomText.textContent = `${Math.round(state.view.scale * 100)}%`;
  renderAll();
}

canvas.addEventListener('pointerdown', pointerDown, { passive: false });
canvas.addEventListener('pointermove', pointerMove, { passive: false });
canvas.addEventListener('pointerup', pointerUp, { passive: false });
canvas.addEventListener('pointercancel', pointerCancel, { passive: false });
canvas.addEventListener('lostpointercapture', event => {
  if (event.pointerType === 'touch') {
    if (state.touchEditPointerId === event.pointerId) cancelTouchLetterInteraction();
    if (state.pointers.has(event.pointerId)) endTouchPointer(event);
    return;
  }
  if (state.activePointerId === event.pointerId && state.interactionBefore) pointerCancel(event);
});
document.addEventListener('pointerdown', event => {
  if (!event.target?.closest?.(MEDIDAOT_INTERFACE_SELECTOR)) return;
  if (state.activePointerId === null || !state.interactionBefore) return;
  restoreInteractionState(state.interactionBefore);
  releaseActiveMeasurementPointer();
  renderAll();
}, { capture: true });
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
  const value = object.type === 'gap' ? measurementLengthPx(object) : distance(object.points[0], object.points[1]);
  if (object.type === 'nib' && value > 0) {
    state.formula.nibPx = value;
    const parentRegion = object.regionId
      ? state.objects.find(item => item.id === object.regionId && item.type === 'nibRegion')
      : null;
    if (parentRegion) {
      parentRegion.calibrationPx = value;
      parentRegion.confidence = object.auto ? object.confidence ?? null : 1;
      markObjectModified(parentRegion);
    }
    if (!object.auto) {
      const sourceUid = object.uid || String(object.id);
      const existing = (state.formula.nibSamples || []).find(sample => sample.sourceUid === sourceUid);
      state.formula.nibSamples = [
        ...(state.formula.nibSamples || [])
          .filter(sample => sample.sourceUid !== sourceUid)
          .map(sample => ({ ...sample, active: false })),
        {
          id: existing?.id || createStableId('nib-sample'),
          sourceUid,
          sourceMeasurementId: sourceUid,
          sourceType: object.regionId ? 'region-corrected' : 'manual-line',
          valuePx: value,
          accepted: true,
          active: true,
          locked: true,
          confidence: 1,
          estimator: 'human-line-v1',
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ].slice(-60);
      object.sampleAccepted = true;
    }
    state.formula.calibration = {
      ...(state.formula.calibration || {}),
      id: state.formula.calibration?.id || `nib-calibration_${state.projectMeta.id || 'project'}`,
      method: object.regionId ? (object.auto ? 'region' : 'region-corrected') : object.auto ? 'global-auto' : 'manual-line',
      regionObjectId: object.regionId || null,
      objectId: object.id,
      valuePx: value,
      confidence: object.auto ? state.formula.analysis.nibConfidence || null : 1,
      verified: !object.auto,
      aggregation: {
        method: object.auto ? 'automatic-single' : 'human-verified-single',
        valuePx: value,
        madPx: 0,
        acceptedCount: 1,
        rejectedCount: 0
      }
    };
  }
  if (object.type === 'gap' && object.formulaKey === 'common-gap' && value > 0) state.formula.commonGapPx = value;
}

function settleDraftBeforeToolChange(nextTool) {
  if (!state.draft) return 'none';
  if (state.draft.type === nextTool) return 'resumed';

  const draftType = state.draft.type;
  const rollbackSnapshot = state.interactionBefore;
  const pointerId = state.activePointerId;
  state.activePointerId = null;
  state.interactionBefore = null;
  state.dragging = null;
  if (pointerId !== null) {
    try { canvas.releasePointerCapture(pointerId); } catch {}
  }

  if (draftType === 'area' && state.draft.points.length >= 3 && polygonArea(state.draft.points) > 0.01) {
    state.draft.closed = true;
    ensureAreaSegments(state.draft);
    commitDraft('השטח נסגר ונמדד');
    return 'completed';
  }

  if (['length', 'nib', 'gap', 'angle'].includes(draftType) &&
      state.draft.points.length >= 2 &&
      distance(state.draft.points[0], state.draft.points[1]) > 0.01) {
    if (draftType === 'gap') {
      state.draft.formulaKey = state.formula.selectedVariable;
      state.draft.name = selectedVariableName();
      state.draft.category = defaultCategory('gap', state.formula.selectedVariable);
    }
    if (draftType === 'angle') state.draft.angleRef = ui.angleRef.value;
    commitDraft(draftType === 'nib' ? 'עובי הקולמוס כויל' : 'המדידה נוספה');
    return 'completed';
  }

  if (['kastel', 'nibRegion'].includes(draftType)) {
    const completed = finishRectDraft(draftType, rollbackSnapshot);
    return completed ? 'completed' : 'cancelled';
  }

  clearDraftState();
  return 'cancelled';
}

function setTool(tool) {
  const draftOutcome = settleDraftBeforeToolChange(tool);
  if (tool !== 'vectorize') state.vectorizeLasso = null;
  if (tool !== 'pan') {
    state.letterVectorLasso = null;
    $('letterAnchorLassoBtn')?.classList.remove('active');
  }
  state.tool = tool;
  document.querySelectorAll('.tool[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  $('gapsPanelBtn')?.classList.toggle('active', tool === 'gap');
  $('autoNibToolBtn')?.classList.remove('active');
  if (TOOL_COLORS[tool]) ui.color.value = TOOL_COLORS[tool];
  const messages = {
    pan: 'אצבע מזיזה אות; Apple Pencil עורך נקודות; שתי אצבעות מזיזות ומגדילות',
    area: 'מדידת שטח ואיזון לובן: סמן נקודות ב־Apple Pencil',
    nib: 'עובי קולמוס: סמן שתי נקודות לרוחב עובי מייצג',
    nibRegion: 'בדיקה מתקדמת באזור: גרור מסגרת סביב מרכזו של גג ישר',
    gap: `מרווחים: ${selectedVariableName()} — סמן שתי נקודות`,
    length: 'אורך חופשי: סמן שתי נקודות',
    angle: 'זווית: סמן שתי נקודות לאורך הקו',
    kastel: 'קעסטעל: גרור מסגרת סביב האות',
    vectorize: 'אות מצולמת לווקטור: הקף את האות במסלול חופשי ב־Apple Pencil',
  };
  const outcomeMessage = draftOutcome === 'completed'
    ? 'המדידה הקודמת הושלמה. '
    : draftOutcome === 'cancelled'
      ? 'הסימון החלקי בוטל. '
      : '';
  statusText.textContent = outcomeMessage + (messages[tool] || 'מוכן');
  if (tool === 'nib' || tool === 'nibRegion') activateFormulaTab('nib');
  if (tool === 'gap') activateFormulaTab('gaps');
  renderAll();
}

document.querySelectorAll('.tool[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
$('thirdsToggleBtn').addEventListener('click', toggleKastelThirds);
$('detectStructureBtn').addEventListener('click', detectActiveKastelStructure);
$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('deletePointBtn').addEventListener('click', deleteSelectedPoint);
$('closeAreaBtn').addEventListener('click', closeAreaDraft);
$('curveSegmentBtn').addEventListener('click', curveSelectedSegment);
$('straightenSegmentBtn').addEventListener('click', straightenSelectedSegment);
$('cancelDraftBtn').addEventListener('click', cancelDraft);
$('deleteBtn').addEventListener('click', deleteSelectedObject);
$('clearBtn').addEventListener('click', () => {
  if (!state.objects.length && !state.draft) return;
  snapshot();
  state.objects = [];
  state.draft = null;
  state.draftHistory = [];
  state.selectedId = null;
  state.selectedPoint = null;
  state.selectedSegment = null;
  state.letterVectorSelection = null;
  state.formula.nibPx = null;
  state.formula.commonGapPx = null;
  state.formula.betweenLinesPx = null;
  state.formula.calibration = null;
  state.formula.nibSamples = [];
  state.activeCalibrationRegionId = null;
  cancelCalibrationAnalysis();
  statusText.textContent = 'כל הסימונים נוקו';
  renderAll();
});

function activeKastelForAction() {
  const selected = state.objects.find(item => item.id === state.selectedId);
  if (selected?.type === 'kastel') return selected;
  if (selected?.type === 'thirds') {
    const linked = state.objects.find(item => item.id === selected.kastelId && item.type === 'kastel');
    if (linked) return linked;
  }
  const kastels = state.objects.filter(item => item.type === 'kastel');
  return kastels.length === 1 ? kastels[0] : null;
}

function prepareKastelAction() {
  setTool('pan');
  const kastel = activeKastelForAction();
  if (!kastel) {
    statusText.textContent = state.objects.filter(item => item.type === 'kastel').length > 1
      ? 'יש לבחור את מסגרת הקעסטעל הרצויה לפני הפעלת הניתוח'
      : 'יש ליצור קעסטעל תחילה';
    return null;
  }
  return kastel;
}

function toggleKastelThirds() {
  const kastel = prepareKastelAction();
  if (!kastel) return;
  snapshot();
  kastel.overlays = {
    ...(kastel.overlays || {}),
    thirdsVisible: kastel.overlays?.thirdsVisible !== true
  };
  markObjectModified(kastel);
  selectObject(kastel.id);
  statusText.textContent = kastel.overlays.thirdsVisible
    ? 'חוק השלישים הוחל: רוחב הקעסטעל חולק לשלושה טורים אנכיים'
    : 'קווי חוק השלישים הוסתרו';
  renderAll();
}

function detectActiveKastelStructure() {
  const kastel = prepareKastelAction();
  if (!kastel) return;
  snapshot();
  const hadManualGuides = kastelHasManualGuide(kastel.guides);
  const detected = initializeKastelGuides(kastel, true);
  kastel.overlays = {
    ...(kastel.overlays || {}),
    structureVisible: detected ? true : hadManualGuides
  };
  selectObject(kastel.id);
  statusText.textContent = detected
    ? kastel.guides.roofCalibrationAccepted === false
      ? 'גג, חלל ומושב זוהו; עובי הגג חרג ביותר מ־10% ולכן לא שינה את הכיול הפעיל'
      : hasLockedNibCalibration()
        ? 'גג, חלל ומושב זוהו; הכיול הידני המאומת נשאר נעול'
        : 'גג, חלל ומושב זוהו. עובי הקולמוס הופק מן הגג וניתן לתיקון ידני'
    : hadManualGuides
      ? 'הזיהוי החדש לא היה יציב; הגבולות הידניים נשמרו ללא שינוי'
      : 'לא זוהו ארבעה גבולות יציבים. אפשר לדייק את הגבולות ידנית';
  renderAll();
}

function deleteSelectedPoint() {
  const selection = state.selectedPoint;
  if (!selection) return;
  if (selection.target === 'draft' && state.draft) {
    state.draftHistory.push(structuredCloneSafe(state.draft));
    if (state.draftHistory.length > 80) state.draftHistory.shift();
    if (state.draft.type === 'area') removeAreaPoint(state.draft, selection.index);
    else state.draft.points.splice(selection.index, 1);
    if (!state.draft.points.length) state.draft = null;
    state.selectedPoint = null;
    statusText.textContent = 'הנקודה נמחקה מן הסימון הנוכחי';
    renderAll();
    return;
  }
  const object = state.objects.find(item => item.id === selection.id);
  if (!object) return;
  if (object.type === 'kastel' || object.type === 'nibRegion') {
    statusText.textContent = object.type === 'kastel'
      ? 'בקעסטעל מזיזים את ארבע הפינות; אין למחוק פינה'
      : 'באזור כיול מזיזים את ארבע הפינות; אין למחוק פינה';
    return;
  }
  const minimum = { area: 3, length: 2, angle: 2, nib: 2, gap: 2, thirds: 1 }[object.type] || 1;
  snapshot();
  if (object.points.length - 1 < minimum) {
    state.objects = state.objects.filter(item => item.id !== object.id);
    if (object.type === 'nib') activateFallbackNibCalibration(object.regionId || null);
    if (object.type === 'gap' && object.formulaKey === 'common-gap') {
      const lastGap = [...state.objects].reverse().find(item => item.type === 'gap' && item.formulaKey === 'common-gap');
      state.formula.commonGapPx = lastGap ? distance(lastGap.points[0], lastGap.points[1]) : null;
    }
    state.selectedId = null;
    statusText.textContent = 'המדידה נמחקה משום שלא נותרו בה די נקודות';
  } else {
    if (object.type === 'area') removeAreaPoint(object, selection.index);
    else object.points.splice(selection.index, 1);
    statusText.textContent = 'הנקודה נמחקה';
  }
  state.selectedPoint = null;
  state.selectedSegment = null;
  renderAll();
}

function closeAreaDraft() {
  if (state.draft?.type !== 'area' || state.draft.points.length < 3) return;
  releaseActiveMeasurementPointer();
  if (polygonArea(state.draft.points) <= 0.01) {
    statusText.textContent = 'הנקודות אינן תוחמות שטח. יש להזיז נקודה או להוסיף נקודה נוספת';
    renderAll();
    return;
  }
  state.draft.closed = true;
  ensureAreaSegments(state.draft);
  const object = commitDraft('השטח נסגר ונמדד');
  if (!object) return;
  setTool('pan');
  state.selectedPoint = null;
  state.selectedSegment = {
    target: 'object',
    id: object.id,
    index: Math.max(0, areaSegmentCount(object) - 1)
  };
  statusText.textContent = 'השטח נסגר. המקטע האחרון נבחר; גרור את היהלום או לחץ „עיגול המקטע”';
  renderAll();
}

function selectedAreaSegment() {
  const selection = state.selectedSegment;
  if (!selection) return null;
  const object = selection.target === 'draft'
    ? state.draft
    : state.objects.find(item => item.id === selection.id);
  if (object?.type !== 'area') return null;
  ensureAreaSegments(object);
  if (!Number.isInteger(selection.index) || selection.index < 0 || selection.index >= areaSegmentCount(object)) return null;
  return { object, index: selection.index, isDraft: selection.target === 'draft' };
}

function curveSelectedSegment() {
  const selected = selectedAreaSegment();
  if (!selected) return;
  if (!selected.isDraft) snapshot();
  else {
    state.draftHistory.push(structuredCloneSafe(selected.object));
    if (state.draftHistory.length > 80) state.draftHistory.shift();
  }
  const { object, index } = selected;
  const start = object.points[index];
  const end = object.points[segmentEndIndex(object, index)];
  const center = midpoint(start, end);
  const length = distance(start, end) || 1;
  const offset = Math.min(length * .22, 38 / Math.max(.2, state.view.scale));
  const nx = -(end.y - start.y) / length;
  const ny = (end.x - start.x) / length;
  object.segments[index] = {
    curved: true,
    control: object.segments[index]?.control || { x: center.x + nx * offset, y: center.y + ny * offset }
  };
  markObjectModified(object);
  statusText.textContent = 'המקטע עוגל. גרור את היהלום לדייק את העיקול';
  renderAll();
}

function straightenSelectedSegment() {
  const selected = selectedAreaSegment();
  if (!selected) return;
  if (!selected.isDraft) snapshot();
  else {
    state.draftHistory.push(structuredCloneSafe(selected.object));
    if (state.draftHistory.length > 80) state.draftHistory.shift();
  }
  selected.object.segments[selected.index] = { curved: false, control: null };
  markObjectModified(selected.object);
  statusText.textContent = 'המקטע יושר';
  renderAll();
}

function cancelDraft() {
  if (!state.draft) return;
  releaseActiveMeasurementPointer();
  clearDraftState();
  statusText.textContent = 'הסימון הנוכחי בוטל';
  renderAll();
}
function deleteSelectedObject() {
  if (!state.selectedId) return;
  snapshot();
  const deleted = state.objects.find(item => item.id === state.selectedId);
  state.objects = state.objects.filter(item => item.id !== state.selectedId);
  if (deleted?.type === 'nibRegion') {
    cancelCalibrationAnalysis();
    state.formula.nibSamples = (state.formula.nibSamples || []).filter(sample => sample.sourceUid !== (deleted.uid || String(deleted.id)));
    state.objects = state.objects.filter(item => item.regionId !== deleted.id);
    if (state.activeCalibrationRegionId === deleted.id) state.activeCalibrationRegionId = null;
    if (state.formula.calibration?.regionObjectId === deleted.id) {
      activateFallbackNibCalibration(deleted.id);
    }
  }
  if (deleted?.type === 'nib') {
    if (deleted.sampleId) {
      state.formula.nibSamples = (state.formula.nibSamples || []).filter(sample => sample.id !== deleted.sampleId);
    } else {
      state.formula.nibSamples = (state.formula.nibSamples || []).filter(sample => sample.sourceUid !== (deleted.uid || String(deleted.id)));
    }
    if (deleted.regionId) {
      const region = state.objects.find(item => item.id === deleted.regionId && item.type === 'nibRegion');
      if (region) {
        region.calibrationPx = null;
        region.confidence = null;
      }
    }
    activateFallbackNibCalibration(deleted.regionId || null);
  }
  if (deleted?.type === 'kastel') {
    withdrawNibFromKastelRoof(deleted);
  }
  if (deleted?.type === 'gap' && deleted.formulaKey === 'common-gap') {
    const lastGap = [...state.objects].reverse().find(item => item.type === 'gap' && item.formulaKey === 'common-gap');
    state.formula.commonGapPx = lastGap ? distance(lastGap.points[0], lastGap.points[1]) : null;
  }
  if (deleted?.type === 'gap' && deleted.formulaKey === 'between-lines') {
    refreshBetweenLinesSummary();
  }
  state.selectedId = null;
  state.selectedPoint = null;
  state.selectedSegment = null;
  state.letterVectorSelection = null;
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
$('startNibRegionBtn').addEventListener('click', () => setTool('nibRegion'));
$('startGapBtn').addEventListener('click', () => setTool('gap'));
$('analyzeBtn').addEventListener('click', () => {
  const automatic = globalThis.MEDIDAOT_AUTO_MEASURE;
  if (automatic?.runNib) automatic.runNib({ userInitiated: true }).catch(() => {});
  else analyzeImage(true);
});
$('autoNibToolBtn')?.addEventListener('click', () => {
  activateFormulaTab('nib');
  const automatic = globalThis.MEDIDAOT_AUTO_MEASURE;
  if (automatic?.runNib) automatic.runNib({ userInitiated: true }).catch(() => {});
  else analyzeImage(true);
});
$('gapsPanelBtn')?.addEventListener('click', () => {
  activateFormulaTab('gaps');
  $('gapsPanelBtn').classList.add('active');
  statusText.textContent = 'בחר סוג מרווח; בין השיטין ניתן לזיהוי אוטומטי או לתיקון ידני';
  renderFormulaUI();
});
$('autoLineGapBtn')?.addEventListener('click', () => {
  state.formula.selectedVariable = 'between-lines';
  ui.gapVariable.value = 'between-lines';
  const automatic = globalThis.MEDIDAOT_AUTO_MEASURE;
  if (automatic?.runInterline) {
    automatic.runInterline({ userInitiated: true })
      .then(result => {
        if (result?.stale || !result?.applied) return;
        refreshBetweenLinesSummary();
        renderFormulaUI();
      })
      .catch(() => {});
  }
  else statusText.textContent = 'מנוע זיהוי בין השיטין טרם נטען';
});

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
  cancelCalibrationAnalysis();
  state.formula.nibPx = value;
  let object = [...state.objects].reverse().find(item => item.type === 'nib');
  if (!object && state.image) {
    object = makeObject('nib', defaultCenteredLine(value), { color: TOOL_COLORS.nib, name: 'עובי קולמוס — כיול ידני' });
    state.objects.push(object);
    replaceCalibrationOverlays(object);
  } else if (object) {
    resizeLineToLength(object, value);
    object.auto = false;
    markObjectModified(object);
  }
  const parentRegion = object?.regionId
    ? state.objects.find(item => item.id === object.regionId && item.type === 'nibRegion')
    : null;
  if (parentRegion) {
    parentRegion.calibrationPx = value;
    parentRegion.confidence = 1;
    markObjectModified(parentRegion);
  }
  const sourceUid = object?.uid || `manual-value_${state.projectMeta.id || 'project'}`;
  const existingSample = (state.formula.nibSamples || []).find(sample => sample.sourceUid === sourceUid);
  state.formula.nibSamples = [
    ...(state.formula.nibSamples || [])
      .filter(sample => sample.sourceUid !== sourceUid)
      .map(sample => ({ ...sample, active: false })),
    {
      id: existingSample?.id || createStableId('nib-sample'),
      sourceUid,
      sourceMeasurementId: sourceUid,
      sourceType: parentRegion ? 'region-corrected' : 'manual-value',
      valuePx: value,
      accepted: true,
      active: true,
      locked: true,
      confidence: 1,
      estimator: 'human-value-v1',
      createdAt: existingSample?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ].slice(-60);
  state.formula.calibration = {
    ...(state.formula.calibration || {}),
    id: state.formula.calibration?.id || `nib-calibration_${state.projectMeta.id || 'project'}`,
    method: parentRegion ? 'region-corrected' : 'manual-value',
    regionObjectId: parentRegion?.id || null,
    objectId: object?.id || null,
    valuePx: value,
    confidence: 1,
    verified: true,
    aggregation: {
      method: 'human-verified-single',
      valuePx: value,
      madPx: 0,
      acceptedCount: 1,
      rejectedCount: 0
    }
  };
  statusText.textContent = 'עובי הקולמוס עודכן';
  for (const kastel of state.objects.filter(item => item.type === 'kastel')) {
    initializeKastelGuides(kastel);
  }
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

for (const element of [ui.name, ui.color, ui.lineWidth, ui.fillAlpha, ui.fillEnabled, ui.category, ui.assessment, ui.note].filter(Boolean)) {
  element.addEventListener('input', updateSelectedStyle);
  element.addEventListener('change', updateSelectedStyle);
}
function updateSelectedStyle() {
  const object = state.objects.find(item => item.id === state.selectedId);
  if (!object) return;
  object.name = ui.name.value.trim() || defaultName(object.type);
  object.color = ui.color.value;
  object.lineWidth = +ui.lineWidth.value;
  if (['area', 'kastel', 'nibRegion'].includes(object.type)) {
    object.fillAlpha = +ui.fillAlpha.value / 100;
    object.fillEnabled = ui.fillEnabled.checked;
  }
  object.category = ui.category?.value || object.category || defaultCategory(object.type);
  if (object.type === 'gap' && object.category === 'line-gap') {
    object.formulaKey = 'between-lines';
    state.formula.selectedVariable = 'between-lines';
    ui.gapVariable.value = 'between-lines';
  }
  object.assessment = ui.assessment?.value || object.assessment || 'unclassified';
  object.note = ui.note?.value.trim() || '';
  object.auto = false;
  markObjectModified(object);
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

const KASTEL_GUIDE_INPUTS = [
  [ui.roofTopGuide, 'roofTopT'],
  [ui.roofGuide, 'roofBottomT'],
  [ui.seatGuide, 'seatTopT'],
  [ui.seatBottomGuide, 'seatBottomT']
];
const KASTEL_GUIDE_ORDER = KASTEL_GUIDE_INPUTS.map(([, key]) => key);
for (const [input, key] of KASTEL_GUIDE_INPUTS) {
  input?.addEventListener('input', () => {
    const object = state.objects.find(item => item.id === state.selectedId && item.type === 'kastel');
    if (!object) return;
    if (input.dataset.editing !== '1') {
      snapshot();
      input.dataset.editing = '1';
    }
    if (!object.guides) initializeKastelGuides(object);
    const index = KASTEL_GUIDE_ORDER.indexOf(key);
    const previousKey = KASTEL_GUIDE_ORDER[index - 1];
    const nextKey = KASTEL_GUIDE_ORDER[index + 1];
    const gap = .006;
    let nextValue = clamp(+input.value / 1000, 0, 1);
    if (previousKey && Number.isFinite(object.guides[previousKey])) {
      nextValue = Math.max(nextValue, object.guides[previousKey] + gap);
    }
    if (nextKey && Number.isFinite(object.guides[nextKey])) {
      nextValue = Math.min(nextValue, object.guides[nextKey] - gap);
    }
    object.guides[key] = clamp(nextValue, 0, 1);
    object.guides[`${key.replace(/T$/, '')}Source`] = 'manual';
    const sources = KASTEL_GUIDE_ORDER
      .map(guideKey => object.guides[`${guideKey.replace(/T$/, '')}Source`])
      .filter(Boolean);
    object.guides.source = sources.length === 4
      ? sources.every(source => source === 'manual')
        ? 'manual'
        : sources.every(source => source === 'auto')
          ? 'auto'
          : 'mixed'
      : 'manual-partial';
    object.overlays = { ...(object.overlays || {}), structureVisible: true };
    if (key === 'roofTopT' || key === 'roofBottomT') updateNibFromKastelRoof(object);
    markObjectModified(object);
    input.value = Math.round(object.guides[key] * 1000);
    draw();
    renderResults();
  });
  input?.addEventListener('change', () => { input.dataset.editing = '0'; });
  input?.addEventListener('blur', () => { input.dataset.editing = '0'; });
}

$('imageInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const now = new Date().toISOString();
  state.sourceMeta = {
    id: createStableId('image'),
    fileName: file.name,
    mimeType: file.type || null,
    byteLength: file.size
  };
  state.projectMeta = {
    id: createStableId('project'),
    title: file.name.replace(/\.[^.]+$/, ''),
    createdAt: now,
    updatedAt: now
  };
  state.projectDocument = null;
  const reader = new FileReader();
  reader.onload = () => loadImageSource(reader.result, true);
  reader.readAsDataURL(file);
  event.target.value = '';
});

function loadImageSource(source, resetProject, preparedImage = null) {
  const image = preparedImage || new Image();
  const handleLoad = () => {
    state.image = image;
    state.imageSrc = source;
    emptyState.style.display = 'none';
    if (resetProject) {
      state.objects = [];
      state.draft = null;
      state.draftHistory = [];
      state.selectedId = null;
      state.selectedPoint = null;
      state.selectedSegment = null;
      state.letterVectorSelection = null;
      state.nextId = 1;
      state.history = [];
      state.future = [];
      state.formula = mergeFormula({});
    }
    fitImage();
    const savedView = !resetProject ? state.projectDocument?.uiState?.view : null;
    if (savedView && Number.isFinite(+savedView.x) && Number.isFinite(+savedView.y) && Number.isFinite(+savedView.scale)) {
      state.view = { x: +savedView.x, y: +savedView.y, scale: clamp(+savedView.scale, .03, 12) };
      zoomText.textContent = `${Math.round(state.view.scale * 100)}%`;
    }
    renderAll();
    for (const kastel of state.objects.filter(item => item.type === 'kastel' && !item.guides)) initializeKastelGuides(kastel);
    if (resetProject) {
      statusText.textContent = 'התמונה נטענה. מזהה כעת את עובי הקולמוס מן הגגות…';
      setTimeout(() => {
        const automatic = globalThis.MEDIDAOT_AUTO_MEASURE;
        if (automatic?.analyzeLoadedImage) {
          automatic.analyzeLoadedImage({ apply: true })
            .then(result => {
              if (result?.stale || !result?.applied?.interline) return;
              refreshBetweenLinesSummary();
              renderFormulaUI();
            })
            .catch(() => {});
        }
        else analyzeImage(false);
      }, 0);
    }
  };
  if (preparedImage) {
    handleLoad();
    return;
  }
  image.onload = handleLoad;
  image.onerror = () => alert('לא ניתן לפתוח את התמונה');
  image.src = source;
}

async function analyzeImage(userInitiated) {
  if (!state.image) {
    statusText.textContent = 'יש להעלות תמונה תחילה';
    return;
  }
  if (userInitiated) snapshot();
  const token = ++state.calibrationAnalysisToken;
  state.formula.analysis.status = 'running';
  analysisOverlay.hidden = false;
  renderFormulaUI();
  statusText.textContent = 'מזהה גגות ישרים ועובי קולמוס…';
  await new Promise(resolve => setTimeout(resolve, 40));
  try {
    const analysis = computeImageMetrics(state.image);
    if (token !== state.calibrationAnalysisToken) return;
    applyAnalysis(analysis);
  } catch (error) {
    if (token !== state.calibrationAnalysisToken) return;
    console.error(error);
    state.formula.analysis.status = 'failed';
    statusText.textContent = 'לא נמצא גג יציב דיו. אפשר לתקן באמצעות קו ידני או בדיקה באזור.';
  } finally {
    if (token === state.calibrationAnalysisToken) {
      analysisOverlay.hidden = true;
      renderAll();
    }
  }
}
