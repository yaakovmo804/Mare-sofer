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
    state.formula.calibration = {
      method: 'global-auto',
      objectId: object.id,
      valuePx: analysis.nib.length,
      confidence: analysis.nibConfidence || null,
      verified: false
    };
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
  for (const kastel of state.objects.filter(object => object.type === 'kastel' && object.guides?.source !== 'manual')) {
    initializeKastelGuides(kastel, true);
  }
  if (selected) selectObject(selected.id);
  statusText.textContent = analysis.nib
    ? 'נוצרה הצעה ראשונית. גרור את קצות הקווים כדי לאמת ולדייק'
    : 'לא זוהה עובי יציב. עבור לסימון ידני';
}

function computeImageMetrics(image, options = {}) {
  const maxDimension = options.maxDimension || 900;
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
  const minimumInkPixels = options.region
    ? Math.max(12, gray.length * .01)
    : Math.max(80, gray.length * .0005);
  if (darkCount < minimumInkPixels) throw new Error('Insufficient ink pixels');

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

  const minThickness = Math.max(2, Math.round(Math.max(width, height) * (options.region ? .001 : .002)));
  const maxThickness = options.region
    ? Math.max(minThickness + 3, Math.min(Math.max(width, height) - 1, Math.round(Math.min(width, height) * .9)))
    : Math.max(minThickness + 3, Math.round(Math.max(width, height) * .085));
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
  if (!nibMode || thicknessSamples < (options.region ? 8 : 20)) throw new Error('No stable stroke width');

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

function rasterizeImageQuad(points, maxDimension = 600) {
  const topWidth = distance(points[0], points[1]);
  const bottomWidth = distance(points[3], points[2]);
  const leftHeight = distance(points[0], points[3]);
  const rightHeight = distance(points[1], points[2]);
  const targetWidth = (topWidth + bottomWidth) / 2;
  const targetHeight = (leftHeight + rightHeight) / 2;
  if (targetWidth < 2 || targetHeight < 2) throw new Error('Region is too small');
  const factor = Math.min(1, maxDimension / Math.max(targetWidth, targetHeight));
  const width = Math.max(2, Math.round(targetWidth * factor));
  const height = Math.max(2, Math.round(targetHeight * factor));

  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const minX = clamp(Math.floor(Math.min(...xs)), 0, state.image.width - 1);
  const minY = clamp(Math.floor(Math.min(...ys)), 0, state.image.height - 1);
  const maxX = clamp(Math.ceil(Math.max(...xs)), minX + 1, state.image.width);
  const maxY = clamp(Math.ceil(Math.max(...ys)), minY + 1, state.image.height);
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  const sourceFactor = Math.min(1, 900 / Math.max(sourceWidth, sourceHeight));
  const sourceRasterWidth = Math.max(2, Math.round(sourceWidth * sourceFactor));
  const sourceRasterHeight = Math.max(2, Math.round(sourceHeight * sourceFactor));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceRasterWidth;
  sourceCanvas.height = sourceRasterHeight;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.fillStyle = '#fff';
  sourceContext.fillRect(0, 0, sourceRasterWidth, sourceRasterHeight);
  sourceContext.drawImage(
    state.image,
    minX, minY, sourceWidth, sourceHeight,
    0, 0, sourceRasterWidth, sourceRasterHeight
  );
  const sourceData = sourceContext.getImageData(0, 0, sourceRasterWidth, sourceRasterHeight).data;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const output = context.createImageData(width, height);
  const [a, b, c, d] = points;
  const mapPoint = point => {
    const u = clamp(point.x / width, 0, 1);
    const v = clamp(point.y / height, 0, 1);
    return {
      x: a.x * (1 - u) * (1 - v) + b.x * u * (1 - v) + c.x * u * v + d.x * (1 - u) * v,
      y: a.y * (1 - u) * (1 - v) + b.y * u * (1 - v) + c.y * u * v + d.y * (1 - u) * v
    };
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const imagePoint = mapPoint({ x: x + .5, y: y + .5 });
      const sampleX = clamp(Math.round((imagePoint.x - minX) / sourceWidth * (sourceRasterWidth - 1)), 0, sourceRasterWidth - 1);
      const sampleY = clamp(Math.round((imagePoint.y - minY) / sourceHeight * (sourceRasterHeight - 1)), 0, sourceRasterHeight - 1);
      const sourceIndex = (sampleY * sourceRasterWidth + sampleX) * 4;
      const outputIndex = (y * width + x) * 4;
      output.data[outputIndex] = sourceData[sourceIndex];
      output.data[outputIndex + 1] = sourceData[sourceIndex + 1];
      output.data[outputIndex + 2] = sourceData[sourceIndex + 2];
      output.data[outputIndex + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return { canvas, mapPoint };
}

async function analyzeCalibrationRegion(region) {
  if (!state.image || !region?.points?.length) return;
  state.formula.analysis.status = 'running';
  analysisOverlay.hidden = false;
  statusText.textContent = 'מנתח את עובי הקולמוס באזור שסומן…';
  renderFormulaUI();
  await new Promise(resolve => setTimeout(resolve, 30));
  const wasActiveCalibration = state.formula.calibration?.regionObjectId === region.id;
  try {
    const raster = rasterizeImageQuad(region.points, 600);
    const analysis = computeImageMetrics(raster.canvas, { region: true, maxDimension: 600 });
    const mappedPoints = analysis.nib.points.map(raster.mapPoint);
    const calibratedLength = distance(mappedPoints[0], mappedPoints[1]);

    state.objects = state.objects.filter(object => !(object.type === 'nib' && object.regionId === region.id));
    const nibObject = makeObject('nib', mappedPoints, {
      color: TOOL_COLORS.nib,
      lineWidth: 3,
      name: 'עובי קולמוס — מתוך אזור',
      regionId: region.id,
      auto: true,
      role: 'region-nib',
      category: 'nib',
      confidence: analysis.nibConfidence || null
    });
    state.objects.push(nibObject);
    region.calibrationPx = calibratedLength;
    region.confidence = analysis.nibConfidence || null;
    region.provenance.modifiedAt = new Date().toISOString();
    state.formula.nibPx = calibratedLength;
    state.formula.calibration = {
      method: 'region',
      regionObjectId: region.id,
      objectId: nibObject.id,
      valuePx: calibratedLength,
      confidence: analysis.nibConfidence || null,
      verified: false
    };
    state.formula.analysis = {
      status: 'done',
      nibConfidence: analysis.nibConfidence || 0,
      gapConfidence: 0,
      threshold: analysis.threshold
    };
    for (const kastel of state.objects.filter(object => object.type === 'kastel' && object.guides?.source !== 'manual')) {
      initializeKastelGuides(kastel, true);
    }
    state.selectedId = region.id;
    statusText.textContent = `עובי הקולמוס כויל מן האזור: ${fmt(calibratedLength, 1)} פיקסלים`;
  } catch (error) {
    console.error(error);
    state.objects = state.objects.filter(object => !(object.type === 'nib' && object.regionId === region.id));
    region.calibrationPx = null;
    state.formula.analysis.status = 'failed';
    const fallback = wasActiveCalibration ? activateFallbackNibCalibration(region.id) : null;
    statusText.textContent = fallback
      ? `לא זוהה עובי יציב באזור; הכיול הקודם נשאר פעיל (${fmt(state.formula.nibPx, 1)} פיקסלים)`
      : wasActiveCalibration
        ? 'לא זוהה עובי יציב באזור והכיול בוטל. נסה תחום צר ומייצג יותר'
        : 'לא זוהה עובי יציב באזור. הכיול הפעיל לא השתנה';
  } finally {
    analysisOverlay.hidden = true;
    renderAll();
  }
}

function activateFallbackNibCalibration(excludedRegionId = null) {
  const fallback = [...state.objects].reverse().find(object =>
    object.type === 'nib' && (!excludedRegionId || object.regionId !== excludedRegionId)
  );
  if (!fallback) {
    state.formula.nibPx = null;
    state.formula.calibration = null;
    return null;
  }
  const valuePx = distance(fallback.points[0], fallback.points[1]);
  state.formula.nibPx = valuePx;
  state.formula.calibration = {
    method: fallback.regionId ? 'region' : fallback.auto ? 'global-auto' : 'manual-line',
    regionObjectId: fallback.regionId || null,
    objectId: fallback.id,
    valuePx,
    confidence: fallback.confidence ?? (fallback.auto ? state.formula.analysis.nibConfidence || null : 1),
    verified: !fallback.auto
  };
  return fallback;
}

function initializeKastelGuides(kastel, force = false) {
  if (!kastel || kastel.type !== 'kastel') return;
  if (!force && kastel.guides?.source === 'manual') return;
  const heightPx = (distance(kastel.points[0], kastel.points[3]) + distance(kastel.points[1], kastel.points[2])) / 2 || 1;
  const fallbackThickness = state.formula.nibPx
    ? clamp(state.formula.nibPx / heightPx, .005, .46)
    : .18;
  let guides = {
    roofBottomT: fallbackThickness,
    seatTopT: 1 - fallbackThickness,
    source: state.formula.nibPx ? 'nib-default' : 'default',
    confidence: 0
  };
  const detected = detectKastelInkBands(kastel);
  if (detected && detected.confidence >= .42 && detected.roofBottomT < detected.seatTopT - .06) guides = detected;
  kastel.guides = guides;
  kastel.provenance = kastel.provenance || {};
  kastel.provenance.modifiedAt = new Date().toISOString();
  renderAll();
}

function detectKastelInkBands(kastel) {
  if (!state.image) return null;
  const topWidth = distance(kastel.points[0], kastel.points[1]);
  const bottomWidth = distance(kastel.points[3], kastel.points[2]);
  const leftHeight = distance(kastel.points[0], kastel.points[3]);
  const rightHeight = distance(kastel.points[1], kastel.points[2]);
  const targetWidth = (topWidth + bottomWidth) / 2;
  const targetHeight = (leftHeight + rightHeight) / 2;
  if (targetWidth < 12 || targetHeight < 12) return null;
  const factor = Math.min(1, 420 / Math.max(targetWidth, targetHeight));
  const width = Math.max(8, Math.round(targetWidth * factor));
  const height = Math.max(8, Math.round(targetHeight * factor));

  const xs = kastel.points.map(point => point.x);
  const ys = kastel.points.map(point => point.y);
  const minX = clamp(Math.floor(Math.min(...xs)), 0, state.image.width - 1);
  const minY = clamp(Math.floor(Math.min(...ys)), 0, state.image.height - 1);
  const maxX = clamp(Math.ceil(Math.max(...xs)), minX + 1, state.image.width);
  const maxY = clamp(Math.ceil(Math.max(...ys)), minY + 1, state.image.height);
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  if (sourceWidth < 12 || sourceHeight < 12) return null;
  const sourceFactor = Math.min(1, 900 / Math.max(sourceWidth, sourceHeight));
  const sourceRasterWidth = Math.max(2, Math.round(sourceWidth * sourceFactor));
  const sourceRasterHeight = Math.max(2, Math.round(sourceHeight * sourceFactor));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceRasterWidth;
  sourceCanvas.height = sourceRasterHeight;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.fillStyle = '#fff';
  sourceContext.fillRect(0, 0, sourceRasterWidth, sourceRasterHeight);
  sourceContext.drawImage(
    state.image,
    minX, minY, sourceWidth, sourceHeight,
    0, 0, sourceRasterWidth, sourceRasterHeight
  );
  const sourceData = sourceContext.getImageData(0, 0, sourceRasterWidth, sourceRasterHeight).data;
  const histogram = new Uint32Array(256);
  const gray = new Uint8Array(width * height);
  const [a, b, c, d] = kastel.points;
  for (let y = 0; y < height; y++) {
    const v = (y + .5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + .5) / width;
      const imageX = a.x * (1 - u) * (1 - v) + b.x * u * (1 - v) + c.x * u * v + d.x * (1 - u) * v;
      const imageY = a.y * (1 - u) * (1 - v) + b.y * u * (1 - v) + c.y * u * v + d.y * (1 - u) * v;
      const sampleX = clamp(Math.round((imageX - minX) / sourceWidth * (sourceRasterWidth - 1)), 0, sourceRasterWidth - 1);
      const sampleY = clamp(Math.round((imageY - minY) / sourceHeight * (sourceRasterHeight - 1)), 0, sourceRasterHeight - 1);
      const sourceIndex = (sampleY * sourceRasterWidth + sampleX) * 4;
      const value = Math.round(
        .2126 * sourceData[sourceIndex] +
        .7152 * sourceData[sourceIndex + 1] +
        .0722 * sourceData[sourceIndex + 2]
      );
      const pixel = y * width + x;
      gray[pixel] = value;
      histogram[value]++;
    }
  }
  const threshold = clamp(otsuThreshold(histogram, gray.length) + 6, 35, 210);
  const xStart = Math.floor(width * .14);
  const xEnd = Math.ceil(width * .86);
  const rowInk = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = xStart; x < xEnd; x++) if (gray[y * width + x] < threshold) count++;
    rowInk[y] = count;
  }
  const smooth = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0, count = 0;
    for (let offset = -2; offset <= 2; offset++) {
      if (y + offset < 0 || y + offset >= height) continue;
      sum += rowInk[y + offset];
      count++;
    }
    smooth[y] = sum / count;
  }
  const peak = Math.max(...smooth);
  if (peak < Math.max(2, (xEnd - xStart) * .035)) return null;
  const activeThreshold = Math.max(2, peak * .26);
  const active = y => smooth[y] >= activeThreshold;

  let roofStart = -1;
  for (let y = 0; y < Math.floor(height * .48); y++) {
    if (active(y)) { roofStart = y; break; }
  }
  let seatEnd = -1;
  for (let y = height - 1; y >= Math.ceil(height * .52); y--) {
    if (active(y)) { seatEnd = y; break; }
  }
  if (roofStart < 0 || seatEnd < 0) return null;

  let roofEnd = roofStart;
  let quiet = 0;
  for (let y = roofStart + 1; y < Math.floor(height * .58); y++) {
    if (active(y)) { roofEnd = y; quiet = 0; }
    else if (++quiet >= 3) break;
  }
  let seatStart = seatEnd;
  quiet = 0;
  for (let y = seatEnd - 1; y >= Math.ceil(height * .42); y--) {
    if (active(y)) { seatStart = y; quiet = 0; }
    else if (++quiet >= 3) break;
  }
  const roofBottomT = clamp((roofEnd + 1) / height, .03, .46);
  const seatTopT = clamp(seatStart / height, .54, .97);
  const edgeFit = (1 - Math.min(.3, roofStart / height)) * (1 - Math.min(.3, (height - 1 - seatEnd) / height));
  return {
    roofBottomT,
    seatTopT,
    source: 'auto',
    confidence: clamp(edgeFit * (peak / Math.max(1, xEnd - xStart)) * 2.4, .15, .92),
    threshold
  };
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
  context.lineWidth = Math.max(1, object.lineWidth || 4);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  if (object.auto) context.setLineDash([10, 8]);
  if (object.type === 'area') {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    ensureAreaSegments(object);
    for (let index = 0; index < areaSegmentCount(object); index++) {
      const end = object.points[segmentEndIndex(object, index)];
      const segment = object.segments[index];
      if (segment?.curved && segment.control) context.quadraticCurveTo(segment.control.x, segment.control.y, end.x, end.y);
      else context.lineTo(end.x, end.y);
    }
    if (object.closed && points.length >= 3) context.closePath();
    if (object.fillEnabled && points.length >= 3) context.fill();
    context.stroke();
  } else if (['kastel', 'nibRegion'].includes(object.type)) {
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
      }
      if (state.formula.nibPx) {
        const topWidthPx = distance(points[0], points[1]);
        const bottomWidthPx = distance(points[3], points[2]);
        context.globalAlpha = .42;
        for (let index = 1; index <= Math.floor(Math.min(topWidthPx, bottomWidthPx) / state.formula.nibPx); index++) {
          const topT = index * state.formula.nibPx / topWidthPx;
          const bottomT = index * state.formula.nibPx / bottomWidthPx;
          if (topT >= .995 || bottomT >= .995) break;
          let p = interp(points[0], points[1], topT), q = interp(points[3], points[2], bottomT);
          context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(q.x, q.y); context.stroke();
        }
      }
      if (object.guides) {
        context.globalAlpha = .9;
        context.setLineDash([]);
        context.lineWidth *= 1.4;
        for (const t of [object.guides.roofBottomT, object.guides.seatTopT]) {
          const p = interp(points[0], points[3], t), q = interp(points[1], points[2], t);
          context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(q.x, q.y); context.stroke();
        }
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
    const size = 10;
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

$('saveProjectBtn').addEventListener('click', async () => {
  const button = $('saveProjectBtn');
  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = 'מכין קובץ…';
  try {
    const data = await serializeProjectV3();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `מדידאות-${stamp}.json`
    );
    statusText.textContent = 'הפרויקט נשמר כקובץ נתונים מוכן להשוואה עתידית';
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
});

async function serializeProjectV3() {
  const now = new Date().toISOString();
  if (!state.projectMeta.id) state.projectMeta.id = createStableId('project');
  if (!state.projectMeta.createdAt) state.projectMeta.createdAt = now;
  state.projectMeta.updatedAt = now;
  if (state.imageSrc && !state.sourceMeta) {
    state.sourceMeta = {
      id: createStableId('image'),
      fileName: null,
      mimeType: state.imageSrc.match(/^data:([^;,]+)/)?.[1] || null,
      byteLength: estimateDataUrlBytes(state.imageSrc)
    };
  }
  if (state.sourceMeta && !state.sourceMeta.id) state.sourceMeta.id = createStableId('image');
  if (state.formula.calibration && !state.formula.calibration.id) {
    state.formula.calibration.id = `nib-calibration_${state.projectMeta.id}`;
  }
  const calibrationId = activeNibCalibrationId();
  const base = structuredCloneSafe(state.projectDocument || {});
  const stableIdMap = new Map(state.objects.map(object => [object.id, object.uid || String(object.id)]));
  const capturedFormula = structuredCloneSafe(state.formula);
  if (capturedFormula.calibration) {
    for (const key of ['objectId', 'regionObjectId']) {
      if (stableIdMap.has(capturedFormula.calibration[key])) {
        capturedFormula.calibration[key] = stableIdMap.get(capturedFormula.calibration[key]);
      }
    }
  }
  const captured = {
    projectMeta: structuredCloneSafe(state.projectMeta),
    sourceMeta: structuredCloneSafe(state.sourceMeta),
    imageSrc: state.imageSrc,
    imageWidth: state.image?.width || null,
    imageHeight: state.image?.height || null,
    formula: capturedFormula,
    measurements: state.objects.map(object => serializeMeasurementV3(object, stableIdMap)),
    view: { ...state.view },
    nextId: state.nextId
  };
  const fingerprint = captured.imageSrc ? await sha256DataUrl(captured.imageSrc) : null;
  const mimeType = captured.sourceMeta?.mimeType || captured.imageSrc?.match(/^data:([^;,]+)/)?.[1] || null;
  const byteLength = captured.sourceMeta?.byteLength || estimateDataUrlBytes(captured.imageSrc);
  const builtInCategories = SEMANTIC_CATEGORIES.map(category => ({ id: category.id, labelHe: category.name }));
  const preservedCategories = (base.taxonomy?.categories || []).filter(category =>
    category?.id && !builtInCategories.some(builtIn => builtIn.id === category.id)
  );
  const activeCalibration = captured.formula.nibPx ? {
    ...((base.calibrations || []).find(item => item.id === calibrationId) || {}),
    id: calibrationId,
    kind: 'nib-width',
    valuePx: captured.formula.nibPx,
    method: captured.formula.calibration?.method || 'legacy',
    regionObjectId: captured.formula.calibration?.regionObjectId || null,
    sampleMeasurementId: captured.formula.calibration?.objectId || null,
    confidence: captured.formula.calibration?.confidence ?? null,
    verified: captured.formula.calibration?.verified ?? false,
    provenance: {
      ...((base.calibrations || []).find(item => item.id === calibrationId)?.provenance || {}),
      origin: captured.formula.calibration?.verified ? 'human' : 'assisted',
      updatedAt: now
    }
  } : null;
  const preservedCalibrations = (base.calibrations || []).filter(item => item?.id && item.id !== calibrationId);
  const capturedCustomVariables = captured.formula.variables.filter(variable => !variable.builtin);
  const preservedCustomVariables = (base.taxonomy?.customVariables || []).filter(variable =>
    variable?.id && !capturedCustomVariables.some(current => current.id === variable.id)
  );
  return {
    ...base,
    format: 'mirror-sofer.measure-stam.project',
    schemaVersion: '3.0.0',
    project: {
      ...(base.project || {}),
      id: captured.projectMeta.id,
      title: captured.projectMeta.title || 'פרויקט מדידאות',
      createdAt: captured.projectMeta.createdAt,
      updatedAt: now,
      appVersion: '2026.07.31d',
      locale: 'he-IL'
    },
    source: {
      ...(base.source || {}),
      image: captured.imageSrc ? {
        ...(base.source?.image || {}),
        id: captured.sourceMeta?.id,
        fileName: captured.sourceMeta?.fileName || null,
        mimeType,
        widthPx: captured.imageWidth,
        heightPx: captured.imageHeight,
        byteLength,
        fingerprint: fingerprint ? { algorithm: 'SHA-256', value: fingerprint } : null,
        storage: { ...(base.source?.image?.storage || {}), kind: 'embedded-data-url', data: captured.imageSrc }
      } : base.source?.image || null,
      coordinateSpace: { id: 'image-px', unit: 'px', origin: 'top-left' }
    },
    taxonomy: {
      ...(base.taxonomy || {}),
      version: '1.0.0',
      categories: [...builtInCategories, ...preservedCategories],
      customVariables: [...capturedCustomVariables, ...preservedCustomVariables]
    },
    calibrations: activeCalibration ? [...preservedCalibrations, activeCalibration] : preservedCalibrations,
    activeNibCalibrationId: activeCalibration ? calibrationId : null,
    formula: captured.formula,
    measurements: captured.measurements,
    samples: Array.isArray(base.samples) ? base.samples : [],
    ruleSets: Array.isArray(base.ruleSets) ? base.ruleSets : [],
    modelRuns: Array.isArray(base.modelRuns) ? base.modelRuns : [],
    uiState: { ...(base.uiState || {}), view: captured.view },
    legacy: { ...(base.legacy || {}), nextId: captured.nextId }
  };
}

function serializeMeasurementV3(object, stableIdMap = new Map()) {
  const copy = structuredCloneSafe(object);
  copy.uid = copy.uid || createStableId('measurement');
  copy.legacy = { ...(copy.legacy || {}), runtimeId: object.id };
  copy.id = copy.uid;
  for (const key of ['kastelId', 'regionId']) {
    if (object[key] == null) continue;
    copy.legacy[`${key}Runtime`] = object[key];
    copy[key] = stableIdMap.get(object[key]) || object[key];
  }
  copy.semantic = {
    ...(copy.semantic || {}),
    categoryId: object.category || defaultCategory(object.type, object.formulaKey),
    labelHe: object.name || defaultName(object.type),
    formulaKey: object.formulaKey || null
  };
  copy.geometry = { ...(copy.geometry || {}), ...measurementGeometry(object) };
  copy.metrics = { ...(copy.metrics || {}), ...measurementMetrics(object) };
  const judgments = Array.isArray(copy.judgments) ? structuredCloneSafe(copy.judgments) : [];
  const primaryHumanIndex = judgments.findIndex(item => item?.source === 'human' && item?.role === 'primary-ui');
  const fallbackHumanIndex = judgments.findIndex(item => item?.source === 'human');
  const editableHumanIndex = primaryHumanIndex >= 0 ? primaryHumanIndex : fallbackHumanIndex;
  if (object.assessment && object.assessment !== 'unclassified') {
    const updatedJudgment = {
        ...(editableHumanIndex >= 0 ? judgments[editableHumanIndex] : {}),
        label: object.assessment,
        labelHe: object.assessment === 'reference' ? 'דוגמת ייחוס' : object.assessment === 'acceptable' ? 'תקין' : 'חריג',
        source: 'human',
        role: 'primary-ui',
        verified: true,
        note: object.note || ''
      };
    if (editableHumanIndex >= 0) judgments[editableHumanIndex] = updatedJudgment;
    else judgments.unshift(updatedJudgment);
  } else if (primaryHumanIndex >= 0) {
    judgments.splice(primaryHumanIndex, 1);
  }
  copy.judgments = judgments;
  copy.provenance = {
    ...(copy.provenance || {}),
    origin: object.auto ? 'assisted' : object.provenance?.origin || 'human',
    createdAt: object.provenance?.createdAt || new Date().toISOString(),
    modifiedAt: object.provenance?.modifiedAt || new Date().toISOString()
  };
  return copy;
}

function measurementGeometry(object) {
  const common = { spaceId: 'image-px', points: structuredCloneSafe(object.points || []) };
  if (object.type === 'area') {
    return { ...common, type: 'quadratic-path', closed: object.closed !== false, segments: structuredCloneSafe(object.segments || []) };
  }
  if (object.type === 'kastel' || object.type === 'nibRegion') return { ...common, type: 'polygon', closed: true };
  if (object.type === 'thirds') return { ...common, type: 'point' };
  if (object.type === 'angle') return { ...common, type: 'polyline' };
  return { ...common, type: 'line-string' };
}

function activeNibCalibrationId() {
  if (!state.formula.nibPx) return null;
  return state.formula.calibration?.id || `nib-calibration_${state.projectMeta.id || 'project'}`;
}

function measurementMetrics(object) {
  if (object.type === 'area') return { areaPx2: measuredArea(object) };
  if (['length', 'nib', 'gap'].includes(object.type) && object.points.length >= 2) {
    const lengthPx = distance(object.points[0], object.points[1]);
    return {
      lengthPx,
      lengthNib: state.formula.nibPx ? lengthPx / state.formula.nibPx : null,
      calibrationId: activeNibCalibrationId()
    };
  }
  if (object.type === 'angle') return { angleDeg: objectAngle(object) };
  if (object.type === 'kastel' && object.points.length === 4) {
    const widthPx = (distance(object.points[0], object.points[1]) + distance(object.points[3], object.points[2])) / 2;
    const heightPx = (distance(object.points[0], object.points[3]) + distance(object.points[1], object.points[2])) / 2;
    return {
      widthPx,
      heightPx,
      widthNib: state.formula.nibPx ? widthPx / state.formula.nibPx : null,
      heightNib: state.formula.nibPx ? heightPx / state.formula.nibPx : null,
      roofBottomVerticalFraction: object.guides?.roofBottomT ?? null,
      seatTopVerticalFraction: object.guides?.seatTopT ?? null,
      guideConfidence: object.guides?.confidence ?? null
    };
  }
  if (object.type === 'thirds') {
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (kastel) {
      const value = thirdsValues(kastel, object.points[0]);
      return {
        verticalFrameFraction: value.yPct / 100,
        verticalThirdDeviationPct: value.yDev,
        horizontalNibFromRight: value.xNibFromRight
      };
    }
  }
  if (object.type === 'nibRegion') return { calibratedNibPx: object.calibrationPx || null, confidence: object.confidence || null };
  return {};
}

function createStableId(prefix) {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? `${prefix}_${globalThis.crypto.randomUUID()}`
    : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function sha256DataUrl(value) {
  if (!value || !globalThis.crypto?.subtle) return null;
  const comma = value.indexOf(',');
  const header = comma >= 0 ? value.slice(0, comma) : '';
  const payload = comma >= 0 ? value.slice(comma + 1) : value;
  let bytes;
  if (/;base64$/i.test(header)) {
    const binary = atob(payload);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function estimateDataUrlBytes(value) {
  if (!value) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return value.length;
  return Math.max(0, Math.floor((value.length - comma - 1) * .75));
}

$('projectInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const migrated = migrateProjectData(data);
      const nextFormula = mergeFormula(migrated.formula || {});
      const prepared = prepareLoadedObjects(migrated.objects);
      const preparedImage = migrated.imageSrc ? await decodeImageSource(migrated.imageSrc) : null;
      if (nextFormula.calibration) {
        for (const key of ['objectId', 'regionObjectId']) {
          const translated = prepared.referenceMap.get(String(nextFormula.calibration[key]));
          if (translated) nextFormula.calibration[key] = translated;
        }
      }
      const importedNextId = Number.isSafeInteger(+migrated.nextId) && +migrated.nextId > 0
        ? +migrated.nextId
        : 0;
      const nextId = Math.max(
        importedNextId,
        prepared.objects.reduce((max, object) => Math.max(max, object.id), 0) + 1
      );
      state.formula = nextFormula;
      state.objects = prepared.objects;
      state.nextId = nextId;
      state.projectMeta = migrated.projectMeta;
      state.sourceMeta = migrated.sourceMeta;
      state.projectDocument = migrated.projectDocument;
      state.draft = null;
      state.draftHistory = [];
      state.selectedId = null;
      state.selectedPoint = null;
      state.selectedSegment = null;
      state.history = [];
      state.future = [];
      if (migrated.imageSrc) loadImageSource(migrated.imageSrc, false, preparedImage);
      else {
        state.image = null;
        state.imageSrc = null;
        emptyState.style.display = '';
        renderAll();
      }
      statusText.textContent = `הפרויקט נפתח${migrated.fromLegacy ? ' והותאם למבנה הנתונים החדש' : ''}`;
    } catch {
      alert('קובץ הפרויקט אינו תקין');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
});

function decodeImageSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Invalid embedded image'));
    image.src = source;
  });
}

