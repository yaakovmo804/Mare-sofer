'use strict';

/*
 * Local raster-to-vector tracing for a freely selected photographed letter.
 * The module is deliberately dependency-free so the same deterministic
 * geometry can be exercised in Node regression tests and in the iPad PWA.
 */
globalThis.MEDIDAOT_REGION_VECTOR = (() => {
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const pointKey = point => `${point.x},${point.y}`;

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const a = polygon[index];
      const b = polygon[previous];
      const onEdge = Math.abs(
        (point.x - b.x) * (a.y - b.y) - (point.y - b.y) * (a.x - b.x)
      ) < 1e-7 &&
        point.x >= Math.min(a.x, b.x) - 1e-7 && point.x <= Math.max(a.x, b.x) + 1e-7 &&
        point.y >= Math.min(a.y, b.y) - 1e-7 && point.y <= Math.max(a.y, b.y) + 1e-7;
      if (onEdge) return true;
      if (((a.y > point.y) !== (b.y > point.y)) &&
          point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function luminance(data, offset) {
    return Math.round(data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722);
  }

  function otsuThreshold(histogram, sampleCount) {
    if (!sampleCount) return 128;
    let weightedTotal = 0;
    for (let value = 0; value < 256; value++) weightedTotal += value * histogram[value];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let bestThreshold = 128;
    for (let value = 0; value < 255; value++) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = sampleCount - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
      const difference = backgroundMean - foregroundMean;
      const variance = backgroundWeight * foregroundWeight * difference * difference;
      if (variance > bestVariance) {
        bestVariance = variance;
        bestThreshold = value;
      }
    }
    return clamp(bestThreshold, 36, 196);
  }

  function connectedComponents(binary, width, height) {
    const labels = new Int32Array(binary.length);
    const components = [];
    const queue = new Int32Array(binary.length);
    for (let start = 0; start < binary.length; start++) {
      if (!binary[start] || labels[start]) continue;
      let head = 0;
      let tail = 0;
      const label = components.length + 1;
      queue[tail++] = start;
      labels[start] = label;
      while (head < tail) {
        const current = queue[head++];
        const x = current % width;
        const y = Math.floor(current / width);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!binary[next] || labels[next]) continue;
          labels[next] = label;
          queue[tail++] = next;
        }
      }
      components.push({ label, area: tail });
    }
    return { labels, components };
  }

  function cleanInk(binary, width, height, selectedPixelCount, options = {}) {
    const { labels, components } = connectedComponents(binary, width, height);
    if (!components.length) return binary;
    const largest = Math.max(...components.map(component => component.area));
    const minimum = Math.max(
      Number.isFinite(+options.minimumComponentPixels) ? +options.minimumComponentPixels : 3,
      Math.round(Math.min(largest * .0015, Math.max(3, selectedPixelCount * .00008)))
    );
    const maximumAnchors = Math.max(3, Math.round(+options.maximumAnchors || 420));
    const maximumComponents = Math.max(1, Math.floor(maximumAnchors / 3));
    const retained = components
      .filter(component => component.area >= minimum)
      .sort((first, second) => second.area - first.area || first.label - second.label)
      .slice(0, maximumComponents);
    const retainedLabels = new Uint8Array(components.length + 1);
    for (const component of retained) retainedLabels[component.label] = 1;
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < labels.length; index++) {
      if (retainedLabels[labels[index]]) output[index] = 1;
    }
    return output;
  }

  function evenlySampleClosed(points, maximumPoints) {
    const count = Math.max(3, Math.min(points.length, Math.trunc(maximumPoints)));
    if (points.length <= count) return points.slice();
    const sampled = [];
    for (let index = 0; index < count; index++) {
      sampled.push(points[Math.floor(index * points.length / count)]);
    }
    return sampled;
  }

  function normalizeSelectionPolygon(selectionPolygon, width, height, options = {}) {
    const fallback = [
      { x: 0, y: 0 }, { x: width, y: 0 },
      { x: width, y: height }, { x: 0, y: height }
    ];
    if (!Array.isArray(selectionPolygon) || selectionPolygon.length < 3) return fallback;
    const clean = [];
    for (const source of selectionPolygon) {
      const point = { x: +source?.x, y: +source?.y };
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const previous = clean[clean.length - 1];
      if (!previous || point.x !== previous.x || point.y !== previous.y) clean.push(point);
    }
    if (clean.length > 1 && pointKey(clean[0]) === pointKey(clean[clean.length - 1])) clean.pop();
    if (clean.length < 3) return fallback;

    const maximumVertices = clamp(
      Math.round(+options.maximumSelectionVertices || 768),
      32,
      2048
    );
    /* Bound work before RDP as well as after it; a malformed event stream must
       never feed an unbounded recursive/geometry workload into the tracer. */
    const prelimited = clean.length > maximumVertices * 4
      ? evenlySampleClosed(clean, maximumVertices * 4)
      : clean;
    let tolerance = Math.max(.35, Math.min(width, height) * .0008);
    let simplified = simplifyClosed(prelimited, tolerance);
    for (let attempt = 0; simplified.length > maximumVertices && attempt < 12; attempt++) {
      tolerance *= 1.45;
      simplified = simplifyClosed(prelimited, tolerance);
    }
    if (simplified.length > maximumVertices) {
      simplified = evenlySampleClosed(simplified, maximumVertices);
    }
    return simplified.length >= 3 ? simplified : fallback;
  }

  function rasterizePolygonMask(polygon, width, height) {
    const mask = new Uint8Array(width * height);
    let selectedPixelCount = 0;
    for (let y = 0; y < height; y++) {
      const scanY = y + .5;
      const intersections = [];
      for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const first = polygon[previous];
        const second = polygon[index];
        if ((first.y > scanY) === (second.y > scanY)) continue;
        intersections.push(
          first.x + (scanY - first.y) * (second.x - first.x) / (second.y - first.y)
        );
      }
      intersections.sort((first, second) => first - second);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const left = intersections[index];
        const right = intersections[index + 1];
        const start = Math.max(0, Math.ceil(Math.min(left, right) - .5));
        const end = Math.min(width - 1, Math.ceil(Math.max(left, right) - .5) - 1);
        for (let x = start; x <= end; x++) {
          mask[y * width + x] = 1;
          selectedPixelCount++;
        }
      }
    }
    return { mask, selectedPixelCount };
  }

  function addBoundaryEdge(edges, startX, startY, endX, endY, direction) {
    const start = { x: startX, y: startY };
    const edge = { start, end: { x: endX, y: endY }, direction, used: false };
    const key = pointKey(start);
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push(edge);
  }

  function boundaryEdges(binary, width, height) {
    const edges = new Map();
    const ink = (x, y) => x >= 0 && x < width && y >= 0 && y < height && binary[y * width + x];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!ink(x, y)) continue;
        if (!ink(x, y - 1)) addBoundaryEdge(edges, x, y, x + 1, y, 0);
        if (!ink(x + 1, y)) addBoundaryEdge(edges, x + 1, y, x + 1, y + 1, 1);
        if (!ink(x, y + 1)) addBoundaryEdge(edges, x + 1, y + 1, x, y + 1, 2);
        if (!ink(x - 1, y)) addBoundaryEdge(edges, x, y + 1, x, y, 3);
      }
    }
    return edges;
  }

  function nextBoundaryEdge(edges, current) {
    const candidates = (edges.get(pointKey(current.end)) || []).filter(edge => !edge.used);
    if (!candidates.length) return null;
    const priority = turn => turn === 1 ? 0 : turn === 0 ? 1 : turn === 3 ? 2 : 3;
    candidates.sort((first, second) => {
      const firstTurn = (first.direction - current.direction + 4) % 4;
      const secondTurn = (second.direction - current.direction + 4) % 4;
      return priority(firstTurn) - priority(secondTurn);
    });
    return candidates[0];
  }

  function traceContours(binary, width, height) {
    const edges = boundaryEdges(binary, width, height);
    const contours = [];
    for (const list of edges.values()) {
      for (const first of list) {
        if (first.used) continue;
        const contour = [{ ...first.start }];
        let current = first;
        let guard = 0;
        while (current && !current.used && guard++ <= width * height * 8) {
          current.used = true;
          contour.push({ ...current.end });
          if (pointKey(current.end) === pointKey(first.start)) break;
          current = nextBoundaryEdge(edges, current);
        }
        if (contour.length >= 5 && pointKey(contour[0]) === pointKey(contour[contour.length - 1])) {
          contour.pop();
          contours.push(contour);
        }
      }
    }
    return contours;
  }

  function polygonArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current.x * next.y - next.x * current.y;
    }
    return area / 2;
  }

  function removeCollinear(points) {
    if (points.length < 4) return points.slice();
    const result = [];
    for (let index = 0; index < points.length; index++) {
      const previous = points[(index - 1 + points.length) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const cross = (current.x - previous.x) * (next.y - current.y) -
        (current.y - previous.y) * (next.x - current.x);
      if (Math.abs(cross) > 1e-9) result.push(current);
    }
    return result.length >= 3 ? result : points.slice();
  }

  function pointSegmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
    const ratio = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
    return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio));
  }

  function simplifyOpen(points, tolerance) {
    if (points.length <= 2) return points.slice();
    const retained = new Uint8Array(points.length);
    retained[0] = 1;
    retained[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [startIndex, endIndex] = stack.pop();
      let furthestIndex = -1;
      let furthestDistance = tolerance;
      for (let index = startIndex + 1; index < endIndex; index++) {
        const current = pointSegmentDistance(points[index], points[startIndex], points[endIndex]);
        if (current > furthestDistance) {
          furthestDistance = current;
          furthestIndex = index;
        }
      }
      if (furthestIndex < 0) continue;
      retained[furthestIndex] = 1;
      stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
    return points.filter((point, index) => retained[index]);
  }

  function simplifyClosed(points, tolerance) {
    const clean = removeCollinear(points);
    if (clean.length <= 4) return clean;
    let split = 1;
    let furthest = -1;
    for (let index = 1; index < clean.length; index++) {
      const current = (clean[index].x - clean[0].x) ** 2 + (clean[index].y - clean[0].y) ** 2;
      if (current > furthest) {
        furthest = current;
        split = index;
      }
    }
    const firstArc = simplifyOpen(clean.slice(0, split + 1), tolerance);
    const secondArc = simplifyOpen([...clean.slice(split), clean[0]], tolerance);
    const result = [...firstArc.slice(0, -1), ...secondArc.slice(0, -1)];
    return removeCollinear(result);
  }

  function contourBounds(points) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const point of points) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
    return { left, top, right, bottom };
  }

  function selectContoursWithinBudget(contours, maximumAnchors) {
    const entries = contours
      .map((source, index) => {
        const points = removeCollinear(source);
        const signedArea = polygonArea(points);
        return {
          index,
          points,
          signedArea,
          area: Math.abs(signedArea),
          bounds: contourBounds(points),
          minimumAnchors: Math.min(4, points.length),
          parentIndex: null
        };
      })
      .filter(entry => entry.points.length >= 3 && entry.area >= 2);
    const outer = entries.filter(entry => entry.signedArea >= 0);
    for (const hole of entries.filter(entry => entry.signedArea < 0)) {
      let parent = null;
      for (const candidate of outer) {
        if (candidate.area <= hole.area) continue;
        if (hole.bounds.left < candidate.bounds.left || hole.bounds.right > candidate.bounds.right ||
            hole.bounds.top < candidate.bounds.top || hole.bounds.bottom > candidate.bounds.bottom) continue;
        if (!pointInPolygon(hole.points[0], candidate.points)) continue;
        if (!parent || candidate.area < parent.area) parent = candidate;
      }
      hole.parentIndex = parent?.index ?? null;
    }
    entries.sort((first, second) => second.area - first.area || first.index - second.index);
    const selected = [];
    const selectedIndices = new Set();
    let reservedAnchors = 0;
    for (const entry of entries) {
      if (entry.parentIndex !== null && !selectedIndices.has(entry.parentIndex)) continue;
      if (reservedAnchors + entry.minimumAnchors > maximumAnchors) continue;
      selected.push(entry);
      selectedIndices.add(entry.index);
      reservedAnchors += entry.minimumAnchors;
    }
    return {
      entries: selected,
      droppedContourCount: Math.max(0, entries.length - selected.length)
    };
  }

  function simplifyContours(contours, width, height, options = {}) {
    const maximumAnchors = Math.max(3, Math.round(+options.maximumAnchors || 420));
    const selected = selectContoursWithinBudget(contours, maximumAnchors);
    if (!selected.entries.length) return {
      contours: [],
      tolerance: 0,
      droppedContourCount: selected.droppedContourCount
    };
    let tolerance = Math.max(
      Number.isFinite(+options.tolerance) ? +options.tolerance : 0,
      .8,
      Math.min(width, height) * .0025
    );
    let simplified;
    for (let attempt = 0; attempt < 18; attempt++) {
      simplified = selected.entries.map(entry => {
        const current = simplifyClosed(entry.points, tolerance);
        return current.length >= 3
          ? current
          : evenlySampleClosed(entry.points, entry.minimumAnchors);
      });
      const total = simplified.reduce((sum, points) => sum + points.length, 0);
      if (total <= maximumAnchors) break;
      tolerance *= 1.45;
    }
    let total = simplified.reduce((sum, points) => sum + points.length, 0);
    if (total > maximumAnchors) {
      const quotas = selected.entries.map(entry => entry.minimumAnchors);
      let remaining = maximumAnchors - quotas.reduce((sum, count) => sum + count, 0);
      while (remaining > 0) {
        let best = -1;
        let bestNeed = 0;
        for (let index = 0; index < simplified.length; index++) {
          const need = simplified[index].length - quotas[index];
          if (need > bestNeed) {
            bestNeed = need;
            best = index;
          }
        }
        if (best < 0) break;
        quotas[best]++;
        remaining--;
      }
      simplified = simplified.map((points, index) => evenlySampleClosed(points, quotas[index]));
      total = simplified.reduce((sum, points) => sum + points.length, 0);
    }
    return {
      contours: simplified || [],
      tolerance,
      anchorCount: total,
      droppedContourCount: selected.droppedContourCount
    };
  }

  function buildVector(contours, width, height, metadata = {}) {
    const commands = [];
    for (const contour of contours) {
      commands.push({ type: 'M', x: contour[0].x, y: contour[0].y });
      for (const point of contour.slice(1)) commands.push({ type: 'L', x: point.x, y: point.y });
      commands.push({ type: 'Z' });
    }
    const anchors = commands.filter(command => command.type === 'M' || command.type === 'L').length;
    return {
      schemaVersion: 1,
      sourceKey: 'photographed-selection',
      letter: '',
      tradition: 'custom',
      style: 'photographed-letter',
      slug: 'photographed-selection',
      viewBox: [0, 0, width, height],
      weight: 1,
      revision: 1,
      paths: [{ rule: 'evenodd', commands }],
      handleCounts: { anchors, controls: 0, total: anchors },
      trace: { ...metadata, contourCount: contours.length, anchorCount: anchors }
    };
  }

  function vectorizeImageData(imageData, selectionPolygon, options = {}) {
    const width = Math.max(1, Math.trunc(+imageData?.width || 0));
    const height = Math.max(1, Math.trunc(+imageData?.height || 0));
    const data = imageData?.data;
    if (!data || data.length < width * height * 4) throw new TypeError('Valid RGBA image data is required.');
    const polygon = normalizeSelectionPolygon(selectionPolygon, width, height, options);
    const selection = rasterizePolygonMask(polygon, width, height);
    const histogram = new Uint32Array(256);
    let selectedPixelCount = 0;
    for (let index = 0; index < selection.mask.length; index++) {
      if (!selection.mask[index]) continue;
      const offset = index * 4;
      if (data[offset + 3] < 24) continue;
      histogram[luminance(data, offset)]++;
      selectedPixelCount++;
    }
    if (selectedPixelCount < 12) throw new Error('The selected area is too small to vectorize.');
    const threshold = Number.isFinite(+options.threshold)
      ? clamp(+options.threshold, 0, 255)
      : otsuThreshold(histogram, selectedPixelCount);
    let binary = new Uint8Array(width * height);
    for (let index = 0; index < selection.mask.length; index++) {
      if (!selection.mask[index]) continue;
      const offset = index * 4;
      if (data[offset + 3] >= 24 && luminance(data, offset) <= threshold) binary[index] = 1;
    }
    binary = cleanInk(binary, width, height, selectedPixelCount, options);
    const inkPixelCount = binary.reduce((sum, value) => sum + value, 0);
    if (inkPixelCount < 8) throw new Error('No stable ink was found inside the selection.');
    const rawContours = traceContours(binary, width, height);
    const simplified = simplifyContours(rawContours, width, height, options);
    if (!simplified.contours.length) throw new Error('The photographed letter did not produce a closed vector contour.');
    return {
      threshold,
      selectedPixelCount,
      inkPixelCount,
      contours: simplified.contours,
      tolerance: simplified.tolerance,
      selectionVertexCount: polygon.length,
      droppedContourCount: simplified.droppedContourCount,
      vector: buildVector(simplified.contours, width, height, {
        threshold,
        selectedPixelCount,
        inkPixelCount,
        tolerance: simplified.tolerance,
        selectionVertexCount: polygon.length,
        droppedContourCount: simplified.droppedContourCount
      })
    };
  }

  return Object.freeze({
    pointInPolygon,
    otsuThreshold,
    traceContours,
    simplifyClosed,
    vectorizeImageData
  });
})();
