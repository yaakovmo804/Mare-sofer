'use strict';
function applyAnalysis(analysis) {
  state.objects = state.objects.filter(object => !object.auto);
  state.formula.analysis = {
    status: analysis.nib ? 'done' : 'failed',
    nibConfidence: analysis.nibConfidence || 0,
    gapConfidence: analysis.gapConfidence || 0,
    threshold: analysis.threshold
  };

  let selected = null;
  if (analysis.nib) {
    state.formula.nibPx = analysis.nib.length;
    const object = makeObject('nib', analysis.nib.points, {
      color: TOOL_COLORS.nib,
      lineWidth: 3,
      name: 'עובי קולמוס — הצעה אוטומטית',
      auto: true,
      role: 'auto-nib'
    });
    state.objects.push(object);
    selected = object;
  }
  if (analysis.gap) {
    state.formula.commonGapPx = analysis.gap.length;
    const object = makeObject('gap', analysis.gap.points, {
      color: TOOL_COLORS.gap,
      lineWidth: 3,
      name: 'מרווח מצוי — הצעה אוטומטית',
      formulaKey: 'common-gap',
      auto: true,
      role: 'auto-gap'
    });
    state.objects.push(object);
  }
  if (selected) state.selectedId = selected.id;
  statusText.textContent = analysis.nib
    ? 'נוצרה הצעה ראשונית. גרור את קצות הקווים כדי לאמת ולדייק'
    : 'לא זוהה עובי יציב. עבור לסימון ידני';
}

