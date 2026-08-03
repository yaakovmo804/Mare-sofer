(function installMedidaotAutoMeasure(global) {
  'use strict';

  const ENGINE_VERSION = 'local-roof-row-cv-v2';
  const NIB_ROLE = 'medidaot-auto-roof-nib-v1';
  const GAP_ROLE = 'medidaot-auto-interline-gap-v1';
  const OWN_ROLES = Object.freeze([NIB_ROLE, GAP_ROLE]);
  const DEFAULT_MAX_DIMENSION = 1400;
  let analysisRunToken = 0;
  let preparedRasterCache = {
    source: null,
    signature: null,
    prepared: null
  };

  function finite(value) {
    return Number.isFinite(+value) ? +value : null;
  }

  function bound(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile(values, fraction) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const position = bound(fraction, 0, 1) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const blend = position - lower;
    return sorted[lower] * (1 - blend) + sorted[upper] * blend;
  }

  function mad(values, center = median(values)) {
    return Number.isFinite(center)
      ? median(values.map(value => Math.abs(value - center)))
      : null;
  }

  function pointDistance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function uniqueId(prefix) {
    if (typeof global.crypto?.randomUUID === 'function') return global.crypto.randomUUID();
    uniqueId.sequence = (uniqueId.sequence || 0) + 1;
    return `${prefix}_${Date.now().toString(36)}_${uniqueId.sequence.toString(36)}`;
  }

  function sourceSize(source) {
    return {
      width: Math.round(
        finite(source?.naturalWidth) ||
        finite(source?.videoWidth) ||
        finite(source?.width) ||
        0
      ),
      height: Math.round(
        finite(source?.naturalHeight) ||
        finite(source?.videoHeight) ||
        finite(source?.height) ||
        0
      )
    };
  }

  function rgbaGray(data, width, height, targetWidth, targetHeight) {
    const gray = new Uint8Array(targetWidth * targetHeight);
    for (let y = 0; y < targetHeight; y++) {
      const sourceY = Math.min(height - 1, Math.floor((y + .5) * height / targetHeight));
      for (let x = 0; x < targetWidth; x++) {
        const sourceX = Math.min(width - 1, Math.floor((x + .5) * width / targetWidth));
        const sourceIndex = (sourceY * width + sourceX) * 4;
        const alpha = (data[sourceIndex + 3] ?? 255) / 255;
        gray[y * targetWidth + x] = Math.round(
          (
            .2126 * data[sourceIndex] +
            .7152 * data[sourceIndex + 1] +
            .0722 * data[sourceIndex + 2]
          ) * alpha +
          255 * (1 - alpha)
        );
      }
    }
    return gray;
  }

  function rasterize(source, options = {}) {
    if (source?.gray instanceof Uint8Array && finite(source.width) && finite(source.height)) {
      const width = Math.round(source.width);
      const height = Math.round(source.height);
      return {
        width,
        height,
        sourceWidth: finite(source.sourceWidth) || width,
        sourceHeight: finite(source.sourceHeight) || height,
        scaleX: (finite(source.sourceWidth) || width) / width,
        scaleY: (finite(source.sourceHeight) || height) / height,
        gray: source.gray.slice()
      };
    }

    const { width: sourceWidth, height: sourceHeight } = sourceSize(source);
    if (sourceWidth < 8 || sourceHeight < 8) throw new Error('No usable loaded image');
    const maximum = Math.max(320, finite(options.maxDimension) || DEFAULT_MAX_DIMENSION);
    const factor = Math.min(1, maximum / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(8, Math.round(sourceWidth * factor));
    const height = Math.max(8, Math.round(sourceHeight * factor));
    let gray;

    if (source?.data && source.data.length >= sourceWidth * sourceHeight * 4) {
      gray = rgbaGray(source.data, sourceWidth, sourceHeight, width, height);
    } else {
      if (typeof document === 'undefined') {
        throw new Error('Canvas is required for this image source');
      }
      const raster = document.createElement('canvas');
      raster.width = width;
      raster.height = height;
      const context = raster.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas 2D is unavailable');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      gray = rgbaGray(pixels, width, height, width, height);
    }

    return {
      width,
      height,
      sourceWidth,
      sourceHeight,
      scaleX: sourceWidth / width,
      scaleY: sourceHeight / height,
      gray
    };
  }

  function otsuThreshold(histogram, total) {
    let weightedTotal = 0;
    for (let value = 0; value < 256; value++) weightedTotal += value * histogram[value];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let bestThreshold = 128;
    for (let value = 0; value < 256; value++) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight *
        (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        bestThreshold = value;
      }
    }
    return bestThreshold;
  }

  function integralImage(values, width, height) {
    const stride = width + 1;
    const integral = new Float64Array(stride * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        rowSum += values[y * width + x];
        integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
      }
    }
    return integral;
  }

  function rectangleMean(integral, width, height, x, y, radius) {
    const stride = width + 1;
    const x0 = Math.max(0, x - radius);
    const y0 = Math.max(0, y - radius);
    const x1 = Math.min(width - 1, x + radius);
    const y1 = Math.min(height - 1, y + radius);
    const sum =
      integral[(y1 + 1) * stride + x1 + 1] -
      integral[y0 * stride + x1 + 1] -
      integral[(y1 + 1) * stride + x0] +
      integral[y0 * stride + x0];
    return sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
  }

  function bridgeAndClean(binary, width, height) {
    const bridged = binary.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (binary[index]) continue;
        const horizontal = binary[index - 1] && binary[index + 1];
        const vertical = binary[index - width] && binary[index + width];
        if (horizontal || vertical) bridged[index] = 1;
      }
    }
    const cleaned = bridged.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (!bridged[index]) continue;
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx || dy) neighbors += bridged[(y + dy) * width + x + dx];
          }
        }
        if (neighbors < 2) cleaned[index] = 0;
      }
    }
    return cleaned;
  }

  function prepareRaster(source, options = {}) {
    const raster = options.prepared?.gray ? options.prepared : rasterize(source, options);
    if (raster.binary && raster.threshold != null) return raster;
    const { gray, width, height } = raster;
    const histogram = new Uint32Array(256);
    for (const value of gray) histogram[value]++;
    const otsu = otsuThreshold(histogram, gray.length);
    const integral = integralImage(gray, width, height);
    const radius = bound(
      Math.round(Math.max(width, height) * .026),
      14,
      56
    );
    const globalStrong = bound(otsu - 8, 28, 185);
    const globalLimit = bound(otsu + 16, 55, 225);
    const localContrast = bound(finite(options.localContrast) || 7, 4, 18);
    const binary = new Uint8Array(gray.length);
    let inkCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const value = gray[index];
        const localMean = rectangleMean(integral, width, height, x, y, radius);
        const locallyDark = value <= globalLimit && value <= localMean - localContrast;
        const stronglyDark = value <= globalStrong;
        if (locallyDark || stronglyDark) {
          binary[index] = 1;
          inkCount++;
        }
      }
    }
    if (inkCount < Math.max(30, gray.length * .00025)) {
      throw new Error('Insufficient ink for automatic measurement');
    }
    return {
      ...raster,
      binary: bridgeAndClean(binary, width, height),
      threshold: {
        method: 'local-mean-plus-otsu',
        otsu,
        globalStrong,
        globalLimit,
        localContrast,
        radius
      }
    };
  }

  function prepareRasterForRun(source, options = {}) {
    if (options.prepared?.gray) return prepareRaster(source, options);
    const cacheable = source && typeof source === 'object' && source === appState()?.image;
    const signature = JSON.stringify({
      maxDimension: finite(options.maxDimension) || DEFAULT_MAX_DIMENSION,
      localContrast: finite(options.localContrast) || 7
    });
    if (
      cacheable &&
      preparedRasterCache.source === source &&
      preparedRasterCache.signature === signature &&
      preparedRasterCache.prepared
    ) {
      return preparedRasterCache.prepared;
    }
    const prepared = prepareRaster(source, options);
    if (cacheable) {
      preparedRasterCache = { source, signature, prepared };
    }
    return prepared;
  }

  function rowRuns(binary, width, y, minimumLength = 1) {
    const runs = [];
    let x = 0;
    while (x < width) {
      while (x < width && !binary[y * width + x]) x++;
      if (x >= width) break;
      const start = x;
      while (x < width && binary[y * width + x]) x++;
      if (x - start >= minimumLength) {
        runs.push({ y, x0: start, x1: x - 1, length: x - start });
      }
    }
    return runs;
  }

  function overlapLength(first, second) {
    return Math.max(0, Math.min(first.x1, second.x1) - Math.max(first.x0, second.x0) + 1);
  }

  function trackLongHorizontalRuns(prepared, options = {}) {
    const { binary, width, height } = prepared;
    const minimumLength = Math.max(
      12,
      Math.ceil(width * (finite(options.minimumRoofWidthFraction) || .014))
    );
    const active = [];
    const finished = [];
    for (let y = 0; y < height; y++) {
      const runs = rowRuns(binary, width, y, minimumLength);
      const used = new Set();
      for (const run of runs) {
        let bestIndex = -1;
        let bestScore = -Infinity;
        for (let index = 0; index < active.length; index++) {
          if (used.has(index) || y - active[index].lastY > 2) continue;
          const previous = active[index].runs[active[index].runs.length - 1];
          const overlap = overlapLength(run, previous);
          const ratio = overlap / Math.max(1, Math.min(run.length, previous.length));
          const widthRatio =
            Math.min(run.length, previous.length) /
            Math.max(run.length, previous.length);
          const centerShift = Math.abs(
            (run.x0 + run.x1) / 2 - (previous.x0 + previous.x1) / 2
          );
          if (widthRatio < .42 || (ratio < .32 && centerShift > 3)) continue;
          const score = ratio * 10 - centerShift / Math.max(run.length, previous.length);
          if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
          }
        }
        if (bestIndex >= 0) {
          active[bestIndex].runs.push(run);
          active[bestIndex].lastY = y;
          used.add(bestIndex);
        } else {
          active.push({ runs: [run], firstY: y, lastY: y });
          used.add(active.length - 1);
        }
      }
      for (let index = active.length - 1; index >= 0; index--) {
        if (y - active[index].lastY > 2) finished.push(active.splice(index, 1)[0]);
      }
    }
    finished.push(...active);
    return { minimumLength, tracks: finished };
  }

  function verticalInkRun(binary, width, height, x, expectedY, searchRadius) {
    const y0 = bound(Math.round(expectedY - searchRadius), 0, height - 1);
    const y1 = bound(Math.round(expectedY + searchRadius), 0, height - 1);
    let best = null;
    let y = y0;
    while (y <= y1) {
      while (y <= y1 && !binary[y * width + x]) y++;
      if (y > y1) break;
      const start = y;
      while (y < height && binary[y * width + x]) y++;
      const end = y - 1;
      const contains = expectedY >= start - 1 && expectedY <= end + 1;
      const centerDistance = Math.abs((start + end) / 2 - expectedY);
      const score = (contains ? 1000 : 0) - centerDistance;
      if (!best || score > best.score) best = { start, end, score };
    }
    return best;
  }

  function roofSampleFromTrack(track, prepared) {
    const { binary, width, height, scaleX, scaleY } = prepared;
    if (track.runs.length < 2) return null;
    const widths = track.runs.map(run => run.length);
    const medianWidth = median(widths);
    const left = median(track.runs.map(run => run.x0));
    const right = median(track.runs.map(run => run.x1));
    const trackHeight = track.lastY - track.firstY + 1;
    if (!medianWidth || right - left < 8 || medianWidth < trackHeight * 2.4) return null;
    const centralStart = Math.ceil(left + (right - left) * .24);
    const centralEnd = Math.floor(left + (right - left) * .76);
    if (centralEnd <= centralStart) return null;
    const sampleCount = Math.min(45, centralEnd - centralStart + 1);
    const columns = [];
    for (let index = 0; index < sampleCount; index++) {
      const x = Math.round(
        centralStart + (centralEnd - centralStart) * (sampleCount === 1 ? .5 : index / (sampleCount - 1))
      );
      const coveringRows = track.runs
        .filter(run => x >= run.x0 && x <= run.x1)
        .map(run => run.y);
      const expectedY = median(coveringRows) ?? (track.firstY + track.lastY) / 2;
      const run = verticalInkRun(
        binary,
        width,
        height,
        bound(x, 0, width - 1),
        expectedY,
        Math.max(4, trackHeight * 1.5)
      );
      if (!run) continue;
      columns.push({
        x,
        top: run.start,
        bottom: run.end + 1,
        thickness: run.end - run.start + 1
      });
    }
    if (columns.length < Math.max(5, sampleCount * .35)) return null;
    const initialMedian = median(columns.map(column => column.thickness));
    const initialMad = mad(columns.map(column => column.thickness), initialMedian) || 0;
    const tolerance = Math.max(1.25, initialMedian * .16, initialMad * 3);
    const stable = columns.filter(column =>
      Math.abs(column.thickness - initialMedian) <= tolerance
    );
    if (stable.length < Math.max(5, columns.length * .55)) return null;
    const thicknessRasterPx = median(stable.map(column => column.thickness));
    if (!thicknessRasterPx || medianWidth / thicknessRasterPx < 3.1) return null;
    const dispersion = mad(stable.map(column => column.thickness), thicknessRasterPx) || 0;
    const representative = stable.reduce((best, column) =>
      Math.abs(column.thickness - thicknessRasterPx) <
      Math.abs(best.thickness - thicknessRasterPx)
        ? column
        : best
    );
    const valuePx = thicknessRasterPx * scaleY;
    const points = [
      { x: (representative.x + .5) * scaleX, y: representative.top * scaleY },
      { x: (representative.x + .5) * scaleX, y: representative.bottom * scaleY }
    ];
    const stability = stable.length / columns.length;
    const aspect = medianWidth / thicknessRasterPx;
    const confidence = bound(
      .22 +
      Math.min(.24, stability * .24) +
      Math.min(.24, Math.log2(Math.max(1, aspect)) * .075) +
      Math.max(0, .25 * (1 - dispersion / Math.max(1, thicknessRasterPx * .18))),
      .12,
      .97
    );
    return {
      valuePx,
      points,
      confidence,
      raster: {
        x: representative.x,
        top: representative.top,
        bottom: representative.bottom,
        roofLeft: left,
        roofRight: right,
        roofTop: track.firstY,
        roofBottom: track.lastY
      },
      stats: {
        estimator: 'stable-central-roof-columns-median-v1',
        roofWidthPx: medianWidth * scaleX,
        roofAspect: aspect,
        sampledColumnCount: columns.length,
        stableColumnCount: stable.length,
        stableFraction: stability,
        medianRasterPx: thicknessRasterPx,
        madRasterPx: dispersion
      }
    };
  }

  function deduplicateRoofSamples(samples) {
    const ordered = [...samples].sort((a, b) => b.confidence - a.confidence);
    const kept = [];
    for (const candidate of ordered) {
      const box = candidate.raster;
      const duplicate = kept.some(existing => {
        const other = existing.raster;
        const horizontalOverlap = Math.max(
          0,
          Math.min(box.roofRight, other.roofRight) - Math.max(box.roofLeft, other.roofLeft)
        );
        const minimumWidth = Math.max(
          1,
          Math.min(box.roofRight - box.roofLeft, other.roofRight - other.roofLeft)
        );
        const verticalDistance = Math.abs(
          (box.roofTop + box.roofBottom) / 2 -
          (other.roofTop + other.roofBottom) / 2
        );
        return horizontalOverlap / minimumWidth > .55 &&
          verticalDistance <= Math.max(2, (box.roofBottom - box.roofTop + 1) * .55);
      });
      if (!duplicate) kept.push(candidate);
    }
    return kept.sort((a, b) =>
      a.raster.roofTop - b.raster.roofTop ||
      a.raster.roofLeft - b.raster.roofLeft
    );
  }

  function densestRelativeCluster(samples, tolerance = .10) {
    const valid = samples.filter(sample => finite(sample?.valuePx) > 0);
    if (!valid.length) {
      return {
        valuePx: null,
        accepted: [],
        rejected: [],
        madPx: null,
        confidence: 0
      };
    }
    const overallMedian = median(valid.map(sample => sample.valuePx));
    let best = null;
    valid.forEach((candidate, index) => {
      const members = valid.filter(sample =>
        Math.abs(sample.valuePx - candidate.valuePx) /
        Math.max(.0001, candidate.valuePx) <= tolerance + 1e-9
      );
      const center = median(members.map(sample => sample.valuePx));
      const spread = mad(members.map(sample => sample.valuePx), center) || 0;
      const confidenceSum = members.reduce((sum, sample) => sum + (sample.confidence || 0), 0);
      const proposal = {
        members,
        center,
        spread,
        confidenceSum,
        overallDistance: Math.abs(center - overallMedian) / Math.max(.0001, overallMedian),
        index
      };
      if (!best ||
          proposal.members.length > best.members.length ||
          (
            proposal.members.length === best.members.length &&
            proposal.confidenceSum > best.confidenceSum + 1e-9
          ) ||
          (
            proposal.members.length === best.members.length &&
            Math.abs(proposal.confidenceSum - best.confidenceSum) <= 1e-9 &&
            proposal.spread < best.spread - 1e-9
          ) ||
          (
            proposal.members.length === best.members.length &&
            Math.abs(proposal.confidenceSum - best.confidenceSum) <= 1e-9 &&
            Math.abs(proposal.spread - best.spread) <= 1e-9 &&
            proposal.overallDistance < best.overallDistance - 1e-9
          )) {
        best = proposal;
      }
    });
    let center = best.center;
    for (let pass = 0; pass < 2; pass++) {
      const members = valid.filter(sample =>
        Math.abs(sample.valuePx - center) / Math.max(.0001, center) <= tolerance + 1e-9
      );
      if (!members.length) break;
      center = median(members.map(sample => sample.valuePx));
    }
    const accepted = valid.filter(sample =>
      Math.abs(sample.valuePx - center) / Math.max(.0001, center) <= tolerance + 1e-9
    );
    const acceptedSet = new Set(accepted);
    const rejected = valid.filter(sample => !acceptedSet.has(sample));
    const acceptedMad = mad(accepted.map(sample => sample.valuePx), center) || 0;
    const countScore = Math.min(1, accepted.length / 6);
    const agreement = accepted.length / valid.length;
    const sampleConfidence = median(accepted.map(sample => sample.confidence)) || 0;
    const relativeSpread = acceptedMad / Math.max(.0001, center);
    const confidence = bound(
      .12 +
      .30 * countScore +
      .25 * agreement +
      .25 * sampleConfidence +
      .08 * Math.max(0, 1 - relativeSpread / tolerance),
      .08,
      .99
    );
    return {
      valuePx: center,
      accepted,
      rejected,
      madPx: acceptedMad,
      confidence,
      toleranceRelative: tolerance
    };
  }

  function analyzeNibPrepared(prepared, options = {}) {
    const tracked = trackLongHorizontalRuns(prepared, options);
    const samples = deduplicateRoofSamples(
      tracked.tracks
        .map(track => roofSampleFromTrack(track, prepared))
        .filter(Boolean)
    );
    const aggregation = densestRelativeCluster(samples, .10);
    if (!aggregation.valuePx || !aggregation.accepted.length) {
      throw new Error('No stable group of long horizontal roofs was detected');
    }
    const representative = aggregation.accepted.reduce((best, sample) => {
      const score = Math.abs(sample.valuePx - aggregation.valuePx) /
        Math.max(.0001, aggregation.valuePx) +
        (1 - sample.confidence) * .18;
      const bestScore = Math.abs(best.valuePx - aggregation.valuePx) /
        Math.max(.0001, aggregation.valuePx) +
        (1 - best.confidence) * .18;
      return score < bestScore ? sample : best;
    });
    const evidence = samples.map((sample, index) => ({
      index,
      accepted: aggregation.accepted.includes(sample),
      valuePx: sample.valuePx,
      points: sample.points.map(point => ({ ...point })),
      confidence: sample.confidence,
      stats: { ...sample.stats }
    }));
    return {
      engine: ENGINE_VERSION,
      kind: 'nib',
      valuePx: aggregation.valuePx,
      length: aggregation.valuePx,
      points: representative.points.map(point => ({ ...point })),
      evidence,
      samples: evidence,
      confidence: aggregation.confidence,
      threshold: { ...prepared.threshold },
      aggregation: {
        method: 'densest-relative-cluster-median',
        toleranceRelative: .10,
        valuePx: aggregation.valuePx,
        madPx: aggregation.madPx,
        acceptedCount: aggregation.accepted.length,
        rejectedCount: aggregation.rejected.length
      },
      geometry: {
        spaceId: 'image-px',
        sourceWidth: prepared.sourceWidth,
        sourceHeight: prepared.sourceHeight
      },
      diagnostics: {
        longRunMinimumRasterPx: tracked.minimumLength,
        candidateRoofCount: samples.length
      }
    };
  }

  function connectedInkComponents(binary, width, height, minimumArea) {
    const visited = new Uint8Array(binary.length);
    const queue = new Int32Array(binary.length);
    const components = [];
    for (let start = 0; start < binary.length; start++) {
      if (!binary[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      queue[tail++] = start;
      visited[start] = 1;
      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            const next = nextY * width + nextX;
            if (!binary[next] || visited[next]) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
      if (tail >= minimumArea) {
        components.push({
          area: tail,
          minX,
          maxX,
          minY,
          maxY,
          pixels: queue.slice(0, tail)
        });
      }
    }
    return components;
  }

  function removeTinyInk(binary, width, height, nibRasterPx) {
    const minimumArea = Math.max(3, Math.round(nibRasterPx * nibRasterPx * .055));
    const components = connectedInkComponents(binary, width, height, minimumArea);
    if (!components.length) return binary;
    const mask = new Uint8Array(binary.length);
    for (const component of components) {
      for (const index of component.pixels) mask[index] = 1;
    }
    return mask;
  }

  function boxSmooth(values, radius) {
    const output = new Float64Array(values.length);
    const prefix = new Float64Array(values.length + 1);
    for (let index = 0; index < values.length; index++) {
      prefix[index + 1] = prefix[index] + values[index];
    }
    for (let index = 0; index < values.length; index++) {
      const start = Math.max(0, index - radius);
      const end = Math.min(values.length - 1, index + radius);
      output[index] = (prefix[end + 1] - prefix[start]) / (end - start + 1);
    }
    return output;
  }

  function bridgeBooleanRuns(active, maximumGap) {
    const output = active.slice();
    let index = 0;
    while (index < output.length) {
      while (index < output.length && output[index]) index++;
      const start = index;
      while (index < output.length && !output[index]) index++;
      const end = index;
      if (start > 0 && end < output.length && end - start <= maximumGap) {
        for (let fill = start; fill < end; fill++) output[fill] = 1;
      }
    }
    return output;
  }

  function booleanBands(active, minimumHeight) {
    const bands = [];
    let y = 0;
    while (y < active.length) {
      while (y < active.length && !active[y]) y++;
      if (y >= active.length) break;
      const start = y;
      while (y < active.length && active[y]) y++;
      const end = y - 1;
      if (end - start + 1 >= minimumHeight) bands.push({ start, end });
    }
    return bands;
  }

  function bandWeight(profile, band) {
    let weight = 0;
    for (let y = band.start; y <= band.end; y++) weight += profile[y] || 0;
    return Math.max(1, weight);
  }

  function attachmentEvidence(binary, width, height, spans, nibRasterPx, direction) {
    // A narrow, real stem can occupy too few roof columns to survive a global
    // bottom quantile.  Measure only ink that is actually connected to each
    // horizontal track, and score its reach, mass, and breadth independently.
    const reaches = new Map();
    for (const span of spans) {
      const x0 = bound(Math.floor(span.left), 0, width - 1);
      const x1 = bound(Math.ceil(span.right), x0, width - 1);
      const top = bound(Math.floor(span.top), 0, height - 1);
      const bottom = bound(Math.ceil(span.bottom), top, height - 1);
      for (let x = x0; x <= x1; x++) {
        let touchesTrack = false;
        for (let y = top; y <= bottom; y++) {
          if (binary[y * width + x]) {
            touchesTrack = true;
            break;
          }
        }
        if (!touchesTrack) continue;
        let y = direction > 0 ? bottom + 1 : top - 1;
        let reach = 0;
        while (y >= 0 && y < height && binary[y * width + x]) {
          reach++;
          y += direction;
        }
        if (reach > (reaches.get(x) || 0)) reaches.set(x, reach);
      }
    }
    const positive = [...reaches.values()].filter(value => value > 0);
    const maximumReach = positive.length ? Math.max(...positive) : 0;
    const representativeReach = median(positive) || 0;
    const longTailColumnCount = positive.filter(value =>
      value >= representativeReach + nibRasterPx * 1.5
    ).length;
    const resolvedReach = longTailColumnCount >= Math.max(2, nibRasterPx * .75)
      ? maximumReach
      : representativeReach;
    const inkMass = positive.reduce((sum, value) => sum + value, 0);
    const attachedColumnCount = positive.length;
    const reachScore = Math.min(1, maximumReach / Math.max(1, nibRasterPx * 1.5));
    const massScore = Math.min(
      1,
      inkMass / Math.max(1, nibRasterPx * nibRasterPx * 1.5)
    );
    const breadthScore = Math.min(
      1,
      attachedColumnCount / Math.max(1, nibRasterPx * .75)
    );
    return {
      score: reachScore * Math.sqrt(massScore * breadthScore),
      maximumReachRasterPx: maximumReach,
      representativeReachRasterPx: representativeReach,
      resolvedReachRasterPx: resolvedReach,
      longTailColumnCount,
      inkMassRasterPx: inkMass,
      attachedColumnCount
    };
  }

  function horizontalTrackAnchors(prepared, nibRasterPx) {
    const tracked = trackLongHorizontalRuns(prepared);
    const samples = tracked.tracks
      .map(track => roofSampleFromTrack(track, prepared))
      .filter(Boolean)
      .map(sample => ({
        sample,
        center: (sample.raster.roofTop + sample.raster.roofBottom) / 2,
        weight: Math.max(1, sample.raster.roofRight - sample.raster.roofLeft + 1)
      }))
      .sort((a, b) => a.center - b.center);
    const groups = [];
    const mergeDistance = Math.max(1.5, nibRasterPx * .72);
    for (const item of samples) {
      const previous = groups[groups.length - 1];
      if (previous && Math.abs(item.center - previous.center) <= mergeDistance) {
        previous.items.push(item);
        const totalWeight = previous.weight + item.weight;
        previous.center = (
          previous.center * previous.weight + item.center * item.weight
        ) / totalWeight;
        previous.weight = totalWeight;
      } else {
        groups.push({ center: item.center, weight: item.weight, items: [item] });
      }
    }
    return groups.map((group, index) => {
      const spans = group.items.map(item => ({
        left: item.sample.raster.roofLeft,
        right: item.sample.raster.roofRight,
        top: item.sample.raster.roofTop,
        bottom: item.sample.raster.roofBottom
      }));
      const downward = attachmentEvidence(
        prepared.binary,
        prepared.width,
        prepared.height,
        spans,
        nibRasterPx,
        1
      );
      const upward = attachmentEvidence(
        prepared.binary,
        prepared.width,
        prepared.height,
        spans,
        nibRasterPx,
        -1
      );
      const roleDenominator = downward.score + upward.score + .15;
      return {
        index,
        center: group.center,
        start: Math.min(...spans.map(span => span.top)),
        end: Math.max(...spans.map(span => span.bottom)),
        spans,
        sampleCount: group.items.length,
        horizontalWeight: group.weight,
        downward,
        upward,
        roofness: downward.score / roleDenominator,
        seatness: upward.score / roleDenominator
      };
    });
  }

  function bandPhaseAnchors(bands) {
    return bands.map((band, index) => ({
      index,
      center: (band.start + band.end) / 2,
      start: band.start,
      end: band.end,
      spans: [],
      sampleCount: 0,
      horizontalWeight: band.end - band.start + 1,
      downward: { score: 0 },
      upward: { score: 0 },
      roofness: 0,
      seatness: 0
    }));
  }

  function periodLinks(anchors, pitch, nibRasterPx) {
    const tolerance = Math.max(nibRasterPx * .75, pitch * .045);
    const proposals = [];
    for (let first = 0; first < anchors.length; first++) {
      let best = null;
      for (let second = first + 1; second < anchors.length; second++) {
        const difference = anchors[second].center - anchors[first].center;
        const residual = Math.abs(difference - pitch);
        if (difference > pitch + tolerance) break;
        if (residual > tolerance) continue;
        const roleSimilarity = 1 - Math.min(
          1,
          Math.abs((anchors[first].roofness || 0) - (anchors[second].roofness || 0))
        );
        const weight = Math.exp(-((residual / Math.max(1e-6, tolerance)) ** 2)) *
          (.65 + .35 * roleSimilarity);
        const proposal = { first, second, difference, residual, weight };
        if (!best || proposal.residual < best.residual - 1e-9 || (
          Math.abs(proposal.residual - best.residual) <= 1e-9 &&
          proposal.weight > best.weight
        )) best = proposal;
      }
      if (best) proposals.push(best);
    }
    const byDestination = new Map();
    for (const proposal of proposals) {
      const existing = byDestination.get(proposal.second);
      if (!existing || proposal.residual < existing.residual - 1e-9 || (
        Math.abs(proposal.residual - existing.residual) <= 1e-9 &&
        proposal.weight > existing.weight
      )) byDestination.set(proposal.second, proposal);
    }
    return [...byDestination.values()].sort((a, b) => a.first - b.first);
  }

  function phaseChains(anchors, links) {
    const outgoing = new Map(links.map(link => [link.first, link]));
    const incoming = new Set(links.map(link => link.second));
    const chains = [];
    const visited = new Set();
    const starts = anchors.map((_, index) => index).filter(index => !incoming.has(index));
    for (const start of starts) {
      const nodes = [];
      const chainLinks = [];
      let current = start;
      while (!visited.has(current)) {
        visited.add(current);
        nodes.push(current);
        const link = outgoing.get(current);
        if (!link) break;
        chainLinks.push(link);
        current = link.second;
      }
      if (nodes.length > 1) chains.push({ nodes, links: chainLinks });
    }
    return chains;
  }

  function evaluatePhasePeriod(anchors, initialPitch, nibRasterPx) {
    let pitch = initialPitch;
    let links = [];
    for (let pass = 0; pass < 2; pass++) {
      links = periodLinks(anchors, pitch, nibRasterPx);
      const refined = median(links.map(link => link.difference));
      if (!refined) break;
      pitch = refined;
    }
    links = periodLinks(anchors, pitch, nibRasterPx);
    const chains = phaseChains(anchors, links);
    const longChains = chains.filter(chain => chain.nodes.length >= 3);
    const pairedChains = chains.filter(chain => chain.nodes.length >= 2);
    const bodyBackedChains = pairedChains.filter(chain => chain.nodes.every(index =>
      (anchors[index].downward?.score || 0) >= .42
    ));
    // Same-row roof/seat offsets create disconnected two-node pairs.  A text
    // line period instead creates a repeated same-phase chain; two-line crops
    // are admitted only when a second phase corroborates a body-backed chain.
    const eligible = longChains.length > 0 || (
      pairedChains.length >= 2 && bodyBackedChains.length > 0
    );
    const participatingNodes = new Set(
      longChains.flatMap(chain => chain.nodes)
    );
    const longLinks = longChains.flatMap(chain => chain.links);
    const consideredLinks = longLinks.length ? longLinks : links;
    const meanResidual = consideredLinks.length
      ? consideredLinks.reduce((sum, link) => sum + link.residual, 0) / consideredLinks.length
      : Infinity;
    const weight = consideredLinks.reduce((sum, link) => sum + link.weight, 0);
    const step = median(consideredLinks.map(link => link.second - link.first));
    return {
      pitch,
      eligible,
      links,
      chains,
      longChainCount: longChains.length,
      longNodeCount: participatingNodes.size,
      longEdgeCount: longLinks.length,
      pairedChainCount: pairedChains.length,
      bodyBackedChainCount: bodyBackedChains.length,
      maximumChainLength: chains.length
        ? Math.max(...chains.map(chain => chain.nodes.length))
        : 0,
      meanResidual,
      weight,
      step: Number.isFinite(step) ? Math.round(step) : null
    };
  }

  function phasePeriodIsBetter(candidate, best) {
    if (!best) return true;
    const candidateRank = [
      candidate.longNodeCount,
      candidate.longChainCount,
      candidate.longEdgeCount,
      candidate.bodyBackedChainCount,
      candidate.weight,
      -candidate.meanResidual,
      -candidate.pitch
    ];
    const bestRank = [
      best.longNodeCount,
      best.longChainCount,
      best.longEdgeCount,
      best.bodyBackedChainCount,
      best.weight,
      -best.meanResidual,
      -best.pitch
    ];
    for (let index = 0; index < candidateRank.length; index++) {
      if (candidateRank[index] > bestRank[index] + 1e-9) return true;
      if (candidateRank[index] < bestRank[index] - 1e-9) return false;
    }
    return false;
  }

  function estimatePhaseLinePitch(anchors, profile, nibRasterPx, height, method) {
    if (anchors.length < 2) return null;
    const minimumPitch = Math.max(nibRasterPx * 5.15, 8);
    const maximumPitch = Math.min(height * .72, nibRasterPx * 28);
    const candidates = [];
    for (let first = 0; first < anchors.length; first++) {
      for (let second = first + 1; second < anchors.length; second++) {
        const difference = anchors[second].center - anchors[first].center;
        if (difference >= minimumPitch && difference <= maximumPitch) {
          candidates.push(difference);
        }
      }
    }
    let best = null;
    for (const pitch of candidates) {
      const proposal = evaluatePhasePeriod(anchors, pitch, nibRasterPx);
      if (!proposal.eligible) continue;
      if (phasePeriodIsBetter(proposal, best)) best = proposal;
    }
    if (!best) return null;
    const lag = Math.round(best.pitch);
    let overlap = 0;
    let reference = 0;
    for (let y = 0; y + lag < profile.length; y++) {
      overlap += Math.min(profile[y], profile[y + lag]);
      reference += Math.sqrt(Math.max(0, profile[y] * profile[y + lag]));
    }
    return {
      pitch: best.pitch,
      score: best.weight,
      step: best.step,
      relativeSpread: best.meanResidual / Math.max(1, best.pitch),
      support: best.longEdgeCount || best.links.length,
      repeatedIntervalCount: best.longEdgeCount || best.links.length,
      correlation: reference ? overlap / reference : 0,
      method,
      phase: best,
      phaseAnchors: anchors
    };
  }

  function physicalLinesFromPhasePitch(pitchInfo) {
    const phase = pitchInfo?.phase;
    const anchors = pitchInfo?.phaseAnchors;
    if (!phase || !anchors?.length) return [];
    let candidates = phase.chains.filter(chain => chain.nodes.length >= 3);
    if (!candidates.length) {
      candidates = phase.chains.filter(chain =>
        chain.nodes.length >= 2 && chain.nodes.every(index =>
          (anchors[index]?.downward?.score || 0) >= .42
        )
      );
    }
    if (!candidates.length) return [];
    const ranked = candidates.map(chain => {
      const chainAnchors = chain.nodes.map(index => anchors[index]).filter(Boolean);
      const downward = chainAnchors.reduce(
        (sum, anchor) => sum + (anchor.downward?.score || 0),
        0
      ) / Math.max(1, chainAnchors.length);
      const roofness = chainAnchors.reduce(
        (sum, anchor) => sum + (anchor.roofness || 0),
        0
      ) / Math.max(1, chainAnchors.length);
      return {
        chain,
        anchors: chainAnchors,
        downward,
        roofness,
        first: chainAnchors[0]?.center ?? Infinity
      };
    }).sort((a, b) =>
      b.downward - a.downward ||
      b.roofness - a.roofness ||
      b.anchors.length - a.anchors.length ||
      a.first - b.first
    );
    return ranked[0].anchors.map(anchor => ({
      center: anchor.center,
      energy: anchor.horizontalWeight || 1,
      bands: [],
      anchor
    }));
  }

  function phaseLineWindows(lines, pitchInfo, nibRasterPx, height) {
    const anchors = pitchInfo?.phaseAnchors || [];
    if (!lines.length || !anchors.length) return [];
    const memberships = lines.map(line => ({
      line,
      anchors: [line.anchor].filter(Boolean)
    }));
    for (const anchor of anchors) {
      if (memberships.some(membership => membership.anchors.includes(anchor))) continue;
      let target = -1;
      for (let index = 0; index < lines.length; index++) {
        const next = lines[index + 1];
        const cutoff = next
          ? next.center - Math.min(nibRasterPx * .9, pitchInfo.pitch * .15)
          : Infinity;
        if (anchor.center >= lines[index].center - nibRasterPx * 1.2 &&
            anchor.center < cutoff) {
          target = index;
          break;
        }
      }
      if (target >= 0) memberships[target].anchors.push(anchor);
    }
    const extents = memberships.map(membership => ({
      top: Math.min(...membership.anchors.map(anchor => anchor.start)),
      bottom: Math.max(...membership.anchors.map(anchor => anchor.end))
    }));
    const boundaries = [];
    for (let index = 0; index < extents.length - 1; index++) {
      const upper = extents[index];
      const lower = extents[index + 1];
      boundaries.push(
        lines[index].center <= nibRasterPx * .5
          ? (lines[index].center + lines[index + 1].center) / 2
          : upper.bottom < lower.top
          ? (upper.bottom + lower.top) / 2
          : (lines[index].center + lines[index + 1].center) / 2
      );
    }
    return lines.map((line, index) => ({
      start: index ? boundaries[index - 1] : 0,
      end: index < boundaries.length ? boundaries[index] : height - 1,
      line
    }));
  }

  function estimatePhysicalLinePitch(bands, profile, nibRasterPx, height) {
    if (bands.length < 2) return null;
    const centers = bands.map(band => (band.start + band.end) / 2);
    const minimumPitch = Math.max(nibRasterPx * 5.15, 8);
    const maximumPitch = Math.min(height * .72, nibRasterPx * 28);
    let best = null;
    const maximumStep = Math.min(5, bands.length - 1);
    for (let step = 1; step <= maximumStep; step++) {
      const differences = [];
      for (let index = 0; index + step < centers.length; index++) {
        const difference = centers[index + step] - centers[index];
        if (difference > 0) differences.push(difference);
      }
      if (!differences.length) continue;
      const pitch = median(differences);
      if (pitch < minimumPitch || pitch > maximumPitch) continue;
      const lower = quantile(differences, .1);
      const upper = quantile(differences, .9);
      const relativeSpread = (upper - lower) / Math.max(1, pitch);
      const stability = 1 / (1 + relativeSpread * 8);
      const support = differences.length / step;
      const compactness = 1 / Math.sqrt(Math.max(1, pitch / minimumPitch));
      const score = support * stability * compactness;
      if (!best ||
          score > best.score + 1e-9 ||
          (Math.abs(score - best.score) <= 1e-9 && pitch < best.pitch)) {
        best = {
          pitch,
          score,
          step,
          relativeSpread,
          support,
          repeatedIntervalCount: differences.length
        };
      }
    }
    if (!best) return null;

    const lag = Math.round(best.pitch);
    let overlap = 0;
    let reference = 0;
    for (let y = 0; y + lag < profile.length; y++) {
      overlap += Math.min(profile[y], profile[y + lag]);
      reference += Math.sqrt(Math.max(0, profile[y] * profile[y + lag]));
    }
    best.correlation = reference ? overlap / reference : 0;
    if (best.repeatedIntervalCount < 2) return null;
    return best;
  }

  function lineEnergyCenters(bands, profile, pitchInfo, nibRasterPx) {
    if (!bands.length) return [];
    if (!pitchInfo?.pitch) {
      const groups = [];
      const mergeDistance = nibRasterPx * 4.75;
      const independentBodyHeight = nibRasterPx * 1.55;
      for (const band of bands) {
        const previous = groups[groups.length - 1];
        const bandHeight = band.end - band.start + 1;
        const previousHasBody = previous && previous.bands.some(previousBand =>
          previousBand.end - previousBand.start + 1 >= independentBodyHeight
        );
        const currentHasBody = bandHeight >= independentBodyHeight;
        if (
          previous &&
          band.start - previous.end <= mergeDistance &&
          !(previousHasBody && currentHasBody)
        ) {
          previous.bands.push(band);
          previous.end = band.end;
        } else {
          groups.push({ start: band.start, end: band.end, bands: [band] });
        }
      }
      return groups.map(group => {
        const weights = group.bands.map(band => bandWeight(profile, band));
        const total = weights.reduce((sum, value) => sum + value, 0);
        return {
          center: group.bands.reduce(
            (sum, band, index) => sum + ((band.start + band.end) / 2) * weights[index],
            0
          ) / total,
          bands: group.bands
        };
      });
    }

    const pitch = pitchInfo.pitch;
    const radius = bound(
      Math.round(Math.min(pitch * .405, nibRasterPx * 3.75)),
      Math.max(2, Math.round(nibRasterPx * 1.8)),
      Math.max(3, Math.round(pitch * .46))
    );
    const prefix = new Float64Array(profile.length + 1);
    for (let y = 0; y < profile.length; y++) prefix[y + 1] = prefix[y] + profile[y];
    const energy = new Float64Array(profile.length);
    const firstY = Math.max(0, bands[0].start - radius);
    const lastY = Math.min(profile.length - 1, bands[bands.length - 1].end + radius);
    let maximumEnergy = 0;
    for (let y = firstY; y <= lastY; y++) {
      const start = Math.max(0, y - radius);
      const end = Math.min(profile.length - 1, y + radius);
      energy[y] = prefix[end + 1] - prefix[start];
      maximumEnergy = Math.max(maximumEnergy, energy[y]);
    }
    const candidates = [];
    for (let y = firstY; y <= lastY; y++) {
      const previous = energy[Math.max(firstY, y - 1)];
      const next = energy[Math.min(lastY, y + 1)];
      if (energy[y] >= previous && energy[y] >= next && energy[y] >= maximumEnergy * .16) {
        candidates.push({ y, energy: energy[y] });
      }
    }
    candidates.sort((a, b) => b.energy - a.energy || a.y - b.y);
    const chosen = [];
    const minimumSeparation = pitch * .64;
    for (const candidate of candidates) {
      if (chosen.every(item => Math.abs(item.center - candidate.y) >= minimumSeparation)) {
        chosen.push({ center: candidate.y, energy: candidate.energy, bands: [] });
      }
    }
    chosen.sort((a, b) => a.center - b.center);

    for (const band of bands) {
      const center = (band.start + band.end) / 2;
      let closest = null;
      let closestDistance = Infinity;
      for (const line of chosen) {
        const currentDistance = Math.abs(line.center - center);
        if (currentDistance < closestDistance) {
          closestDistance = currentDistance;
          closest = line;
        }
      }
      if (closest && closestDistance <= pitch * .48) closest.bands.push(band);
    }
    const nonEmpty = chosen.filter(line => line.bands.length);
    for (const line of nonEmpty) {
      const weights = line.bands.map(band => bandWeight(profile, band));
      const total = weights.reduce((sum, value) => sum + value, 0);
      const weightedCenter = line.bands.reduce(
        (sum, band, index) => sum + ((band.start + band.end) / 2) * weights[index],
        0
      ) / total;
      line.center = (line.center + weightedCenter * 2) / 3;
    }
    return nonEmpty;
  }

  function boundaryForLineWindow(binary, width, height, window, nibRasterPx) {
    const topValues = [];
    const bottomValues = [];
    const occupiedX = [];
    const start = bound(Math.floor(window.start), 0, height - 1);
    const end = bound(Math.ceil(window.end), start, height - 1);
    for (let x = 0; x < width; x++) {
      let top = null;
      let bottom = null;
      for (let y = start; y <= end; y++) {
        if (!binary[y * width + x]) continue;
        if (top == null) top = y;
        bottom = y + 1;
      }
      if (top == null || bottom == null) continue;
      occupiedX.push(x);
      topValues.push(top);
      bottomValues.push(bottom);
    }
    if (occupiedX.length < Math.max(4, nibRasterPx)) return null;
    const roofTop = quantile(topValues, .30);
    const bottom = quantile(bottomValues, .86);
    const xMin = quantile(occupiedX, .03);
    const xMax = quantile(occupiedX, .97);
    if (!Number.isFinite(roofTop) || !Number.isFinite(bottom) || bottom <= roofTop) return null;
    const topMedian = median(topValues);
    const bottomMedian = median(bottomValues);
    const topMad = mad(topValues, topMedian) || 0;
    const bottomMad = mad(bottomValues, bottomMedian) || 0;
    const coverage = (xMax - xMin + 1) / width;
    const consistency = Math.max(
      0,
      1 - (topMad + bottomMad) / Math.max(1, nibRasterPx * 4.2)
    );
    const bodyHeight = bottom - roofTop;
    const bodyPlausibility = bodyHeight >= nibRasterPx * .75 && bodyHeight <= nibRasterPx * 9
      ? 1
      : .45;
    return {
      rasterTopY: roofTop,
      rasterRoofTopY: roofTop,
      rasterBottomY: bottom,
      rasterXMin: xMin,
      rasterXMax: xMax,
      rasterInkXMin: occupiedX[0],
      rasterInkXMax: occupiedX[occupiedX.length - 1],
      confidence: bound(
        (.24 + Math.min(.34, coverage * .88) + consistency * .31) * bodyPlausibility,
        .10,
        .96
      ),
      stats: {
        occupiedColumnCount: occupiedX.length,
        horizontalCoverage: coverage,
        topMadRasterPx: topMad,
        bottomMadRasterPx: bottomMad,
        robustBodyHeightRasterPx: bodyHeight,
        windowTopRasterPx: start,
        windowBottomRasterPx: end
      }
    };
  }

  function boundaryForBand(binary, width, height, band, nibRasterPx) {
    const margin = Math.max(1, Math.round(nibRasterPx * .65));
    const searchTop = Math.max(0, band.start - margin);
    const searchBottom = Math.min(height - 1, band.end + margin);
    const topValues = [];
    const bottomValues = [];
    const occupiedX = [];
    for (let x = 0; x < width; x++) {
      let intersectsCore = false;
      for (let y = band.start; y <= band.end; y++) {
        if (binary[y * width + x]) {
          intersectsCore = true;
          break;
        }
      }
      if (!intersectsCore) continue;
      let top = null;
      let bottom = null;
      for (let y = searchTop; y <= searchBottom; y++) {
        if (!binary[y * width + x]) continue;
        if (top == null) top = y;
        bottom = y + 1;
      }
      if (top == null || bottom == null) continue;
      occupiedX.push(x);
      topValues.push(top);
      bottomValues.push(bottom);
    }
    if (occupiedX.length < Math.max(4, nibRasterPx)) return null;
    const roofTop = quantile(topValues, .28);
    const bottom = quantile(bottomValues, .78);
    const xMin = quantile(occupiedX, .03);
    const xMax = quantile(occupiedX, .97);
    const topMad = mad(topValues, median(topValues)) || 0;
    const bottomMad = mad(bottomValues, median(bottomValues)) || 0;
    const coverage = (xMax - xMin + 1) / width;
    const consistency = Math.max(
      0,
      1 - (topMad + bottomMad) / Math.max(1, nibRasterPx * 3.5)
    );
    return {
      rasterTopY: roofTop,
      rasterRoofTopY: roofTop,
      rasterBottomY: bottom,
      rasterXMin: xMin,
      rasterXMax: xMax,
      rasterInkXMin: occupiedX[0],
      rasterInkXMax: occupiedX[occupiedX.length - 1],
      confidence: bound(.28 + Math.min(.35, coverage * .9) + consistency * .32, .12, .96),
      stats: {
        occupiedColumnCount: occupiedX.length,
        horizontalCoverage: coverage,
        topMadRasterPx: topMad,
        bottomMadRasterPx: bottomMad
      }
    };
  }

  function mergeOverlappingRows(rows, nibRasterPx) {
    if (!rows.length) return rows;
    const merged = [{ ...rows[0] }];
    for (let index = 1; index < rows.length; index++) {
      const previous = merged[merged.length - 1];
      const current = rows[index];
      const overlap = previous.rasterBottomY - current.rasterRoofTopY;
      if (overlap > nibRasterPx * .35) {
        const previousWeight = Math.max(1, previous.stats.occupiedColumnCount);
        const currentWeight = Math.max(1, current.stats.occupiedColumnCount);
        const totalWeight = previousWeight + currentWeight;
        previous.rasterTopY = Math.min(previous.rasterTopY, current.rasterTopY);
        previous.rasterRoofTopY =
          (previous.rasterRoofTopY * previousWeight + current.rasterRoofTopY * currentWeight) /
          totalWeight;
        previous.rasterBottomY = Math.max(previous.rasterBottomY, current.rasterBottomY);
        previous.rasterXMin = Math.min(previous.rasterXMin, current.rasterXMin);
        previous.rasterXMax = Math.max(previous.rasterXMax, current.rasterXMax);
        previous.rasterInkXMin = Math.min(
          previous.rasterInkXMin ?? previous.rasterXMin,
          current.rasterInkXMin ?? current.rasterXMin
        );
        previous.rasterInkXMax = Math.max(
          previous.rasterInkXMax ?? previous.rasterXMax,
          current.rasterInkXMax ?? current.rasterXMax
        );
        previous.confidence = Math.max(previous.confidence, current.confidence) * .92;
        previous.stats.occupiedColumnCount += current.stats.occupiedColumnCount;
      } else {
        merged.push({ ...current });
      }
    }
    return merged;
  }

  function detectRowBands(prepared, nibSourcePx, options = {}) {
    const { width, height, scaleY } = prepared;
    const nibRasterPx = Math.max(1.5, nibSourcePx / scaleY);
    const binary = removeTinyInk(prepared.binary, width, height, nibRasterPx);
    const profile = new Float64Array(height);
    const structural = new Uint8Array(height);
    const horizontalMinimum = Math.max(2, Math.round(nibRasterPx * 1.65));
    for (let y = 0; y < height; y++) {
      const runs = rowRuns(binary, width, y, 1);
      const ink = runs.reduce((sum, run) => sum + run.length, 0);
      const longInk = runs
        .filter(run => run.length >= horizontalMinimum)
        .reduce((sum, run) => sum + run.length, 0);
      profile[y] = ink + longInk * .35;
      structural[y] = (
        (runs.length >= 2 && ink >= nibRasterPx * 1.05) ||
        longInk >= horizontalMinimum
      ) ? 1 : 0;
    }
    const smoothRadius = Math.max(1, Math.round(nibRasterPx * .55));
    const smoothed = boxSmooth(profile, smoothRadius);
    const highReference = quantile([...smoothed], .94) || Math.max(...smoothed);
    const threshold = Math.max(
      nibRasterPx * (finite(options.rowSupportNibFactor) || 1.08),
      highReference * .115,
      width * .0025
    );
    let active = new Uint8Array(height);
    for (let y = 0; y < height; y++) {
      if (smoothed[y] >= threshold && (structural[y] || smoothed[y] >= threshold * 1.35)) {
        active[y] = 1;
      }
    }
    active = bridgeBooleanRuns(active, Math.max(1, Math.round(nibRasterPx * .75)));
    const minimumHeight = Math.max(2, Math.round(nibRasterPx * 1.12));
    const broadBands = booleanBands(active, minimumHeight);
    const cleanedPrepared = { ...prepared, binary };
    const trackAnchors = horizontalTrackAnchors(cleanedPrepared, nibRasterPx);
    const trackPitchInfo = estimatePhaseLinePitch(
      trackAnchors,
      profile,
      nibRasterPx,
      height,
      'horizontal-track-phase-chains'
    );
    const bandPitchInfo = estimatePhaseLinePitch(
      bandPhaseAnchors(broadBands),
      profile,
      nibRasterPx,
      height,
      'broad-band-phase-chains'
    );
    const profilePitchInfo = estimatePhysicalLinePitch(
      broadBands,
      profile,
      nibRasterPx,
      height
    );
    if (profilePitchInfo) profilePitchInfo.method = 'profile-differences';
    const pitchInfo = trackPitchInfo || bandPitchInfo || profilePitchInfo;
    const phasePhysicalLines = physicalLinesFromPhasePitch(pitchInfo);
    const physicalLines = phasePhysicalLines.length
      ? phasePhysicalLines
      : lineEnergyCenters(broadBands, profile, pitchInfo, nibRasterPx);
    const fallbackPitch = pitchInfo?.pitch || nibRasterPx * 7;
    const phaseWindows = phaseLineWindows(
      phasePhysicalLines,
      pitchInfo,
      nibRasterPx,
      height
    );
    const windows = phaseWindows.length
      ? phaseWindows
      : physicalLines.map((line, index) => {
        const previous = physicalLines[index - 1];
        const next = physicalLines[index + 1];
        const start = previous
          ? (previous.center + line.center) / 2
          : line.center - fallbackPitch * .49;
        const end = next
          ? (line.center + next.center) / 2
          : line.center + fallbackPitch * .49;
        return { start, end, line };
      });
    let rows = windows
      .map(window => boundaryForLineWindow(binary, width, height, window, nibRasterPx))
      .filter(Boolean)
      .sort((a, b) => a.rasterRoofTopY - b.rasterRoofTopY);
    rows = mergeOverlappingRows(rows, nibRasterPx);
    if (phasePhysicalLines.length) {
      const edgeMargin = Math.max(1, nibRasterPx * .35);
      rows = rows.filter(row =>
        row.rasterRoofTopY > edgeMargin &&
        row.rasterBottomY < height - edgeMargin
      );
    }
    const twoBandSingleInterval =
      !pitchInfo &&
      broadBands.length === 2 &&
      physicalLines.length === 2;
    const rowAnchorEvidence = rows.map(row => {
      const nearby = trackAnchors.filter(anchor =>
        Math.abs(anchor.center - row.rasterRoofTopY) <= nibRasterPx * 1.6
      );
      const score = nearby.length
        ? Math.max(...nearby.map(anchor => anchor.downward.score || 0))
        : 0;
      const bodyBottom = nearby
        .filter(anchor => (anchor.downward.score || 0) >= .42)
        .reduce((maximum, anchor) => Math.max(
          maximum,
          anchor.end + 1 + (anchor.downward.resolvedReachRasterPx || 0)
        ), row.rasterBottomY);
      return { score, bodyBottom };
    });
    const rowBodyEvidence = rowAnchorEvidence.map(evidence => evidence.score);
    rows.forEach((row, index) => {
      const componentBottom = rowAnchorEvidence[index].bodyBottom;
      if (
        row.stats.robustBodyHeightRasterPx < nibRasterPx * 1.55 &&
        componentBottom > row.rasterBottomY
      ) {
        row.rasterBottomY = Math.min(height, componentBottom);
        row.stats.componentBodyBottomRasterPx = row.rasterBottomY;
        row.stats.robustBodyHeightRasterPx = row.rasterBottomY - row.rasterRoofTopY;
      }
    });
    const independentBodyEvidenceCount = rowBodyEvidence.filter(score => score >= .42).length;
    // With no repeated period, two horizontal members are intrinsically
    // ambiguous unless each proposed row has its own connected downward body.
    // Preserve the candidate rows for diagnostics, but block automatic apply.
    const unperiodicMemberAmbiguity = !pitchInfo && trackAnchors.length >= 2 && (
      rows.length < 2 || independentBodyEvidenceCount < rows.length
    );
    const ambiguousTwoBandPair = twoBandSingleInterval && unperiodicMemberAmbiguity;
    const ambiguityReason = unperiodicMemberAmbiguity
      ? rows.length < 2
        ? 'unresolved-horizontal-members-in-one-row-window'
        : 'unresolved-horizontal-members-without-independent-downward-bodies'
      : null;
    return {
      binary,
      rows,
      nibRasterPx,
      profile: {
        smoothingRadius: smoothRadius,
        supportThreshold: threshold,
        detectedBandCount: broadBands.length,
        physicalLineCount: rows.length,
        estimatedLinePitchRasterPx: pitchInfo?.pitch || null,
        linePitchStep: pitchInfo?.step || null,
        linePitchCorrelation: pitchInfo?.correlation || null,
        linePitchMethod: pitchInfo?.method || null,
        horizontalTrackAnchorCount: trackAnchors.length,
        phaseMaximumChainLength: pitchInfo?.phase?.maximumChainLength || null,
        phaseLongChainCount: pitchInfo?.phase?.longChainCount || null,
        rowBodyEvidence,
        twoBandSingleInterval,
        independentBodyEvidenceCount,
        ambiguousTwoBandPair,
        ambiguityReason
      }
    };
  }

  function horizontalInkRunLength(binary, width, height, x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height || !binary[y * width + x]) return 0;
    let left = x;
    let right = x;
    while (left > 0 && binary[y * width + left - 1]) left--;
    while (right + 1 < width && binary[y * width + right + 1]) right++;
    return right - left + 1;
  }

  function localZeroMarginGap(prepared, detection, upper, lower) {
    const { binary, nibRasterPx } = detection;
    const { width, height, scaleX, scaleY } = prepared;
    const upperInkLeft = upper.rasterInkXMin ?? upper.rasterXMin;
    const upperInkRight = upper.rasterInkXMax ?? upper.rasterXMax;
    const lowerInkLeft = lower.rasterInkXMin ?? lower.rasterXMin;
    const lowerInkRight = lower.rasterInkXMax ?? lower.rasterXMax;
    const overlapLeft = Math.max(0, Math.ceil(Math.max(upperInkLeft, lowerInkLeft)));
    const overlapRight = Math.min(width - 1, Math.floor(Math.min(upperInkRight, lowerInkRight)));
    if (overlapRight < overlapLeft) return null;
    const upperSearchTop = bound(Math.floor(upper.rasterRoofTopY), 0, height - 1);
    const gapMidpoint = (upper.rasterBottomY + lower.rasterRoofTopY) / 2;
    const upperSearchBottom = bound(Math.floor(gapMidpoint), upperSearchTop, height - 1);
    const lowerSearchTop = bound(
      Math.floor(lower.rasterRoofTopY - nibRasterPx * 1.15),
      0,
      height - 1
    );
    const lowerSearchBottom = bound(
      Math.ceil(lower.rasterRoofTopY + nibRasterPx * 1.25),
      lowerSearchTop,
      height - 1
    );
    // A genuine terminal stroke can be about half a nib wide. Keep the
    // component/noise filter as the guard, and do not require a broad seat.
    const minimumUpperSupport = Math.max(2, Math.ceil(nibRasterPx * .34));
    const minimumRoofSupport = Math.max(2, Math.ceil(nibRasterPx * .72));
    const candidates = [];

    for (let x = overlapLeft; x <= overlapRight; x++) {
      let upperInkY = null;
      for (let y = upperSearchBottom; y >= upperSearchTop; y--) {
        if (!binary[y * width + x]) continue;
        if (horizontalInkRunLength(binary, width, height, x, y) < minimumUpperSupport) continue;
        upperInkY = y;
        break;
      }
      if (upperInkY == null) continue;

      let lowerRoofY = null;
      for (let y = lowerSearchTop; y <= lowerSearchBottom; y++) {
        if (!binary[y * width + x]) continue;
        if (horizontalInkRunLength(binary, width, height, x, y) < minimumRoofSupport) continue;
        lowerRoofY = y;
        break;
      }
      if (lowerRoofY == null || Math.abs(lowerRoofY - lower.rasterRoofTopY) > nibRasterPx * 1.15) continue;
      const upperBoundaryY = upperInkY + 1;
      const gapRasterPx = lowerRoofY - upperBoundaryY;
      if (gapRasterPx <= .5) continue;
      candidates.push({ x, upperInkY, upperBoundaryY, lowerRoofY, gapRasterPx });
    }

    const minimumBodyDepth = Math.max(1, nibRasterPx * 1.15);
    const bodyCandidates = candidates.filter(candidate =>
      candidate.upperInkY - upper.rasterRoofTopY >= minimumBodyDepth
    );
    const minimumRunWidth = Math.max(2, Math.ceil(nibRasterPx * .34));
    const stableRunsFor = pool => {
      const runs = [];
      for (const candidate of pool) {
        const previous = runs[runs.length - 1];
        if (previous && candidate.x === previous.items[previous.items.length - 1].x + 1) {
          previous.items.push(candidate);
        } else {
          runs.push({ items: [candidate] });
        }
      }
      return runs.filter(run => run.items.length >= minimumRunWidth);
    };
    const allRuns = stableRunsFor(candidates);
    const bodyRuns = stableRunsFor(bodyCandidates);
    const supportWidth = runs => runs.reduce((sum, run) => sum + run.items.length, 0);
    const bodySupportWidth = supportWidth(bodyRuns);
    const allSupportWidth = supportWidth(allRuns);
    const representativeBodyDepth = median(bodyRuns.flatMap(run =>
      run.items.map(candidate => candidate.upperBoundaryY - upper.rasterRoofTopY)
    ));
    const repeatedBodyEvidence = Number.isFinite(representativeBodyDepth) &&
      detection.rows.filter((row, index) =>
        (detection.profile.rowBodyEvidence[index] || 0) >= .42 &&
        Math.abs(
          row.rasterBottomY - row.rasterRoofTopY - representativeBodyDepth
        ) <= nibRasterPx * .75
      ).length >= 2;
    const bodySupportIsMajority = bodySupportWidth * 2 > allSupportWidth;
    // A three-pixel stem remains valid when body evidence at the same depth
    // repeats across rows. A lone descender, however, cannot discard the much
    // broader roof-only consensus merely because it is the only deep run.
    const useBodyRuns = bodyRuns.length && (
      repeatedBodyEvidence || bodySupportIsMajority
    );
    const stableRuns = useBodyRuns ? bodyRuns : allRuns;
    const stableCandidates = stableRuns.flatMap(run => run.items.map((candidate, index) => ({
      ...candidate,
      runLeft: run.items[0].x,
      runRight: run.items[run.items.length - 1].x,
      edgeDistance: Math.min(index, run.items.length - 1 - index)
    })));
    if (!stableCandidates.length) return null;
    const representativeGap = median(stableCandidates.map(candidate => candidate.gapRasterPx));
    const overlapCenter = (overlapLeft + overlapRight) / 2;
    stableCandidates.sort((first, second) =>
      Math.abs(first.gapRasterPx - representativeGap) - Math.abs(second.gapRasterPx - representativeGap) ||
      second.edgeDistance - first.edgeDistance ||
      Math.abs(first.x - overlapCenter) - Math.abs(second.x - overlapCenter) ||
      first.x - second.x
    );
    const chosen = stableCandidates[0];
    return {
      x: (chosen.x + .5) * scaleX,
      upperBoundaryY: chosen.upperBoundaryY * scaleY,
      lowerBoundaryY: chosen.lowerRoofY * scaleY,
      valuePx: chosen.gapRasterPx * scaleY,
      raster: {
        x: chosen.x,
        upperInkY: chosen.upperInkY,
        upperBoundaryY: chosen.upperBoundaryY,
        lowerRoofY: chosen.lowerRoofY,
        gapPx: chosen.gapRasterPx,
        runLeft: chosen.runLeft,
        runRight: chosen.runRight
      },
      support: {
        left: chosen.runLeft * scaleX,
        right: (chosen.runRight + 1) * scaleX,
        candidateCount: stableCandidates.length,
        runCount: stableRuns.length,
        minimumRunWidthRasterPx: minimumRunWidth,
        boundaryConsensus: useBodyRuns ? 'repeated-or-majority-body' : 'all-stable-runs'
      }
    };
  }

  function analyzeInterlinePrepared(prepared, options = {}) {
    const suppliedNib = finite(options.nibPx);
    const detectedNib = finite(options.nib?.valuePx);
    const activeNib = suppliedNib || detectedNib;
    if (!activeNib || activeNib <= 0) {
      throw new Error('Nib thickness is required for stable row detection');
    }
    const detection = detectRowBands(prepared, activeNib, options);
    if (detection.profile.ambiguityReason) {
      throw new Error(`Ambiguous row structure: ${detection.profile.ambiguityReason}`);
    }
    if (detection.rows.length < 2) {
      throw new Error('Fewer than two stable text rows were detected');
    }
    const rows = detection.rows.map((row, index) => ({
      index,
      topY: row.rasterTopY * prepared.scaleY,
      roofTopY: row.rasterRoofTopY * prepared.scaleY,
      bottomY: row.rasterBottomY * prepared.scaleY,
      xMin: row.rasterXMin * prepared.scaleX,
      xMax: row.rasterXMax * prepared.scaleX,
      confidence: row.confidence,
      geometry: {
        spaceId: 'image-px',
        band: [
          { x: row.rasterXMin * prepared.scaleX, y: row.rasterRoofTopY * prepared.scaleY },
          { x: row.rasterXMax * prepared.scaleX, y: row.rasterRoofTopY * prepared.scaleY },
          { x: row.rasterXMax * prepared.scaleX, y: row.rasterBottomY * prepared.scaleY },
          { x: row.rasterXMin * prepared.scaleX, y: row.rasterBottomY * prepared.scaleY }
        ]
      },
      stats: { ...row.stats }
    }));
    const gaps = [];
    for (let index = 0; index < rows.length - 1; index++) {
      const upper = rows[index];
      const lower = rows[index + 1];
      const local = localZeroMarginGap(
        prepared,
        detection,
        detection.rows[index],
        detection.rows[index + 1]
      );
      if (!local) continue;
      const valuePx = local.valuePx;
      if (valuePx <= Math.max(.5, activeNib * .06)) continue;
      const x = local.x;
      const ratio = valuePx / activeNib;
      const plausibility = ratio >= .25 && ratio <= 9
        ? 1
        : ratio > 0 && ratio <= 14
          ? .55
          : .2;
      const confidence = bound(
        ((upper.confidence + lower.confidence) / 2) * (.72 + .28 * plausibility),
        .08,
        .97
      );
      gaps.push({
        index: gaps.length,
        upperRowIndex: upper.index,
        lowerRowIndex: lower.index,
        valuePx,
        length: valuePx,
        valueNib: valuePx / activeNib,
        points: [
          { x, y: local.upperBoundaryY },
          { x, y: local.lowerBoundaryY }
        ],
        confidence,
        boundaries: {
          upperBottomInkY: local.upperBoundaryY,
          lowerReferenceRoofTopY: local.lowerBoundaryY,
          zeroMargin: true,
          raster: local.raster,
          support: local.support
        },
        localSupport: local.support
      });
    }
    if (!gaps.length) throw new Error('No positive adjacent interline clearance was detected');
    const values = gaps.map(gap => gap.valuePx);
    const medianPx = median(values);
    const gapMadPx = mad(values, medianPx) || 0;
    const medianConfidence = median(gaps.map(gap => gap.confidence)) || 0;
    const dispersionConfidence = Math.max(
      0,
      1 - gapMadPx / Math.max(activeNib * 2.5, medianPx)
    );
    const confidence = bound(
      .15 +
      Math.min(.28, gaps.length * .09) +
      medianConfidence * .42 +
      dispersionConfidence * .15,
      .08,
      .98
    );
    return {
      engine: ENGINE_VERSION,
      kind: 'interline',
      formulaKey: 'between-lines',
      category: 'line-gap',
      nibPx: activeNib,
      normalizedByNib: true,
      rows,
      gaps,
      medianPx,
      medianNib: medianPx / activeNib,
      madPx: gapMadPx,
      confidence,
      threshold: { ...prepared.threshold },
      geometry: {
        spaceId: 'image-px',
        sourceWidth: prepared.sourceWidth,
        sourceHeight: prepared.sourceHeight
      },
      diagnostics: {
        ...detection.profile,
        rowCount: rows.length,
        gapCount: gaps.length
      }
    };
  }

  function appState() {
    return typeof state !== 'undefined' && state ? state : null;
  }

  function loadedImage(explicitSource) {
    if (explicitSource) return explicitSource;
    return appState()?.image || null;
  }

  function safeStatus(message) {
    try {
      if (typeof statusText !== 'undefined' && statusText) {
        statusText.textContent = message;
        return;
      }
    } catch {}
    try {
      const element = global.document?.getElementById('statusText');
      if (element) element.textContent = message;
    } catch {}
  }

  function safeBusy(visible) {
    try {
      if (typeof analysisOverlay !== 'undefined' && analysisOverlay) {
        analysisOverlay.hidden = !visible;
        return;
      }
    } catch {}
    try {
      const element = global.document?.getElementById('analysisOverlay');
      if (element) element.hidden = !visible;
    } catch {}
  }

  function safeRender() {
    try {
      if (typeof renderAll === 'function') {
        renderAll();
        return;
      }
    } catch {}
    try {
      if (typeof draw === 'function') draw();
      if (typeof renderList === 'function') renderList();
      if (typeof renderResults === 'function') renderResults();
      if (typeof renderFormulaUI === 'function') renderFormulaUI();
    } catch {}
  }

  function takeSnapshot() {
    try {
      if (typeof snapshot === 'function') snapshot();
    } catch {}
  }

  function beginAnalysisRun(kind, message) {
    const token = ++analysisRunToken;
    const currentState = appState();
    if (currentState?.formula) {
      currentState.formula.analysis = {
        ...(currentState.formula.analysis || {}),
        status: 'running',
        runToken: token,
        runKind: kind,
        error: null
      };
    }
    safeBusy(true);
    safeStatus(message);
    safeRender();
    return token;
  }

  function analysisRunIsCurrent(token) {
    return token === analysisRunToken;
  }

  function cancelActiveRun(options = {}) {
    const token = ++analysisRunToken;
    if (options.resetUi !== false) {
      const currentState = appState();
      if (currentState?.formula?.analysis?.status === 'running') {
        currentState.formula.analysis = {
          ...currentState.formula.analysis,
          status: 'idle',
          runToken: token,
          runKind: null,
          error: null
        };
      }
      safeBusy(false);
      if (options.render === true) safeRender();
    }
    return token;
  }

  function finishAnalysisRun(token, status, error = null) {
    if (!analysisRunIsCurrent(token)) return false;
    const currentState = appState();
    if (currentState?.formula) {
      currentState.formula.analysis = {
        ...(currentState.formula.analysis || {}),
        status,
        runToken: token,
        error: error ? String(error.message || error) : null
      };
    }
    safeBusy(false);
    safeRender();
    return true;
  }

  function isManualCalibrationLocked(currentState) {
    if (!currentState?.formula) return false;
    if (currentState.formula.calibration?.verified === true) return true;
    if ((currentState.formula.nibSamples || []).some(sample =>
      sample?.active !== false && sample?.locked === true
    )) return true;
    const calibrationObjectId = currentState.formula.calibration?.objectId;
    return calibrationObjectId != null && currentState.objects.some(object =>
      object.id === calibrationObjectId &&
      object.type === 'nib' &&
      object.auto !== true &&
      object.provenance?.origin !== 'automatic'
    );
  }

  function fallbackObject(type, points, overrides, currentState) {
    const id = currentState.nextId || 1;
    currentState.nextId = id + 1;
    return {
      id,
      uid: uniqueId('auto-measurement'),
      type,
      points: points.map(point => ({ x: +point.x, y: +point.y })),
      name: overrides.name || (type === 'nib' ? 'עובי קולמוס אוטומטי' : 'מרווח בין שורות'),
      color: overrides.color || (type === 'nib' ? '#7c3aed' : '#0f766e'),
      lineWidth: overrides.lineWidth || 3,
      fillAlpha: 0,
      fillEnabled: false,
      formulaKey: overrides.formulaKey,
      category: overrides.category,
      assessment: 'unclassified',
      note: '',
      display: { resultLabelVisible: true },
      provenance: {
        origin: 'automatic',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString()
      },
      ...overrides
    };
  }

  function createMeasurement(type, points, overrides, currentState) {
    try {
      if (typeof makeObject === 'function') {
        return makeObject(type, points, {
          auto: true,
          ...overrides,
          display: {
            resultLabelVisible: true,
            ...(overrides.display || {})
          }
        });
      }
    } catch {}
    return fallbackObject(type, points, { auto: true, ...overrides }, currentState);
  }

  function clearOwnedObjects(currentState, roles) {
    const roleSet = new Set(roles);
    const removable = object => {
      if (!roleSet.has(object.role)) return false;
      const origin = String(object.provenance?.origin || '').toLowerCase();
      const protectedByHumanWork =
        object.auto === false ||
        object.manualCorrected === true ||
        object.verified === true ||
        object.gapDetection?.manualCorrected === true ||
        object.gapDetection?.verified === true ||
        origin === 'human' ||
        origin === 'human-corrected' ||
        origin.startsWith('human-');
      return !protectedByHumanWork && (
        object.auto === true ||
        !origin ||
        origin === 'automatic' ||
        origin === 'assisted'
      );
    };
    const removedIds = new Set(
      currentState.objects
        .filter(removable)
        .map(object => object.id)
    );
    currentState.objects = currentState.objects.filter(object => !removedIds.has(object.id));
    if (removedIds.has(currentState.selectedId)) currentState.selectedId = null;
    if (currentState.formula?.calibration) {
      if (removedIds.has(currentState.formula.calibration.objectId)) {
        currentState.formula.calibration.objectId = null;
      }
      if (removedIds.has(currentState.formula.calibration.regionObjectId)) {
        currentState.formula.calibration.regionObjectId = null;
      }
    }
    return removedIds;
  }

  function applyNib(result, options = {}) {
    const currentState = appState();
    if (!currentState) throw new Error('Medidaot application state is unavailable');
    if (!result?.valuePx || !Array.isArray(result.evidence)) {
      throw new Error('Invalid automatic nib result');
    }
    if (!options.skipSnapshot) takeSnapshot();
    clearOwnedObjects(currentState, [NIB_ROLE]);
    const acceptedEvidence = result.evidence.filter(item => item.accepted);
    const evidenceLimit = Math.max(2, Math.round(finite(options.maxEvidence) || 10));
    const selectedEvidence = acceptedEvidence
      .sort((a, b) =>
        Math.abs(a.valuePx - result.valuePx) - Math.abs(b.valuePx - result.valuePx) ||
        b.confidence - a.confidence
      )
      .slice(0, evidenceLimit);
    const objects = selectedEvidence.map((evidence, index) => {
      const object = createMeasurement('nib', evidence.points, {
        role: NIB_ROLE,
        auto: true,
        name: `עובי קולמוס אוטומטי — גג ${index + 1}`,
        category: 'nib',
        color: '#7c3aed',
        lineWidth: 3,
        confidence: evidence.confidence,
        sampleAccepted: true,
        algorithmVersion: ENGINE_VERSION,
        autoMeasurement: {
          engine: ENGINE_VERSION,
          kind: 'roof-nib-evidence',
          canonicalValuePx: result.valuePx,
          measuredValuePx: evidence.valuePx,
          accepted: true,
          stats: evidence.stats
        }
      }, currentState);
      currentState.objects.push(object);
      return object;
    });
    const representativeObject = objects.reduce((best, object) => {
      if (!best) return object;
      const objectLength = pointDistance(object.points[0], object.points[1]);
      const bestLength = pointDistance(best.points[0], best.points[1]);
      return Math.abs(objectLength - result.valuePx) < Math.abs(bestLength - result.valuePx)
        ? object
        : best;
    }, null);
    const locked = isManualCalibrationLocked(currentState);
    const now = new Date().toISOString();
    currentState.formula.analysis = {
      ...(currentState.formula.analysis || {}),
      status: 'done',
      nibConfidence: result.confidence,
      threshold: result.threshold,
      sourceThreshold: result.threshold?.otsu ?? null,
      autoNibPx: result.valuePx,
      autoNibEngine: ENGINE_VERSION,
      roofCandidates: result.evidence.map(evidence => ({
        valuePx: evidence.valuePx,
        points: evidence.points.map(point => ({ ...point })),
        confidence: evidence.confidence,
        accepted: evidence.accepted,
        stats: { ...(evidence.stats || {}) }
      }))
    };
    const previousSamples = (currentState.formula.nibSamples || []).filter(sample =>
      sample?.estimator !== ENGINE_VERSION && sample?.role !== NIB_ROLE
    );
    const automaticSamples = selectedEvidence.map((evidence, index) => ({
      id: uniqueId('auto-roof-sample'),
      sourceUid: objects[index]?.uid || `${NIB_ROLE}-${index}`,
      sourceMeasurementId: objects[index]?.uid || null,
      sourceType: 'whole-image-horizontal-roof',
      role: NIB_ROLE,
      valuePx: evidence.valuePx,
      accepted: true,
      active: !locked,
      validationOnly: locked,
      locked: false,
      confidence: evidence.confidence,
      estimator: ENGINE_VERSION,
      stats: evidence.stats,
      geometry: { spaceId: 'image-px', points: evidence.points },
      createdAt: now
    }));
    currentState.formula.nibSamples = [...previousSamples, ...automaticSamples].slice(-60);
    if (locked) {
      currentState.formula.calibration = {
        ...currentState.formula.calibration,
        verified: true,
        validations: [
          ...(currentState.formula.calibration?.validations || []),
          {
            sourceType: 'whole-image-horizontal-roofs',
            role: NIB_ROLE,
            valuePx: result.valuePx,
            confidence: result.confidence,
            accepted: Math.abs(result.valuePx - currentState.formula.nibPx) /
              Math.max(.0001, currentState.formula.nibPx) <= .10,
            createdAt: now,
            engine: ENGINE_VERSION
          }
        ].slice(-60)
      };
    } else {
      currentState.formula.nibPx = result.valuePx;
      currentState.formula.calibration = {
        ...(currentState.formula.calibration || {}),
        id: currentState.formula.calibration?.id ||
          `nib-calibration_${currentState.projectMeta?.id || 'project'}`,
        method: 'whole-image-horizontal-roofs',
        algorithmVersion: ENGINE_VERSION,
        regionObjectId: null,
        objectId: representativeObject?.id || null,
        valuePx: result.valuePx,
        confidence: result.confidence,
        verified: false,
        aggregation: { ...result.aggregation }
      };
    }
    if (options.selectEvidence && representativeObject) currentState.selectedId = representativeObject.id;
    safeStatus(locked
      ? 'זוהו גגות יציבים; הכיול הידני המאומת נשאר פעיל והזיהוי נשמר כראיה'
      : `עובי הקולמוס זוהה אוטומטית מתוך ${result.aggregation.acceptedCount} גגות עקביים`);
    safeRender();
    return {
      objects,
      valuePx: result.valuePx,
      activeValuePx: currentState.formula.nibPx,
      manualLockPreserved: locked
    };
  }

  function applyInterline(result, options = {}) {
    const currentState = appState();
    if (!currentState) throw new Error('Medidaot application state is unavailable');
    if (!Array.isArray(result?.gaps) || !result.gaps.length) {
      throw new Error('Invalid automatic interline result');
    }
    if (!options.skipSnapshot) takeSnapshot();
    clearOwnedObjects(currentState, [GAP_ROLE]);
    const objects = result.gaps.map((gap, index) => {
      const upperRow = result.rows?.find(row => row.index === gap.upperRowIndex);
      const lowerRow = result.rows?.find(row => row.index === gap.lowerRowIndex);
      const sourceWidth = finite(result.geometry?.sourceWidth) ||
        finite(currentState.image?.width) ||
        Math.max(gap.points[0].x, gap.points[1].x) * 2;
      const activeNibPx = finite(result.nibPx) || finite(currentState.formula.nibPx);
      const supportLeft = finite(gap.localSupport?.left) ??
        finite(gap.boundaries?.support?.left);
      const supportRight = finite(gap.localSupport?.right) ??
        finite(gap.boundaries?.support?.right);
      const overlapLeft = supportLeft ?? Math.max(
        finite(upperRow?.xMin) ?? gap.points[0].x,
        finite(lowerRow?.xMin) ?? gap.points[0].x
      );
      const overlapRight = supportRight ?? Math.min(
        finite(upperRow?.xMax) ?? gap.points[0].x,
        finite(lowerRow?.xMax) ?? gap.points[0].x
      );
      // The evidence ticks deliberately stay local. A long global line implies
      // a statistical row boundary even where no ink exists at that height.
      const desiredSpan = Math.max((activeNibPx || 1) * 2.25, 12);
      let boundaryLeft;
      let boundaryRight;
      if (overlapRight - overlapLeft >= 4) {
        const center = bound(gap.points[0].x, overlapLeft, overlapRight);
        const half = Math.min(desiredSpan, overlapRight - overlapLeft) / 2;
        boundaryLeft = bound(center - half, overlapLeft, overlapRight);
        boundaryRight = bound(center + half, overlapLeft, overlapRight);
        if (boundaryRight - boundaryLeft < Math.min(4, overlapRight - overlapLeft)) {
          boundaryLeft = overlapLeft;
          boundaryRight = overlapRight;
        }
      } else {
        const half = desiredSpan / 2;
        boundaryLeft = bound(gap.points[0].x - half, 0, sourceWidth);
        boundaryRight = bound(gap.points[0].x + half, 0, sourceWidth);
      }
      const upperBoundaryY = gap.boundaries.upperBottomInkY;
      const lowerBoundaryY = gap.boundaries.lowerReferenceRoofTopY;
      const upperBoundary = [
        { x: boundaryLeft, y: upperBoundaryY },
        { x: boundaryRight, y: upperBoundaryY }
      ];
      const lowerBoundary = [
        { x: boundaryLeft, y: lowerBoundaryY },
        { x: boundaryRight, y: lowerBoundaryY }
      ];
      const object = createMeasurement('gap', gap.points, {
        role: GAP_ROLE,
        auto: true,
        name: `מרווח בין שורות ${index + 1}`,
        formulaKey: 'between-lines',
        category: 'line-gap',
        color: '#0f766e',
        lineWidth: 3,
        confidence: gap.confidence,
        sampleAccepted: true,
        algorithmVersion: ENGINE_VERSION,
        gapDetection: {
          medianPx: gap.valuePx,
          method: 'auto-interline-zero-margin-v2',
          engine: ENGINE_VERSION,
          confidence: gap.confidence,
          sampleCount: 2,
          verified: false,
          manualCorrected: false,
          upperBoundary,
          lowerBoundary,
          zeroMargin: true,
          raster: gap.boundaries?.raster ? { ...gap.boundaries.raster } : null,
          support: gap.boundaries?.support ? { ...gap.boundaries.support } : null
        },
        rowBoundaries: {
          upperRowIndex: gap.upperRowIndex,
          lowerRowIndex: gap.lowerRowIndex,
          upperBottomInkY: gap.boundaries.upperBottomInkY,
          lowerReferenceRoofTopY: gap.boundaries.lowerReferenceRoofTopY,
          zeroMargin: true,
          support: gap.boundaries?.support ? { ...gap.boundaries.support } : null
        },
        normalization: {
          nibPxAtMeasurement: activeNibPx,
          calibrationId: currentState.formula.calibration?.id || null,
          calibrationVersion: currentState.formula.calibration?.algorithmVersion ||
            currentState.formula.calibration?.version || null,
          measuredAt: new Date().toISOString()
        },
        autoMeasurement: {
          engine: ENGINE_VERSION,
          kind: 'interline-clearance',
          definition: 'upper-row-bottom-ink-to-next-row-reference-roof-top',
          valuePx: gap.valuePx,
          valueNib: activeNibPx ? gap.valuePx / activeNibPx : gap.valueNib,
          confidence: gap.confidence
        }
      }, currentState);
      currentState.objects.push(object);
      return object;
    });
    const textRows = (result.rows || []).map(row => ({
      index: row.index,
      topY: row.topY,
      roofTopY: row.roofTopY,
      bottomY: row.bottomY,
      xMin: row.xMin,
      xMax: row.xMax,
      confidence: row.confidence,
      geometry: row.geometry
    }));
    const interlineProposals = result.gaps.map((gap, index) => ({
      index,
      formulaKey: 'between-lines',
      category: 'line-gap',
      upperRowIndex: gap.upperRowIndex,
      lowerRowIndex: gap.lowerRowIndex,
      valuePx: gap.valuePx,
      valueNib: gap.valueNib,
      points: gap.points.map(point => ({ ...point })),
      confidence: gap.confidence,
      gapDetection: objects[index]?.gapDetection
    }));
    currentState.formula.betweenLinesPx = result.medianPx;
    currentState.formula.analysis = {
      ...(currentState.formula.analysis || {}),
      status: 'done',
      gapConfidence: result.confidence,
      autoInterlineMedianPx: result.medianPx,
      autoInterlineMedianNib: result.medianNib,
      betweenLinesMedianPx: result.medianPx,
      betweenLinesMedianNib: result.medianNib,
      autoInterlineEngine: ENGINE_VERSION,
      textRows,
      interlineProposals
    };
    // Keep human and automatic evidence separate. If a verified/manual gap is
    // present it remains the active formula value; the automatic median stays
    // visible as its own comparison instead of being averaged into it.
    if (typeof global.refreshBetweenLinesSummary === 'function') {
      global.refreshBetweenLinesSummary();
    }
    if (options.selectEvidence && objects[0]) currentState.selectedId = objects[0].id;
    safeStatus(
      `זוהו ${objects.length} מרווחים בין שורות · חציון ${result.medianNib.toFixed(2)} עובי קולמוס`
    );
    safeRender();
    return { objects, medianPx: result.medianPx, medianNib: result.medianNib };
  }

  async function yieldForUi() {
    await new Promise(resolve => global.setTimeout(resolve, 0));
  }

  async function runNib(options = {}) {
    const source = loadedImage(options.image);
    const token = beginAnalysisRun(
      'nib',
      source
        ? 'מאתר גגות ארוכים וחתכים מרכזיים יציבים…'
        : 'לא נטענה תמונה לניתוח'
    );
    if (!source) {
      const error = new Error('No loaded image');
      finishAnalysisRun(token, 'failed', error);
      if (options.throwOnError) throw error;
      return {
        engine: ENGINE_VERSION,
        kind: 'nib',
        valuePx: null,
        evidence: [],
        confidence: 0,
        error: error.message,
        applied: null
      };
    }
    await yieldForUi();
    if (!analysisRunIsCurrent(token)) return { engine: ENGINE_VERSION, kind: 'nib', stale: true };
    try {
      const prepared = prepareRasterForRun(source, options);
      const result = analyzeNibPrepared(prepared, options);
      if (!analysisRunIsCurrent(token)) return { ...result, stale: true, applied: null };
      const applied = options.apply === false ? null : applyNib(result, options);
      if (options.apply === false) {
        safeStatus(`זוהה עובי קולמוס בהסתברות ${Math.round(result.confidence * 100)}%`);
      }
      finishAnalysisRun(token, 'done');
      return { ...result, applied };
    } catch (error) {
      if (!analysisRunIsCurrent(token)) {
        return { engine: ENGINE_VERSION, kind: 'nib', stale: true, error: error.message };
      }
      safeStatus('לא נמצאו די גגות אופקיים יציבים; הכיול הקיים לא השתנה');
      finishAnalysisRun(token, 'failed', error);
      if (options.throwOnError) throw error;
      return {
        engine: ENGINE_VERSION,
        kind: 'nib',
        valuePx: null,
        evidence: [],
        confidence: 0,
        error: error.message,
        applied: null
      };
    }
  }

  async function runInterline(options = {}) {
    const source = loadedImage(options.image);
    const token = beginAnalysisRun(
      'interline',
      source
        ? 'מזהה שורות וגבולות לובן בין השיטין…'
        : 'לא נטענה תמונה לניתוח'
    );
    if (!source) {
      const error = new Error('No loaded image');
      finishAnalysisRun(token, 'failed', error);
      if (options.throwOnError) throw error;
      return {
        engine: ENGINE_VERSION,
        kind: 'interline',
        rows: [],
        gaps: [],
        confidence: 0,
        error: error.message,
        applied: null
      };
    }
    await yieldForUi();
    if (!analysisRunIsCurrent(token)) return { engine: ENGINE_VERSION, kind: 'interline', stale: true };
    try {
      const prepared = prepareRasterForRun(source, options);
      const currentNib = finite(options.nibPx) || finite(appState()?.formula?.nibPx);
      let nibResult = options.nib || null;
      if (!currentNib && !nibResult) nibResult = analyzeNibPrepared(prepared, options);
      const result = analyzeInterlinePrepared(prepared, {
        ...options,
        nib: nibResult,
        nibPx: currentNib || finite(nibResult?.valuePx)
      });
      if (!analysisRunIsCurrent(token)) {
        return { ...result, stale: true, applied: null, nib: nibResult };
      }
      let appliedNib = null;
      let applied = null;
      if (options.apply !== false) {
        if (!currentNib && nibResult?.valuePx) {
          takeSnapshot();
          const batchedOptions = { ...options, skipSnapshot: true };
          appliedNib = applyNib(nibResult, batchedOptions);
          applied = applyInterline(result, batchedOptions);
        } else {
          applied = applyInterline(result, options);
        }
      }
      if (options.apply === false) {
        safeStatus(`זוהו ${result.gaps.length} מרווחים בין שורות`);
      }
      finishAnalysisRun(token, 'done');
      return { ...result, applied, appliedNib, nib: nibResult };
    } catch (error) {
      if (!analysisRunIsCurrent(token)) {
        return { engine: ENGINE_VERSION, kind: 'interline', stale: true, error: error.message };
      }
      safeStatus('לא זוהו שתי שורות עיקריות יציבות; המדידות הקיימות לא השתנו');
      finishAnalysisRun(token, 'failed', error);
      if (options.throwOnError) throw error;
      return {
        engine: ENGINE_VERSION,
        kind: 'interline',
        rows: [],
        gaps: [],
        confidence: 0,
        error: error.message,
        applied: null
      };
    }
  }

  async function analyzeLoadedImage(options = {}) {
    const source = loadedImage(options.image);
    const token = beginAnalysisRun(
      'combined',
      source
        ? 'מנתח עובי קולמוס ושורות בכל התמונה…'
        : 'לא נטענה תמונה לניתוח'
    );
    if (!source) {
      const error = new Error('No loaded image');
      finishAnalysisRun(token, 'failed', error);
      if (options.throwOnError) throw error;
      return {
        engine: ENGINE_VERSION,
        nib: null,
        interline: null,
        errors: { image: error.message },
        applied: {},
        error: error.message
      };
    }
    await yieldForUi();
    if (!analysisRunIsCurrent(token)) return { engine: ENGINE_VERSION, stale: true };
    try {
      const prepared = prepareRasterForRun(source, options);
      let nib = null;
      let interline = null;
      const errors = {};
      try {
        nib = analyzeNibPrepared(prepared, options);
      } catch (error) {
        errors.nib = error.message;
      }
      const currentState = appState();
      const existingNib = finite(currentState?.formula?.nibPx);
      const lockedManualNib = isManualCalibrationLocked(currentState);
      const normalizationNib = finite(options.nibPx) ||
        (lockedManualNib ? existingNib : finite(nib?.valuePx)) ||
        existingNib;
      try {
        interline = analyzeInterlinePrepared(prepared, {
          ...options,
          nib,
          nibPx: normalizationNib
        });
      } catch (error) {
        errors.interline = error.message;
      }
      if (!nib && !interline) throw new Error('No stable automatic measurements were detected');
      if (!analysisRunIsCurrent(token)) {
        return { engine: ENGINE_VERSION, nib, interline, errors, stale: true, applied: {} };
      }
      const applied = {};
      if (options.apply === true) {
        takeSnapshot();
        const batchedOptions = { ...options, skipSnapshot: true };
        if (nib) applied.nib = applyNib(nib, batchedOptions);
        if (interline) applied.interline = applyInterline(interline, batchedOptions);
      }
      safeStatus(
        nib && interline
          ? `הניתוח הושלם: ${nib.aggregation.acceptedCount} גגות ו־${interline.gaps.length} מרווחי שורות`
          : nib
            ? 'זוהה עובי קולמוס; לא זוהו שתי שורות עיקריות'
            : `זוהו ${interline.gaps.length} מרווחי שורות; כיול הקולמוס הפעיל נשמר`
      );
      finishAnalysisRun(token, 'done');
      return {
        engine: ENGINE_VERSION,
        nib,
        interline,
        errors,
        applied,
        source: {
          width: prepared.sourceWidth,
          height: prepared.sourceHeight,
          spaceId: 'image-px'
        }
      };
    } catch (error) {
      if (!analysisRunIsCurrent(token)) {
        return { engine: ENGINE_VERSION, stale: true, error: error.message };
      }
      safeStatus('הניתוח האוטומטי לא מצא מבנה כתב יציב; המדידות הקיימות לא השתנו');
      finishAnalysisRun(token, 'failed', error);
      if (options.throwOnError) throw error;
      return {
        engine: ENGINE_VERSION,
        nib: null,
        interline: null,
        errors: { analysis: error.message },
        applied: {},
        error: error.message
      };
    }
  }

  function analyzeNib(source, options = {}) {
    return analyzeNibPrepared(prepareRaster(source, options), options);
  }

  function analyzeInterline(source, options = {}) {
    const prepared = prepareRaster(source, options);
    let nib = options.nib || null;
    const nibPx = finite(options.nibPx) || finite(nib?.valuePx);
    if (!nibPx) nib = analyzeNibPrepared(prepared, options);
    return analyzeInterlinePrepared(prepared, {
      ...options,
      nib,
      nibPx: nibPx || nib.valuePx
    });
  }

  global.MEDIDAOT_AUTO_MEASURE = Object.freeze({
    version: ENGINE_VERSION,
    roles: Object.freeze({
      nib: NIB_ROLE,
      interline: GAP_ROLE,
      all: OWN_ROLES
    }),
    analyzeNib,
    analyzeInterline,
    analyzeLoadedImage,
    applyNib,
    applyInterline,
    cancelActiveRun,
    runNib,
    runInterline,
    helpers: Object.freeze({
      prepareRaster,
      densestRelativeCluster,
      detectRowBands,
      localZeroMarginGap,
      removeTinyInk,
      isManualCalibrationLocked
    })
  });
})(globalThis);