function migrateProjectData(data) {
  if (data?.format === 'mirror-sofer.measure-stam.project' && String(data.schemaVersion || '').startsWith('3')) {
    const image = data.source?.image;
    const calibration = data.calibrations?.find(item => item.id === data.activeNibCalibrationId) || data.calibrations?.[0];
    const formulaSeed = structuredCloneSafe(data.formula || {});
    formulaSeed.variables = [
      ...(formulaSeed.variables || []),
      ...(data.taxonomy?.customVariables || [])
    ];
    const formula = mergeFormula(formulaSeed);
    if (!formula.nibPx && calibration?.valuePx) formula.nibPx = calibration.valuePx;
    if (!formula.calibration && calibration) {
      formula.calibration = {
        id: calibration.id,
        method: calibration.method,
        regionObjectId: calibration.regionObjectId,
        objectId: calibration.sampleMeasurementId,
        valuePx: calibration.valuePx,
        confidence: calibration.confidence,
        verified: calibration.verified
      };
    }
    return {
      objects: data.measurements || [],
      nextId: data.legacy?.nextId || null,
      formula,
      imageSrc: image?.storage?.data || null,
      projectMeta: {
        id: data.project?.id || createStableId('project'),
        title: data.project?.title || '',
        createdAt: data.project?.createdAt || null,
        updatedAt: data.project?.updatedAt || null
      },
      sourceMeta: image ? {
        id: image.id,
        fileName: image.fileName,
        mimeType: image.mimeType,
        byteLength: image.byteLength
      } : null,
      projectDocument: projectDocumentTemplate(data),
      fromLegacy: false
    };
  }
  if (data && (data.version === 2 || Array.isArray(data.objects))) {
    return {
      objects: data.objects || [],
      nextId: data.nextId || null,
      formula: mergeFormula(data.formula || {}),
      imageSrc: data.imageSrc || null,
      projectMeta: { id: createStableId('project'), title: '', createdAt: null, updatedAt: null },
      sourceMeta: null,
      projectDocument: null,
      fromLegacy: true
    };
  }
  throw new Error('Unsupported project format');
}