function computeImageMetrics(image) {
  const maxDimension = 900;
  const factor = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const context = offscreen.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < imageData.data.length; i += 4, p++) {
    const alpha = imageData.data[i + 3] / 255;
    const value = Math.round((0.2126 * imageData.data[i] + 0.7152 * imageData.data[i + 1] + 0.0722 * imageData.data[i + 2]) * alpha + 255 * (1 - alpha));
    gray[p] = value;
    histogram[value]++;
  }
  const otsu = otsuThreshold(histogram, gray.length);
  const threshold = clamp(otsu + 6, 35, 210);
  const binary = new Uint8Array(gray.length);
  let darkCount = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < threshold) { binary[i] = 1; darkCount++; }
  }
  if (darkCount < Math.max(80, gray.length * 0.0005)) throw new Error('Insufficient ink pixels');

  const hRun = new Uint16Array(gray.length);
  const vRun = new Uint16Array(gray.length);
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!binary[y * width + x]) { x++; continue; }
      const start = x;
      while (x < width && binary[y * width + x]) x++;
      const length = x - start;
      for (let xx = start; xx < x; xx++) hRun[y * width + xx] = length;
    }
  }
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      if (!binary[y * width + x]) { y++; continue; }
      const start = y;
      while (y < height && binary[y * width + x]) y++;
      const length = y - start;
      for (let yy = start; yy < y; yy++) vRun[yy * width + x] = length;
    }
  }

  const minThickness = Math.max(2, Math.round(Math.max(width, height) * 0.002));
  const maxThickness = Math.max(minThickness + 3, Math.round(Math.max(width, height) * 0.085));
  const thicknessHist = new Uint32Array(maxThickness + 1);
  let thicknessSamples = 0;
  const step = gray.length > 600000 ? 2 : 1;
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const index = y * width + x;
      if (!binary[index]) continue;
      const h = hRun[index], v = vRun[index];
      const thin = Math.min(h, v), long = Math.max(h, v);
      if (thin >= minThickness && thin <= maxThickness && long >= thin * 1.55) {
        thicknessHist[thin]++;
        thicknessSamples++;
      }
    }
  }
  const nibMode = smoothMode(thicknessHist, minThickness, maxThickness);
  if (!nibMode || thicknessSamples < 20) throw new Error('No stable stroke width');

  let nibCandidate = null;
  let nibScore = -Infinity;
  const tolerance = Math.max(1, Math.round(nibMode * 0.18));
  for (let y = 2; y < height - 2; y += step) {
    for (let x = 2; x < width - 2; x += step) {
      const index = y * width + x;
      if (!binary[index]) continue;
      const h = hRun[index], v = vRun[index];
      const thin = Math.min(h, v), long = Math.max(h, v);
      if (Math.abs(thin - nibMode) > tolerance || long < thin * 1.8) continue;
      const edgePenalty = Math.min(x, width - x, y, height - y) / Math.max(width, height);
      const score = long / Math.max(1, thin) + edgePenalty * 3;
      if (score > nibScore) {
        nibScore = score;
        nibCandidate = strokeSegment(binary, width, height, x, y, h <= v ? 'horizontal' : 'vertical');
      }
    }
  }
  if (!nibCandidate) throw new Error('No representative stroke location');

  const gapMin = Math.max(2, Math.round(nibMode * 0.55));
  const gapMax = Math.min(Math.max(width, height) - 1, Math.max(gapMin + 2, Math.round(nibMode * 7)));
  const gapHist = new Uint32Array(gapMax + 1);
  scanWhiteRuns(binary, width, height, 'horizontal', gapMin, gapMax, length => gapHist[length]++);
  scanWhiteRuns(binary, width, height, 'vertical', gapMin, gapMax, length => gapHist[length]++);
  const gapMode = smoothMode(gapHist, gapMin, gapMax);
  let gapCandidate = null;
  if (gapMode) gapCandidate = bestGapSegment(binary, width, height, gapMode, Math.max(1, Math.round(gapMode * 0.2)), nibMode);

  const nibConcentration = histogramConcentration(thicknessHist, nibMode, Math.max(1, Math.round(nibMode * 0.2)));
  const gapConcentration = gapMode ? histogramConcentration(gapHist, gapMode, Math.max(1, Math.round(gapMode * 0.2))) : 0;
  const invFactor = 1 / factor;
  const mapPoints = segment => segment.points.map(point => ({ x: point.x * invFactor, y: point.y * invFactor }));

  return {
    threshold,
    nibConfidence: clamp(nibConcentration * 3.4, 0.15, 0.95),
    gapConfidence: clamp(gapConcentration * 3.0, 0.08, 0.9),
    nib: {
      length: distance(nibCandidate.points[0], nibCandidate.points[1]) * invFactor,
      points: mapPoints(nibCandidate)
    },
    gap: gapCandidate ? {
      length: distance(gapCandidate.points[0], gapCandidate.points[1]) * invFactor,
      points: mapPoints(gapCandidate)
    } : null
  };
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let sumBackground = 0, weightBackground = 0, maximum = 0, threshold = 128;
  for (let i = 0; i < 256; i++) {
    weightBackground += histogram[i];
    if (!weightBackground) continue;
    const weightForeground = total - weightBackground;
    if (!weightForeground) break;
    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (between > maximum) { maximum = between; threshold = i; }
  }
  return threshold;
}
function smoothMode(histogram, min, max) {
  let bestIndex = 0, bestValue = 0;
  for (let i = min; i <= max; i++) {
    let value = 0;
    for (let offset = -2; offset <= 2; offset++) value += histogram[i + offset] || 0;
    if (value > bestValue) { bestValue = value; bestIndex = i; }
  }
  return bestValue > 0 ? bestIndex : null;
}
function histogramConcentration(histogram, center, radius) {
  let total = 0, local = 0;
  for (let i = 0; i < histogram.length; i++) {
    total += histogram[i];
    if (Math.abs(i - center) <= radius) local += histogram[i];
  }
  return total ? local / total : 0;
}
function strokeSegment(binary, width, height, x, y, orientation) {
  if (orientation === 'horizontal') {
    let start = x, end = x;
    while (start > 0 && binary[y * width + start - 1]) start--;
    while (end < width - 1 && binary[y * width + end + 1]) end++;
    return { points: [{ x: start + 0.5, y: y + 0.5 }, { x: end + 0.5, y: y + 0.5 }] };
  }
  let start = y, end = y;
  while (start > 0 && binary[(start - 1) * width + x]) start--;
  while (end < height - 1 && binary[(end + 1) * width + x]) end++;
  return { points: [{ x: x + 0.5, y: start + 0.5 }, { x: x + 0.5, y: end + 0.5 }] };
}
function scanWhiteRuns(binary, width, height, orientation, minLength, maxLength, callback) {
  const outer = orientation === 'horizontal' ? height : width;
  const inner = orientation === 'horizontal' ? width : height;
  for (let outerIndex = 0; outerIndex < outer; outerIndex++) {
    let innerIndex = 0;
    while (innerIndex < inner) {
      const at = i => orientation === 'horizontal' ? outerIndex * width + i : i * width + outerIndex;
      if (binary[at(innerIndex)]) { innerIndex++; continue; }
      const start = innerIndex;
      while (innerIndex < inner && !binary[at(innerIndex)]) innerIndex++;
      const length = innerIndex - start;
      const bracketed = start > 0 && innerIndex < inner && binary[at(start - 1)] && binary[at(innerIndex)];
      if (bracketed && length >= minLength && length <= maxLength) callback(length, outerIndex, start, innerIndex - 1, orientation);
    }
  }
}
function bestGapSegment(binary, width, height, mode, tolerance, nibMode) {
  let best = null, bestScore = -Infinity;
  const evaluate = (length, outer, start, end, orientation) => {
    if (Math.abs(length - mode) > tolerance) return;
    const at = i => orientation === 'horizontal' ? outer * width + i : i * width + outer;
    let before = start - 1, beforeLength = 0;
    while (before >= 0 && binary[at(before)] && beforeLength < nibMode * 5) { before--; beforeLength++; }
    const innerLimit = orientation === 'horizontal' ? width : height;
    let after = end + 1, afterLength = 0;
    while (after < innerLimit && binary[at(after)] && afterLength < nibMode * 5) { after++; afterLength++; }
    const centerBias = orientation === 'horizontal'
      ? 1 - Math.abs(outer - height / 2) / (height / 2)
      : 1 - Math.abs(outer - width / 2) / (width / 2);
    const score = Math.min(beforeLength, afterLength) + centerBias * nibMode - Math.abs(length - mode);
    if (score > bestScore) {
      bestScore = score;
      best = orientation === 'horizontal'
        ? { points: [{ x: start + 0.5, y: outer + 0.5 }, { x: end + 0.5, y: outer + 0.5 }] }
        : { points: [{ x: outer + 0.5, y: start + 0.5 }, { x: outer + 0.5, y: end + 0.5 }] };
    }
  };
  const minLength = Math.max(2, mode - tolerance);
  const maxLength = mode + tolerance;
  scanWhiteRuns(binary, width, height, 'horizontal', minLength, maxLength, evaluate);
  scanWhiteRuns(binary, width, height, 'vertical', minLength, maxLength, evaluate);
  return best;
}

