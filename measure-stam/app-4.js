'use strict';
function applyAnalysis(analysis) {
  state.objects = state.objects.filter(object => !['auto-nib', 'auto-gap'].includes(object.role));
  state.formula.analysis = {
    status: analysis.nib ? 'done' : 'failed',
    nibConfidence: analysis.nibConfidence || 0,
    gapConfidence: analysis.gapConfidence || 0,
    threshold: analysis.threshold,
    suggestedNibPx: analysis.nib?.length || null,
    suggestedGapPx: analysis.gap?.length || null,
    proposalOnly: true
  };
  statusText.textContent = analysis.nib
    ? state.formula.nibPx
      ? 'הבדיקה הכללית הסתיימה ולא שינתה את כיול הקולמוס הפעיל'
      : 'הבדיקה הכללית הסתיימה. לקביעת 1 עובי קולמוס יש לסמן אזור כיול'
    : 'לא זוהה מבנה יציב. לקביעת עובי קולמוס יש לסמן אזור כיול';
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
  const smoothed = new Float64Array(histogram.length);
  let bestValue = 0;
  for (let i = min; i <= max; i++) {
    let value = 0;
    for (let offset = -2; offset <= 2; offset++) value += histogram[i + offset] || 0;
    smoothed[i] = value;
    bestValue = Math.max(bestValue, value);
  }
  if (!bestValue) return null;
  let bestRun = null;
  for (let index = min; index <= max;) {
    if (smoothed[index] !== bestValue) {
      index++;
      continue;
    }
    const start = index;
    while (index + 1 <= max && smoothed[index + 1] === bestValue) index++;
    const end = index;
    let mass = 0;
    let weighted = 0;
    for (let bin = Math.max(min, start - 2); bin <= Math.min(max, end + 2); bin++) {
      mass += histogram[bin] || 0;
      weighted += bin * (histogram[bin] || 0);
    }
    if (!bestRun || mass > bestRun.mass) bestRun = { start, end, mass, weighted };
    index++;
  }
  if (bestRun?.mass) return Math.round(bestRun.weighted / bestRun.mass);
  return Math.round((bestRun.start + bestRun.end) / 2);
}
function histogramConcentration(histogram, center, radius) {
  let total = 0, local = 0;
  for (let i = 0; i < histogram.length; i++) {
    total += histogram[i];
    if (Math.abs(i - center) <= radius) local += histogram[i];
  }
  return total ? local / total : 0;
}
function numericMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function medianAbsoluteDeviation(values, center = numericMedian(values)) {
  if (!values.length || !Number.isFinite(center)) return null;
  return numericMedian(values.map(value => Math.abs(value - center)));
}

function stableImageThreshold(image, maxDimension = 900) {
  const factor = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(2, Math.round(image.width * factor));
  const height = Math.max(2, Math.round(image.height * factor));
  const raster = document.createElement('canvas');
  raster.width = width;
  raster.height = height;
  const context = raster.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.length; index += 4) {
    const value = Math.round(.2126 * pixels[index] + .7152 * pixels[index + 1] + .0722 * pixels[index + 2]);
    histogram[value]++;
  }
  return clamp(otsuThreshold(histogram, width * height) + 6, 35, 210);
}

function sourceInkThreshold() {
  const cached = +state.formula.analysis?.sourceThreshold;
  if (Number.isFinite(cached) && cached > 0) return cached;
  const threshold = stableImageThreshold(state.image);
  state.formula.analysis.sourceThreshold = threshold;
  return threshold;
}

function largestInkComponent(binary, width, height) {
  const visited = new Uint8Array(binary.length);
  const queue = new Int32Array(binary.length);
  let best = [];
  const neighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],           [1, 0],
    [-1, 1],  [0, 1],  [1, 1]
  ];
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!binary[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (tail > best.length) best = Array.from(queue.subarray(0, tail));
  }
  return best;
}