function projectDocumentTemplate(data) {
  const { measurements: _measurements, formula: _formula, ...template } = data;
  if (data.source) {
    template.source = { ...data.source };
    if (data.source.image) {
      template.source.image = { ...data.source.image };
      if (data.source.image.storage) {
        const { data: _embeddedData, ...storage } = data.source.image.storage;
        template.source.image.storage = storage;
      }
    }
  }
  return template;
}

function prepareLoadedObjects(rawObjects) {
  if (!Array.isArray(rawObjects)) throw new Error('Measurements must be an array');
  const stableOwners = new Map();
  rawObjects.forEach((object, index) => {
    const stableKeys = new Set([object?.id, object?.uid].filter(value => value != null).map(String));
    for (const key of stableKeys) {
      if (stableOwners.has(key)) throw new Error('Duplicate measurement identifier');
      stableOwners.set(key, index);
    }
  });
  const objects = rawObjects.map(normalizeLoadedObject);
  const usedIds = new Set();
  const referenceMap = new Map();
  let nextRuntimeId = 1;
  for (const object of objects) {
    const originalId = object.id;
    if (!object.uid && originalId != null) object.uid = String(originalId);
    let runtimeId = Number.isInteger(originalId) && originalId > 0 && !usedIds.has(originalId)
      ? originalId
      : null;
    while (!runtimeId || usedIds.has(runtimeId)) {
      if (!usedIds.has(nextRuntimeId)) runtimeId = nextRuntimeId;
      nextRuntimeId++;
    }
    usedIds.add(runtimeId);
    if (originalId != null) referenceMap.set(String(originalId), runtimeId);
    if (object.uid) referenceMap.set(String(object.uid), runtimeId);
    object.id = runtimeId;
  }
  for (const object of objects) {
    for (const key of ['kastelId', 'regionId']) {
      if (object[key] == null) continue;
      const translated = referenceMap.get(String(object[key]));
      if (translated) object[key] = translated;
    }
  }
  return { objects, referenceMap };
}

