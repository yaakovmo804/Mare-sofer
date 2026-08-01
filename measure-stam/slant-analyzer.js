'use strict';

/*
 * Deterministic, dependency-free candidate detector for long downward STaM
 * stems. It deliberately does not guess whether a candidate belongs to a
 * dalet, he or tav; that remains a pending human classification.
 *
 * Browser: globalThis.MEDIDAOT_SLANT_ANALYZER
 * Node:    require('./slant-analyzer.js')
 */
(function exposeSlantAnalyzer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MEDIDAOT_SLANT_ANALYZER = api;
})(typeof globalThis === 'object' ? globalThis : this, function createSlantAnalyzer() {
  const VERSION = '1.0.0';
  const ALLOWED_LETTER_CLASSIFICATIONS = Object.freeze(['ד', 'ה', 'ת', 'exclude']);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function round(value, digits = 3) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }

  function median(values) {
    if (!values.length) return null;
    const ordered = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function signedVerticalAngle(rootPoint, tipPoint) {
    if (!rootPoint || !tipPoint) return 0;
    let value = Math.atan2(
      tipPoint.x - rootPoint.x,
      rootPoint.y - tipPoint.y
    ) * 180 / Math.PI;
    while (value > 90) value -= 180;
    while (value < -90) value += 180;
    return value;
  }

  function emptyResult(reason, imageWidth = 0, imageHeight = 0, roi = null, details = {}) {
    return {
      version: VERSION,
      image: { width: imageWidth, height: imageHeight },
      roi,
      polarity: 'dark-ink',
      threshold: null,
      strokeWidthPx: null,
      candidates: [],
      diagnostics: {
        reason,
        inkPixelCount: 0,
        orientedPixelCount: 0,
        componentCount: 0,
        ...details
      }
    };
  }

  function rasterDescriptor(input) {
    if (!input || typeof input !== 'object') return null;
    const width = Math.trunc(finiteNumber(input.width, 0));
    const height = Math.trunc(finiteNumber(input.height, 0));
    if (width <= 0 || height <= 0) return null;

    let data = input.data;
    let format = typeof input.format === 'string' ? input.format.toLowerCase() : null;
    if (input.binary != null) {
      data = input.binary;
      format = 'binary';
    } else if (input.gray != null || input.grayscale != null) {
      data = input.gray ?? input.grayscale;
      format = 'gray';
    }
    if (!data || typeof data.length !== 'number') return null;

    const pixels = width * height;
    if (!format) {
      if (data.length >= pixels * 4) format = 'rgba';
      else if (data.length >= pixels) format = 'gray';
    }
    if (format === 'rgba' && data.length < pixels * 4) return null;
    if ((format === 'gray' || format === 'binary') && data.length < pixels) return null;
    if (!['rgba', 'gray', 'binary'].includes(format)) return null;
    return { width, height, data, format };
  }

  function normalizeRoi(rawRoi, width, height) {
    const source = rawRoi && typeof rawRoi === 'object'
      ? rawRoi
      : { x: 0, y: 0, width, height };
    const rawX = finiteNumber(source.x ?? source.left, 0);
    const rawY = finiteNumber(source.y ?? source.top, 0);
    const rawWidth = finiteNumber(
      source.width,
      finiteNumber(source.right, rawX) - rawX
    );
    const rawHeight = finiteNumber(
      source.height,
      finiteNumber(source.bottom, rawY) - rawY
    );
    if (!(rawWidth > 0) || !(rawHeight > 0)) return null;

    const left = clamp(Math.floor(rawX), 0, width);
    const top = clamp(Math.floor(rawY), 0, height);
    const right = clamp(Math.ceil(rawX + rawWidth), 0, width);
    const bottom = clamp(Math.ceil(rawY + rawHeight), 0, height);
    if (right <= left || bottom <= top) return null;
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      left,
      top,
      right,
      bottom
    };
  }

  function sampleGray(raster, sourceIndex) {
    if (raster.format === 'gray') return clamp(Number(raster.data[sourceIndex]) || 0, 0, 255);
    const offset = sourceIndex * 4;
    const red = Number(raster.data[offset]) || 0;
    const green = Number(raster.data[offset + 1]) || 0;
    const blue = Number(raster.data[offset + 2]) || 0;
    const alpha = raster.data[offset + 3] == null ? 255 : clamp(Number(raster.data[offset + 3]) || 0, 0, 255);
    const luminance = .2126 * red + .7152 * green + .0722 * blue;
    return 255 - (255 - luminance) * (alpha / 255);
  }

  function otsuThreshold(gray, minimum, maximum) {
    if (!gray.length || maximum <= minimum) return null;
    const histogram = new Uint32Array(256);
    let totalValue = 0;
    for (let index = 0; index < gray.length; index++) {
      const value = clamp(Math.round(gray[index]), 0, 255);
      histogram[value]++;
      totalValue += value;
    }

    let backgroundWeight = 0;
    let backgroundValue = 0;
    let bestVariance = -1;
    let bestThreshold = minimum;
    for (let threshold = minimum; threshold < maximum; threshold++) {
      backgroundWeight += histogram[threshold];
      if (!backgroundWeight) continue;
      const foregroundWeight = gray.length - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundValue += threshold * histogram[threshold];
      const backgroundMean = backgroundValue / backgroundWeight;
      const foregroundMean = (totalValue - backgroundValue) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        bestThreshold = threshold;
      }
    }
    return bestThreshold;
  }

  function buildInkMask(raster, roi, options) {
    const size = roi.width * roi.height;
    if (raster.format === 'binary') {
      const mask = new Uint8Array(size);
      let inkPixelCount = 0;
      for (let localY = 0; localY < roi.height; localY++) {
        const sourceRow = (roi.y + localY) * raster.width + roi.x;
        const localRow = localY * roi.width;
        for (let localX = 0; localX < roi.width; localX++) {
          const ink = raster.data[sourceRow + localX] ? 1 : 0;
          mask[localRow + localX] = ink;
          inkPixelCount += ink;
        }
      }
      return { mask, threshold: null, minimum: 0, maximum: 1, inkPixelCount };
    }

    const gray = new Uint8Array(size);
    let minimum = 255;
    let maximum = 0;
    for (let localY = 0; localY < roi.height; localY++) {
      const sourceRow = (roi.y + localY) * raster.width + roi.x;
      const localRow = localY * roi.width;
      for (let localX = 0; localX < roi.width; localX++) {
        const value = clamp(Math.round(sampleGray(raster, sourceRow + localX)), 0, 255);
        gray[localRow + localX] = value;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
    const minimumContrast = Math.max(1, finiteNumber(options.minimumContrast, 12));
    if (maximum - minimum < minimumContrast) {
      return { mask: new Uint8Array(size), threshold: null, minimum, maximum, inkPixelCount: 0 };
    }
    const requestedThreshold = finiteNumber(options.threshold, null);
    const threshold = requestedThreshold == null
      ? otsuThreshold(gray, minimum, maximum)
      : clamp(requestedThreshold, 0, 255);
    const mask = new Uint8Array(size);
    let inkPixelCount = 0;
    for (let index = 0; index < size; index++) {
      const ink = gray[index] <= threshold ? 1 : 0;
      mask[index] = ink;
      inkPixelCount += ink;
    }
    return { mask, threshold, minimum, maximum, inkPixelCount };
  }

  function horizontalRunMap(mask, width, height) {
    const lengths = new Uint16Array(mask.length);
    const runs = [];
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let x = 0;
      while (x < width) {
        while (x < width && !mask[row + x]) x++;
        const start = x;
        while (x < width && mask[row + x]) x++;
        const length = x - start;
        if (!length) continue;
        runs.push(length);
        for (let column = start; column < x; column++) lengths[row + column] = length;
      }
    }
    return { lengths, runs };
  }

  function estimateStrokeWidth(runs, roiWidth, override) {
    const requested = finiteNumber(override, null);
    if (requested != null && requested > 0) return clamp(requested, 1, Math.max(1, roiWidth / 3));
    const upper = Math.max(3, roiWidth * .24);
    const useful = runs.filter(length => length >= 2 && length <= upper);
    const fallback = runs.filter(length => length <= Math.max(3, roiWidth * .4));
    const estimate = median(useful.length ? useful : fallback) || 1;
    return clamp(estimate, 1, Math.max(2, roiWidth / 8));
  }

  function buildOrientedMask(mask, runLengths, maximumRunLength) {
    const oriented = new Uint8Array(mask.length);
    let count = 0;
    for (let index = 0; index < mask.length; index++) {
      if (mask[index] && runLengths[index] <= maximumRunLength) {
        oriented[index] = 1;
        count++;
      }
    }
    return { mask: oriented, count };
  }

  function connectedComponents(mask, width, height) {
    const visited = new Uint8Array(mask.length);
    const queue = new Int32Array(mask.length);
    const components = [];
    const neighbors = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1], [1, 1]
    ];

    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      const rows = new Map();
      let area = 0;
      let left = width;
      let right = -1;
      let top = height;
      let bottom = -1;

      while (head < tail) {
        const index = queue[head++];
        const y = Math.floor(index / width);
        const x = index - y * width;
        area++;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        const row = rows.get(y) || { sumX: 0, count: 0, minimumX: width, maximumX: -1 };
        row.sumX += x;
        row.count++;
        row.minimumX = Math.min(row.minimumX, x);
        row.maximumX = Math.max(row.maximumX, x);
        rows.set(y, row);

        for (const [dx, dy] of neighbors) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
      components.push({ area, left, right, top, bottom, rows });
    }
    return components;
  }

  function roofSupportFor(component, originalMask, runLengths, width, height, strokeWidth, roofMinimumRun) {
    const startY = Math.max(0, Math.floor(component.top - strokeWidth * 2.5));
    const endY = Math.min(height - 1, Math.ceil(component.top + Math.max(1, strokeWidth * .5)));
    const startX = Math.max(0, Math.floor(component.left - strokeWidth * 2));
    const endX = Math.min(width - 1, Math.ceil(component.right + strokeWidth * 2));
    let best = null;
    for (let y = startY; y <= endY; y++) {
      const row = y * width;
      for (let x = startX; x <= endX; x++) {
        const runLength = originalMask[row + x] ? runLengths[row + x] : 0;
        if (runLength < roofMinimumRun) continue;
        const distanceFromRoot = Math.abs(component.top - y);
        if (!best || runLength > best.runLength || (runLength === best.runLength && distanceFromRoot < best.distancePx)) {
          best = { y, runLength, distancePx: distanceFromRoot };
        }
      }
    }
    return best;
  }

  function fitComponent(component) {
    const rowEntries = [...component.rows.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([y, row]) => ({ y, x: row.sumX / row.count, width: row.maximumX - row.minimumX + 1 }));
    if (rowEntries.length < 2) return null;
    const meanY = rowEntries.reduce((sum, row) => sum + row.y, 0) / rowEntries.length;
    const meanX = rowEntries.reduce((sum, row) => sum + row.x, 0) / rowEntries.length;
    let covariance = 0;
    let varianceY = 0;
    for (const row of rowEntries) {
      covariance += (row.y - meanY) * (row.x - meanX);
      varianceY += (row.y - meanY) ** 2;
    }
    const slope = varianceY > 0 ? covariance / varianceY : 0;
    const intercept = meanX - slope * meanY;
    let residualSquared = 0;
    for (const row of rowEntries) residualSquared += (row.x - (intercept + slope * row.y)) ** 2;
    const residualRms = Math.sqrt(residualSquared / rowEntries.length);
    const root = { x: intercept + slope * component.top, y: component.top };
    const tip = { x: intercept + slope * component.bottom, y: component.bottom };
    return {
      rows: rowEntries,
      slope,
      residualRms,
      medianRowWidth: median(rowEntries.map(row => row.width)) || 1,
      root,
      tip
    };
  }

  function coordinatePoint(localPoint, roi) {
    const roiPoint = { x: round(localPoint.x), y: round(localPoint.y) };
    const sourcePoint = { x: round(roi.x + localPoint.x), y: round(roi.y + localPoint.y) };
    return { roi: roiPoint, source: sourcePoint };
  }

  function coordinateBounds(component, roi) {
    const local = {
      x: component.left,
      y: component.top,
      width: component.right - component.left + 1,
      height: component.bottom - component.top + 1,
      left: component.left,
      top: component.top,
      right: component.right,
      bottom: component.bottom
    };
    return {
      roi: local,
      source: {
        x: roi.x + local.x,
        y: roi.y + local.y,
        width: local.width,
        height: local.height,
        left: roi.x + local.left,
        top: roi.y + local.top,
        right: roi.x + local.right,
        bottom: roi.y + local.bottom
      }
    };
  }

  function confidenceFor(component, fit, metrics) {
    const lengthScore = clamp(component.height / Math.max(1, metrics.minimumStemLength * 1.8), 0, 1);
    const coverageScore = clamp(component.rowCoverage, 0, 1);
    const residualScore = clamp(1 - fit.residualRms / Math.max(1, metrics.strokeWidth * 1.5), 0, 1);
    const widthScore = clamp(1 - Math.max(0, fit.medianRowWidth - metrics.strokeWidth * 1.8) / Math.max(1, metrics.strokeWidth * 2), 0, 1);
    const roofScore = component.roofSupport ? 1 : metrics.requireRoof ? 0 : .55;
    return clamp(
      .25 * lengthScore +
      .24 * coverageScore +
      .24 * residualScore +
      .12 * widthScore +
      .15 * roofScore,
      0,
      1
    );
  }

  function candidateFromComponent(component, context) {
    const fit = fitComponent(component);
    if (!fit) return null;
    const height = component.bottom - component.top + 1;
    const width = component.right - component.left + 1;
    const rowCoverage = fit.rows.length / Math.max(1, height);
    component.height = height;
    component.width = width;
    component.rowCoverage = rowCoverage;
    if (height < context.minimumStemLength) return null;
    if (rowCoverage < context.minimumRowCoverage) return null;
    if (component.area < context.minimumArea) return null;
    if (width > height * context.maximumWidthToHeight + context.strokeWidth) return null;
    const angle = signedVerticalAngle(fit.root, fit.tip);
    if (Math.abs(angle) > context.maximumAngleDeg) return null;

    const roofSupport = roofSupportFor(
      component,
      context.originalMask,
      context.runLengths,
      context.roi.width,
      context.roi.height,
      context.strokeWidth,
      context.roofMinimumRun
    );
    component.roofSupport = roofSupport;
    if (context.requireRoof && !roofSupport) return null;

    const confidence = confidenceFor(component, fit, context);
    if (confidence < context.minimumConfidence) return null;
    const root = coordinatePoint(fit.root, context.roi);
    const tip = coordinatePoint(fit.tip, context.roi);
    const bounds = coordinateBounds(component, context.roi);
    const signedAngle = round(angle, 4);
    return {
      id: null,
      root: root.source,
      tip: tip.source,
      roiRoot: root.roi,
      roiTip: tip.roi,
      endpoints: { root, tip, topRoot: root, bottomTip: tip },
      signedAngleDeg: signedAngle,
      signedVerticalAngleDeg: signedAngle,
      angleConvention: 'signed-deviation-from-vertical',
      confidence: round(confidence, 4),
      bounds,
      strokeWidthPx: round(fit.medianRowWidth, 3),
      lengthPx: round(Math.hypot(fit.tip.x - fit.root.x, fit.tip.y - fit.root.y), 3),
      rowCoverage: round(rowCoverage, 4),
      roofSupport: roofSupport
        ? {
            found: true,
            sourceY: context.roi.y + roofSupport.y,
            roiY: roofSupport.y,
            horizontalRunPx: roofSupport.runLength,
            distanceFromRootPx: round(roofSupport.distancePx, 3)
          }
        : { found: false },
      letterClassification: {
        status: 'pending',
        letter: null,
        allowed: ALLOWED_LETTER_CLASSIFICATIONS.slice()
      }
    };
  }

  function stableCandidateId(candidate) {
    const bounds = candidate.bounds.source;
    const rootX = Math.round(candidate.root.x * 10);
    const tipX = Math.round(candidate.tip.x * 10);
    return `stem-${bounds.left}-${bounds.top}-${bounds.right}-${bounds.bottom}-${rootX}-${tipX}`;
  }

  function analyze(input, rawRoi = null, rawOptions = {}) {
    const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
    const raster = rasterDescriptor(input);
    if (!raster) return emptyResult('invalid-raster');
    const roi = normalizeRoi(rawRoi, raster.width, raster.height);
    if (!roi) return emptyResult('empty-roi', raster.width, raster.height);

    const ink = buildInkMask(raster, roi, options);
    if (!ink.inkPixelCount) {
      const reason = ink.maximum != null && ink.minimum != null && ink.maximum - ink.minimum < Math.max(1, finiteNumber(options.minimumContrast, 12))
        ? 'insufficient-contrast'
        : 'no-ink';
      return {
        ...emptyResult(reason, raster.width, raster.height, roi, {
          grayMinimum: ink.minimum,
          grayMaximum: ink.maximum
        }),
        threshold: ink.threshold
      };
    }

    const runs = horizontalRunMap(ink.mask, roi.width, roi.height);
    const strokeWidth = estimateStrokeWidth(runs.runs, roi.width, options.strokeWidthPx);
    const maximumOrientedRun = Math.max(2, finiteNumber(options.maximumOrientedRunPx, strokeWidth * 2.35));
    const oriented = buildOrientedMask(ink.mask, runs.lengths, maximumOrientedRun);
    if (!oriented.count) {
      return {
        ...emptyResult('no-vertical-ink', raster.width, raster.height, roi, {
          inkPixelCount: ink.inkPixelCount,
          grayMinimum: ink.minimum,
          grayMaximum: ink.maximum
        }),
        threshold: ink.threshold,
        strokeWidthPx: round(strokeWidth, 3)
      };
    }

    const minimumStemLength = Math.max(
      6,
      finiteNumber(options.minimumStemLengthPx, Math.max(strokeWidth * 4.5, roi.height * .18))
    );
    const context = {
      roi,
      originalMask: ink.mask,
      runLengths: runs.lengths,
      strokeWidth,
      minimumStemLength,
      minimumArea: Math.max(4, finiteNumber(options.minimumAreaPx, minimumStemLength * Math.max(1, strokeWidth) * .34)),
      minimumRowCoverage: clamp(finiteNumber(options.minimumRowCoverage, .68), 0, 1),
      maximumWidthToHeight: clamp(finiteNumber(options.maximumWidthToHeight, .5), .05, 1),
      maximumAngleDeg: clamp(finiteNumber(options.maximumAngleDeg, 38), 1, 89),
      minimumConfidence: clamp(finiteNumber(options.minimumConfidence, .42), 0, 1),
      requireRoof: options.requireRoof !== false,
      roofMinimumRun: Math.max(
        4,
        finiteNumber(
          options.roofMinimumRunPx,
          Math.max(strokeWidth * 3.2, Math.min(roi.width * .08, strokeWidth * 12))
        )
      )
    };
    const components = connectedComponents(oriented.mask, roi.width, roi.height);
    const candidates = components
      .map(component => candidateFromComponent(component, context))
      .filter(Boolean)
      .sort((a, b) => a.root.x - b.root.x || a.root.y - b.root.y || a.tip.x - b.tip.x);
    const usedIds = new Map();
    for (const candidate of candidates) {
      const base = stableCandidateId(candidate);
      const occurrence = usedIds.get(base) || 0;
      usedIds.set(base, occurrence + 1);
      candidate.id = occurrence ? `${base}-${occurrence + 1}` : base;
    }

    return {
      version: VERSION,
      image: { width: raster.width, height: raster.height },
      roi,
      polarity: 'dark-ink',
      threshold: ink.threshold,
      strokeWidthPx: round(strokeWidth, 3),
      candidates,
      diagnostics: {
        reason: candidates.length ? 'ok' : 'no-candidates',
        inkPixelCount: ink.inkPixelCount,
        orientedPixelCount: oriented.count,
        componentCount: components.length,
        grayMinimum: ink.minimum,
        grayMaximum: ink.maximum,
        minimumStemLengthPx: round(minimumStemLength, 3),
        maximumOrientedRunPx: round(maximumOrientedRun, 3),
        roofMinimumRunPx: round(context.roofMinimumRun, 3)
      }
    };
  }

  return Object.freeze({
    version: VERSION,
    analyze,
    signedVerticalAngle,
    allowedLetterClassifications: ALLOWED_LETTER_CLASSIFICATIONS
  });
});