function computeRegionNibMetrics(image, options = {}) {
  const width = image.width;
  const height = image.height;
  const context = image.getContext
    ? image.getContext('2d', { willReadFrequently: true })
    : null;
  const raster = context ? image : document.createElement('canvas');
  const rasterContext = context || raster.getContext('2d', { willReadFrequently: true });
  if (!context) {
    raster.width = width;
    raster.height = height;
    rasterContext.fillStyle = '#fff';
    rasterContext.fillRect(0, 0, width, height);
    rasterContext.drawImage(image, 0, 0);
  }
  const pixels = rasterContext.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target++) {
    const alpha = pixels[source + 3] / 255;
    const value = Math.round(
      (.2126 * pixels[source] + .7152 * pixels[source + 1] + .0722 * pixels[source + 2]) * alpha +
      255 * (1 - alpha)
    );
    gray[target] = value;
    histogram[value]++;
  }
  const threshold = Number.isFinite(+options.threshold)
    ? +options.threshold
    : clamp(otsuThreshold(histogram, gray.length) + 6, 35, 210);
  const binary = new Uint8Array(gray.length);
  let darkCount = 0;
  for (let index = 0; index < gray.length; index++) {
    if (gray[index] < threshold) {
      binary[index] = 1;
      darkCount++;
    }
  }
  if (darkCount < Math.max(30, gray.length * .006)) throw new Error('Not enough ink in calibration region');
  const component = largestInkComponent(binary, width, height);
  if (component.length < Math.max(24, darkCount * .12)) throw new Error('No stable ink component');

  let meanX = 0;
  let meanY = 0;
  for (const index of component) {
    meanX += index % width + .5;
    meanY += Math.floor(index / width) + .5;
  }
  meanX /= component.length;
  meanY /= component.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const index of component) {
    const dx = index % width + .5 - meanX;
    const dy = Math.floor(index / width) + .5 - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  xx /= component.length;
  xy /= component.length;
  yy /= component.length;
  const discriminant = Math.sqrt((xx - yy) ** 2 + 4 * xy ** 2);
  const majorVariance = (xx + yy + discriminant) / 2;
  const minorVariance = Math.max(.0001, (xx + yy - discriminant) / 2);
  const elongation = majorVariance / minorVariance;
  if (elongation < 3.5) throw new Error('Calibration region must contain one elongated stroke');
  const angle = .5 * Math.atan2(2 * xy, xx - yy);
  const major = { x: Math.cos(angle), y: Math.sin(angle) };
  const minor = { x: -major.y, y: major.x };
  const projected = component.map(index => {
    const dx = index % width + .5 - meanX;
    const dy = Math.floor(index / width) + .5 - meanY;
    return { u: dx * major.x + dy * major.y, v: dx * minor.x + dy * minor.y };
  });
  let minU = Infinity;
  let maxU = -Infinity;
  for (const point of projected) {
    minU = Math.min(minU, point.u);
    maxU = Math.max(maxU, point.u);
  }
  const fullSpan = maxU - minU;
  if (fullSpan < 12) throw new Error('Calibration stroke is too short');
  const coreMin = minU + fullSpan * .18;
  const coreMax = maxU - fullSpan * .18;
  const coreSpan = coreMax - coreMin;
  const binCount = clamp(Math.round(coreSpan / 1.7), 12, 31);
  const binWidth = coreSpan / binCount;
  const minorIntervalAt = u => {
    const baseX = meanX + major.x * u;
    const baseY = meanY + major.y * u;
    let minimum = -Infinity;
    let maximum = Infinity;
    const constrain = (origin, direction, low, high) => {
      if (Math.abs(direction) < 1e-8) return origin >= low && origin <= high;
      const first = (low - origin) / direction;
      const second = (high - origin) / direction;
      minimum = Math.max(minimum, Math.min(first, second));
      maximum = Math.min(maximum, Math.max(first, second));
      return minimum <= maximum;
    };
    if (!constrain(baseX, minor.x, .5, width - .5)) return null;
    if (!constrain(baseY, minor.y, .5, height - .5)) return null;
    return { minimum, maximum };
  };
  const grayAt = (u, v) => {
    const x = meanX + major.x * u + minor.x * v;
    const y = meanY + major.y * u + minor.y * v;
    if (x < .5 || x > width - .5 || y < .5 || y > height - .5) return 255;
    const pixelX = x - .5;
    const pixelY = y - .5;
    const x0 = clamp(Math.floor(pixelX), 0, width - 1);
    const y0 = clamp(Math.floor(pixelY), 0, height - 1);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = pixelX - x0;
    const ty = pixelY - y0;
    const top = gray[y0 * width + x0] * (1 - tx) + gray[y0 * width + x1] * tx;
    const bottom = gray[y1 * width + x0] * (1 - tx) + gray[y1 * width + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
  const scanCrossSection = (u, interval) => {
    const step = .25;
    const startV = interval.minimum + .05;
    const endV = interval.maximum - .05;
    if (endV <= startV) return null;
    const runs = [];
    let previousV = startV;
    let previousGray = grayAt(u, previousV);
    let inside = previousGray < threshold;
    let runStart = inside ? startV : null;
    for (let v = startV + step; v <= endV + 1e-9; v += step) {
      const currentV = Math.min(v, endV);
      const currentGray = grayAt(u, currentV);
      const currentInside = currentGray < threshold;
      if (currentInside !== inside) {
        const denominator = currentGray - previousGray;
        const ratio = Math.abs(denominator) > 1e-8
          ? clamp((threshold - previousGray) / denominator, 0, 1)
          : .5;
        const crossing = previousV + (currentV - previousV) * ratio;
        if (currentInside) runStart = crossing;
        else if (runStart != null) {
          runs.push({ start: runStart, end: crossing, width: crossing - runStart });
          runStart = null;
        }
      }
      inside = currentInside;
      previousV = currentV;
      previousGray = currentGray;
      if (currentV === endV) break;
    }
    if (inside && runStart != null) runs.push({ start: runStart, end: endV, width: endV - runStart });
    const substantial = runs.filter(run => run.width >= 1.5).sort((a, b) => b.width - a.width);
    if (!substantial.length) return { runs: [], primary: null };
    const meaningful = substantial.filter(run => run.width >= substantial[0].width * .22);
    return { runs: meaningful, primary: substantial[0] };
  };
  const candidates = [];
  let multiRunBins = 0;
  let clippedBins = 0;
  for (let index = 0; index < binCount; index++) {
    const u = coreMin + (index + .5) * binWidth;
    const interval = minorIntervalAt(u);
    const scan = interval ? scanCrossSection(u, interval) : null;
    if (!scan?.primary) {
      clippedBins++;
      continue;
    }
    if (scan.runs.length > 1) {
      multiRunBins++;
      continue;
    }
    const lowerEdge = scan.primary.start;
    const upperEdge = scan.primary.end;
    const backgroundOffsets = [.65, 1.25];
    const hasOuterBackground =
      lowerEdge - interval.minimum >= 1.35 &&
      interval.maximum - upperEdge >= 1.35 &&
      backgroundOffsets.every(offset => grayAt(u, lowerEdge - offset) >= threshold) &&
      backgroundOffsets.every(offset => grayAt(u, upperEdge + offset) >= threshold);
    if (!hasOuterBackground) {
      clippedBins++;
      continue;
    }
    candidates.push({
      width: scan.primary.width,
      u,
      centerV: (scan.primary.start + scan.primary.end) / 2
    });
  }
  if (clippedBins > Math.max(1, Math.floor(binCount * .10))) {
    throw new Error('Calibration stroke touches the region boundary');
  }
  if (multiRunBins > binCount * .22) throw new Error('Calibration region contains more than one stroke');
  if (candidates.length < Math.max(9, binCount * .45)) throw new Error('Not enough stable cross-sections');
  const firstMedian = numericMedian(candidates.map(candidate => candidate.width));
  const firstMad = medianAbsoluteDeviation(candidates.map(candidate => candidate.width), firstMedian) || 0;
  const tolerance = Math.max(1.2, firstMedian * .12, firstMad * 3.5);
  const accepted = candidates.filter(candidate => Math.abs(candidate.width - firstMedian) <= tolerance);
  if (accepted.length < 9) throw new Error('Cross-sections are inconsistent');
  const crossSectionMedian = numericMedian(accepted.map(candidate => candidate.width));
  const majorFootprint = Math.abs(major.x) + Math.abs(major.y);
  const areaWidth = component.length / Math.max(1, fullSpan + majorFootprint);
  if (Math.abs(areaWidth - crossSectionMedian) / Math.max(1, crossSectionMedian) > .10) {
    throw new Error('Stroke area and cross-sections disagree');
  }
  const valuePx = crossSectionMedian;
  const rawMad = medianAbsoluteDeviation(accepted.map(candidate => candidate.width), crossSectionMedian) || 0;
  const madPx = rawMad;
  const robustCv = valuePx ? 1.4826 * madPx / valuePx : Infinity;
  if (!Number.isFinite(valuePx) || valuePx <= 0 || robustCv > .11) throw new Error('Stroke width is not stable');
  if (valuePx > Math.min(width, height) * .90) throw new Error('Calibration region is too broad');
  const representative = accepted.reduce((best, candidate) =>
    Math.abs(candidate.width - crossSectionMedian) < Math.abs(best.width - crossSectionMedian) ? candidate : best
  );
  const center = {
    x: meanX + major.x * representative.u + minor.x * representative.centerV,
    y: meanY + major.y * representative.u + minor.y * representative.centerV
  };
  const points = [
    { x: center.x - minor.x * valuePx / 2, y: center.y - minor.y * valuePx / 2 },
    { x: center.x + minor.x * valuePx / 2, y: center.y + minor.y * valuePx / 2 }
  ];
  const confidence = clamp(
    .25 +
    Math.min(.25, accepted.length / 80) +
    Math.min(.25, Math.log2(elongation) / 16) +
    Math.max(0, .25 * (1 - robustCv / .11)),
    .15,
    .98
  );
  return {
    threshold,
    length: valuePx,
    points,
    confidence,
    stats: {
      estimator: 'pca-subpixel-perpendicular-median-v2',
      sliceCount: accepted.length,
      rejectedSliceCount: candidates.length - accepted.length,
      multiRunBinCount: multiRunBins,
      clippedBinCount: clippedBins,
      medianPx: valuePx,
      crossSectionMedianPx: crossSectionMedian,
      areaWidthPx: areaWidth,
      madPx,
      robustCv,
      elongation
    }
  };
}

function strokeSegment(binary, width, height, x, y, orientation) {
  if (orientation === 'horizontal') {
    let start = x, end = x;
    while (start > 0 && binary[y * width + start - 1]) start--;
    while (end < width - 1 && binary[y * width + end + 1]) end++;
    return { points: [{ x: start, y: y + 0.5 }, { x: end + 1, y: y + 0.5 }] };
  }
  let start = y, end = y;
  while (start > 0 && binary[(start - 1) * width + x]) start--;
  while (end < height - 1 && binary[(end + 1) * width + x]) end++;
  return { points: [{ x: x + 0.5, y: start }, { x: x + 0.5, y: end + 1 }] };
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
  if (!state.image || points.some(point =>
    point.x < 0 || point.y < 0 || point.x > state.image.width || point.y > state.image.height
  )) {
    throw new Error('Calibration region must stay inside the image');
  }
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

function classifyNibSampleCluster(samples, tolerance = .10, currentCanonicalPx = null) {
  const active = samples.filter(sample =>
    sample.active !== false && Number.isFinite(+sample.valuePx) && +sample.valuePx > 0
  );
  if (!active.length) return { samples, canonicalPx: null, madPx: null, acceptedCount: 0, rejectedCount: 0 };
  const values = active.map(sample => +sample.valuePx);
  const locked = active.filter(sample => sample.locked === true);
  if (locked.length) {
    const canonicalPx = numericMedian(locked.map(sample => +sample.valuePx));
    let acceptedCount = 0;
    let rejectedCount = 0;
    const classified = samples.map(sample => {
      if (sample.active === false || !Number.isFinite(+sample.valuePx) || +sample.valuePx <= 0) return sample;
      const relativeDeviation = Math.abs(+sample.valuePx - canonicalPx) / canonicalPx;
      const accepted = sample.locked === true || relativeDeviation <= tolerance + 1e-9;
      accepted ? acceptedCount++ : rejectedCount++;
      return { ...sample, accepted, relativeDeviation };
    });
    const acceptedValues = classified
      .filter(sample => sample.active !== false && sample.accepted !== false)
      .map(sample => +sample.valuePx);
    return {
      samples: classified,
      canonicalPx,
      madPx: medianAbsoluteDeviation(acceptedValues, canonicalPx) || 0,
      acceptedCount,
      rejectedCount
    };
  }
  const overallMedian = numericMedian(values);
  let best = null;
  active.forEach((candidate, index) => {
    const center = +candidate.valuePx;
    const members = active.filter(sample => Math.abs(+sample.valuePx - center) / center <= tolerance + 1e-9);
    const memberValues = members.map(sample => +sample.valuePx);
    const memberMedian = numericMedian(memberValues);
    const relativeMad = (medianAbsoluteDeviation(memberValues, memberMedian) || 0) / memberMedian;
    const distanceFromOverall = Math.abs(memberMedian - overallMedian) / overallMedian;
    const distanceFromCurrent = Number.isFinite(+currentCanonicalPx) && +currentCanonicalPx > 0
      ? Math.abs(memberMedian - +currentCanonicalPx) / +currentCanonicalPx
      : 0;
    const proposal = { members, memberMedian, relativeMad, distanceFromOverall, distanceFromCurrent, firstIndex: index };
    if (!best ||
        proposal.members.length > best.members.length ||
        (proposal.members.length === best.members.length && proposal.relativeMad < best.relativeMad - 1e-9) ||
        (proposal.members.length === best.members.length && Math.abs(proposal.relativeMad - best.relativeMad) <= 1e-9 &&
          proposal.distanceFromCurrent < best.distanceFromCurrent - 1e-9) ||
        (proposal.members.length === best.members.length && Math.abs(proposal.relativeMad - best.relativeMad) <= 1e-9 &&
          Math.abs(proposal.distanceFromCurrent - best.distanceFromCurrent) <= 1e-9 &&
          proposal.distanceFromOverall < best.distanceFromOverall - 1e-9) ||
        (proposal.members.length === best.members.length && Math.abs(proposal.relativeMad - best.relativeMad) <= 1e-9 &&
          Math.abs(proposal.distanceFromCurrent - best.distanceFromCurrent) <= 1e-9 &&
          Math.abs(proposal.distanceFromOverall - best.distanceFromOverall) <= 1e-9 && proposal.firstIndex < best.firstIndex)) {
      best = proposal;
    }
  });
  let canonicalPx = best.memberMedian;
  for (let iteration = 0; iteration < 2; iteration++) {
    const acceptedValues = values.filter(value => Math.abs(value - canonicalPx) / canonicalPx <= tolerance + 1e-9);
    if (!acceptedValues.length) break;
    canonicalPx = numericMedian(acceptedValues);
  }
  let acceptedCount = 0;
  let rejectedCount = 0;
  const classified = samples.map(sample => {
    if (sample.active === false || !Number.isFinite(+sample.valuePx) || +sample.valuePx <= 0) return sample;
    const relativeDeviation = Math.abs(+sample.valuePx - canonicalPx) / canonicalPx;
    const accepted = relativeDeviation <= tolerance + 1e-9;
    accepted ? acceptedCount++ : rejectedCount++;
    return { ...sample, accepted, relativeDeviation };
  });
  const acceptedValues = classified
    .filter(sample => sample.active !== false && sample.accepted !== false)
    .map(sample => +sample.valuePx);
  return {
    samples: classified,
    canonicalPx,
    madPx: medianAbsoluteDeviation(acceptedValues, canonicalPx) || 0,
    acceptedCount,
    rejectedCount
  };
}

function registerRegionNibSample(region, valuePx, analysis) {
  const sourceUid = region.uid || String(region.id);
  const previous = (state.formula.nibSamples || []).filter(sample => sample.sourceUid !== sourceUid);
  const sample = {
    id: createStableId('nib-sample'),
    sourceUid,
    sourceMeasurementId: sourceUid,
    sourceType: 'region',
    valuePx,
    active: true,
    confidence: analysis.confidence,
    estimator: analysis.stats?.estimator || 'pca-subpixel-perpendicular-median-v2',
    threshold: Number.isFinite(+analysis.threshold) ? +analysis.threshold : null,
    stats: structuredCloneSafe(analysis.stats || {}),
    geometry: { spaceId: 'image-px', points: structuredCloneSafe(region.points) },
    representativeSection: {
      spaceId: 'image-px',
      points: structuredCloneSafe(analysis.representativePoints || [])
    },
    createdAt: new Date().toISOString()
  };
  const clustered = classifyNibSampleCluster([...previous, sample].slice(-60), .10, state.formula.nibPx);
  state.formula.nibSamples = clustered.samples;
  const classifiedSample = clustered.samples.find(item => item.id === sample.id) || sample;
  return {
    sample: classifiedSample,
    samples: clustered.samples,
    canonicalPx: clustered.canonicalPx,
    aggregation: {
      method: 'densest-relative-cluster-median',
      toleranceRelative: .10,
      valuePx: clustered.canonicalPx,
      madPx: clustered.madPx,
      acceptedCount: clustered.acceptedCount,
      rejectedCount: clustered.rejectedCount
    }
  };
}

async function analyzeCalibrationRegion(region, rollbackSnapshot = null) {
  if (!state.image || !region?.points?.length) return;
  normalizeQuadObject(region);
  const safeRollback = structuredCloneSafe(rollbackSnapshot || captureSnapshot());
  const previousActiveRegionId = safeRollback.formula?.calibration?.regionObjectId || null;
  const token = ++state.calibrationAnalysisToken;
  state.formula.analysis.status = 'running';
  analysisOverlay.hidden = false;
  statusText.textContent = 'מודד חתכים יציבים בתוך אזור הכיול…';
  renderFormulaUI();
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    const raster = rasterizeImageQuad(region.points, 600);
    const analysis = computeRegionNibMetrics(raster.canvas, { threshold: sourceInkThreshold() });
    if (token !== state.calibrationAnalysisToken) return;
    const mappedPoints = analysis.points.map(raster.mapPoint);
    const calibratedLength = distance(mappedPoints[0], mappedPoints[1]);
    const aggregation = registerRegionNibSample(region, calibratedLength, {
      ...analysis,
      representativePoints: mappedPoints,
      stats: {
        ...analysis.stats,
        rasterValuePx: analysis.length,
        sourceValuePx: calibratedLength
      }
    });

    if (!aggregation.sample.accepted || !aggregation.canonicalPx) {
      const rejectedSample = structuredCloneSafe(aggregation.sample);
      const deviation = rejectedSample.relativeDeviation;
      restoreSnapshot(safeRollback);
      state.formula.nibSamples = [
        ...(state.formula.nibSamples || []).filter(sample => sample.id !== rejectedSample.id),
        rejectedSample
      ].slice(-60);
      state.activeCalibrationRegionId = previousActiveRegionId || state.formula.calibration?.regionObjectId || null;
      statusText.textContent = Number.isFinite(deviation)
        ? `הדגימה שונה מן הכיול היציב ב־${fmt(deviation * 100, 1)}% ולכן לא החליפה אותו`
        : 'הדגימה לא התאימה לכיול היציב ולכן לא החליפה אותו';
      renderFormulaUI();
      return;
    }

    const hasLockedBaseline =
      safeRollback.formula?.calibration?.verified === true ||
      (safeRollback.formula?.nibSamples || []).some(sample => sample.active !== false && sample.locked === true);
    if (hasLockedBaseline) {
      const validationSamples = structuredCloneSafe(aggregation.samples);
      const validationRecord = {
        sampleId: aggregation.sample.id,
        valuePx: aggregation.sample.valuePx,
        accepted: true,
        confidence: aggregation.sample.confidence ?? null,
        createdAt: new Date().toISOString()
      };
      restoreSnapshot(safeRollback);
      state.formula.nibSamples = validationSamples;
      state.formula.calibration = {
        ...(state.formula.calibration || {}),
        verified: true,
        aggregation: aggregation.aggregation,
        validations: [
          ...(state.formula.calibration?.validations || []),
          validationRecord
        ].slice(-60)
      };
      state.activeCalibrationRegionId = state.formula.calibration?.regionObjectId || null;
      statusText.textContent = 'הדגימה תואמת את הכיול הידני המאומת; מקור הכיול הידני נשאר פעיל';
      renderFormulaUI();
      return;
    }

    replaceCalibrationOverlays(region, false);
    const nibObject = makeObject('nib', mappedPoints, {
      color: TOOL_COLORS.nib,
      lineWidth: 3,
      name: 'עובי קולמוס — מתוך אזור',
      regionId: region.id,
      auto: true,
      role: 'region-nib',
      category: 'nib',
      confidence: analysis.confidence,
      sampleId: aggregation.sample.id,
      sampleAccepted: true
    });
    state.objects.push(nibObject);
    region.calibrationPx = calibratedLength;
    region.calibrationCanonicalPx = aggregation.canonicalPx;
    region.confidence = analysis.confidence;
    region.sampleId = aggregation.sample.id;
    region.sampleAccepted = true;
    region.analysisStats = structuredCloneSafe(analysis.stats);
    region.provenance.modifiedAt = new Date().toISOString();
    state.activeCalibrationRegionId = region.id;
    state.formula.nibPx = aggregation.canonicalPx;
    state.formula.calibration = {
      ...(state.formula.calibration || {}),
      id: state.formula.calibration?.id || `nib-calibration_${state.projectMeta.id || createStableId('project')}`,
      method: 'region-cross-section-median',
      algorithmVersion: 'pca-subpixel-perpendicular-median-v2',
      regionObjectId: region.id,
      objectId: nibObject.id,
      valuePx: aggregation.canonicalPx,
      confidence: analysis.confidence,
      verified: false,
      aggregation: aggregation.aggregation
    };
    state.formula.analysis = {
      ...state.formula.analysis,
      status: 'done',
      nibConfidence: analysis.confidence || 0,
      gapConfidence: 0,
      threshold: analysis.threshold
    };
    for (const kastel of state.objects.filter(object => object.type === 'kastel')) {
      initializeKastelGuides(kastel);
    }
    state.selectedId = region.id;
    statusText.textContent = `הכיול הפעיל נקבע: 1.00 עובי קולמוס · ${aggregation.aggregation.acceptedCount} דגימות עקביות`;
  } catch (error) {
    if (token !== state.calibrationAnalysisToken) return;
    console.error(error);
    const hadPreviousCalibration = Number.isFinite(+safeRollback.formula?.nibPx) && +safeRollback.formula.nibPx > 0;
    restoreSnapshot(safeRollback);
    state.activeCalibrationRegionId = previousActiveRegionId || state.formula.calibration?.regionObjectId || null;
    statusText.textContent = hadPreviousCalibration
      ? 'לא נמצא חתך קולמוס יציב באזור; הכיול הקודם נשאר פעיל. סמן מקטע ישר ורציף בלבד'
      : 'לא נמצא חתך קולמוס יציב. סמן אזור צר סביב מקטע ישר ורציף, ללא פינה או הסתעפות';
  } finally {
    if (token === state.calibrationAnalysisToken) {
      analysisOverlay.hidden = true;
      renderAll();
    }
  }
}

function activateFallbackNibCalibration(excludedRegionId = null) {
  const fallback = [...state.objects].reverse().find(object =>
    object.type === 'nib' &&
    object.sampleAccepted !== false &&
    (!excludedRegionId || object.regionId !== excludedRegionId)
  );
  if (!fallback) {
    const stored = (state.formula.nibSamples || []).filter(sample => sample.active !== false && sample.accepted !== false);
    const valuePx = numericMedian(stored.map(sample => sample.valuePx));
    if (!valuePx) {
      state.formula.nibPx = null;
      state.formula.calibration = null;
      return null;
    }
    const madPx = medianAbsoluteDeviation(stored.map(sample => sample.valuePx), valuePx) || 0;
    state.formula.nibPx = valuePx;
    state.formula.calibration = {
      ...(state.formula.calibration || {}),
      method: 'stored-sample-median',
      regionObjectId: null,
      objectId: null,
      valuePx,
      confidence: numericMedian(stored.map(sample => sample.confidence).filter(Number.isFinite)) || null,
      verified: stored.every(sample => sample.confidence === 1),
      aggregation: {
        method: 'median',
        valuePx,
        madPx,
        acceptedCount: stored.length,
        rejectedCount: (state.formula.nibSamples || []).filter(sample => sample.active !== false && sample.accepted === false).length
      }
    };
    return { stored: true, valuePx };
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
  const previousGuides = kastel.guides;
  const heightPx = (distance(kastel.points[0], kastel.points[3]) + distance(kastel.points[1], kastel.points[2])) / 2 || 1;
  const fallbackThickness = state.formula.nibPx
    ? clamp(state.formula.nibPx / heightPx, .005, .46)
    : .18;
  const detectionRequested = force || kastel.overlays?.structureVisible === true;
  if (!force && kastelHasManualGuide(kastel.guides)) {
    if (!Number.isFinite(kastel.guides.roofTopT)) kastel.guides.suggestedRoofTopT = .02;
    if (!Number.isFinite(kastel.guides.roofBottomT)) kastel.guides.suggestedRoofBottomT = fallbackThickness;
    if (!Number.isFinite(kastel.guides.seatTopT)) kastel.guides.suggestedSeatTopT = 1 - fallbackThickness;
    if (!Number.isFinite(kastel.guides.seatBottomT)) kastel.guides.suggestedSeatBottomT = .98;
    kastel.provenance = kastel.provenance || {};
    kastel.provenance.modifiedAt = new Date().toISOString();
    updateNibFromKastelRoof(kastel);
    renderAll();
    return kastel.guides;
  }
  if (!detectionRequested && kastel.guides) {
    kastel.guides.suggestedRoofTopT = .02;
    kastel.guides.suggestedRoofBottomT = fallbackThickness;
    kastel.guides.suggestedSeatTopT = 1 - fallbackThickness;
    kastel.guides.suggestedSeatBottomT = .98;
    return null;
  }
  let guides = {
    roofTopT: null,
    roofBottomT: null,
    seatTopT: null,
    seatBottomT: null,
    suggestedRoofTopT: .02,
    suggestedRoofBottomT: fallbackThickness,
    suggestedSeatTopT: 1 - fallbackThickness,
    suggestedSeatBottomT: .98,
    roofTopSource: null,
    roofBottomSource: null,
    seatTopSource: null,
    seatBottomSource: null,
    source: 'unresolved',
    confidence: 0
  };
  const detected = detectionRequested ? detectKastelInkBands(kastel) : null;
  if (detected &&
      detected.confidence >= .42 &&
      detected.roofTopT < detected.roofBottomT &&
      detected.roofBottomT < detected.seatTopT - .06 &&
      detected.seatTopT < detected.seatBottomT) {
    guides = detected;
  } else if (force && kastelHasManualGuide(previousGuides)) {
    kastel.guides = previousGuides;
    kastel.provenance = kastel.provenance || {};
    kastel.provenance.modifiedAt = new Date().toISOString();
    renderAll();
    return null;
  } else if (detectionRequested) {
    withdrawNibFromKastelRoof(kastel);
  }
  kastel.guides = guides;
  kastel.overlays = {
    ...(kastel.overlays || {}),
    structureVisible: guides.source === 'auto'
  };
  kastel.provenance = kastel.provenance || {};
  kastel.provenance.modifiedAt = new Date().toISOString();
  if (guides.source === 'auto') updateNibFromKastelRoof(kastel);
  renderAll();
  return guides.source === 'auto' ? guides : null;
}

function hasLockedNibCalibration() {
  return state.formula.calibration?.verified === true ||
    (state.formula.nibSamples || []).some(sample => sample.active !== false && sample.locked === true);
}

function withdrawNibFromKastelRoof(kastel) {
  if (!kastel) return;
  const sourceUid = `${kastel.uid || kastel.id}:roof`;
  state.formula.nibSamples = (state.formula.nibSamples || [])
    .filter(sample => sample.sourceUid !== sourceUid);
  if (Array.isArray(state.formula.calibration?.validations)) {
    state.formula.calibration.validations = state.formula.calibration.validations
      .filter(validation => validation.sourceUid !== sourceUid);
  }
  const calibrationCameFromKastel = state.formula.calibration?.objectId === kastel.id &&
    String(state.formula.calibration?.method || '').startsWith('kastel-roof-band');
  if (calibrationCameFromKastel) state.formula.calibration = null;
  if (calibrationCameFromKastel || !hasLockedNibCalibration()) activateFallbackNibCalibration();
}

function updateNibFromKastelRoof(kastel) {
  if (!kastel?.guides) return false;
  const heightPx = (distance(kastel.points[0], kastel.points[3]) + distance(kastel.points[1], kastel.points[2])) / 2 || 1;
  const roofManuallyAdjusted = kastel.guides.roofTopSource === 'manual' || kastel.guides.roofBottomSource === 'manual';
  const roofThicknessPx = !roofManuallyAdjusted && Number.isFinite(kastel.guides.roofDerivedNibPx)
    ? kastel.guides.roofDerivedNibPx
    : Number.isFinite(kastel.guides.roofTopT) && Number.isFinite(kastel.guides.roofBottomT)
      ? (kastel.guides.roofBottomT - kastel.guides.roofTopT) * heightPx
      : null;
  if (!Number.isFinite(roofThicknessPx) || roofThicknessPx <= 0) return false;
  kastel.guides.roofDerivedNibPx = roofThicknessPx;
  const sourceUid = `${kastel.uid || kastel.id}:roof`;
  const now = new Date().toISOString();
  const previous = (state.formula.nibSamples || []).find(sample => sample.sourceUid === sourceUid);
  const otherLockedSample = (state.formula.nibSamples || []).some(sample =>
    sample.sourceUid !== sourceUid && sample.active !== false && sample.locked === true
  );
  const verifiedCalibrationElsewhere = state.formula.calibration?.verified === true &&
    !(state.formula.calibration?.objectId === kastel.id &&
      state.formula.calibration?.method === 'kastel-roof-band-corrected');
  const lockedCalibration = otherLockedSample || verifiedCalibrationElsewhere;
  const sameSourceDeviation = previous?.active !== false &&
      previous?.accepted !== false &&
      Number.isFinite(+previous?.valuePx) &&
      +previous.valuePx > 0
    ? Math.abs(roofThicknessPx - +previous.valuePx) / +previous.valuePx
    : null;
  if (!roofManuallyAdjusted &&
      Number.isFinite(sameSourceDeviation) &&
      sameSourceDeviation > .10 + 1e-9) {
    kastel.guides.roofCalibrationAccepted = false;
    kastel.guides.roofCalibrationDeviation = sameSourceDeviation;
    state.formula.calibration = {
      ...(state.formula.calibration || {}),
      validations: [
        ...(state.formula.calibration?.validations || []).filter(item => item.sourceUid !== sourceUid),
        {
          sourceUid,
          sourceType: 'kastel-roof-band',
          valuePx: roofThicknessPx,
          accepted: false,
          relativeDeviation: sameSourceDeviation,
          confidence: kastel.guides.confidence || null,
          createdAt: now
        }
      ].slice(-60)
    };
    return false;
  }
  const sample = {
    id: previous?.id || createStableId('nib-sample'),
    sourceUid,
    sourceMeasurementId: kastel.uid || String(kastel.id),
    sourceType: roofManuallyAdjusted ? 'kastel-roof-band-corrected' : 'kastel-roof-band',
    valuePx: roofThicknessPx,
    active: true,
    locked: roofManuallyAdjusted && !lockedCalibration,
    validationOnly: lockedCalibration,
    confidence: roofManuallyAdjusted ? 1 : kastel.guides.confidence || null,
    estimator: roofManuallyAdjusted ? 'human-corrected-roof-band-v1' : 'kastel-roof-column-median-v1',
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  const clustered = classifyNibSampleCluster([
    ...(state.formula.nibSamples || []).filter(item => item.sourceUid !== sourceUid),
    sample
  ].slice(-60), .10, state.formula.nibPx);
  const classifiedSample = clustered.samples.find(item => item.id === sample.id) || sample;
  kastel.guides.roofCalibrationAccepted = classifiedSample.accepted !== false;
  kastel.guides.roofCalibrationDeviation = classifiedSample.relativeDeviation ?? null;

  if (lockedCalibration) {
    state.formula.nibSamples = clustered.samples.map(item =>
      item.id === classifiedSample.id
        ? { ...item, active: false, validationOnly: true }
        : item
    );
    const validation = {
      sourceUid,
      sourceType: 'kastel-roof-band',
      valuePx: roofThicknessPx,
      accepted: classifiedSample.accepted !== false,
      relativeDeviation: classifiedSample.relativeDeviation ?? null,
      confidence: classifiedSample.confidence,
      createdAt: now
    };
    state.formula.calibration = {
      ...(state.formula.calibration || {}),
      validations: [
        ...(state.formula.calibration?.validations || []).filter(item => item.sourceUid !== sourceUid),
        validation
      ].slice(-60)
    };
    return false;
  }

  state.formula.nibSamples = clustered.samples;
  if (classifiedSample.accepted === false || !clustered.canonicalPx) return false;
  const canonicalPx = clustered.canonicalPx;
  state.formula.nibPx = canonicalPx;
  state.formula.calibration = {
    ...(state.formula.calibration || {}),
    id: state.formula.calibration?.id || `nib-calibration_${state.projectMeta.id || 'project'}`,
    method: roofManuallyAdjusted ? 'kastel-roof-band-corrected' : 'kastel-roof-band',
    algorithmVersion: roofManuallyAdjusted ? 'human-corrected-roof-band-v1' : 'kastel-roof-column-median-v1',
    regionObjectId: null,
    objectId: kastel.id,
    valuePx: canonicalPx,
    confidence: sample.confidence,
    verified: roofManuallyAdjusted,
    aggregation: {
      method: 'densest-relative-cluster-median',
      toleranceRelative: .10,
      valuePx: canonicalPx,
      madPx: clustered.madPx,
      acceptedCount: clustered.acceptedCount,
      rejectedCount: clustered.rejectedCount
    }
  };
  return true;
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
  if (seatStart <= roofEnd + 4) return null;
  const valleyStart = Math.min(height - 1, roofEnd + 2);
  const valleyEnd = Math.max(valleyStart + 1, seatStart - 1);
  let valleySum = 0;
  let valleyCount = 0;
  for (let y = valleyStart; y < valleyEnd; y++) {
    valleySum += smooth[y];
    valleyCount++;
  }
  const valleyRatio = valleyCount ? (valleySum / valleyCount) / Math.max(1, peak) : 1;
  const separation = clamp(1 - valleyRatio, 0, 1);
  if (separation < .34) return null;
  const roofBottomT = clamp((roofEnd + 1) / height, .03, .46);
  const seatTopT = clamp(seatStart / height, .54, .97);
  const roofTopT = clamp(roofStart / height, 0, roofBottomT - .005);
  const seatBottomT = clamp((seatEnd + 1) / height, seatTopT + .005, 1);
  const roofThicknessSamples = [];
  const seatTopSamples = [];
  const columnStart = Math.floor(width * .16);
  const columnEnd = Math.ceil(width * .84);
  for (let x = columnStart; x < columnEnd; x++) {
    let firstRoof = -1;
    let lastRoof = -1;
    for (let y = Math.max(0, roofStart - 2); y <= Math.min(height - 1, roofEnd + 2); y++) {
      if (gray[y * width + x] >= threshold) continue;
      if (firstRoof < 0) firstRoof = y;
      lastRoof = y;
    }
    if (firstRoof >= 0 && lastRoof >= firstRoof) roofThicknessSamples.push(lastRoof - firstRoof + 1);

    let firstSeat = -1;
    for (let y = Math.max(0, seatStart - 3); y <= Math.min(height - 1, seatEnd + 2); y++) {
      if (gray[y * width + x] < threshold) {
        firstSeat = y;
        break;
      }
    }
    if (firstSeat >= 0) seatTopSamples.push({ x, y: firstSeat });
  }
  const roofThicknessMedianRaster = numericMedian(roofThicknessSamples) || Math.max(1, roofEnd - roofStart + 1);
  const roofThicknessMadRaster = medianAbsoluteDeviation(roofThicknessSamples, roofThicknessMedianRaster) || 0;
  const roofDerivedNibPx = roofThicknessMedianRaster / height * targetHeight;
  const roofThicknessMadPx = roofThicknessMadRaster / height * targetHeight;

  let seatTrend = null;
  if (seatTopSamples.length >= Math.max(6, Math.floor((columnEnd - columnStart) * .15))) {
    const seatMedian = numericMedian(seatTopSamples.map(sample => sample.y));
    const seatMad = medianAbsoluteDeviation(seatTopSamples.map(sample => sample.y), seatMedian) || 0;
    const tolerance = Math.max(2, seatMad * 3);
    const stableSamples = seatTopSamples.filter(sample => Math.abs(sample.y - seatMedian) <= tolerance);
    if (stableSamples.length >= 5) {
      const meanX = stableSamples.reduce((sum, sample) => sum + sample.x, 0) / stableSamples.length;
      const meanY = stableSamples.reduce((sum, sample) => sum + sample.y, 0) / stableSamples.length;
      let numerator = 0;
      let denominator = 0;
      for (const sample of stableSamples) {
        numerator += (sample.x - meanX) * (sample.y - meanY);
        denominator += (sample.x - meanX) ** 2;
      }
      const slopeRaster = denominator ? numerator / denominator : 0;
      const interceptRaster = meanY - slopeRaster * meanX;
      const leftX = width * .12;
      const rightX = width * .88;
      const leftT = clamp((interceptRaster + slopeRaster * leftX) / height, seatTopT - .08, seatBottomT);
      const rightT = clamp((interceptRaster + slopeRaster * rightX) / height, seatTopT - .08, seatBottomT);
      const residuals = stableSamples.map(sample => Math.abs(sample.y - (interceptRaster + slopeRaster * sample.x)));
      const pixelSlope = slopeRaster * (targetHeight / height) / Math.max(1e-9, targetWidth / width);
      const path = [];
      const binCount = 9;
      for (let bin = 0; bin < binCount; bin++) {
        const startX = columnStart + (columnEnd - columnStart) * bin / binCount;
        const endX = columnStart + (columnEnd - columnStart) * (bin + 1) / binCount;
        const members = stableSamples.filter(sample =>
          sample.x >= startX && (bin === binCount - 1 ? sample.x <= endX : sample.x < endX)
        );
        if (!members.length) continue;
        path.push({
          u: clamp(numericMedian(members.map(sample => sample.x)) / width, 0, 1),
          t: clamp(numericMedian(members.map(sample => sample.y)) / height, seatTopT - .08, seatBottomT)
        });
      }
      const smoothedPath = path.map((point, index) => {
        const neighbours = path.slice(Math.max(0, index - 1), Math.min(path.length, index + 2));
        return {
          u: point.u,
          t: numericMedian(neighbours.map(item => item.t))
        };
      });
      seatTrend = {
        leftT,
        rightT,
        meanU: clamp(meanX / width, 0, 1),
        meanT: clamp(meanY / height, 0, 1),
        angleDeg: Math.atan(pixelSlope) * 180 / Math.PI,
        curvaturePx: (numericMedian(residuals) || 0) / height * targetHeight,
        confidence: clamp(stableSamples.length / Math.max(1, seatTopSamples.length), .2, .98),
        sampleCount: stableSamples.length,
        path: smoothedPath.length >= 3 ? smoothedPath : null
      };
    }
  }
  const edgeFit = (1 - Math.min(.3, roofStart / height)) * (1 - Math.min(.3, (height - 1 - seatEnd) / height));
  return {
    roofTopT,
    roofBottomT,
    seatTopT,
    seatBottomT,
    roofTopSource: 'auto',
    roofBottomSource: 'auto',
    seatTopSource: 'auto',
    seatBottomSource: 'auto',
    source: 'auto',
    confidence: clamp(edgeFit * separation * (peak / Math.max(1, xEnd - xStart)) * 3.2, .15, .92),
    threshold,
    roofDerivedNibPx,
    roofThicknessMadPx,
    roofThicknessSampleCount: roofThicknessSamples.length,
    seatTrend
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
function exportOverlayUnit() {
  return Math.max(1, Math.max(state.image?.width || 1, state.image?.height || 1) / 1400);
}
function drawExportLine(context, a, b) {
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
}
function drawExportScaleNote(context, point, text, color, unit) {
  context.save();
  context.font = `700 ${11 * unit}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial`;
  const width = context.measureText(text).width + 12 * unit;
  const height = 20 * unit;
  const x = clamp(point.x - width / 2, 2 * unit, Math.max(2 * unit, state.image.width - width - 2 * unit));
  const y = clamp(point.y - 28 * unit, 2 * unit, Math.max(2 * unit, state.image.height - height - 2 * unit));
  context.fillStyle = 'rgba(255,255,255,.94)';
  context.fillRect(x, y, width, height);
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, unit);
  context.setLineDash([]);
  context.strokeRect(x, y, width, height);
  context.fillStyle = '#111827';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, x + width / 2, y + height / 2);
  context.restore();
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
  if (object.type === 'letterTemplate') {
    drawLetterTemplateForExport(context, object);
  } else if (object.type === 'area') {
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
    const selectedObject = state.objects.find(item => item.id === state.selectedId);
    const exportOverlayActive = object.id === state.selectedId ||
      (selectedObject?.type === 'thirds' && selectedObject.kastelId === object.id) ||
      object.overlays?.thirdsVisible === true ||
      object.overlays?.structureVisible === true;
    if (object.type === 'kastel' && points.length === 4 && exportOverlayActive) {
      const unit = exportOverlayUnit();
      if (object.overlays?.thirdsVisible === true) {
        context.save();
        context.strokeStyle = KASTEL_GUIDE_COLORS.thirds;
        context.lineWidth = 1.8 * unit;
        context.setLineDash([7 * unit, 6 * unit]);
        for (const t of [1 / 3, 2 / 3]) {
          const top = interp(points[0], points[1], t);
          const bottom = interp(points[3], points[2], t);
          drawExportLine(context, top, bottom);
        }
        context.restore();
      }
      const tickLayout = object.id === state.selectedId ? kastelNibTickLayout(object, 1) : null;
      if (tickLayout) {
        const { topWidthImage, divisions, step } = tickLayout;
        context.save();
        context.globalAlpha = .68;
        context.strokeStyle = object.color;
        context.lineWidth = 1.25 * unit;
        context.setLineDash([]);
        for (let index = step; index <= divisions; index += step) {
          const topT = index * state.formula.nibPx / topWidthImage;
          if (topT >= .995) break;
          const top = interp(points[0], points[1], topT);
          const topTarget = interp(points[3], points[2], topT);
          const tickLength = 8 * unit;
          const topInside = interp(top, topTarget, Math.min(1, tickLength / Math.max(1, distance(top, topTarget))));
          drawExportLine(context, top, topInside);
        }
        context.restore();
        if (step > 1) {
          drawExportScaleNote(
            context,
            midpoint(points[0], points[1]),
            `שנתה = ${step} עובי קולמוס`,
            object.color,
            unit
          );
        }
      }
      const guideSpecs = kastelGuideSpecs(object.guides);
      const showStructure = object.overlays?.structureVisible === true;
      if (showStructure && guideSpecs.length) {
        context.save();
        context.globalAlpha = .9;
        context.lineWidth = 2.5 * unit;
        for (const { t, color, dash } of guideSpecs) {
          const left = interp(points[0], points[3], t);
          const right = interp(points[1], points[2], t);
          context.strokeStyle = color;
          context.setLineDash(dash.map(value => value * unit));
          drawExportLine(context, left, right);
        }
        context.restore();
        const trend = object.guides?.seatTrend;
        const trendGeometry = seatTrendGeometry(points, trend);
        if (trendGeometry) {
          const trendPath = trendGeometry.line;
          const mean = trendGeometry.mean;
          context.save();
          context.strokeStyle = KASTEL_GUIDE_COLORS.seatTrend;
          context.lineWidth = 2 * unit;
          context.setLineDash([2 * unit, 5 * unit]);
          context.beginPath();
          context.moveTo(trendPath[0].x, trendPath[0].y);
          for (const point of trendPath.slice(1)) context.lineTo(point.x, point.y);
          context.stroke();
          context.fillStyle = KASTEL_GUIDE_COLORS.seatTrend;
          context.beginPath();
          context.arc(mean.x, mean.y, 4 * unit, 0, Math.PI * 2);
          context.fill();
          context.restore();
          if (Number.isFinite(trend.angleDeg)) {
            drawExportScaleNote(
              context,
              mean,
              `זווית המושב ${fmt(trend.angleDeg, 1)}°`,
              KASTEL_GUIDE_COLORS.seatTrend,
              unit
            );
          }
        }
      }
    }
  } else if (['length', 'nib', 'gap', 'angle'].includes(object.type) && points.length >= 2) {
    context.beginPath(); context.moveTo(points[0].x, points[0].y); context.lineTo(points[1].x, points[1].y); context.stroke();
    if (object.type === 'angle' && points.length >= 3) {
      context.beginPath(); context.moveTo(points[1].x, points[1].y); context.lineTo(points[2].x, points[2].y); context.stroke();
    }
  } else if (object.type === 'thirds' && object.id === state.selectedId) {
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
  const activeAcceptedSamples = (captured.formula.nibSamples || []).filter(sample =>
    sample.active !== false && sample.accepted !== false
  );
  const measurementIds = new Set(captured.measurements.map(measurement => String(measurement.id)));
  const activeCalibration = captured.formula.nibPx ? {
    ...((base.calibrations || []).find(item => item.id === calibrationId) || {}),
    id: calibrationId,
    kind: 'nib-width',
    valuePx: captured.formula.nibPx,
    method: captured.formula.calibration?.method || 'legacy',
    regionObjectId: captured.formula.calibration?.regionObjectId || null,
    sampleMeasurementId: captured.formula.calibration?.objectId || null,
    sampleIds: activeAcceptedSamples.map(sample => sample.id).filter(Boolean),
    sampleMeasurementIds: [...new Set(activeAcceptedSamples
      .map(sample => sample.sourceMeasurementId || sample.sourceUid)
      .filter(identifier => identifier != null && measurementIds.has(String(identifier)))
      .map(String))],
    confidence: captured.formula.calibration?.confidence ?? null,
    verified: captured.formula.calibration?.verified ?? false,
    algorithmVersion: captured.formula.calibration?.algorithmVersion || null,
    validations: structuredCloneSafe(captured.formula.calibration?.validations || []),
    samples: structuredCloneSafe(captured.formula.nibSamples || []),
    aggregation: structuredCloneSafe(captured.formula.calibration?.aggregation || {
      method: 'single',
      valuePx: captured.formula.nibPx,
      madPx: 0,
      acceptedCount: 1,
      rejectedCount: 0
    }),
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
  const balanceRuleTemplate = {
    id: 'rule.balance.symmetric-area.10pct.v1',
    version: '1.0.0',
    labelHe: 'איזון שטחים — סטייה מותרת עד 10%',
    status: 'draft',
    evaluatorAvailable: false,
    relationType: 'balance-pair',
    metricId: 'manual-outline-area.v1',
    scope: {
      glyph: 'א',
      requiredRoles: ['aleph.yod.upper', 'aleph.yod.lower']
    },
    calculation: {
      type: 'symmetric-relative-difference',
      operator: 'symmetric-relative-difference',
      expression: 'abs(a-b)/((a+b)/2)',
      formulaDisplay: '|A-B| / ((A+B)/2)'
    },
    passWhen: { operator: 'less-than-or-equal', value: .10 },
    maxInclusive: .10,
    missingInputResult: 'needs-review',
    template: true
  };
  const existingRuleSets = Array.isArray(base.ruleSets) ? base.ruleSets : [];
  const ruleSets = existingRuleSets.some(rule => rule?.id === balanceRuleTemplate.id)
    ? existingRuleSets
    : [balanceRuleTemplate, ...existingRuleSets];
  const ruleResults = (Array.isArray(base.ruleResults) ? base.ruleResults : []).map(result => ({
    ...result,
    status: 'stale',
    needsRecompute: true,
    invalidatedAt: now,
    invalidationReason: 'project-saved-without-rule-recomputation'
  }));
  return {
    ...base,
    format: 'mirror-sofer.measure-stam.project',
    schemaVersion: '3.2.0',
    project: {
      ...(base.project || {}),
      id: captured.projectMeta.id,
      title: captured.projectMeta.title || 'פרויקט מדידאות',
      createdAt: captured.projectMeta.createdAt,
      updatedAt: now,
      appVersion: '2026.07.31i',
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
    relations: Array.isArray(base.relations) ? base.relations : [],
    ruleSets,
    ruleResults,
    referenceSets: Array.isArray(base.referenceSets) ? base.referenceSets : [],
    modelRuns: Array.isArray(base.modelRuns) ? base.modelRuns : [],
    derivedState: { ...(base.derivedState || {}), rulesNeedRecompute: true, updatedAt: now },
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
  delete copy.points;
  delete copy.segments;
  delete copy.closed;
  copy.metrics = { ...(copy.metrics || {}), ...measurementMetrics(object) };
  copy.display = {
    ...(copy.display || {}),
    resultLabelVisible: isResultLabelVisible(object)
  };
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
  const points = structuredCloneSafe(object.points || []);
  const width = state.image?.width || 0;
  const height = state.image?.height || 0;
  const normalizedPoints = width && height
    ? points.map(point => ({ x: point.x / width, y: point.y / height }))
    : null;
  const common = { spaceId: 'image-px', points, normalizedPoints };
  if (object.type === 'area') {
    return { ...common, type: 'quadratic-path', closed: object.closed !== false, segments: structuredCloneSafe(object.segments || []) };
  }
  if (object.type === 'kastel' || object.type === 'nibRegion' || object.type === 'letterTemplate') {
    return { ...common, type: 'polygon', closed: true };
  }
  if (object.type === 'thirds') return { ...common, type: 'point' };
  if (object.type === 'angle') return { ...common, type: 'polyline' };
  return { ...common, type: 'line-string' };
}

function activeNibCalibrationId() {
  if (!state.formula.nibPx) return null;
  return state.formula.calibration?.id || `nib-calibration_${state.projectMeta.id || 'project'}`;
}

function measurementMetrics(object) {
  if (object.type === 'area') {
    const areaPx2 = measuredArea(object);
    return {
      metricId: 'manual-outline-area.v1',
      areaPx2,
      areaNib2: state.formula.nibPx ? areaPx2 / (state.formula.nibPx ** 2) : null,
      calibrationId: activeNibCalibrationId()
    };
  }
  if (object.type === 'letterTemplate' && object.points.length === 4) {
    const rect = letterObjectRect(object);
    return {
      metricId: 'reference-letter-template.v1',
      letter: object.template?.letter || null,
      tradition: object.template?.tradition || 'beitYosef',
      vectorAssetVersion: object.template?.vectorAssetVersion || 1,
      widthPx: rect.width,
      heightPx: rect.height,
      mode: object.letterMode || 'solid',
      opacity: object.letterOpacity ?? .62
    };
  }
  if (['length', 'nib', 'gap'].includes(object.type) && object.points.length >= 2) {
    const lengthPx = distance(object.points[0], object.points[1]);
    return {
      metricId: object.type === 'nib'
        ? 'nib-width-line.v1'
        : object.type === 'gap'
          ? 'gap-length.v1'
          : 'line-length.v1',
      lengthPx,
      lengthNib: state.formula.nibPx ? lengthPx / state.formula.nibPx : null,
      calibrationId: activeNibCalibrationId()
    };
  }
  if (object.type === 'angle') return { metricId: 'axis-deviation-angle.v1', angleDeg: objectAngle(object) };
  if (object.type === 'kastel' && object.points.length === 4) {
    const widthPx = (distance(object.points[0], object.points[1]) + distance(object.points[3], object.points[2])) / 2;
    const heightPx = (distance(object.points[0], object.points[3]) + distance(object.points[1], object.points[2])) / 2;
    return {
      metricId: 'kastel-frame.v2',
      widthPx,
      heightPx,
      widthNib: state.formula.nibPx ? widthPx / state.formula.nibPx : null,
      heightNib: state.formula.nibPx ? heightPx / state.formula.nibPx : null,
      thirdsOrientation: 'vertical-dividers-across-width',
      thirdsVisible: object.overlays?.thirdsVisible === true,
      roofTopVerticalFraction: object.guides?.roofTopT ?? null,
      roofBottomVerticalFraction: object.guides?.roofBottomT ?? null,
      seatTopVerticalFraction: object.guides?.seatTopT ?? null,
      seatBottomVerticalFraction: object.guides?.seatBottomT ?? null,
      roofThicknessPx: Number.isFinite(object.guides?.roofTopT) && Number.isFinite(object.guides?.roofBottomT)
        ? (object.guides.roofBottomT - object.guides.roofTopT) * heightPx
        : null,
      innerSpacePx: Number.isFinite(object.guides?.roofBottomT) && Number.isFinite(object.guides?.seatTopT)
        ? (object.guides.seatTopT - object.guides.roofBottomT) * heightPx
        : null,
      seatThicknessPx: Number.isFinite(object.guides?.seatTopT) && Number.isFinite(object.guides?.seatBottomT)
        ? (object.guides.seatBottomT - object.guides.seatTopT) * heightPx
        : null,
      roofDerivedNibPx: object.guides?.roofDerivedNibPx ?? null,
      seatSlopeAngleDeg: object.guides?.seatTrend?.angleDeg ?? null,
      seatCurvaturePx: object.guides?.seatTrend?.curvaturePx ?? null,
      guideConfidence: object.guides?.confidence ?? null
    };
  }
  if (object.type === 'thirds') {
    const kastel = state.objects.find(item => item.id === object.kastelId);
    if (kastel) {
      const value = thirdsValues(kastel, object.points[0]);
      return {
        metricId: 'kastel-position.v1',
        verticalFrameFraction: value.yPct / 100,
        verticalThirdDeviationPct: value.yDev,
        horizontalFrameFraction: value.xPct / 100,
        horizontalThirdDeviationPct: value.xDev,
        horizontalNibFromRight: value.xNibFromRight
      };
    }
  }
  if (object.type === 'nibRegion') {
    return {
      metricId: 'nib-region-calibration.v2',
      calibratedNibPx: object.calibrationPx || null,
      confidence: object.confidence || null
    };
  }
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
      const activeCalibrationObjectId = nextFormula.calibration?.objectId || null;
      const activeCalibrationRegionId = nextFormula.calibration?.regionObjectId || null;
      let visibleCalibrationRegionId = activeCalibrationRegionId;
      if (prepared.objects.some(object => ['nib', 'nibRegion'].includes(object.type))) {
        const fallbackCalibration = [...prepared.objects].reverse().find(object => object.type === 'nib');
        const keepNibId = activeCalibrationObjectId || fallbackCalibration?.id || null;
        const keepRegionId = activeCalibrationRegionId || fallbackCalibration?.regionId || null;
        visibleCalibrationRegionId = keepRegionId;
        prepared.objects = prepared.objects.filter(object => {
          if (!['nib', 'nibRegion'].includes(object.type)) return true;
          if (object.type === 'nibRegion') return object.id === keepRegionId;
          return object.id === keepNibId || (keepRegionId && object.regionId === keepRegionId);
        });
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
      state.activeCalibrationRegionId = visibleCalibrationRegionId || null;
      cancelCalibrationAnalysis();
      state.pointers.clear();
      state.pinchStart = null;
      state.activePointerId = null;
      state.interactionBefore = null;
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
    if (!formulaSeed.nibSamples?.length && Array.isArray(calibration?.samples)) {
      formulaSeed.nibSamples = structuredCloneSafe(calibration.samples);
    }
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
        verified: calibration.verified,
        algorithmVersion: calibration.algorithmVersion,
        aggregation: calibration.aggregation
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
  const allowedTypes = new Set(['area', 'length', 'angle', 'kastel', 'thirds', 'nib', 'nibRegion', 'gap', 'letterTemplate']);
  if (!allowedTypes.has(normalized.type)) throw new Error('Unsupported measurement type');
  if (normalized.geometry?.nodes) throw new Error('Unsupported rich path geometry');
  const supportedGeometryTypes = new Set(['quadratic-path', 'polygon', 'point', 'polyline', 'line-string']);
  if (normalized.geometry?.type && !supportedGeometryTypes.has(normalized.geometry.type)) {
    throw new Error('Unsupported measurement geometry type');
  }
  if (Array.isArray(normalized.geometry?.points)) {
    normalized.points = structuredCloneSafe(normalized.geometry.points);
  }
  if (!Array.isArray(normalized.points)) throw new Error('Invalid measurement geometry');
  normalized.points = normalized.points.map(point => Array.isArray(point)
    ? { x: +point[0], y: +point[1] }
    : { x: +point?.x, y: +point?.y });
  if (normalized.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('Invalid measurement geometry');
  }
  if (['kastel', 'nibRegion'].includes(normalized.type) && normalized.points.length === 4) {
    normalized.points = normalizeQuadPoints(normalized.points);
  }
  const minimumPoints = { area: 3, length: 2, angle: 2, kastel: 4, thirds: 1, nib: 2, nibRegion: 4, gap: 2, letterTemplate: 4 };
  if (normalized.points.length < minimumPoints[normalized.type]) throw new Error('Incomplete measurement geometry');
  if (['kastel', 'nibRegion', 'letterTemplate'].includes(normalized.type) && normalized.points.length !== 4) {
    throw new Error('Rectangular measurements require four corners');
  }
  normalized.uid = normalized.uid || (typeof normalized.id === 'string' ? normalized.id : createStableId('measurement'));
  normalized.category = normalized.category || normalized.semantic?.categoryId || defaultCategory(normalized.type, normalized.formulaKey);
  const humanJudgment = Array.isArray(normalized.judgments)
    ? normalized.judgments.find(item => item?.source === 'human')
    : null;
  normalized.assessment = normalized.assessment || humanJudgment?.label || 'unclassified';
  normalized.note = normalized.note || humanJudgment?.note || '';
  normalized.display = {
    ...(normalized.display || {}),
    resultLabelVisible: normalized.display?.resultLabelVisible !== false
  };
  normalized.provenance = normalized.provenance || {
    origin: normalized.auto ? 'assisted' : 'human',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };
  if (normalized.type === 'area') {
    normalized.closed = normalized.geometry?.closed ?? normalized.closed ?? true;
    if (Array.isArray(normalized.geometry?.segments)) {
      normalized.segments = structuredCloneSafe(normalized.geometry.segments);
    }
    ensureAreaSegments(normalized);
  }
  if (normalized.type === 'letterTemplate') normalizeLetterTemplateObject(normalized);
  if (normalized.type === 'kastel' && normalized.guides) {
    const guides = normalized.guides;
    const validSource = source => ['auto', 'manual'].includes(source);
    const sharedSource = validSource(guides.source) ? guides.source : null;
    const roofSource = validSource(guides.roofSource) ? guides.roofSource : sharedSource;
    const seatSource = validSource(guides.seatSource) ? guides.seatSource : sharedSource;
    const guideKeys = ['roofTopT', 'roofBottomT', 'seatTopT', 'seatBottomT'];
    const fallbackSources = {
      roofTopT: null,
      roofBottomT: roofSource,
      seatTopT: seatSource,
      seatBottomT: null
    };
    const values = {};
    const sources = {};
    for (const key of guideKeys) {
      const sourceKey = `${key.replace(/T$/, '')}Source`;
      values[key] = Number.isFinite(+guides[key]) ? clamp(+guides[key], 0, 1) : null;
      sources[key] = validSource(guides[sourceKey]) ? guides[sourceKey] : fallbackSources[key];
      if (!validSource(sources[key])) {
        values[key] = null;
        sources[key] = null;
      }
    }
    for (let index = 1; index < guideKeys.length; index++) {
      const previous = values[guideKeys[index - 1]];
      const current = values[guideKeys[index]];
      if (Number.isFinite(previous) && Number.isFinite(current) && current <= previous) {
        values[guideKeys[index]] = null;
        sources[guideKeys[index]] = null;
      }
    }
    const oldRoofValue = values.roofBottomT;
    const oldSeatValue = values.seatTopT;
    guides.suggestedRoofTopT = Number.isFinite(guides.suggestedRoofTopT)
      ? clamp(guides.suggestedRoofTopT, 0, 1)
      : .02;
    guides.suggestedRoofBottomT = Number.isFinite(guides.suggestedRoofBottomT)
      ? guides.suggestedRoofBottomT
      : oldRoofValue;
    guides.suggestedSeatTopT = Number.isFinite(guides.suggestedSeatTopT)
      ? guides.suggestedSeatTopT
      : oldSeatValue;
    guides.suggestedSeatBottomT = Number.isFinite(guides.suggestedSeatBottomT)
      ? clamp(guides.suggestedSeatBottomT, 0, 1)
      : .98;
    for (const key of guideKeys) {
      const sourceKey = `${key.replace(/T$/, '')}Source`;
      guides[key] = values[key];
      guides[sourceKey] = sources[key];
    }
    const resolvedSources = guideKeys.map(key => sources[key]).filter(Boolean);
    guides.source = resolvedSources.length === 4
      ? resolvedSources.every(source => source === 'manual')
        ? 'manual'
        : resolvedSources.every(source => source === 'auto')
          ? 'auto'
          : 'mixed'
      : resolvedSources.length
        ? resolvedSources.includes('manual') ? 'manual-partial' : 'auto-partial'
        : 'unresolved';
    if (!resolvedSources.length) guides.confidence = 0;
    if (guides.seatTrend) {
      const trend = guides.seatTrend;
      if (![trend.leftT, trend.rightT, trend.angleDeg].every(Number.isFinite)) {
        guides.seatTrend = null;
      } else {
        trend.leftT = clamp(trend.leftT, 0, 1);
        trend.rightT = clamp(trend.rightT, 0, 1);
        trend.meanU = Number.isFinite(trend.meanU) ? clamp(trend.meanU, 0, 1) : .5;
        trend.meanT = Number.isFinite(trend.meanT)
          ? clamp(trend.meanT, 0, 1)
          : clamp((trend.leftT + trend.rightT) / 2, 0, 1);
        const path = Array.isArray(trend.path)
          ? trend.path
            .filter(point => Number.isFinite(point?.u) && Number.isFinite(point?.t))
            .map(point => ({ u: clamp(point.u, 0, 1), t: clamp(point.t, 0, 1) }))
            .sort((a, b) => a.u - b.u)
          : [];
        trend.path = path.length >= 3 ? path : null;
      }
    }
  }
  if (normalized.type === 'kastel') {
    normalized.overlays = {
      thirdsVisible: normalized.overlays?.thirdsVisible === true,
      structureVisible: normalized.overlays?.structureVisible === true
    };
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