function normalizeLoadedObject(object) {
  if (!object || typeof object !== 'object') throw new Error('Invalid measurement');
  const normalized = structuredCloneSafe(object);
  const allowedTypes = new Set(['area', 'length', 'angle', 'kastel', 'thirds', 'nib', 'nibRegion', 'gap']);
  if (!allowedTypes.has(normalized.type)) throw new Error('Unsupported measurement type');
  if (normalized.geometry?.nodes) throw new Error('Unsupported rich path geometry');
  const supportedGeometryTypes = new Set(['quadratic-path', 'polygon', 'point', 'polyline', 'line-string']);
  if (normalized.geometry?.type && !supportedGeometryTypes.has(normalized.geometry.type)) {
    throw new Error('Unsupported measurement geometry type');
  }
  if (!Array.isArray(normalized.points) && Array.isArray(normalized.geometry?.points)) {
    normalized.points = structuredCloneSafe(normalized.geometry.points);
  }
  if (!Array.isArray(normalized.points)) throw new Error('Invalid measurement geometry');
  normalized.points = normalized.points.map(point => Array.isArray(point)
    ? { x: +point[0], y: +point[1] }
    : { x: +point?.x, y: +point?.y });
  if (normalized.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('Invalid measurement geometry');
  }
  const minimumPoints = { area: 3, length: 2, angle: 2, kastel: 4, thirds: 1, nib: 2, nibRegion: 4, gap: 2 };
  if (normalized.points.length < minimumPoints[normalized.type]) throw new Error('Incomplete measurement geometry');
  if (['kastel', 'nibRegion'].includes(normalized.type) && normalized.points.length !== 4) {
    throw new Error('Rectangular measurements require four corners');
  }
  normalized.uid = normalized.uid || (typeof normalized.id === 'string' ? normalized.id : createStableId('measurement'));
  normalized.category = normalized.category || normalized.semantic?.categoryId || defaultCategory(normalized.type, normalized.formulaKey);
  const humanJudgment = Array.isArray(normalized.judgments)
    ? normalized.judgments.find(item => item?.source === 'human')
    : null;
  normalized.assessment = normalized.assessment || humanJudgment?.label || 'unclassified';
  normalized.note = normalized.note || humanJudgment?.note || '';
  normalized.provenance = normalized.provenance || {
    origin: normalized.auto ? 'assisted' : 'human',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };
  if (normalized.type === 'area') {
    normalized.closed = normalized.closed !== false;
    if (!Array.isArray(normalized.segments) && Array.isArray(normalized.geometry?.segments)) {
      normalized.segments = structuredCloneSafe(normalized.geometry.segments);
    }
    ensureAreaSegments(normalized);
  }
  return normalized;
}

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
