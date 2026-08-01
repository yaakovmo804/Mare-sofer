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
      let left = width;
      let top = height;
      let right = -1;
      let bottom = -1;
      while (head < tail) {
        const current = queue[head++];
        const x = current % width;
        const y = Math.floor(current / width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
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
      components.push({ label, area: tail, left, top, right, bottom });
    }
    return { labels, components };
  }

  function meaningfulComponents(components) {
    if (!components.length) return { largestArea: 0, components: [] };
    const largestArea = Math.max(...components.map(component => component.area));
    return {
      largestArea,
      components: components
        .filter(component => component.area >= Math.max(24, largestArea * .012))
        .sort((first, second) => second.area - first.area || first.label - second.label)
        .slice(0, 12)
    };
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

  function contourComponentLabel(contour, labels, width, height) {
    const counts = new Map();
    for (let index = 0; index < contour.length; index++) {
      const first = contour[index];
      const second = contour[(index + 1) % contour.length];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) continue;
      /* Boundary tracing keeps ink on the right side of every directed edge.
         Sampling that side reads the connected-component label of the ink
         that actually owns the contour, including counters and nested ink. */
      const sampleX = (first.x + second.x) / 2 - dy / length * .25;
      const sampleY = (first.y + second.y) / 2 + dx / length * .25;
      const pixelX = Math.floor(sampleX);
      const pixelY = Math.floor(sampleY);
      if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= height) continue;
      const label = labels[pixelY * width + pixelX];
      if (!label) continue;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    let bestLabel = 0;
    let bestCount = 0;
    for (const [label, count] of counts) {
      if (count > bestCount || (count === bestCount && label < bestLabel)) {
        bestLabel = label;
        bestCount = count;
      }
    }
    return bestLabel;
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
      /* A structural landmark is an intentional editable station even when it
         lies on a perfectly straight edge. Never simplify it away. */
      if (Math.abs(cross) > 1e-9 || current.semanticLandmarkIds?.length) result.push(current);
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

  function selectContoursWithinBudget(contours, maximumAnchors, componentIndices = []) {
    const entries = contours
      .map((source, index) => {
        const points = removeCollinear(source);
        const signedArea = polygonArea(points);
        return {
          index,
          componentIndex: Number.isInteger(componentIndices[index]) ? componentIndices[index] : null,
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
    const selected = selectContoursWithinBudget(
      contours,
      maximumAnchors,
      options.contourComponentIndices
    );
    if (!selected.entries.length) return {
      contours: [],
      componentIndices: [],
      tolerance: 0,
      droppedContourCount: selected.droppedContourCount
    };
    let tolerance = Math.max(
      Number.isFinite(+options.tolerance) ? +options.tolerance : 0,
      1.25,
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
      componentIndices: selected.entries.map(entry => entry.componentIndex),
      tolerance,
      anchorCount: total,
      droppedContourCount: selected.droppedContourCount
    };
  }

  function numericMedian(values) {
    if (!values.length) return null;
    const ordered = values.slice().sort((first, second) => first - second);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function componentRowRuns(labels, width, component) {
    const rows = [];
    for (let y = component.top; y <= component.bottom; y++) {
      const runs = [];
      let start = -1;
      for (let x = component.left; x <= component.right + 1; x++) {
        const active = x <= component.right && labels[y * width + x] === component.label;
        if (active && start < 0) start = x;
        if (!active && start >= 0) {
          runs.push({ left: start, right: x, width: x - start, center: (start + x) / 2 });
          start = -1;
        }
      }
      rows.push(runs);
    }
    return rows;
  }

  function runOverlap(first, second) {
    return Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  }

  function roofRunForRow(runs, reference, minimumWidth) {
    let best = null;
    for (const run of runs) {
      if (run.width < minimumWidth) continue;
      const overlap = runOverlap(run, reference);
      if (overlap < Math.min(run.width, reference.width) * .45) continue;
      if (!best || overlap > best.overlap || (overlap === best.overlap && run.width > best.run.width)) {
        best = { run, overlap };
      }
    }
    return best?.run || null;
  }

  function linearAxis(samples, rootY) {
    const meanY = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length;
    const meanX = samples.reduce((sum, sample) => sum + sample.x, 0) / samples.length;
    let varianceY = 0;
    let covariance = 0;
    for (const sample of samples) {
      const dy = sample.y - meanY;
      varianceY += dy * dy;
      covariance += dy * (sample.x - meanX);
    }
    const slope = varianceY > 1e-9 ? covariance / varianceY : 0;
    const xAt = y => meanX + slope * (y - meanY);
    const residual = Math.sqrt(samples.reduce((sum, sample) => (
      sum + (sample.x - xAt(sample.y)) ** 2
    ), 0) / samples.length);
    const tipY = samples[samples.length - 1].y;
    return {
      root: { x: xAt(rootY), y: rootY },
      tip: { x: xAt(tipY), y: tipY },
      slope,
      residual
    };
  }

  function roundFeaturePoint(point) {
    return {
      x: Math.round(point.x * 1000) / 1000,
      y: Math.round(point.y * 1000) / 1000
    };
  }

  function fallbackComponentFeatures(labels, width, component, componentIndex) {
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    const leftYs = [];
    const rightYs = [];
    const topXs = [];
    const bottomXs = [];
    for (let y = component.top; y <= component.bottom; y++) {
      for (let x = component.left; x <= component.right; x++) {
        if (labels[y * width + x] !== component.label) continue;
        const centerX = x + .5;
        const centerY = y + .5;
        count++;
        sumX += centerX;
        sumY += centerY;
        if (x === component.left) leftYs.push(centerY);
        if (x === component.right) rightYs.push(centerY);
        if (y === component.top) topXs.push(centerX);
        if (y === component.bottom) bottomXs.push(centerX);
      }
    }
    if (!count) return [];

    const center = { x: sumX / count, y: sumY / count };
    let xx = 0;
    let xy = 0;
    let yy = 0;
    for (let y = component.top; y <= component.bottom; y++) {
      for (let x = component.left; x <= component.right; x++) {
        if (labels[y * width + x] !== component.label) continue;
        const dx = x + .5 - center.x;
        const dy = y + .5 - center.y;
        xx += dx * dx;
        xy += dx * dy;
        yy += dy * dy;
      }
    }
    const axisAngle = .5 * Math.atan2(2 * xy, xx - yy);
    let axis = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) };
    if ((Math.abs(axis.y) >= Math.abs(axis.x) && axis.y < 0) ||
        (Math.abs(axis.y) < Math.abs(axis.x) && axis.x < 0)) {
      axis = { x: -axis.x, y: -axis.y };
    }
    let minimumProjection = Infinity;
    let maximumProjection = -Infinity;
    for (let y = component.top; y <= component.bottom; y++) {
      for (let x = component.left; x <= component.right; x++) {
        if (labels[y * width + x] !== component.label) continue;
        const point = { x: x + .5, y: y + .5 };
        const projection = (point.x - center.x) * axis.x + (point.y - center.y) * axis.y;
        minimumProjection = Math.min(minimumProjection, projection);
        maximumProjection = Math.max(maximumProjection, projection);
      }
    }
    const axisStart = {
      x: center.x + axis.x * minimumProjection,
      y: center.y + axis.y * minimumProjection
    };
    const axisEnd = {
      x: center.x + axis.x * maximumProjection,
      y: center.y + axis.y * maximumProjection
    };

    const prefix = `component-${componentIndex}-fallback`;
    const extremumDefinitions = [
      ['left', 'קצה מתאר שמאלי', { x: component.left, y: numericMedian(leftYs) }],
      ['right', 'קצה מתאר ימני', { x: component.right + 1, y: numericMedian(rightYs) }],
      ['top', 'קצה מתאר עליון', { x: numericMedian(topXs), y: component.top }],
      ['bottom', 'קצה מתאר תחתון', { x: numericMedian(bottomXs), y: component.bottom + 1 }]
    ];
    const features = [];
    const usedPoints = new Set();
    for (const [role, label, point] of extremumDefinitions) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const rounded = roundFeaturePoint(point);
      const key = `${rounded.x},${rounded.y}`;
      if (usedPoints.has(key)) continue;
      usedPoints.add(key);
      features.push({
        id: `${prefix}-extreme-${role}`,
        type: 'contour-extremum',
        role,
        label,
        point: rounded,
        confidence: .72,
        componentIndex,
        fallback: true
      });
    }
    const root = roundFeaturePoint(axisStart);
    const tip = roundFeaturePoint(axisEnd);
    const trace = xx + yy;
    const separation = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
    const axisConfidence = trace > 0 ? clamp(.5 + .35 * separation / trace, .5, .85) : .5;
    features.push({
      id: `${prefix}-axis`,
      type: 'component-axis',
      label: 'ציר ראשי של הרכיב',
      point: roundFeaturePoint(center),
      root,
      tip,
      angleDeg: Math.round(Math.atan2(tip.x - root.x, tip.y - root.y) * 180000 / Math.PI) / 1000,
      confidence: axisConfidence,
      componentIndex,
      fallback: true
    });
    return features;
  }

  function traceStemFromRun(rows, component, roof, rootRun, rootRow) {
    const samples = [];
    let previous = rootRun;
    let missingRows = 0;
    const maximumWidth = Math.max(rootRun.width * 2.8, roof.width * .48);
    for (let y = rootRow; y <= component.bottom; y++) {
      const runs = rows[y - component.top] || [];
      let candidate = null;
      let candidateScore = Infinity;
      for (const run of runs) {
        const overlap = runOverlap(run, previous);
        const centerDistance = Math.abs(run.center - previous.center);
        const reachable = overlap > 0 || centerDistance <= Math.max(3, previous.width * 1.25);
        if (!reachable || run.width > maximumWidth) continue;
        const score = centerDistance + Math.abs(run.width - previous.width) * .2 - overlap * .35;
        if (score < candidateScore) {
          candidate = run;
          candidateScore = score;
        }
      }
      if (!candidate) {
        missingRows++;
        if (missingRows > 2) break;
        continue;
      }
      missingRows = 0;
      samples.push({
        x: candidate.center,
        y: y + .5,
        width: candidate.width,
        left: candidate.left,
        right: candidate.right
      });
      previous = candidate;
    }
    if (samples.length < 4) return null;
    const axis = linearAxis(samples, roof.bottom);
    const extent = axis.tip.y - axis.root.y;
    const medianWidth = numericMedian(samples.map(sample => sample.width)) || rootRun.width;
    if (extent < Math.max(4, (component.bottom - component.top + 1) * .18)) return null;
    if (extent / Math.max(1, medianWidth) < 1.25) return null;
    const continuity = samples.length / Math.max(1, Math.round(extent));
    const straightness = 1 - clamp(axis.residual / Math.max(1, medianWidth), 0, 1);
    const elongation = clamp(extent / Math.max(1, medianWidth * 4), 0, 1);
    return {
      ...axis,
      width: medianWidth,
      samples,
      sampleCount: samples.length,
      confidence: clamp(.30 + continuity * .25 + straightness * .2 + elongation * .25, .35, .98)
    };
  }

  function stemStructuralLandmarks(stem, stemId) {
    const samples = Array.isArray(stem?.samples) ? stem.samples : [];
    if (samples.length < 4) return [];
    const rootSample = samples[0];
    const upperEnd = Math.max(1, Math.floor((samples.length - 1) * .46));
    const neckSample = samples.slice(1, upperEnd + 1).reduce((best, sample) => (
      sample.width < best.width ? sample : best
    ), samples[Math.min(1, samples.length - 1)]);
    const lowerStart = Math.min(samples.length - 2, Math.max(upperEnd + 1, Math.floor(samples.length * .58)));
    const lowerEnd = Math.max(lowerStart, samples.length - 2);
    let rounding = null;
    for (let index = lowerStart; index <= lowerEnd; index++) {
      const previous = samples[Math.max(0, index - 2)];
      const current = samples[index];
      const next = samples[Math.min(samples.length - 1, index + 2)];
      const firstDy = Math.max(1, current.y - previous.y);
      const secondDy = Math.max(1, next.y - current.y);
      const curvature =
        Math.abs((current.left - previous.left) / firstDy - (next.left - current.left) / secondDy) +
        Math.abs((current.right - previous.right) / firstDy - (next.right - current.right) / secondDy);
      if (!rounding || curvature > rounding.curvature) rounding = { sample: current, curvature };
    }
    const terminalSample = samples.at(-1);
    const makePair = (stage, label, sample) => [
      {
        id: `${stemId}-${stage}-left`,
        role: `${stage}-left`,
        label: `${label} — צד שמאל`,
        point: roundFeaturePoint({ x: sample.left, y: sample.y })
      },
      {
        id: `${stemId}-${stage}-right`,
        role: `${stage}-right`,
        label: `${label} — צד ימין`,
        point: roundFeaturePoint({ x: sample.right, y: sample.y })
      }
    ];
    const landmarks = [
      ...makePair('root', 'חיבור הירך לגג', rootSample)
    ];
    if (rootSample.width - neckSample.width >= Math.max(1, rootSample.width * .08)) {
      landmarks.push(...makePair('neck', 'הצטמצמות הירך', neckSample));
    }
    if (rounding?.curvature >= .18) {
      landmarks.push(...makePair('rounding', 'נקודת ההתעגלות', rounding.sample));
    }
    landmarks.push(...makePair('terminal', 'סיום הירך', terminalSample));
    return landmarks;
  }

  function detectComponentFeatures(labels, width, component, componentIndex, largestArea) {
    const componentWidth = component.right - component.left + 1;
    const componentHeight = component.bottom - component.top + 1;
    if (component.area < Math.max(24, largestArea * .012) || componentWidth < 6 || componentHeight < 6) {
      return [];
    }
    const rows = componentRowRuns(labels, width, component);
    const roofSearchBottom = Math.min(
      component.bottom,
      component.top + Math.max(2, Math.floor(componentHeight * .62))
    );
    let bestRoof = null;
    for (let y = component.top; y <= roofSearchBottom; y++) {
      for (const run of rows[y - component.top] || []) {
        if (!bestRoof || run.width > bestRoof.run.width) bestRoof = { y, run };
      }
    }
    if (!bestRoof || bestRoof.run.width < Math.max(5, componentWidth * .34)) return [];

    const minimumBandWidth = bestRoof.run.width * .68;
    let bandTop = bestRoof.y;
    let bandBottom = bestRoof.y + 1;
    const bandRuns = [bestRoof.run];
    for (let y = bestRoof.y - 1; y >= component.top; y--) {
      const run = roofRunForRow(rows[y - component.top] || [], bestRoof.run, minimumBandWidth);
      if (!run) break;
      bandRuns.unshift(run);
      bandTop = y;
    }
    for (let y = bestRoof.y + 1; y <= component.bottom; y++) {
      const run = roofRunForRow(rows[y - component.top] || [], bestRoof.run, minimumBandWidth);
      if (!run) break;
      bandRuns.push(run);
      bandBottom = y + 1;
    }
    const roof = {
      left: numericMedian(bandRuns.map(run => run.left)),
      right: numericMedian(bandRuns.map(run => run.right)),
      top: bandTop,
      bottom: bandBottom
    };
    roof.width = roof.right - roof.left;
    const roofHeight = roof.bottom - roof.top;
    if (roofHeight > componentHeight * .38 || roof.width < roofHeight * 1.8) return [];
    const roofCenterY = (roof.top + roof.bottom) / 2;
    if (roofCenterY > component.top + componentHeight * .5) return [];
    const roofSpanRatio = clamp(roof.width / componentWidth, 0, 1);
    const roofThicknessRatio = clamp(roofHeight / Math.max(1, componentHeight * .18), 0, 1);
    const roofConfidence = clamp(.38 + roofSpanRatio * .38 + roofThicknessRatio * .18, .45, .98);
    const prefix = `component-${componentIndex}`;
    const features = [
      {
        id: `${prefix}-roof-left`,
        type: 'roof-endpoint',
        label: 'קצה גג שמאלי',
        point: roundFeaturePoint({ x: roof.left, y: roofCenterY }),
        confidence: roofConfidence,
        componentIndex
      },
      {
        id: `${prefix}-roof-right`,
        type: 'roof-endpoint',
        label: 'קצה גג ימני',
        point: roundFeaturePoint({ x: roof.right, y: roofCenterY }),
        confidence: roofConfidence,
        componentIndex
      }
    ];

    if (roof.bottom > component.bottom) return features;
    let rootRow = roof.bottom;
    let rootRuns = [];
    const roofReference = { left: roof.left, right: roof.right, width: roof.width };
    const maximumProbeRow = Math.min(component.bottom, roof.bottom + Math.max(2, Math.round(componentHeight * .035)));
    for (let y = roof.bottom; y <= maximumProbeRow; y++) {
      const candidates = (rows[y - component.top] || []).filter(run => (
        runOverlap(run, roofReference) > 0
        && run.width >= 2
        && run.width <= roof.width * .62
      ));
      if (candidates.length) {
        rootRow = y;
        rootRuns = candidates.slice(0, 8);
        break;
      }
    }

    let stemIndex = 0;
    for (const rootRun of rootRuns) {
      const stem = traceStemFromRun(rows, component, roof, rootRun, rootRow);
      if (!stem) continue;
      const root = roundFeaturePoint(stem.root);
      const tip = roundFeaturePoint(stem.tip);
      const confidence = Math.min(roofConfidence, stem.confidence);
      const stemId = `${prefix}-stem-${stemIndex}`;
      const organId = `${stemId}-organ`;
      const landmarks = stemStructuralLandmarks(stem, stemId);
      features.push({
        id: stemId,
        type: 'stem-axis',
        label: 'ציר ירך',
        point: root,
        root,
        tip,
        angleDeg: Math.round(Math.atan2(tip.x - root.x, tip.y - root.y) * 180000 / Math.PI) / 1000,
        confidence,
        componentIndex,
        widthPx: Math.round(stem.width * 1000) / 1000,
        organId,
        landmarkIds: landmarks.map(landmark => landmark.id)
      });
      features.push({
        id: `${prefix}-junction-${stemIndex}`,
        type: 'roof-stem-junction',
        label: 'מקום יציאת הירך מן הגג',
        point: root,
        root,
        tip,
        confidence,
        componentIndex,
        stemId,
        organId,
        landmarkIds: landmarks.filter(landmark => landmark.role.startsWith('root-')).map(landmark => landmark.id)
      });
      features.push({
        id: organId,
        type: 'stem-organ',
        label: 'ירך שלמה',
        point: roundFeaturePoint({
          x: (root.x + tip.x) / 2,
          y: (root.y + tip.y) / 2
        }),
        root,
        tip,
        confidence,
        componentIndex,
        stemId,
        organId,
        widthPx: Math.round(stem.width * 1000) / 1000,
        landmarkIds: landmarks.map(landmark => landmark.id)
      });
      for (const landmark of landmarks) {
        features.push({
          ...landmark,
          type: 'stem-landmark',
          confidence,
          componentIndex,
          stemId,
          organId,
          landmarkIds: [landmark.id],
          editable: true
        });
      }
      stemIndex++;
    }
    return features;
  }

  function detectPhotographedFeatures(binary, width, height, componentAnalysis = null) {
    const { labels, components } = componentAnalysis || connectedComponents(binary, width, height);
    if (!components.length) return [];
    const analysis = meaningfulComponents(components);
    const largestArea = analysis.largestArea;
    const meaningful = analysis.components;
    const features = [];
    let fallbackBudget = 40;
    for (let index = 0; index < meaningful.length; index++) {
      const component = meaningful[index];
      const componentBounds = {
        left: component.left,
        top: component.top,
        right: component.right + 1,
        bottom: component.bottom + 1
      };
      const detected = detectComponentFeatures(labels, width, component, index, largestArea)
        .map(feature => ({ ...feature, componentBounds: { ...componentBounds } }));
      if (detected.length) features.push(...detected);
      const hasEditableStructure = detected.some(feature =>
        feature.type === 'stem-axis' || feature.type === 'roof-stem-junction'
      );
      if (hasEditableStructure) continue;
      if (fallbackBudget <= 0) continue;
      const fallback = fallbackComponentFeatures(labels, width, component, index)
        .slice(0, fallbackBudget)
        .map(feature => ({ ...feature, componentBounds: { ...componentBounds } }));
      features.push(...fallback);
      fallbackBudget -= fallback.length;
    }
    return features;
  }

  function pointDistance(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function projectPointToSegment(point, first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 1e-9
      ? clamp(((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const projection = { x: first.x + dx * t, y: first.y + dy * t };
    return { point: projection, distance: pointDistance(point, projection), t };
  }

  function injectSemanticLandmarkAnchors(contours, features, options = {}) {
    const output = contours.map(contour => contour.map(point => ({ ...point })));
    /*
     * Only contour-located features may become editable topology stations.
     * Axes deliberately stay references because their centre points are not on
     * the outline. Roof endpoints and fallback extrema are projected as well so
     * an empty anchorIds array never has to masquerade as a valid binding.
     */
    const landmarks = features.filter(feature => (
      ['stem-landmark', 'roof-endpoint', 'contour-extremum'].includes(feature.type)
      && feature.point
    ));
    const maximumDistance = Math.max(4, (+options.tolerance || 0) * 3.2);
    const contourMetadata = output.map((contour, contourIndex) => ({
      contourIndex,
      componentIndex: Number.isInteger(options.contourComponentIndices?.[contourIndex])
        ? options.contourComponentIndices[contourIndex]
        : null,
      bounds: contourBounds(contour),
      area: Math.abs(polygonArea(contour))
    }));
    for (const landmark of landmarks) {
      let best = null;
      let eligibleContours = contourMetadata;
      if (Number.isInteger(landmark.componentIndex)) {
        const matching = contourMetadata.filter(entry => (
          entry.componentIndex === landmark.componentIndex
        ));
        /* Structural stations are allowed to bind only to contours traced from
           their exact connected component. Among that component's exterior and
           counters, the largest contour remains the structural owner. */
        eligibleContours = matching.length
          ? [matching.sort((a, b) => b.area - a.area)[0]]
          : [];
      }
      for (const { contourIndex } of eligibleContours) {
        const contour = output[contourIndex];
        for (let index = 0; index < contour.length; index++) {
          const nextIndex = (index + 1) % contour.length;
          const projected = projectPointToSegment(landmark.point, contour[index], contour[nextIndex]);
          if (!best || projected.distance < best.distance) {
            best = { ...projected, contourIndex, index, nextIndex };
          }
        }
      }
      if (!best || best.distance > maximumDistance) continue;
      const contour = output[best.contourIndex];
      const first = contour[best.index];
      const second = contour[best.nextIndex];
      const firstDistance = pointDistance(landmark.point, first);
      const secondDistance = pointDistance(landmark.point, second);
      let target;
      if (firstDistance <= .75 || best.t <= .001) target = first;
      else if (secondDistance <= .75 || best.t >= .999) target = second;
      else {
        target = { ...best.point };
        contour.splice(best.index + 1, 0, target);
      }
      target.semanticLandmarkIds = [...new Set([
        ...(target.semanticLandmarkIds || []),
        landmark.id
      ])];
    }
    return output;
  }

  function forwardCyclicIndices(length, start, end) {
    const result = [];
    if (length <= 0) return result;
    let index = start;
    for (let guard = 0; guard <= length; guard++) {
      result.push(index);
      if (index === end) break;
      index = (index + 1) % length;
    }
    return result;
  }

  function pointLandmarkIds(point) {
    return new Set(point?.semanticLandmarkIds || []);
  }

  function locateLandmark(contours, landmarkId) {
    for (let contourIndex = 0; contourIndex < contours.length; contourIndex++) {
      for (let pointIndex = 0; pointIndex < contours[contourIndex].length; pointIndex++) {
        if (pointLandmarkIds(contours[contourIndex][pointIndex]).has(landmarkId)) {
          return { contourIndex, pointIndex };
        }
      }
    }
    return null;
  }

  function organContourOwnership(contours, features) {
    const definitions = [];
    const ownedPoints = new Set();
    const organFeatures = features.filter(feature => feature.type === 'stem-organ');
    for (const organFeature of organFeatures) {
      const organId = organFeature.organId || organFeature.id;
      const landmarks = features.filter(feature => (
        feature.type === 'stem-landmark' && feature.organId === organId
      ));
      const roots = landmarks.filter(feature => feature.role?.startsWith('root-'));
      const terminals = landmarks.filter(feature => feature.role?.startsWith('terminal-'));
      const rootLocations = roots.map(feature => ({ feature, location: locateLandmark(contours, feature.id) }));
      const terminalLocations = terminals.map(feature => ({ feature, location: locateLandmark(contours, feature.id) }));
      const contourIndex = rootLocations[0]?.location?.contourIndex;
      const validRoots = rootLocations.length === 2
        && rootLocations.every(entry => entry.location && entry.location.contourIndex === contourIndex);
      const validTerminals = terminalLocations.length >= 1
        && terminalLocations.every(entry => entry.location && entry.location.contourIndex === contourIndex);
      if (!validRoots || !validTerminals) {
        definitions.push({ organFeature, organId, topologyStatus: 'unbound-reference' });
        continue;
      }
      const contour = contours[contourIndex];
      const firstRoot = rootLocations[0].location.pointIndex;
      const secondRoot = rootLocations[1].location.pointIndex;
      const forward = forwardCyclicIndices(contour.length, firstRoot, secondRoot);
      const reverse = forwardCyclicIndices(contour.length, secondRoot, firstRoot).reverse();
      const scoreArc = indices => {
        const indexSet = new Set(indices);
        const terminalScore = terminalLocations.reduce((score, entry) => (
          score + (indexSet.has(entry.location.pointIndex) ? 100 : 0)
        ), 0);
        const landmarkScore = landmarks.reduce((score, landmark) => {
          const location = locateLandmark(contours, landmark.id);
          return score + (location?.contourIndex === contourIndex && indexSet.has(location.pointIndex) ? 1 : 0);
        }, 0);
        return terminalScore + landmarkScore - indices.length * .0001;
      };
      const sourcePointIndices = scoreArc(forward) >= scoreArc(reverse) ? forward : reverse;
      const terminalIndexSet = new Set(terminalLocations.map(entry => entry.location.pointIndex));
      const arcIndexSet = new Set(sourcePointIndices);
      const hasTerminals = [...terminalIndexSet].every(index => arcIndexSet.has(index));
      const ownershipKeys = sourcePointIndices.map(index => `${contourIndex}:${index}`);
      const overlapsExisting = ownershipKeys.some(key => ownedPoints.has(key));
      if (!hasTerminals || sourcePointIndices.length < 3 || overlapsExisting) {
        definitions.push({ organFeature, organId, topologyStatus: 'ambiguous-ownership' });
        continue;
      }
      ownershipKeys.forEach(key => ownedPoints.add(key));
      definitions.push({
        organFeature,
        organId,
        contourIndex,
        sourcePointIndices,
        rootLandmarkIds: roots.map(feature => feature.id),
        topologyStatus: 'exclusive-contour-arc'
      });
    }
    return definitions;
  }

  function decomposeContours(contours, definitions) {
    const removedInterior = contours.map(() => new Set());
    for (const definition of definitions) {
      if (definition.topologyStatus !== 'exclusive-contour-arc') continue;
      const interior = definition.sourcePointIndices.slice(1, -1);
      for (const pointIndex of interior) removedInterior[definition.contourIndex].add(pointIndex);
      definition.contour = definition.sourcePointIndices.map(pointIndex => ({
        ...contours[definition.contourIndex][pointIndex],
        semanticLandmarkIds: contours[definition.contourIndex][pointIndex].semanticLandmarkIds?.slice()
      }));
    }
    const baseContours = contours.map((contour, contourIndex) => contour
      .filter((point, pointIndex) => !removedInterior[contourIndex].has(pointIndex))
      .map(point => ({ ...point, semanticLandmarkIds: point.semanticLandmarkIds?.slice() })))
      .filter(contour => contour.length >= 3);
    return { baseContours, definitions };
  }

  function contourCornerFlags(points, options = {}) {
    const threshold = clamp(
      Number.isFinite(+options.cornerAngleDeg) ? +options.cornerAngleDeg : 55,
      28,
      100
    ) * Math.PI / 180;
    return points.map((point, index) => {
      const previous = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 1) % points.length];
      const incoming = { x: point.x - previous.x, y: point.y - previous.y };
      const outgoing = { x: next.x - point.x, y: next.y - point.y };
      const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
      if (denominator < 1e-9) return true;
      const cosine = clamp(
        (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator,
        -1,
        1
      );
      return Math.acos(cosine) >= threshold;
    });
  }

  function rotateClosedContourForStableClosure(points, cornerFlags) {
    if (points.length < 4) return { points: points.slice(), cornerFlags: cornerFlags.slice() };
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let index = 0; index < points.length; index++) {
      const previous = (index - 1 + points.length) % points.length;
      const bothCorners = cornerFlags[index] && cornerFlags[previous];
      const score = pointDistance(points[previous], points[index]) * (bothCorners ? .08 : 1);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    return {
      points: [...points.slice(bestIndex), ...points.slice(0, bestIndex)],
      cornerFlags: [...cornerFlags.slice(bestIndex), ...cornerFlags.slice(0, bestIndex)]
    };
  }

  function clampControlVector(vector, maximumLength) {
    const length = Math.hypot(vector.x, vector.y);
    if (!length || length <= maximumLength) return vector;
    const scale = maximumLength / length;
    return { x: vector.x * scale, y: vector.y * scale };
  }

  function cubicSegmentControls(points, cornerFlags, index) {
    const start = points[index];
    const end = points[index + 1];
    const previous = points[(index - 1 + points.length) % points.length];
    const following = points[(index + 2) % points.length];
    const chord = { x: end.x - start.x, y: end.y - start.y };
    const chordLength = Math.max(1e-6, Math.hypot(chord.x, chord.y));
    const maximumControlLength = chordLength * .42;
    let outgoing = cornerFlags[index]
      ? { x: chord.x / 3, y: chord.y / 3 }
      : { x: (end.x - previous.x) / 6, y: (end.y - previous.y) / 6 };
    let incoming = cornerFlags[index + 1]
      ? { x: chord.x / 3, y: chord.y / 3 }
      : { x: (following.x - start.x) / 6, y: (following.y - start.y) / 6 };
    outgoing = clampControlVector(outgoing, maximumControlLength);
    incoming = clampControlVector(incoming, maximumControlLength);

    /* A noisy raster sample can point a Catmull-Rom tangent backwards. Falling
       back to the chord keeps the cubic inside its local edge corridor and
       prevents tiny loops without sacrificing a real smooth tangent. */
    if (outgoing.x * chord.x + outgoing.y * chord.y <= 0) {
      outgoing = { x: chord.x / 3, y: chord.y / 3 };
    }
    if (incoming.x * chord.x + incoming.y * chord.y <= 0) {
      incoming = { x: chord.x / 3, y: chord.y / 3 };
    }
    return {
      x1: start.x + outgoing.x,
      y1: start.y + outgoing.y,
      x2: end.x - incoming.x,
      y2: end.y - incoming.y
    };
  }

  function contourToSmoothCommands(source, options = {}) {
    const clean = removeCollinear(source);
    if (clean.length < 3) return [];
    const prepared = rotateClosedContourForStableClosure(
      clean,
      contourCornerFlags(clean, options)
    );
    const points = prepared.points;
    const cornerFlags = prepared.cornerFlags;
    const commands = [{
      type: 'M', x: points[0].x, y: points[0].y,
      semanticLandmarkIds: points[0].semanticLandmarkIds?.slice()
    }];
    for (let index = 0; index < points.length - 1; index++) {
      const controls = cubicSegmentControls(points, cornerFlags, index);
      commands.push({
        type: 'C',
        ...controls,
        x: points[index + 1].x,
        y: points[index + 1].y,
        semanticLandmarkIds: points[index + 1].semanticLandmarkIds?.slice()
      });
    }
    /* Z owns the shortest or a corner-to-corner closing edge. This avoids a
       duplicate editable anchor at the M point while making the only linear
       closure visually negligible (or structurally correct at a corner). */
    commands.push({ type: 'Z' });
    return commands;
  }

  function commandBundle(contours, options = {}, idPrefix = '') {
    const commands = [];
    for (const contour of contours) commands.push(...contourToSmoothCommands(contour, options));
    const anchorIdsByLandmark = new Map();
    const commandAnchors = [];
    commands.forEach((command, commandIndex) => {
      if (!['M', 'L', 'C'].includes(command.type)) return;
      const anchorId = `${idPrefix}p0:c${commandIndex}:anchor`;
      commandAnchors.push({ id: anchorId, point: { x: command.x, y: command.y } });
      for (const landmarkId of command.semanticLandmarkIds || []) {
        if (!anchorIdsByLandmark.has(landmarkId)) anchorIdsByLandmark.set(landmarkId, []);
        anchorIdsByLandmark.get(landmarkId).push(anchorId);
      }
      delete command.semanticLandmarkIds;
    });
    return {
      paths: commands.length ? [{ rule: 'evenodd', commands }] : [],
      commandAnchors,
      anchorIdsByLandmark
    };
  }

  function buildVector(contours, width, height, metadata = {}, features = [], options = {}) {
    const ownership = organContourOwnership(contours, features);
    const decomposition = decomposeContours(contours, ownership);
    const sourceBundle = commandBundle(contours, options);
    const baseBundle = commandBundle(decomposition.baseContours, options);
    const organById = new Map();
    const organs = [];
    for (const definition of decomposition.definitions) {
      if (definition.topologyStatus !== 'exclusive-contour-arc' || !definition.contour) continue;
      const bundle = commandBundle([definition.contour], options, `o:${definition.organId}:`);
      const anchorIds = bundle.commandAnchors.map(anchor => anchor.id);
      const boundaryPorts = definition.rootLandmarkIds.map((landmarkId, index) => {
        const organAnchorId = bundle.anchorIdsByLandmark.get(landmarkId)?.[0] || null;
        const sourceAnchorId = baseBundle.anchorIdsByLandmark.get(landmarkId)?.[0] || null;
        const sourceAnchor = baseBundle.commandAnchors.find(anchor => anchor.id === sourceAnchorId);
        return {
          id: `${definition.organId}-port-${index}`,
          role: features.find(feature => feature.id === landmarkId)?.role || `root-${index}`,
          landmarkFeatureId: landmarkId,
          sourceAnchorId,
          organAnchorId,
          sourcePoint: sourceAnchor ? { ...sourceAnchor.point } : null
        };
      }).filter(port => port.sourceAnchorId && port.organAnchorId && port.sourcePoint);
      if (boundaryPorts.length !== 2 || anchorIds.length < 3) continue;
      const organ = {
        id: definition.organId,
        type: 'stem',
        label: definition.organFeature.label,
        stemId: definition.organFeature.stemId,
        paths: bundle.paths.map(path => ({ ...path, rule: 'nonzero' })),
        anchorIds,
        landmarkFeatureIds: definition.organFeature.landmarkIds?.slice() || [],
        boundaryPorts,
        junction: {
          id: `${definition.organId}-junction`,
          type: 'paired-boundary-port',
          sourcePortIds: boundaryPorts.map(port => port.sourceAnchorId),
          organPortIds: boundaryPorts.map(port => port.organAnchorId)
        },
        ownership: {
          componentIndex: definition.organFeature.componentIndex,
          contourIndex: definition.contourIndex,
          sourcePointIndices: definition.sourcePointIndices.slice(),
          exclusive: true
        },
        transformMode: 'rigid-subpath',
        topologyStatus: 'exclusive-contour-arc'
      };
      organById.set(organ.id, { organ, bundle });
      organs.push(organ);
    }
    const boundFeatures = features.map(feature => {
      const organEntry = feature.organId ? organById.get(feature.organId) : null;
      let anchorIds = [];
      if (feature.type === 'stem-landmark' && organEntry) {
        anchorIds = organEntry.bundle.anchorIdsByLandmark.get(feature.id) || [];
      } else if (['stem-axis', 'stem-organ'].includes(feature.type) && organEntry) {
        anchorIds = organEntry.organ.anchorIds;
      } else if (feature.type === 'roof-stem-junction' && organEntry) {
        anchorIds = organEntry.organ.boundaryPorts.map(port => port.organAnchorId);
      } else {
        anchorIds = [...new Set((feature.landmarkIds || [feature.id])
          .flatMap(landmarkId => baseBundle.anchorIdsByLandmark.get(landmarkId) || []))];
      }
      const bound = anchorIds.length > 0;
      const copy = {
        ...feature,
        topologyStatus: bound
          ? organEntry ? 'bound-organ-subpath' : 'bound-contour'
          : 'unbound-reference',
        point: feature.point ? { ...feature.point } : undefined,
        root: feature.root ? { ...feature.root } : undefined,
        tip: feature.tip ? { ...feature.tip } : undefined
      };
      if (bound) copy.anchorIds = [...new Set(anchorIds)];
      else if (!['stem-axis', 'stem-organ'].includes(feature.type)) copy.editable = false;
      return copy;
    });
    const editablePaths = [...baseBundle.paths, ...organs.flatMap(organ => organ.paths)];
    const anchors = editablePaths.reduce((sum, path) => sum + path.commands.filter(command => (
      ['M', 'L', 'C'].includes(command.type)
    )).length, 0);
    const controls = editablePaths.reduce((sum, path) => sum + path.commands.filter(command => (
      command.type === 'C'
    )).length * 2, 0);
    return {
      schemaVersion: 3,
      sourceKey: 'photographed-selection',
      letter: '',
      tradition: 'custom',
      style: 'photographed-letter',
      slug: 'photographed-selection',
      viewBox: [0, 0, width, height],
      weight: 1,
      revision: 1,
      paths: sourceBundle.paths,
      composition: {
        schemaVersion: 3,
        mode: 'organ-subpaths-v1',
        basePaths: baseBundle.paths,
        connectorMode: 'paired-boundary-port-bridge'
      },
      organs,
      handleCounts: { anchors, controls, total: anchors + controls },
      featureCoordinateSpace: 'vector-local',
      featureAngleConvention: 'signed-clockwise-from-vertical',
      features: boundFeatures,
      trace: {
        ...metadata,
        contourCount: contours.length,
        anchorCount: anchors,
        sourceAnchorCount: sourceBundle.commandAnchors.length,
        controlCount: controls,
        cubicCount: controls / 2,
        featureCount: features.length,
        stemCount: features.filter(feature => feature.type === 'stem-axis').length,
        boundLandmarkCount: boundFeatures.filter(feature => (
          feature.type === 'stem-landmark' && feature.anchorIds?.length
        )).length,
        organCount: organs.length
      }
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
    const componentAnalysis = connectedComponents(binary, width, height);
    const meaningful = meaningfulComponents(componentAnalysis.components).components;
    const componentIndexByLabel = new Map(
      meaningful.map((component, componentIndex) => [component.label, componentIndex])
    );
    const rawContours = traceContours(binary, width, height);
    const rawContourComponentIndices = rawContours.map(contour => {
      const label = contourComponentLabel(
        contour,
        componentAnalysis.labels,
        width,
        height
      );
      return componentIndexByLabel.get(label) ?? null;
    });
    const features = detectPhotographedFeatures(binary, width, height, componentAnalysis);
    const requestedMaximumAnchors = Math.max(3, Math.round(+options.maximumAnchors || 420));
    const landmarkReserve = features.filter(feature => (
      ['stem-landmark', 'roof-endpoint', 'contour-extremum'].includes(feature.type)
    )).length;
    const simplified = simplifyContours(rawContours, width, height, {
      ...options,
      contourComponentIndices: rawContourComponentIndices,
      maximumAnchors: Math.max(3, requestedMaximumAnchors - landmarkReserve)
    });
    if (!simplified.contours.length) throw new Error('The photographed letter did not produce a closed vector contour.');
    const semanticContours = injectSemanticLandmarkAnchors(simplified.contours, features, {
      tolerance: simplified.tolerance,
      contourComponentIndices: simplified.componentIndices
    });
    const vector = buildVector(semanticContours, width, height, {
      threshold,
      selectedPixelCount,
      inkPixelCount,
      tolerance: simplified.tolerance,
      selectionVertexCount: polygon.length,
      droppedContourCount: simplified.droppedContourCount,
      semanticMethod: 'contour-topology-v3'
    }, features, options);
    return {
      threshold,
      selectedPixelCount,
      inkPixelCount,
      contours: semanticContours,
      features: vector.features,
      tolerance: simplified.tolerance,
      selectionVertexCount: polygon.length,
      droppedContourCount: simplified.droppedContourCount,
      vector
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