$('exportBtn').addEventListener('click', exportImage);
function exportImage() {
  if (!state.image) { statusText.textContent = 'יש להעלות תמונה תחילה'; return; }
  const out = document.createElement('canvas');
  out.width = state.image.width;
  out.height = state.image.height;
  const context = out.getContext('2d');
  context.drawImage(state.image, 0, 0);
  for (const object of state.objects) drawObjectToContext(context, object);
  out.toBlob(blob => downloadBlob(blob, 'מדידאות-מראה-סופר.png'), 'image/png');
}
function drawObjectToContext(context, object) {
  const points = object.points;
  if (!points.length) return;
  context.save();
  context.strokeStyle = object.color;
  context.fillStyle = hexToRgba(object.color, object.fillAlpha || 0);
  context.lineWidth = Math.max(1, (object.lineWidth || 4) / Math.max(0.15, state.view.scale));
  context.lineJoin = 'round';
  context.lineCap = 'round';
  if (object.auto) context.setLineDash([10, 8]);
  if (['area', 'kastel'].includes(object.type)) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => context.lineTo(point.x, point.y));
    if (points.length >= 3) context.closePath();
    if (object.fillEnabled && points.length >= 3) context.fill();
    context.stroke();
    if (object.type === 'kastel' && points.length === 4) {
      context.save();
      context.setLineDash([10, 8]);
      for (const t of [1 / 3, 2 / 3]) {
        let p = interp(points[0], points[3], t), q = interp(points[1], points[2], t);
        context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(q.x, q.y); context.stroke();
        p = interp(points[0], points[1], t); q = interp(points[3], points[2], t);
        context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(q.x, q.y); context.stroke();
      }
      context.restore();
    }
  } else if (['length', 'nib', 'gap', 'angle'].includes(object.type) && points.length >= 2) {
    context.beginPath(); context.moveTo(points[0].x, points[0].y); context.lineTo(points[1].x, points[1].y); context.stroke();
    if (object.type === 'angle' && points.length >= 3) {
      context.beginPath(); context.moveTo(points[1].x, points[1].y); context.lineTo(points[2].x, points[2].y); context.stroke();
    }
  } else if (object.type === 'thirds') {
    const point = points[0];
    const size = 10 / Math.max(0.15, state.view.scale);
    context.beginPath();
    context.moveTo(point.x - size, point.y); context.lineTo(point.x + size, point.y);
    context.moveTo(point.x, point.y - size); context.lineTo(point.x, point.y + size);
    context.stroke();
  }
  context.restore();
}
function downloadBlob(blob, name) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

$('saveProjectBtn').addEventListener('click', () => {
  const data = {
    version: 2,
    imageSrc: state.imageSrc,
    objects: state.objects,
    nextId: state.nextId,
    formula: state.formula
  };
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'פרויקט-מדידאות.json');
});
$('projectInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      state.objects = data.objects || [];
      state.nextId = data.nextId || nextAvailableId();
      state.formula = mergeFormula(data.formula || {});
      state.draft = null;
      state.selectedId = null;
      state.selectedPoint = null;
      state.history = [];
      state.future = [];
      if (data.imageSrc) loadImageSource(data.imageSrc, false);
      else {
        state.image = null;
        state.imageSrc = null;
        emptyState.style.display = '';
        renderAll();
      }
      statusText.textContent = 'הפרויקט נפתח';
    } catch {
      alert('קובץ הפרויקט אינו תקין');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
});

const helpDialog = $('helpDialog');
$('helpBtn').addEventListener('click', () => helpDialog.showModal());
$('closeHelp').addEventListener('click', () => helpDialog.close());
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (!isEditableTarget(event.target)) {
      event.preventDefault();
      state.selectedPoint ? deleteSelectedPoint() : deleteSelectedObject();
    }
  }
  if (event.key === 'Escape') cancelDraft();
});
window.addEventListener('online', () => statusText.textContent = 'חיבור הרשת חזר; העבודה נשמרת מקומית בדפדפן');
window.addEventListener('offline', () => statusText.textContent = 'מצב לא־מקוון — האפליקציה ממשיכה לעבוד');

renderFormulaUI();
renderControls();
resizeCanvas();
