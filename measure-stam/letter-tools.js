'use strict';

const LETTER_VECTOR_CACHE = new Map();
const LETTER_MORPH_CACHE = new Map();
const LETTER_TOPOLOGY_CACHE = new Map();
const LETTER_WEIGHT_DIAGNOSTICS = new WeakMap();
const LETTER_MORPH_CACHE_MAX_BYTES = 24 * 1024 * 1024;
const LETTER_MORPH_PIXELS_PER_NIB = 24;
const LETTER_EDIT_TOPOLOGY_PIXELS_PER_NIB = 8;
const LETTER_TOPOLOGY_ANALYZER_BYTES_PER_PIXEL = 44;
const LETTER_NIB_X_SOURCE = 4.5;
const LETTER_NIB_Y_SOURCE = 12.5;
const LETTER_MORPH_PADDING_NIBS = 1.5;
const LETTER_MAX_OUTLINE_WIDTH = 30;
/* Exhaustive cross-resolution first-unsafe intensity; null means 100 is safe. */
const LETTER_SOURCE_FIRST_UNSAFE_INTENSITY = Object.freeze({
  'beit-yosef:א': [47, 84], 'beit-yosef:ב': [47, null],
  'beit-yosef:ג': [47, 58], 'beit-yosef:ד': [65, null],
  'beit-yosef:ה': [47, 98], 'beit-yosef:ו': [null, null],
  'beit-yosef:ז': [47, 58], 'beit-yosef:ח': [58, null],
  'beit-yosef:ט': [47, 58], 'beit-yosef:י': [99, null],
  'beit-yosef:כ': [null, null], 'beit-yosef:ך': [null, null],
  'beit-yosef:ל': [null, null], 'beit-yosef:מ': [61, null],
  'beit-yosef:ם': [null, null], 'beit-yosef:נ': [47, 44],
  'beit-yosef:ן': [47, 58], 'beit-yosef:ס': [null, null],
  'beit-yosef:ע': [47, 58], 'beit-yosef:פ': [96, null],
  'beit-yosef:ף': [null, null], 'beit-yosef:צ': [33, 58],
  'beit-yosef:ץ': [47, 58], 'beit-yosef:ק': [61, null],
  'beit-yosef:ר': [null, null], 'beit-yosef:ש': [44, 58],
  'beit-yosef:ת': [null, null],
  'ari:א': [33, 84], 'ari:ו': [null, null], 'ari:ח': [58, null],
  'ari:ט': [47, 58], 'ari:צ': [47, 68], 'ari:ק': [47, 58],
  'ari:ש': [47, 58]
});
let activeLetterTradition = 'beitYosef';
let letterWeightHistoryArmed = false;
let letterMorphForceExactId = null;
let letterWeightRenderFrame = null;
let letterWeightRenderDirty = false;
let letterWeightPreviewId = null;

/*
 * Weight is a non-destructive render effect. The source paths stay cubic and
 * editable; morphology is applied only to the union alpha mask below. Keeping
 * these helpers independent of Canvas makes the topology rules testable in
 * Node as well as in the browser.
 */
const MEDIDAOT_LETTER_MORPHOLOGY = (() => {
  function assertMask(alpha, width, height) {
    if (!alpha || alpha.length !== width * height) {
      throw new RangeError('Alpha mask dimensions do not match its data.');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError('Alpha mask dimensions must be positive integers.');
    }
  }

  function distanceTransform1D(source, length, output, sites, breaks) {
    let last = 0;
    sites[0] = 0;
    breaks[0] = -Infinity;
    breaks[1] = Infinity;
    for (let q = 1; q < length; q += 1) {
      let site = sites[last];
      let intersection = (
        (source[q] + q * q) - (source[site] + site * site)
      ) / (2 * (q - site));
      while (intersection <= breaks[last]) {
        last -= 1;
        site = sites[last];
        intersection = (
          (source[q] + q * q) - (source[site] + site * site)
        ) / (2 * (q - site));
      }
      last += 1;
      sites[last] = q;
      breaks[last] = intersection;
      breaks[last + 1] = Infinity;
    }
    last = 0;
    for (let q = 0; q < length; q += 1) {
      while (breaks[last + 1] < q) last += 1;
      const delta = q - sites[last];
      output[q] = delta * delta + source[sites[last]];
    }
  }

  function squaredDistanceTo(alpha, width, height, featureIsInk) {
    assertMask(alpha, width, height);
    const pixelCount = width * height;
    const far = width * width + height * height + 1;
    const firstPass = new Float32Array(pixelCount);
    const result = new Float32Array(pixelCount);
    const maximum = Math.max(width, height);
    const source = new Float64Array(maximum);
    const output = new Float64Array(maximum);
    const sites = new Int32Array(maximum);
    const breaks = new Float64Array(maximum + 1);

    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        const ink = alpha[y * width + x] >= 128;
        source[y] = ink === featureIsInk ? 0 : far;
      }
      distanceTransform1D(source, height, output, sites, breaks);
      for (let y = 0; y < height; y += 1) firstPass[y * width + x] = output[y];
    }
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) source[x] = firstPass[row + x];
      distanceTransform1D(source, width, output, sites, breaks);
      for (let x = 0; x < width; x += 1) result[row + x] = output[x];
    }
    return result;
  }

  function buildSignedDistance(alpha, width, height) {
    assertMask(alpha, width, height);
    const distanceToInk = squaredDistanceTo(alpha, width, height, true);
    const distanceToClear = squaredDistanceTo(alpha, width, height, false);
    const signed = new Float32Array(alpha.length);
    for (let index = 0; index < alpha.length; index += 1) {
      const coverage = alpha[index] / 255;
      if (coverage > 0 && coverage < 1) {
        signed[index] = coverage - .5;
      } else if (coverage >= .5) {
        signed[index] = Math.max(.5, Math.sqrt(distanceToClear[index]) - .5);
      } else {
        signed[index] = -Math.max(.5, Math.sqrt(distanceToInk[index]) - .5);
      }
    }
    return signed;
  }

  function renderSignedDistance(signed, offsetPixels = 0, outlineWidthPixels = 0) {
    const result = new Uint8ClampedArray(signed.length);
    const offset = Number.isFinite(+offsetPixels) ? +offsetPixels : 0;
    const outlineHalfWidth = Math.max(0, Number(outlineWidthPixels) || 0) / 2;
    if (outlineHalfWidth > 0) {
      for (let index = 0; index < signed.length; index += 1) {
        const coverage = outlineHalfWidth - Math.abs(signed[index] + offset) + .5;
        result[index] = Math.round(Math.max(0, Math.min(1, coverage)) * 255);
      }
    } else {
      for (let index = 0; index < signed.length; index += 1) {
        const coverage = signed[index] + offset + .5;
        result[index] = Math.round(Math.max(0, Math.min(1, coverage)) * 255);
      }
    }
    return result;
  }

  function alphaArea(alpha) {
    let area = 0;
    for (const value of alpha) area += value / 255;
    return area;
  }

  function alphaBounds(alpha, width, height, threshold = 1) {
    assertMask(alpha, width, height);
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        if (alpha[row + x] < threshold) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) return null;
    return { x: left, y: top, left, top, right: right + 1, bottom: bottom + 1,
      width: right - left + 1, height: bottom - top + 1 };
  }

  function maskComponents(alpha, width, height, ink = true) {
    assertMask(alpha, width, height);
    const labels = new Int32Array(alpha.length);
    labels.fill(-1);
    const queue = new Int32Array(alpha.length);
    const components = [];
    const offsets = ink
      ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      : [[0, -1], [-1, 0], [1, 0], [0, 1]];
    const matches = index => (alpha[index] >= 128) === ink;
    for (let start = 0; start < alpha.length; start += 1) {
      if (labels[start] !== -1 || !matches(start)) continue;
      const label = components.length;
      let head = 0;
      let tail = 0;
      let touchesBorder = false;
      let left = width;
      let top = height;
      let right = -1;
      let bottom = -1;
      queue[tail++] = start;
      labels[start] = label;
      const pixels = [];
      while (head < tail) {
        const index = queue[head++];
        pixels.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
        for (const [dx, dy] of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (labels[next] !== -1 || !matches(next)) continue;
          labels[next] = label;
          queue[tail++] = next;
        }
      }
      components.push({ label, pixels, area: pixels.length, touchesBorder,
        bounds: { left, top, right: right + 1, bottom: bottom + 1,
          width: right - left + 1, height: bottom - top + 1 } });
    }
    return { labels, components };
  }

  function labelSignedComponents(signed, width, height, offset, ink, labels, queue) {
    labels.fill(-1);
    const components = [];
    const matches = index => (signed[index] + offset >= 0) === ink;
    for (let start = 0; start < signed.length; start += 1) {
      if (labels[start] !== -1 || !matches(start)) continue;
      const label = components.length;
      let head = 0;
      let tail = 0;
      let touchesBorder = false;
      queue[tail++] = start;
      labels[start] = label;
      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
        const minimumY = Math.max(0, y - 1);
        const maximumY = Math.min(height - 1, y + 1);
        const minimumX = Math.max(0, x - 1);
        const maximumX = Math.min(width - 1, x + 1);
        for (let nextY = minimumY; nextY <= maximumY; nextY += 1) {
          const row = nextY * width;
          for (let nextX = minimumX; nextX <= maximumX; nextX += 1) {
            if (nextX === x && nextY === y) continue;
            if (!ink && nextX !== x && nextY !== y) continue;
            const next = row + nextX;
            if (labels[next] !== -1 || !matches(next)) continue;
            labels[next] = label;
            queue[tail++] = next;
          }
        }
      }
      components.push({ label, area: tail, touchesBorder });
    }
    return components;
  }

  function createTopologySafetyAnalyzer(alpha, signed, width, height) {
    const inkSet = maskComponents(alpha, width, height, true);
    const clearSet = maskComponents(alpha, width, height, false);
    const inkArea = inkSet.components.reduce((sum, component) => sum + component.area, 0);
    const significantArea = Math.max(3, Math.ceil(inkArea * .001));
    const majorInk = inkSet.components.filter(component => component.area >= significantArea);
    const majorHoles = clearSet.components.filter(component =>
      !component.touchesBorder && component.area >= significantArea
    );
    const inkLabels = new Int32Array(alpha.length);
    const clearLabels = new Int32Array(alpha.length);
    const queue = new Int32Array(alpha.length);
    const safeAt = offset => {
      const eroding = offset < 0;
      const outputInk = labelSignedComponents(
        signed, width, height, offset, true, inkLabels, queue
      );
      const outputClear = labelSignedComponents(
        signed, width, height, offset, false, clearLabels, queue
      );
      if (eroding) {
        const occupiedInkLabels = new Set();
        for (const component of majorInk) {
          const labelCounts = new Map();
          let retained = 0;
          for (const pixel of component.pixels) {
            const label = inkLabels[pixel];
            if (label < 0) continue;
            retained += 1;
            labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
          }
          const significantLabels = [...labelCounts]
            .filter(([, area]) => area >= significantArea)
            .map(([label]) => label);
          const minimumRetained = Math.max(3, Math.ceil(component.area * .025));
          if (retained < minimumRetained || significantLabels.length !== 1) return false;
          occupiedInkLabels.add(significantLabels[0]);
        }
        if (occupiedInkLabels.size !== majorInk.length) return false;
        const occupiedHoleLabels = new Set();
        for (const component of majorHoles) {
          const outputLabel = clearLabels[component.pixels[0]];
          const outputComponent = outputClear[outputLabel];
          if (outputLabel < 0 || outputComponent?.touchesBorder || occupiedHoleLabels.has(outputLabel)) {
            return false;
          }
          occupiedHoleLabels.add(outputLabel);
        }
      } else {
        const occupiedLabels = new Set();
        for (const component of majorInk) {
          const outputLabel = inkLabels[component.pixels[0]];
          if (outputLabel < 0 || occupiedLabels.has(outputLabel)) return false;
          occupiedLabels.add(outputLabel);
        }
        const knownHoleLabels = new Set();
        for (const component of majorHoles) {
          const labelCounts = new Map();
          let retained = 0;
          for (const pixel of component.pixels) {
            const label = clearLabels[pixel];
            if (label < 0) continue;
            retained += 1;
            labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
          }
          const significantLabels = [...labelCounts]
            .filter(([, area]) => area >= significantArea)
            .map(([label]) => label);
          const minimumRetained = Math.max(3, Math.ceil(component.area * .025));
          if (retained < minimumRetained || significantLabels.length !== 1) return false;
          knownHoleLabels.add(significantLabels[0]);
        }
        if (knownHoleLabels.size !== majorHoles.length) return false;
        const outputHoles = outputClear.filter(component =>
          !component.touchesBorder && component.area >= significantArea
        );
        if (outputHoles.some(component => !knownHoleLabels.has(component.label))) return false;
      }
      return true;
    };
    return {
      safeAt,
      inkComponents: majorInk.length,
      counters: majorHoles.length,
      significantArea
    };
  }

  function topologyLimits(alpha, signed, width, height, maximumOffset) {
    const analyzer = createTopologySafetyAnalyzer(alpha, signed, width, height);
    const findLimit = direction => {
      /*
       * Topology is not mathematically monotone: a split-off fragment can
       * disappear at a stronger offset and make a later sample look "safe"
       * again. Walk out from the master and stop at the first unsafe band.
       */
      const intensitySteps = 100;
      let previousSafe = 0;
      for (let step = 1; step <= intensitySteps; step += 1) {
        const probe = maximumOffset * step / intensitySteps;
        if (!analyzer.safeAt(direction * probe)) return previousSafe;
        previousSafe = probe;
      }
      return maximumOffset;
    };
    return {
      erosion: findLimit(-1),
      dilation: findLimit(1),
      inkComponents: analyzer.inkComponents,
      counters: analyzer.counters,
      significantArea: analyzer.significantArea
    };
  }

  function topologySummary(alpha, width, height) {
    const inkSet = maskComponents(alpha, width, height, true);
    const clearSet = maskComponents(alpha, width, height, false);
    const inkArea = inkSet.components.reduce((sum, component) => sum + component.area, 0);
    const significantArea = Math.max(3, Math.ceil(inkArea * .001));
    return {
      inkComponents: inkSet.components.filter(component => component.area >= significantArea).length,
      counters: clearSet.components.filter(component =>
        !component.touchesBorder && component.area >= significantArea
      ).length,
      significantArea
    };
  }

  function downsampleAlpha(alpha, width, height, factor) {
    assertMask(alpha, width, height);
    const step = Math.max(1, Math.round(Number(factor) || 1));
    if (step === 1) return { alpha: new Uint8ClampedArray(alpha), width, height, factor: 1 };
    const resultWidth = Math.ceil(width / step);
    const resultHeight = Math.ceil(height / step);
    const result = new Uint8ClampedArray(resultWidth * resultHeight);
    for (let y = 0; y < resultHeight; y += 1) {
      for (let x = 0; x < resultWidth; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = 0; dy < step && y * step + dy < height; dy += 1) {
          const row = (y * step + dy) * width;
          for (let dx = 0; dx < step && x * step + dx < width; dx += 1) {
            sum += alpha[row + x * step + dx];
            count += 1;
          }
        }
        result[y * resultWidth + x] = Math.round(sum / Math.max(1, count));
      }
    }
    return { alpha: result, width: resultWidth, height: resultHeight, factor: step };
  }

  function stableEnvelope(bounds, padding) {
    const pad = Math.max(0, Number(padding) || 0);
    const left = Math.floor(bounds.left - pad);
    const top = Math.floor(bounds.top - pad);
    const right = Math.ceil(bounds.right + pad);
    const bottom = Math.ceil(bounds.bottom + pad);
    return {
      x: left,
      y: top,
      left,
      top,
      right,
      bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  return Object.freeze({
    buildSignedDistance,
    renderSignedDistance,
    alphaArea,
    alphaBounds,
    maskComponents,
    createTopologySafetyAnalyzer,
    topologyLimits,
    topologySummary,
    downsampleAlpha,
    stableEnvelope
  });
})();

globalThis.MEDIDAOT_LETTER_MORPHOLOGY = MEDIDAOT_LETTER_MORPHOLOGY;

function letterVectorEngine() {
  return globalThis.MEDIDAOT_VECTOR_ENGINE || null;
}

function isLetterTemplate(object) {
  return object?.type === 'letterTemplate';
}

function isPhotographedVector(object) {
  return isLetterTemplate(object) &&
    object?.template?.kind === 'image-region-vector' &&
    Array.isArray(object?.letterVector?.paths);
}

function letterTraditionLabel(tradition) {
  if (tradition === 'custom') return 'אות מצולמת';
  return tradition === 'ari' ? 'כתב האר״י' : 'בית יוסף';
}

function letterAsset(objectOrLetter, tradition = 'beitYosef') {
  const letter = typeof objectOrLetter === 'string'
    ? objectOrLetter
    : objectOrLetter?.template?.letter;
  const selectedTradition = typeof objectOrLetter === 'string'
    ? tradition
    : objectOrLetter?.template?.tradition || tradition;
  return globalThis.MEDIDAOT_LETTERS?.traditions?.[selectedTradition]?.[letter] || null;
}

function cachedLetterPaths(asset) {
  if (!asset || typeof Path2D !== 'function') return [];
  const cacheKey = `${asset.style}:${asset.slug}`;
  if (!LETTER_VECTOR_CACHE.has(cacheKey)) {
    LETTER_VECTOR_CACHE.set(cacheKey, asset.paths.map(path => ({
      path: new Path2D(path.d),
      rule: path.rule === 'evenodd' ? 'evenodd' : 'nonzero'
    })));
  }
  return LETTER_VECTOR_CACHE.get(cacheKey);
}

function letterMasterSignature(object, asset) {
  const paths = object?.letterVector?.paths;
  if (!Array.isArray(paths)) return `${asset?.style || ''}:${asset?.slug || ''}:source`;
  let hash = 2166136261;
  const mix = value => {
    const string = String(value);
    for (let index = 0; index < string.length; index += 1) {
      hash ^= string.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const entry of paths) {
    mix(entry.rule || 'nonzero');
    for (const command of entry.commands || []) {
      mix(command.type);
      for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
        if (Number.isFinite(command[key])) mix(Math.round(command[key] * 10000));
      }
    }
  }
  return `${asset?.style || ''}:${asset?.slug || ''}:${paths.length}:${(hash >>> 0).toString(36)}`;
}

function createLetterMaskCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvasElement = document.createElement('canvas');
    canvasElement.width = width;
    canvasElement.height = height;
    return canvasElement;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  throw new Error('Canvas is unavailable for letter-mask rendering.');
}

function transformLetterBounds(bounds, matrix) {
  const points = [
    { x: bounds.left, y: bounds.top },
    { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom },
    { x: bounds.left, y: bounds.bottom }
  ].map(point => ({
    x: point.x * matrix.a + point.y * matrix.c + matrix.e,
    y: point.x * matrix.b + point.y * matrix.d + matrix.f
  }));
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

function pruneLetterMorphCache() {
  const entryBytes = entry => entry.pixelCount * (
    5
    + entry.rendered.size * 4
    + (entry.exactTopologyAnalyzer ? LETTER_TOPOLOGY_ANALYZER_BYTES_PER_PIXEL : 0)
  );
  let bytes = 0;
  for (const entry of LETTER_MORPH_CACHE.values()) bytes += entryBytes(entry);
  while (bytes > LETTER_MORPH_CACHE_MAX_BYTES && LETTER_MORPH_CACHE.size > 1) {
    const oldestKey = LETTER_MORPH_CACHE.keys().next().value;
    const oldest = LETTER_MORPH_CACHE.get(oldestKey);
    LETTER_MORPH_CACHE.delete(oldestKey);
    bytes -= oldest ? entryBytes(oldest) : 0;
  }
}

function buildLetterUnionMask(
  object,
  rect,
  asset,
  unitScale,
  requestedPixelsPerNib = LETTER_MORPH_PIXELS_PER_NIB
) {
  const layoutMode = object?.template?.layoutMode || 'tight-v1';
  const pixelsPerNib = requestedPixelsPerNib >= 48
    ? 48
    : requestedPixelsPerNib <= LETTER_EDIT_TOPOLOGY_PIXELS_PER_NIB
      ? LETTER_EDIT_TOPOLOGY_PIXELS_PER_NIB
      : LETTER_MORPH_PIXELS_PER_NIB;
  const masterSignature = letterMasterSignature(object, asset);
  const cacheKey = [
    masterSignature,
    layoutMode,
    pixelsPerNib,
    LETTER_NIB_X_SOURCE,
    LETTER_NIB_Y_SOURCE
  ].join('|');
  const cached = LETTER_MORPH_CACHE.get(cacheKey);
  if (cached) {
    LETTER_MORPH_CACHE.delete(cacheKey);
    LETTER_MORPH_CACHE.set(cacheKey, cached);
    return cached;
  }
  const engine = letterVectorEngine();
  const master = engine?.buildPath2D?.(object, { asset, weight: 1, shared: true });
  const entries = master?.available ? master.entries : cachedLetterPaths(asset);
  const [, , viewWidth, viewHeight] = asset.viewBox;
  const metrics = letterSourceMetrics(object);
  const layoutWidth = layoutMode === 'source-cell-v2'
    ? metrics?.sourceCell?.width || viewWidth
    : viewWidth;
  const layoutHeight = layoutMode === 'source-cell-v2'
    ? metrics?.sourceCell?.height || viewHeight
    : viewHeight;
  const canonicalRect = { x: 0, y: 0, width: layoutWidth, height: layoutHeight };
  const transform = engine?.getLayoutTransform?.(object, { rect: canonicalRect, asset });
  const fallbackMatrix = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: -asset.viewBox[0],
    f: -asset.viewBox[1]
  };
  const matrix = transform?.matrix || fallbackMatrix;
  const localBounds = master?.bounds || {
    left: asset.viewBox[0],
    top: asset.viewBox[1],
    right: asset.viewBox[0] + viewWidth,
    bottom: asset.viewBox[1] + viewHeight
  };
  const masterBounds = transformLetterBounds(localBounds, matrix);
  const envelope = {
    left: Math.floor(masterBounds.left - LETTER_NIB_X_SOURCE * LETTER_MORPH_PADDING_NIBS),
    top: Math.floor(masterBounds.top - LETTER_NIB_Y_SOURCE * LETTER_MORPH_PADDING_NIBS),
    right: Math.ceil(masterBounds.right + LETTER_NIB_X_SOURCE * LETTER_MORPH_PADDING_NIBS),
    bottom: Math.ceil(masterBounds.bottom + LETTER_NIB_Y_SOURCE * LETTER_MORPH_PADDING_NIBS)
  };
  envelope.x = envelope.left;
  envelope.y = envelope.top;
  envelope.width = Math.max(1, envelope.right - envelope.left);
  envelope.height = Math.max(1, envelope.bottom - envelope.top);
  const rasterScaleX = pixelsPerNib / LETTER_NIB_X_SOURCE;
  const rasterScaleY = pixelsPerNib / LETTER_NIB_Y_SOURCE;
  const width = Math.max(1, Math.ceil(envelope.width * rasterScaleX));
  const height = Math.max(1, Math.ceil(envelope.height * rasterScaleY));
  const maskCanvas = createLetterMaskCanvas(width, height);
  const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
  maskContext.setTransform(
    rasterScaleX,
    0,
    0,
    rasterScaleY,
    -envelope.x * rasterScaleX,
    -envelope.y * rasterScaleY
  );
  maskContext.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  maskContext.fillStyle = '#fff';
  maskContext.globalAlpha = 1;
  for (const entry of entries) maskContext.fill(entry.path, entry.rule);
  maskContext.setTransform(1, 0, 0, 1, 0, 0);
  const rgba = maskContext.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0, sourceIndex = 3; index < alpha.length; index += 1, sourceIndex += 4) {
    alpha[index] = rgba[sourceIndex];
  }
  const signed = MEDIDAOT_LETTER_MORPHOLOGY.buildSignedDistance(alpha, width, height);
  const materializedVector = Array.isArray(object?.letterVector?.paths);
  const sourceFirstUnsafe = LETTER_SOURCE_FIRST_UNSAFE_INTENSITY[
    `${asset.style}:${asset.letter}`
  ];
  const sourceUnsafe = !materializedVector ? sourceFirstUnsafe : null;
  const fastMaterializedPreview = materializedVector
    && pixelsPerNib === LETTER_EDIT_TOPOLOGY_PIXELS_PER_NIB;
  /*
   * A materialized master can change after every anchor release. A complete
   * K24 prefix scan is too costly for that interaction. The transient K8
   * slider base skips that scan. Edited K24/K48 bases start with the source
   * letter's exhaustively known cross-resolution range, then validate the
   * exact current full-resolution offset against the edited master.
   */
  const topologyAnalysisPixelsPerNib = Math.min(
    pixelsPerNib,
    materializedVector ? LETTER_EDIT_TOPOLOGY_PIXELS_PER_NIB : LETTER_MORPH_PIXELS_PER_NIB
  );
  const topologyKey = [
    masterSignature,
    layoutMode,
    sourceUnsafe ? 'source-cross-resolution-prefix-v2' : 'edited-source-hint-v4',
    topologyAnalysisPixelsPerNib,
    LETTER_NIB_X_SOURCE,
    LETTER_NIB_Y_SOURCE
  ].join('|');
  let normalizedTopology = LETTER_TOPOLOGY_CACHE.get(topologyKey);
  if (normalizedTopology) {
    LETTER_TOPOLOGY_CACHE.delete(topologyKey);
    LETTER_TOPOLOGY_CACHE.set(topologyKey, normalizedTopology);
  }
  if (!normalizedTopology) {
    const factor = Math.max(1, Math.round(pixelsPerNib / topologyAnalysisPixelsPerNib));
    const proxy = MEDIDAOT_LETTER_MORPHOLOGY.downsampleAlpha(alpha, width, height, factor);
    let proxyTopology;
    if (sourceUnsafe || (materializedVector && sourceFirstUnsafe)) {
      const summary = MEDIDAOT_LETTER_MORPHOLOGY.topologySummary(
        proxy.alpha, proxy.width, proxy.height
      );
      const firstUnsafe = sourceUnsafe || sourceFirstUnsafe;
      const safeErosionIntensity = firstUnsafe[0] === null
        ? 100
        : Math.max(0, firstUnsafe[0] - 1);
      const safeDilationIntensity = firstUnsafe[1] === null
        ? 100
        : Math.max(0, firstUnsafe[1] - 1);
      proxyTopology = {
        erosion: .45 * topologyAnalysisPixelsPerNib / 2 * safeErosionIntensity / 100,
        dilation: .45 * topologyAnalysisPixelsPerNib / 2 * safeDilationIntensity / 100,
        ...summary
      };
    } else if (fastMaterializedPreview) {
      proxyTopology = {
        erosion: .45 * topologyAnalysisPixelsPerNib / 2,
        dilation: .45 * topologyAnalysisPixelsPerNib / 2,
        ...MEDIDAOT_LETTER_MORPHOLOGY.topologySummary(
          proxy.alpha,
          proxy.width,
          proxy.height
        )
      };
    } else {
      const proxySigned = MEDIDAOT_LETTER_MORPHOLOGY.buildSignedDistance(
        proxy.alpha,
        proxy.width,
        proxy.height
      );
      proxyTopology = MEDIDAOT_LETTER_MORPHOLOGY.topologyLimits(
        proxy.alpha,
        proxySigned,
        proxy.width,
        proxy.height,
        .45 * topologyAnalysisPixelsPerNib / 2
      );
    }
    normalizedTopology = {
      erosionNib: proxyTopology.erosion / topologyAnalysisPixelsPerNib,
      dilationNib: proxyTopology.dilation / topologyAnalysisPixelsPerNib,
      inkComponents: proxyTopology.inkComponents,
      counters: proxyTopology.counters,
      significantAreaNib: proxyTopology.significantArea /
        (topologyAnalysisPixelsPerNib * topologyAnalysisPixelsPerNib),
      analysisPixelsPerNib: topologyAnalysisPixelsPerNib
    };
    LETTER_TOPOLOGY_CACHE.set(topologyKey, normalizedTopology);
    while (LETTER_TOPOLOGY_CACHE.size > 128) {
      LETTER_TOPOLOGY_CACHE.delete(LETTER_TOPOLOGY_CACHE.keys().next().value);
    }
  }
  const topology = {
    erosion: normalizedTopology.erosionNib * pixelsPerNib,
    dilation: normalizedTopology.dilationNib * pixelsPerNib,
    inkComponents: normalizedTopology.inkComponents,
    counters: normalizedTopology.counters,
    significantArea: Math.max(3, Math.round(
      normalizedTopology.significantAreaNib * pixelsPerNib * pixelsPerNib
    )),
    analysisPixelsPerNib: normalizedTopology.analysisPixelsPerNib
  };
  const result = {
    cacheKey,
    width,
    height,
    pixelCount: width * height,
    envelope,
    layoutWidth,
    layoutHeight,
    rasterScaleX,
    rasterScaleY,
    pixelsPerNib,
    signed,
    masterAlpha: alpha,
    masterInkBounds: MEDIDAOT_LETTER_MORPHOLOGY.alphaBounds(alpha, width, height, 1),
    topology,
    requiresExactTopologyValidation: materializedVector,
    exactTopologyAnalyzer: null,
    exactTopologyOffsets: new Map(),
    rendered: new Map()
  };
  LETTER_MORPH_CACHE.set(cacheKey, result);
  pruneLetterMorphCache();
  return result;
}

function letterColorChannels(color) {
  const value = /^#[0-9a-f]{6}$/i.test(color || '') ? color.slice(1) : '2563eb';
  const number = Number.parseInt(value, 16);
  return [number >> 16 & 255, number >> 8 & 255, number & 255];
}

function resolveLetterWeightOffset(base, requestedWeight, options = {}) {
  const exactTopology = options?.exactTopology !== false;
  const weight = clamp(Number(requestedWeight) || 1, .55, 1.45);
  const requestedOffset = (weight - 1) * base.pixelsPerNib / 2;
  const hintedOffset = requestedOffset < 0
    ? -Math.min(-requestedOffset, base.topology.erosion)
    : Math.min(requestedOffset, base.topology.dilation);
  let appliedOffset = hintedOffset;
  let exactValidated = false;
  if (exactTopology
    && base.requiresExactTopologyValidation
    && Math.abs(hintedOffset) > .0001) {
    exactValidated = true;
    const cacheKey = hintedOffset.toFixed(4);
    const cached = base.exactTopologyOffsets.get(cacheKey);
    if (Number.isFinite(cached)) {
      appliedOffset = cached;
    } else {
      const transientAnalyzer = base.pixelsPerNib >= 48;
      let analyzer = base.exactTopologyAnalyzer;
      if (!analyzer) {
        analyzer = MEDIDAOT_LETTER_MORPHOLOGY.createTopologySafetyAnalyzer(
          base.masterAlpha,
          base.signed,
          base.width,
          base.height
        );
        if (!transientAnalyzer) {
          base.exactTopologyAnalyzer = analyzer;
          pruneLetterMorphCache();
        }
      }
      const direction = Math.sign(hintedOffset);
      const intensityStep = .45 * base.pixelsPerNib / 2 / 100;
      while (
        Math.abs(appliedOffset) > .0001
        && !analyzer.safeAt(appliedOffset)
      ) {
        appliedOffset = direction * Math.max(0, Math.abs(appliedOffset) - intensityStep);
      }
      if (Math.abs(appliedOffset) <= .0001) appliedOffset = 0;
      base.exactTopologyOffsets.set(cacheKey, appliedOffset);
      while (base.exactTopologyOffsets.size > 64) {
        base.exactTopologyOffsets.delete(base.exactTopologyOffsets.keys().next().value);
      }
    }
  }
  const effectiveWeight = 1 + appliedOffset * 2 / base.pixelsPerNib;
  return {
    requested: weight,
    effective: effectiveWeight,
    capped: Math.abs(requestedOffset - appliedOffset) > .02,
    exactValidated,
    exactBackoff: Math.abs(hintedOffset - appliedOffset) > .0001,
    requestedOffset,
    hintedOffset,
    appliedOffset
  };
}

function renderedLetterMask(base, object, unitScale, options = {}) {
  const weightInfo = resolveLetterWeightOffset(base, object.letterWeight, options);
  const mode = object.letterMode === 'outline' ? 'outline' : 'solid';
  const outlineWidth = mode === 'outline'
    ? clamp(Number(object.letterOutlineWidth) || 2.5, .5, LETTER_MAX_OUTLINE_WIDTH)
    : 0;
  const color = object.color || '#2563eb';
  const outlinePixels = mode === 'outline'
    ? Math.max(.5, Number(unitScale?.outlinePixels) || outlineWidth)
    : 0;
  const renderKey = `${weightInfo.appliedOffset.toFixed(3)}|${mode}|${outlinePixels.toFixed(2)}|${color}`;
  const cached = base.rendered.get(renderKey);
  if (cached) {
    base.rendered.delete(renderKey);
    base.rendered.set(renderKey, cached);
    cached.weightInfo = weightInfo;
    return cached;
  }
  const alpha = MEDIDAOT_LETTER_MORPHOLOGY.renderSignedDistance(
    base.signed,
    weightInfo.appliedOffset,
    outlinePixels
  );
  const canvasElement = createLetterMaskCanvas(base.width, base.height);
  const context = canvasElement.getContext('2d');
  const image = context.createImageData(base.width, base.height);
  const [red, green, blue] = letterColorChannels(color);
  for (let index = 0, target = 0; index < alpha.length; index += 1, target += 4) {
    image.data[target] = red;
    image.data[target + 1] = green;
    image.data[target + 2] = blue;
    image.data[target + 3] = alpha[index];
  }
  context.putImageData(image, 0, 0);
  const rendered = {
    canvas: canvasElement,
    inkBounds: MEDIDAOT_LETTER_MORPHOLOGY.alphaBounds(alpha, base.width, base.height, 1),
    weightInfo
  };
  base.rendered.set(renderKey, rendered);
  while (base.rendered.size > 3) base.rendered.delete(base.rendered.keys().next().value);
  pruneLetterMorphCache();
  return rendered;
}

function letterSourceMetrics(objectOrLetter, tradition = 'beitYosef') {
  return letterVectorEngine()?.getSourceMetrics?.(objectOrLetter, tradition) || null;
}

function letterDesignAspect(objectOrLetter, tradition = 'beitYosef') {
  const metrics = letterSourceMetrics(objectOrLetter, tradition);
  if (metrics?.sourceCell?.height > 0) {
    return metrics.sourceCell.width / metrics.sourceCell.height;
  }
  const asset = letterAsset(objectOrLetter, tradition);
  return asset ? asset.viewBox[2] / Math.max(.001, asset.viewBox[3]) : 1;
}

function letterObjectRect(object) {
  const xs = object.points.map(point => point.x);
  const ys = object.points.map(point => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return { x: left, y: top, width: right - left, height: bottom - top, left, right, top, bottom };
}

function letterRectPoints(x, y, width, height) {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ];
}

function normalizeLetterTemplateObject(object) {
  if (!isLetterTemplate(object)) return object;
  if (!Array.isArray(object.points) || object.points.length !== 4) return object;
  const rect = letterObjectRect(object);
  object.points = letterRectPoints(rect.x, rect.y, Math.max(.1, rect.width), Math.max(.1, rect.height));
  const photographed = isPhotographedVector(object);
  const tradition = photographed
    ? 'custom'
    : object.template?.tradition === 'ari' ? 'ari' : 'beitYosef';
  const letter = photographed
    ? ''
    : globalThis.MEDIDAOT_LETTERS?.order?.includes(object.template?.letter)
      ? object.template.letter
      : 'א';
  const asset = letterAsset(letter, tradition);
  const previousTemplate = object.template || {};
  object.template = {
    kind: photographed ? 'image-region-vector' : 'letter',
    vectorAssetVersion: 1,
    layoutMode: 'tight-v1',
    ...previousTemplate,
    letter,
    tradition,
    slug: asset?.slug || previousTemplate.slug || 'aleph'
  };
  if (photographed || object.template.layoutMode !== 'source-cell-v2') object.template.layoutMode = 'tight-v1';
  object.template.vectorAssetVersion = object.template.layoutMode === 'source-cell-v2'
    ? Math.max(2, +object.template.vectorAssetVersion || 2)
    : Math.max(1, +object.template.vectorAssetVersion || 1);
  object.letterMode = object.letterMode === 'outline' ? 'outline' : 'solid';
  object.letterOpacity = clamp(Number.isFinite(+object.letterOpacity) ? +object.letterOpacity : .62, .08, 1);
  object.letterOutlineWidth = clamp(Number.isFinite(+object.letterOutlineWidth) ? +object.letterOutlineWidth : 2.5, .5, 30);
  const persistedWeight = object.letterVector?.weight ?? object.letterWeight;
  object.letterWeight = clamp(Number.isFinite(+persistedWeight) ? +persistedWeight : 1, .55, 1.45);
  if (object.letterVector && Number.isFinite(+object.letterVector.weight)) {
    object.letterVector.weight = object.letterWeight;
  }
  const vectorLevels = new Set(['structural', 'organs', 'curves', 'full']);
  object.vectorDetailLevel = vectorLevels.has(object.vectorDetailLevel)
    ? object.vectorDetailLevel
    : object.letterEditAnchors === true
      ? 'full'
      : 'structural';
  object.letterEditAnchors = object.vectorDetailLevel !== 'structural';
  object.letterGridVisible = object.letterGridVisible !== false;
  object.letterLockAspect = object.letterLockAspect !== false;
  object.role = 'reference-overlay';
  object.display = { ...(object.display || {}), resultLabelVisible: false };
  return object;
}

function drawLetterGrid(context, rect, color, opacity, unitScale) {
  context.save();
  context.strokeStyle = color || '#2563eb';
  context.globalAlpha = Math.min(.28, Math.max(.12, opacity * .34));
  context.lineWidth = Math.max(.75, .8 * unitScale);
  context.setLineDash([]);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  for (let column = 1; column < 5; column++) {
    const x = rect.x + rect.width * column / 5;
    context.beginPath();
    context.moveTo(x, rect.y);
    context.lineTo(x, rect.y + rect.height);
    context.stroke();
  }
  for (let row = 1; row < 4; row++) {
    const y = rect.y + rect.height * row / 4;
    context.beginPath();
    context.moveTo(rect.x, y);
    context.lineTo(rect.x + rect.width, y);
    context.stroke();
  }
  context.restore();
}

function drawLetterEditableMaster(context, object, rect, unitScale, asset) {
  const engine = letterVectorEngine();
  const transform = engine?.getLayoutTransform?.(object, { rect, asset });
  const master = engine?.buildPath2D?.(object, { asset, weight: 1, shared: true });
  const entries = master?.available ? master.entries : cachedLetterPaths(asset);
  if (!transform || !entries.length) return;
  context.save();
  const matrix = transform.matrix;
  context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  context.globalAlpha = clamp(object.letterOpacity ?? .62, .08, 1);
  context.fillStyle = object.color || '#2563eb';
  context.strokeStyle = object.color || '#2563eb';
  const averageScale = (
    Math.hypot(matrix.a, matrix.b) + Math.hypot(matrix.c, matrix.d)
  ) / 2 || 1;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = Math.max(
    .35,
    (object.letterOutlineWidth || 2.5) * unitScale / averageScale
  );
  for (const entry of entries) {
    if (object.letterMode === 'outline') context.stroke(entry.path);
    else context.fill(entry.path, entry.rule);
  }
  context.restore();
}

function updateLetterWeightReadout(object, weightInfo) {
  if (!weightInfo) return;
  LETTER_WEIGHT_DIAGNOSTICS.set(object, weightInfo);
  if (typeof state === 'undefined' || state.selectedId !== object.id) return;
  const output = typeof $ === 'function' ? $('letterWeightValue') : null;
  if (!output) return;
  const intensity = Math.round((weightInfo.requested - 1) / .45 * 100);
  const magnitude = Math.abs(intensity);
  const label = intensity === 0
    ? 'מקור'
    : intensity < 0
      ? magnitude === 100 ? 'עדין ביותר' : `עדין ${magnitude}`
      : magnitude === 100 ? 'מודגש ביותר' : `מודגש ${magnitude}`;
  output.value = weightInfo.capped
    ? intensity < 0 ? 'עדין · מוגבל' : 'מודגש · מוגבל'
    : label;
  output.textContent = output.value;
}

function drawLetterTemplateShape(context, object, rect, unitScale = 1, options = {}) {
  const asset = letterAsset(object);
  if ((!asset && !Array.isArray(object?.letterVector?.paths)) || rect.width <= 0 || rect.height <= 0) return;
  const suppressWeightReadout = options.exportQuality === true
    || options.suppressWeightReadout === true;
  if (object.letterGridVisible) {
    drawLetterGrid(context, rect, object.color, object.letterOpacity ?? .62, unitScale);
  }
  if (Math.abs((Number(object.letterWeight) || 1) - 1) < .0001) {
    drawLetterEditableMaster(context, object, rect, unitScale, asset);
    if (!suppressWeightReadout) {
      updateLetterWeightReadout(object, { requested: 1, effective: 1, capped: false });
    }
    if (letterMorphForceExactId === object.id) letterMorphForceExactId = null;
    return;
  }
  const activePreviewDrag = typeof state !== 'undefined'
    && state.dragging?.id === object.id
    && (state.dragging.type === 'letterVectorHandle'
      || state.dragging.type === 'letterVectorGroup'
      || (state.dragging.type === 'letterResize' && object.letterMode === 'outline'));
  if (activePreviewDrag && letterMorphForceExactId !== object.id) {
    drawLetterEditableMaster(context, object, rect, unitScale, asset);
    return;
  }
  try {
    const materializedWeightPreview = options.exportQuality !== true
      && letterWeightPreviewId === object.id
      && Array.isArray(object?.letterVector?.paths);
    const base = buildLetterUnionMask(
      object,
      rect,
      asset,
      unitScale,
      options.exportQuality === true
        ? 48
        : materializedWeightPreview
          ? LETTER_EDIT_TOPOLOGY_PIXELS_PER_NIB
          : LETTER_MORPH_PIXELS_PER_NIB
    );
    const maskPixelToDisplayX = rect.width / Math.max(.001, base.layoutWidth * base.rasterScaleX);
    const maskPixelToDisplayY = rect.height / Math.max(.001, base.layoutHeight * base.rasterScaleY);
    const maskPixelToDisplay = (Math.abs(maskPixelToDisplayX) + Math.abs(maskPixelToDisplayY)) / 2;
    const rendered = renderedLetterMask(base, object, {
      outlinePixels: (object.letterOutlineWidth || 2.5) * unitScale /
        Math.max(.001, maskPixelToDisplay)
    }, {
      exactTopology: options.exportQuality === true || letterWeightPreviewId !== object.id
    });
    const source = rendered.inkBounds;
    const target = base.masterInkBounds;
    if (!source || !target) {
      if (letterMorphForceExactId === object.id) letterMorphForceExactId = null;
      return;
    }
    const canonicalTarget = {
      x: base.envelope.x + target.x / base.rasterScaleX,
      y: base.envelope.y + target.y / base.rasterScaleY,
      width: target.width / base.rasterScaleX,
      height: target.height / base.rasterScaleY
    };
    context.save();
    context.globalAlpha = clamp(object.letterOpacity ?? .62, .08, 1);
    context.drawImage(
      rendered.canvas,
      source.x,
      source.y,
      source.width,
      source.height,
      rect.x + canonicalTarget.x / base.layoutWidth * rect.width,
      rect.y + canonicalTarget.y / base.layoutHeight * rect.height,
      canonicalTarget.width / base.layoutWidth * rect.width,
      canonicalTarget.height / base.layoutHeight * rect.height
    );
    context.restore();
    if (!suppressWeightReadout) updateLetterWeightReadout(object, rendered.weightInfo);
    if (letterMorphForceExactId === object.id) letterMorphForceExactId = null;
  } catch (error) {
    /* A master-only fallback is safer than applying a destructive composite. */
    drawLetterEditableMaster(context, object, rect, unitScale, asset);
    if (letterMorphForceExactId === object.id) letterMorphForceExactId = null;
    console.warn('Letter morphology fell back to the editable master.', error);
  }
}

function letterVisualRect(object) {
  if (!isLetterTemplate(object)) return null;
  const visual = letterVectorEngine()?.getVisualBounds?.(object, {
    asset: letterAsset(object),
    weight: 1
  })?.image;
  return visual || letterObjectRect(object);
}

function pointInLetterTemplate(imagePoint, object) {
  const rect = letterVisualRect(object);
  return !!rect &&
    imagePoint.x >= rect.left &&
    imagePoint.x <= rect.right &&
    imagePoint.y >= rect.top &&
    imagePoint.y <= rect.bottom;
}

function letterHandlePositions(object) {
  const rect = letterObjectRect(object);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    nw: { x: rect.left, y: rect.top },
    n: { x: centerX, y: rect.top },
    ne: { x: rect.right, y: rect.top },
    e: { x: rect.right, y: centerY },
    se: { x: rect.right, y: rect.bottom },
    s: { x: centerX, y: rect.bottom },
    sw: { x: rect.left, y: rect.bottom },
    w: { x: rect.left, y: centerY }
  };
}

function allLetterVectorHandles(object) {
  if (!isLetterTemplate(object)) return [];
  return letterVectorEngine()?.enumerateHandles?.(object, {
    asset: letterAsset(object),
    coordinateSpace: 'image'
  }) || [];
}

function representativeOrganHandle(group, groupLabel) {
  if (!group.length) return null;
  const center = group.reduce((sum, handle) => ({
    x: sum.x + handle.point.x / group.length,
    y: sum.y + handle.point.y / group.length
  }), { x: 0, y: 0 });
  const representative = group.reduce((best, handle) => (
    distance(handle.point, center) < distance(best.point, center) ? handle : best
  ), group[0]);
  return {
    ...representative,
    groupIds: group.map(handle => handle.id),
    groupLabel,
    groupCount: group.length
  };
}

function organLevelVectorHandles(handles) {
  const anchorsByPath = new Map();
  for (const handle of handles) {
    if (handle.kind !== 'anchor') continue;
    const pathIndex = Number.isInteger(handle.pathIndex) ? handle.pathIndex : 0;
    if (!anchorsByPath.has(pathIndex)) anchorsByPath.set(pathIndex, []);
    anchorsByPath.get(pathIndex).push(handle);
  }

  const groups = [];
  for (const [pathIndex, pathAnchors] of [...anchorsByPath.entries()].sort((a, b) => a[0] - b[0])) {
    pathAnchors.sort((a, b) => a.commandIndex - b.commandIndex || String(a.id).localeCompare(String(b.id)));
    const runs = [];
    for (const anchor of pathAnchors) {
      const currentRun = runs.at(-1);
      const previous = currentRun?.at(-1);
      if (!currentRun || anchor.commandIndex > previous.commandIndex + 1) runs.push([anchor]);
      else currentRun.push(anchor);
    }
    for (let runIndex = 0; runIndex < runs.length; runIndex++) {
      const run = runs[runIndex];
      const groupCount = Math.min(6, Math.max(1, Math.round(Math.sqrt(run.length))));
      for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
        const start = Math.floor(groupIndex * run.length / groupCount);
        const end = Math.floor((groupIndex + 1) * run.length / groupCount);
        const group = run.slice(start, end);
        const handle = representativeOrganHandle(group, `path:${pathIndex}:run:${runIndex}:group:${groupIndex}`);
        if (handle) groups.push(handle);
      }
    }
  }
  return groups;
}

function anchorIdsInsideLasso(handles, points) {
  return [...new Set(handles
    .filter(handle => handle.kind === 'anchor' && pointInPolygon(handle.point, points))
    .map(handle => handle.id))];
}

function letterVectorHandles(object) {
  if (!isLetterTemplate(object) || !object.letterEditAnchors) return [];
  const handles = allLetterVectorHandles(object);
  if (object.vectorDetailLevel === 'organs') {
    const automaticGroups = organLevelVectorHandles(handles);
    const selectedIds = state.letterVectorSelection?.id === object.id
      ? [...new Set(state.letterVectorSelection.handleIds || [])]
      : [];
    if (!selectedIds.length) return automaticGroups;
    const selectedSet = new Set(selectedIds);
    const selectedAnchors = handles.filter(handle => handle.kind === 'anchor' && selectedSet.has(handle.id));
    const preciseGroup = representativeOrganHandle(selectedAnchors, `custom:${selectedIds.join('|')}`);
    if (!preciseGroup) return automaticGroups;
    return [
      preciseGroup,
      ...automaticGroups.filter(group => !group.groupIds.some(id => selectedSet.has(id)))
    ];
  }
  if (object.vectorDetailLevel === 'curves') {
    return handles.filter(handle => handle.kind === 'anchor');
  }
  return object.vectorDetailLevel === 'full' ? handles : [];
}

function drawLetterVectorHandles(object) {
  const handles = letterVectorHandles(object);
  if (!handles.length) return;
  if (Math.abs((object.letterWeight || 1) - 1) > .001) {
    const objectRect = letterObjectRect(object);
    const topLeft = imageToScreen({ x: objectRect.x, y: objectRect.y });
    const screenRect = {
      x: topLeft.x,
      y: topLeft.y,
      width: objectRect.width * state.view.scale,
      height: objectRect.height * state.view.scale
    };
    const engine = letterVectorEngine();
    const asset = letterAsset(object);
    const transform = engine?.getLayoutTransform?.(object, { rect: screenRect, asset });
    const master = engine?.buildPath2D?.(object, { asset, weight: 1, shared: true });
    if (transform && master?.available) {
      ctx.save();
      const matrix = transform.matrix;
      ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      ctx.strokeStyle = 'rgba(14, 116, 144, .34)';
      ctx.lineWidth = 1.1 / Math.max(.001, (Math.abs(matrix.a) + Math.abs(matrix.d)) / 2);
      ctx.setLineDash([3, 3]);
      for (const entry of master.entries) ctx.stroke(entry.path);
      ctx.restore();
    }
  }
  const anchors = handles.filter(handle => handle.kind === 'anchor');
  const anchorByCommand = new Map(
    anchors.map(handle => [`${handle.pathIndex}:${handle.commandIndex}`, handle])
  );
  const pathAnchors = new Map();
  for (const anchor of anchors) {
    if (!pathAnchors.has(anchor.pathIndex)) pathAnchors.set(anchor.pathIndex, []);
    pathAnchors.get(anchor.pathIndex).push(anchor);
  }
  for (const list of pathAnchors.values()) {
    list.sort((a, b) => a.commandIndex - b.commandIndex);
  }
  const selectedHandleIds = state.letterVectorSelection?.id === object.id
    ? new Set([
        ...(state.letterVectorSelection.handleIds || []),
        state.letterVectorSelection.primaryHandleId,
        state.letterVectorSelection.handleId
      ].filter(Boolean))
    : new Set();

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(14, 116, 144, .42)';
  ctx.setLineDash([]);
  for (const handle of handles.filter(item => item.kind === 'control')) {
    let anchor = null;
    if (handle.role === 'control-in') {
      anchor = anchorByCommand.get(`${handle.pathIndex}:${handle.commandIndex}`) || null;
    } else {
      const candidates = pathAnchors.get(handle.pathIndex) || [];
      anchor = [...candidates].reverse().find(item => item.commandIndex < handle.commandIndex)
        || candidates[candidates.length - 1]
        || null;
    }
    if (!anchor) continue;
    const controlScreen = imageToScreen(handle.point);
    const anchorScreen = imageToScreen(anchor.point);
    ctx.beginPath();
    ctx.moveTo(anchorScreen.x, anchorScreen.y);
    ctx.lineTo(controlScreen.x, controlScreen.y);
    ctx.stroke();
  }

  for (const handle of handles) {
    const point = imageToScreen(handle.point);
    const selected = selectedHandleIds.has(handle.id)
      || handle.groupIds?.some(id => selectedHandleIds.has(id));
    ctx.beginPath();
    if (handle.kind === 'anchor') {
      ctx.fillStyle = selected ? '#f59e0b' : '#ffffff';
      ctx.strokeStyle = selected ? '#92400e' : '#0369a1';
      ctx.lineWidth = selected ? 2.4 : 1.45;
      const organRadius = handle.groupIds?.length > 1 ? 5.2 : 0;
      ctx.arc(point.x, point.y, Math.max(selected ? 5.8 : 3.6, organRadius), 0, Math.PI * 2);
    } else {
      const radius = selected ? 5 : 3;
      ctx.fillStyle = selected ? '#f59e0b' : '#cffafe';
      ctx.strokeStyle = selected ? '#92400e' : '#0e7490';
      ctx.lineWidth = selected ? 2.2 : 1.2;
      ctx.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawLetterTemplateSelection(object) {
  const rect = letterObjectRect(object);
  const topLeft = imageToScreen({ x: rect.left, y: rect.top });
  const bottomRight = imageToScreen({ x: rect.right, y: rect.bottom });
  const screenRect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y
  };
  ctx.save();
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(screenRect.x, screenRect.y, screenRect.width, screenRect.height);
  ctx.setLineDash([]);
  for (const [handle, point] of Object.entries(letterHandlePositions(object))) {
    const screenPoint = imageToScreen(point);
    ctx.beginPath();
    ctx.fillStyle = ['n', 'e', 's', 'w'].includes(handle) ? '#dbeafe' : '#fff';
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    if (['n', 'e', 's', 'w'].includes(handle)) {
      ctx.rect(screenPoint.x - 6, screenPoint.y - 6, 12, 12);
    } else {
      ctx.arc(screenPoint.x, screenPoint.y, 7, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  drawLetterVectorHandles(object);
}

function drawLetterTemplateOnScreen(object, selected) {
  normalizeLetterTemplateObject(object);
  const rect = letterObjectRect(object);
  const topLeft = imageToScreen({ x: rect.x, y: rect.y });
  drawLetterTemplateShape(ctx, object, {
    x: topLeft.x,
    y: topLeft.y,
    width: rect.width * state.view.scale,
    height: rect.height * state.view.scale
  }, state.view.scale);
  if (selected) drawLetterTemplateSelection(object);
}

function drawLetterTemplateForExport(context, object) {
  normalizeLetterTemplateObject(object);
  drawLetterTemplateShape(context, object, letterObjectRect(object), 1, { exportQuality: true });
}

function nearestLetterHandle(object, imagePoint, thresholdScreen = 20) {
  if (!isLetterTemplate(object)) return null;
  const target = imageToScreen(imagePoint);
  let best = null;
  let bestDistance = Infinity;
  for (const [handle, point] of Object.entries(letterHandlePositions(object))) {
    const current = distance(target, imageToScreen(point));
    if (current <= thresholdScreen && current < bestDistance) {
      best = handle;
      bestDistance = current;
    }
  }
  return best;
}

function nearestLetterVectorHandle(object, imagePoint, thresholdScreen = 16) {
  if (!isLetterTemplate(object) || !object.letterEditAnchors) return null;
  const target = imageToScreen(imagePoint);
  let best = null;
  let bestDistance = Infinity;
  for (const handle of letterVectorHandles(object)) {
    const current = distance(target, imageToScreen(handle.point));
    if (current <= thresholdScreen && current < bestDistance) {
      best = handle;
      bestDistance = current;
    }
  }
  return best;
}

function resizeLetterFromHandle(originalPoints, handle, imagePoint, lockAspect) {
  const original = letterObjectRect({ points: originalPoints });
  const minimum = 24 / Math.max(.2, state.view.scale);
  let left = original.left;
  let right = original.right;
  let top = original.top;
  let bottom = original.bottom;

  if (handle === 'e') right = Math.max(left + minimum, imagePoint.x);
  else if (handle === 'w') left = Math.min(right - minimum, imagePoint.x);
  else if (handle === 'n') top = Math.min(bottom - minimum, imagePoint.y);
  else if (handle === 's') bottom = Math.max(top + minimum, imagePoint.y);
  else {
    const anchors = {
      nw: { x: original.right, y: original.bottom, sx: -1, sy: -1 },
      ne: { x: original.left, y: original.bottom, sx: 1, sy: -1 },
      se: { x: original.left, y: original.top, sx: 1, sy: 1 },
      sw: { x: original.right, y: original.top, sx: -1, sy: 1 }
    };
    const anchor = anchors[handle] || anchors.se;
    let width = Math.max(minimum, Math.abs(imagePoint.x - anchor.x));
    let height = Math.max(minimum, Math.abs(imagePoint.y - anchor.y));
    if (lockAspect) {
      const aspect = original.width / Math.max(.001, original.height);
      if (width / Math.max(.001, height) > aspect) height = width / aspect;
      else width = height * aspect;
    }
    left = anchor.sx < 0 ? anchor.x - width : anchor.x;
    right = anchor.sx < 0 ? anchor.x : anchor.x + width;
    top = anchor.sy < 0 ? anchor.y - height : anchor.y;
    bottom = anchor.sy < 0 ? anchor.y : anchor.y + height;
  }
  return letterRectPoints(left, top, Math.max(minimum, right - left), Math.max(minimum, bottom - top));
}

function setActiveLetterTradition(tradition) {
  activeLetterTradition = tradition === 'ari' ? 'ari' : 'beitYosef';
  document.querySelectorAll('[data-letter-tradition]').forEach(button => {
    const active = button.dataset.letterTradition === activeLetterTradition;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const note = $('letterDrawerNote');
  if (note) {
    note.textContent = activeLetterTradition === 'ari'
      ? 'כתב האר״י משתמש בצורות המשותפות של בית יוסף ומחליף את א, ו, ח, ט, צ, ק וש.'
      : 'בחר אות בית יוסף והנח אותה כתבנית וקטורית על הצילום.';
  }
  renderLetterKeyboard();
}

function renderLetterKeyboard() {
  const keyboard = $('letterKeyboard');
  if (!keyboard || !globalThis.MEDIDAOT_LETTERS) return;
  keyboard.replaceChildren();
  for (const letter of globalThis.MEDIDAOT_LETTERS.order) {
    const asset = letterAsset(letter, activeLetterTradition);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'letter-key';
    const isAriOverride = activeLetterTradition === 'ari' &&
      Object.prototype.hasOwnProperty.call(globalThis.MEDIDAOT_LETTERS.ariOverrides, letter);
    button.setAttribute('aria-label', `הנחת האות ${letter} — ${letterTraditionLabel(activeLetterTradition)}`);
    button.title = isAriOverride ? `${letter} — צורת האר״י` : `${letter} — ${letterTraditionLabel(activeLetterTradition)}`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const metrics = letterSourceMetrics(letter, activeLetterTradition);
    const sourceCell = metrics?.sourceCell;
    svg.setAttribute('viewBox', sourceCell
      ? `0 0 ${sourceCell.width} ${sourceCell.height}`
      : asset.viewBox.join(' '));
    svg.setAttribute('aria-hidden', 'true');
    for (const sourcePath of asset.paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', sourcePath.d);
      path.setAttribute('fill', 'currentColor');
      path.setAttribute('fill-rule', sourcePath.rule || 'nonzero');
      if (metrics?.assetOriginInCell) {
        path.setAttribute(
          'transform',
          `translate(${metrics.assetOriginInCell.x} ${metrics.assetOriginInCell.y})`
        );
      }
      svg.append(path);
    }
    const label = document.createElement('span');
    label.className = 'letter-key-label';
    label.textContent = letter;
    button.append(svg, label);
    if (isAriOverride) {
      const badge = document.createElement('span');
      badge.className = 'ari-badge';
      badge.textContent = 'אר״י';
      button.append(badge);
    }
    button.addEventListener('click', () => addLetterTemplate(letter, activeLetterTradition));
    keyboard.append(button);
  }
}

function addLetterTemplate(letter, tradition = activeLetterTradition) {
  if (!state.image) {
    statusText.textContent = 'יש להעלות צילום לפני הנחת תבנית אות';
    return;
  }
  const asset = letterAsset(letter, tradition);
  if (!asset) return;
  const canvasRect = canvas.getBoundingClientRect();
  const center = screenToImage({ x: canvasRect.width / 2, y: canvasRect.height / 2 });
  const targetScreenHeight = clamp(canvasRect.height * .31, 120, 210);
  const height = Math.min(state.image.height * .48, targetScreenHeight / Math.max(.03, state.view.scale));
  const aspect = letterDesignAspect(letter, tradition);
  const width = height * aspect;
  const x = clamp(center.x - width / 2, -width * .25, state.image.width - width * .75);
  const y = clamp(center.y - height / 2, -height * .25, state.image.height - height * .75);
  const object = makeObject('letterTemplate', letterRectPoints(x, y, width, height), {
    name: `תבנית ${letter} — ${letterTraditionLabel(tradition)}`,
    color: '#2563eb',
    lineWidth: 2.5,
    fillEnabled: false,
    fillAlpha: 0,
    role: 'reference-overlay',
    category: 'reference-template',
    template: {
      kind: 'letter',
      letter,
      tradition,
      slug: asset.slug,
      vectorAssetVersion: 2,
      layoutMode: 'source-cell-v2'
    },
    letterMode: 'solid',
    letterOpacity: .62,
    letterOutlineWidth: 2.5,
    letterWeight: 1,
    letterEditAnchors: false,
    vectorDetailLevel: 'structural',
    letterGridVisible: true,
    letterLockAspect: true,
    display: { resultLabelVisible: false }
  });
  normalizeLetterTemplateObject(object);
  snapshot();
  state.objects.push(object);
  setTool('pan');
  selectObject(object.id);
  statusText.textContent = `תבנית ${letter} הונחה בגודלה היחסי המקורי. גרור להזזה; ידיות הצד משנות רוחב או גובה`;
}

function selectedLetterTemplate() {
  return state.objects.find(object => object.id === state.selectedId && isLetterTemplate(object)) || null;
}

function syncLetterControls(object = selectedLetterTemplate()) {
  const panel = $('letterControlsPanel');
  if (!panel) return;
  const active = isLetterTemplate(object);
  panel.hidden = !active;
  if (!active) return;
  normalizeLetterTemplateObject(object);
  const mode = object.letterMode === 'outline' ? 'outline' : 'solid';
  const photographed = isPhotographedVector(object);
  $('letterSelectedLabel').textContent = photographed
    ? 'אות מצולמת · וקטור'
    : `${object.template.letter} · ${letterTraditionLabel(object.template.tradition)}`;
  $('letterModeSolidBtn').classList.toggle('active', mode === 'solid');
  $('letterModeOutlineBtn').classList.toggle('active', mode === 'outline');
  $('letterColorInput').value = object.color || '#2563eb';
  $('letterOpacityInput').value = Math.round((object.letterOpacity ?? .62) * 100);
  $('letterOutlineWidthInput').value = object.letterOutlineWidth || 2.5;
  $('letterOutlineWidthLabel').hidden = mode !== 'outline';
  const weightIntensity = Math.round(((object.letterWeight || 1) - 1) / .45 * 100);
  $('letterWeightInput').value = clamp(weightIntensity, -100, 100);
  $('letterWeightInput').disabled = photographed;
  const cachedWeightInfo = LETTER_WEIGHT_DIAGNOSTICS.get(object);
  const currentWeight = object.letterWeight || 1;
  updateLetterWeightReadout(object,
    cachedWeightInfo && Math.abs(cachedWeightInfo.requested - currentWeight) < .0001
      ? cachedWeightInfo
      : { requested: currentWeight, effective: currentWeight, capped: false }
  );
  $('letterGridInput').checked = object.letterGridVisible !== false;
  $('letterLockAspectInput').checked = object.letterLockAspect !== false;
  $('letterEditAnchorsInput').checked = object.letterEditAnchors === true;
  const vectorLevelSelect = $('letterVectorLevelSelect');
  if (vectorLevelSelect) vectorLevelSelect.value = object.vectorDetailLevel;
  $('letterAnchorLassoBtn').disabled = object.vectorDetailLevel === 'structural';
  const vectorStats = letterVectorEngine()?.stats?.(object, letterAsset(object));
  const selectedAnchorCount = state.letterVectorSelection?.id === object.id
    ? new Set(state.letterVectorSelection.handleIds || []).size
    : 0;
  const vectorLevelLabels = {
    structural: 'מבנה: הזזה ושינוי מסגרת בלבד',
    organs: `איברים: ${letterVectorHandles(object).length} קבוצות מקומיות רציפות; סימון חופשי מגדיר איבר מדויק`,
    curves: 'עקומות: נקודות העוגן ללא ידיות הבקרה',
    full: 'מלא: כל נקודות העוגן וידיות ה־Bézier'
  };
  $('letterAnchorReadout').textContent = vectorStats?.available
    ? `${vectorLevelLabels[object.vectorDetailLevel]} · המקור המלא כולל ${vectorStats.anchors} נקודות עוגן ו־${vectorStats.controls} ידיות${vectorStats.materialized ? ' · נשמרו עריכות אישיות' : ' · מקור Bézier מלא'}${selectedAnchorCount ? ` · נבחרו ${selectedAnchorCount} עוגנים להזזה משותפת` : ''}${photographed ? ' · הווקטור נוצר מן האזור המצולם ונשאר עריך' : ` · שינוי העובי הוא תצוגה לא־הרסנית עם הגנת רכיבים וחללים${Math.abs((object.letterWeight || 1) - 1) > .001 ? ' · הקו המקווקו הוא מסלול המקור הנערך' : ''}`}`
    : 'המסלול הווקטורי אינו זמין.';
  const rect = letterObjectRect(object);
  const visual = letterVisualRect(object) || rect;
  const nibText = state.formula.nibPx
    ? ` · ${fmt(visual.width / state.formula.nibPx, 2)} × ${fmt(visual.height / state.formula.nibPx, 2)} עובי קולמוס`
    : '';
  $('letterSizeReadout').textContent =
    `צורת האות: ${fmt(visual.width, 1)} × ${fmt(visual.height, 1)} פיקסלים${nibText} · מסגרת יחסית: ${fmt(rect.width, 1)} × ${fmt(rect.height, 1)}`;
}

function updateSelectedLetterProperty(property, value) {
  const object = selectedLetterTemplate();
  if (!object) return;
  object[property] = value;
  object.auto = false;
  markObjectModified(object);
  syncLetterControls(object);
  draw();
}

function duplicateSelectedLetter() {
  const source = selectedLetterTemplate();
  if (!source) return;
  const copy = structuredCloneSafe(source);
  const offset = 18 / Math.max(.2, state.view.scale);
  snapshot();
  copy.id = state.nextId++;
  copy.uid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  copy.points = copy.points.map(point => ({ x: point.x + offset, y: point.y + offset }));
  copy.name = `${source.name} — עותק`;
  copy.provenance = {
    origin: 'human',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };
  state.objects.push(copy);
  selectObject(copy.id);
  statusText.textContent = `תבנית ${copy.template.letter} שוכפלה`;
}

function resetSelectedLetterRatio() {
  const object = selectedLetterTemplate();
  if (!object) return;
  if (isPhotographedVector(object)) {
    statusText.textContent = 'המסגרת של אות מצולמת נשארת ביחס של אזור המקור';
    return;
  }
  const rect = letterObjectRect(object);
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const width = rect.height * letterDesignAspect(object);
  snapshot();
  object.template = {
    ...(object.template || {}),
    vectorAssetVersion: 2,
    layoutMode: 'source-cell-v2'
  };
  object.points = letterRectPoints(center.x - width / 2, rect.y, width, rect.height);
  markObjectModified(object);
  renderAll();
  statusText.textContent = 'האות הוחזרה לתא וליחסים המקוריים של לוח האותיות';
}

function drawFreeformSelection(points, color) {
  if (!Array.isArray(points) || points.length < 2) return;
  const screenPoints = points.map(imageToScreen);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = hexToRgba(color, .08);
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
  for (const point of screenPoints.slice(1)) ctx.lineTo(point.x, point.y);
  if (points.length >= 3) {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function drawLetterInteractionOverlays() {
  if (state.vectorizeLasso?.points?.length) {
    drawFreeformSelection(
      state.vectorizeLasso.points,
      $('vectorSourceColorInput')?.value || '#f59e0b'
    );
  }
  if (state.letterVectorLasso?.points?.length) {
    drawFreeformSelection(state.letterVectorLasso.points, '#0891b2');
  }
}

function appendLassoPoint(lasso, imagePoint, minimumScreenDistance = 3) {
  if (!lasso?.points) return false;
  const previous = lasso.points[lasso.points.length - 1];
  if (previous && distance(imageToScreen(previous), imageToScreen(imagePoint)) < minimumScreenDistance) {
    return false;
  }
  lasso.points.push({ x: imagePoint.x, y: imagePoint.y });
  return true;
}

function beginVectorizeLasso(imagePoint, pointerId) {
  state.vectorizeLasso = {
    pointerId,
    points: [{ x: imagePoint.x, y: imagePoint.y }]
  };
  state.letterVectorLasso = null;
  state.dragging = { type: 'vectorizeLasso', pointerId, moved: false };
  statusText.textContent = 'הקף את האות המצולמת וסגור את המסלול';
  draw();
}

function photographedSelectionBounds(points) {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const left = clamp(Math.floor(Math.min(...xs)), 0, Math.max(0, state.image.width - 1));
  const top = clamp(Math.floor(Math.min(...ys)), 0, Math.max(0, state.image.height - 1));
  const right = clamp(Math.ceil(Math.max(...xs)), left + 1, state.image.width);
  const bottom = clamp(Math.ceil(Math.max(...ys)), top + 1, state.image.height);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function createPhotographedVector(points) {
  if (!state.image || !globalThis.MEDIDAOT_REGION_VECTOR) {
    throw new Error('מנוע הווקטוריזציה אינו זמין');
  }
  const bounds = photographedSelectionBounds(points);
  if (bounds.width * state.view.scale < 12 || bounds.height * state.view.scale < 12) {
    throw new Error('הסימון קטן מדי');
  }
  const maximumDimension = 1200;
  const maximumPixels = 1_600_000;
  const sampleScale = Math.min(
    1,
    maximumDimension / Math.max(bounds.width, bounds.height),
    Math.sqrt(maximumPixels / Math.max(1, bounds.width * bounds.height))
  );
  const sampleWidth = Math.max(1, Math.round(bounds.width * sampleScale));
  const sampleHeight = Math.max(1, Math.round(bounds.height * sampleScale));
  const crop = createLetterMaskCanvas(sampleWidth, sampleHeight);
  const context = crop.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('לא ניתן לקרוא את אזור התמונה');
  context.drawImage(
    state.image,
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height,
    0,
    0,
    sampleWidth,
    sampleHeight
  );
  const relativePolygon = points.map(point => ({
    x: (point.x - bounds.left) * sampleScale,
    y: (point.y - bounds.top) * sampleScale
  }));
  const trace = globalThis.MEDIDAOT_REGION_VECTOR.vectorizeImageData(
    context.getImageData(0, 0, sampleWidth, sampleHeight),
    relativePolygon,
    { maximumAnchors: 260 }
  );

  snapshot();
  const frame = makeObject('area', points, {
    name: 'מסגרת מקור — אות מצולמת',
    color: $('vectorSourceColorInput')?.value || '#f59e0b',
    lineWidth: 3,
    fillEnabled: false,
    fillAlpha: 0,
    closed: true,
    role: 'vector-source-frame',
    category: 'reference-template',
    display: { resultLabelVisible: false },
    sourceTrace: {
      threshold: trace.threshold,
      sampleScale,
      selectedPixelCount: trace.selectedPixelCount,
      inkPixelCount: trace.inkPixelCount
    }
  });
  ensureAreaSegments(frame);
  const vector = makeObject('letterTemplate', letterRectPoints(
    bounds.left,
    bounds.top,
    bounds.width,
    bounds.height
  ), {
    name: 'אות מצולמת — וקטור עריך',
    color: $('vectorOverlayColorInput')?.value || '#2563eb',
    lineWidth: 2.5,
    fillEnabled: false,
    fillAlpha: 0,
    role: 'reference-overlay',
    category: 'reference-template',
    template: {
      kind: 'image-region-vector',
      letter: '',
      tradition: 'custom',
      slug: 'photographed-selection',
      vectorAssetVersion: 2,
      layoutMode: 'tight-v1'
    },
    letterVector: trace.vector,
    letterMode: 'solid',
    letterOpacity: .58,
    letterOutlineWidth: 2.5,
    letterWeight: 1,
    letterEditAnchors: true,
    vectorDetailLevel: 'organs',
    letterGridVisible: true,
    letterLockAspect: true,
    display: { resultLabelVisible: false },
    sourceSelection: {
      frameId: frame.id,
      sampleScale,
      threshold: trace.threshold,
      polygon: structuredCloneSafe(points)
    }
  });
  frame.linkedVectorId = vector.id;
  normalizeLetterTemplateObject(vector);
  state.objects.push(frame, vector);
  state.vectorizeLasso = null;
  setTool('pan');
  selectObject(vector.id);
  statusText.textContent = `נוצר וקטור מלא עם ${trace.vector.handleCounts.anchors} נקודות עוגן; דרגת האיברים מציגה קבוצות מסלול בטוחות, וסימון חופשי מגדיר איבר מדויק. מסגרת המקור נשארה במקומה`;
  return { frame, vector, trace };
}

function finishVectorizeLasso() {
  const points = state.vectorizeLasso?.points || [];
  state.vectorizeLasso = null;
  if (points.length < 6 || polygonArea(points) < 16) {
    statusText.textContent = 'הסימון החופשי קצר מדי ובוטל';
    draw();
    return null;
  }
  try {
    return createPhotographedVector(points);
  } catch (error) {
    statusText.textContent = `לא נוצר וקטור: ${error.message}`;
    draw();
    return null;
  }
}

function armLetterAnchorLasso() {
  const object = selectedLetterTemplate();
  if (!object?.letterEditAnchors) {
    statusText.textContent = 'יש להפעיל תחילה עריכת נקודות עוגן';
    return;
  }
  setTool('pan');
  state.letterVectorLasso = { armed: true, id: object.id, points: [] };
  state.letterVectorSelection = null;
  $('letterAnchorLassoBtn')?.classList.add('active');
  statusText.textContent = 'הקף ב־Apple Pencil את קבוצת נקודות העוגן הרצויה';
  draw();
}

function beginLetterAnchorLasso(imagePoint, pointerId) {
  const lasso = state.letterVectorLasso;
  if (!lasso?.armed || lasso.id !== state.selectedId) return false;
  lasso.armed = false;
  lasso.pointerId = pointerId;
  lasso.points = [{ x: imagePoint.x, y: imagePoint.y }];
  state.dragging = { type: 'letterAnchorLasso', pointerId, moved: false };
  draw();
  return true;
}

function finishLetterAnchorLasso() {
  const lasso = state.letterVectorLasso;
  const object = state.objects.find(item => item.id === lasso?.id && isLetterTemplate(item));
  const points = lasso?.points || [];
  state.letterVectorLasso = null;
  $('letterAnchorLassoBtn')?.classList.remove('active');
  if (!object || points.length < 3) {
    statusText.textContent = 'לא נבחרו נקודות עוגן';
    draw();
    return [];
  }
  const selected = anchorIdsInsideLasso(allLetterVectorHandles(object), points);
  state.letterVectorSelection = selected.length ? {
    id: object.id,
    handleIds: selected,
    primaryHandleId: selected[0],
    handleId: selected[0]
  } : null;
  object.correctionHandleIds = [...selected];
  syncLetterControls(object);
  statusText.textContent = selected.length
    ? `נבחרו ${selected.length} נקודות עוגן; גרור אחת מהן כדי להזיז את הקבוצה`
    : 'לא נמצאו נקודות עוגן בתוך הסימון';
  draw();
  return selected;
}

function runScheduledLetterWeightRender() {
  letterWeightRenderFrame = null;
  if (!letterWeightRenderDirty) return;
  letterWeightRenderDirty = false;
  draw();
  renderResults();
}

function scheduleLetterWeightRender() {
  letterWeightRenderDirty = true;
  if (letterWeightRenderFrame !== null) return;
  if (typeof requestAnimationFrame === 'function') {
    letterWeightRenderFrame = requestAnimationFrame(runScheduledLetterWeightRender);
  } else {
    runScheduledLetterWeightRender();
  }
}

function flushLetterWeightRender() {
  if (!letterWeightRenderDirty) return;
  if (letterWeightRenderFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(letterWeightRenderFrame);
  }
  letterWeightRenderFrame = null;
  runScheduledLetterWeightRender();
}

function commitLetterWeightRender() {
  const object = selectedLetterTemplate();
  const exactDrawRequired = !!object && letterWeightPreviewId === object.id;
  letterWeightPreviewId = null;
  const pendingDraw = letterWeightRenderDirty;
  flushLetterWeightRender();
  if (exactDrawRequired && !pendingDraw) {
    draw();
    renderResults();
  }
}

$('letterBoardBtn')?.addEventListener('click', () => {
  const drawer = $('letterDrawer');
  drawer.hidden = !drawer.hidden;
  $('letterBoardBtn').classList.toggle('active', !drawer.hidden);
  if (!drawer.hidden) renderLetterKeyboard();
});
$('startVectorizeBtn')?.addEventListener('click', () => setTool('vectorize'));
$('letterAnchorLassoBtn')?.addEventListener('click', armLetterAnchorLasso);
$('closeLetterDrawerBtn')?.addEventListener('click', () => {
  $('letterDrawer').hidden = true;
  $('letterBoardBtn').classList.remove('active');
});
document.querySelectorAll('[data-letter-tradition]').forEach(button => {
  button.addEventListener('click', () => setActiveLetterTradition(button.dataset.letterTradition));
});
$('letterModeSolidBtn')?.addEventListener('click', () => {
  const object = selectedLetterTemplate();
  if (!object || object.letterMode === 'solid') return;
  snapshot();
  updateSelectedLetterProperty('letterMode', 'solid');
});
$('letterModeOutlineBtn')?.addEventListener('click', () => {
  const object = selectedLetterTemplate();
  if (!object || object.letterMode === 'outline') return;
  snapshot();
  updateSelectedLetterProperty('letterMode', 'outline');
});
$('letterColorInput')?.addEventListener('input', event => updateSelectedLetterProperty('color', event.target.value));
$('letterOpacityInput')?.addEventListener('input', event => updateSelectedLetterProperty('letterOpacity', +event.target.value / 100));
$('letterOutlineWidthInput')?.addEventListener('input', event => updateSelectedLetterProperty('letterOutlineWidth', +event.target.value));
$('letterWeightInput')?.addEventListener('pointerdown', () => {
  if (!selectedLetterTemplate()) return;
  snapshot();
  letterWeightHistoryArmed = true;
});
$('letterWeightInput')?.addEventListener('input', event => {
  const object = selectedLetterTemplate();
  if (!object) return;
  if (!letterWeightHistoryArmed) {
    snapshot();
    letterWeightHistoryArmed = true;
  }
  const intensity = clamp(+event.target.value, -100, 100);
  const requestedWeight = 1 + intensity / 100 * .45;
  object.letterWeight = requestedWeight;
  if (object.letterVector) object.letterVector.weight = requestedWeight;
  letterWeightPreviewId = object.id;
  object.auto = false;
  markObjectModified(object);
  syncLetterControls(object);
  scheduleLetterWeightRender();
});
$('letterWeightInput')?.addEventListener('change', () => {
  commitLetterWeightRender();
  letterWeightHistoryArmed = false;
});
$('letterWeightInput')?.addEventListener('pointerup', () => {
  commitLetterWeightRender();
  letterWeightHistoryArmed = false;
});
$('letterWeightInput')?.addEventListener('pointercancel', () => {
  commitLetterWeightRender();
  letterWeightHistoryArmed = false;
});
$('letterWeightInput')?.addEventListener('blur', () => {
  commitLetterWeightRender();
  letterWeightHistoryArmed = false;
});
$('letterGridInput')?.addEventListener('change', event => {
  snapshot();
  updateSelectedLetterProperty('letterGridVisible', event.target.checked);
});
$('letterLockAspectInput')?.addEventListener('change', event => {
  snapshot();
  updateSelectedLetterProperty('letterLockAspect', event.target.checked);
});
$('letterEditAnchorsInput')?.addEventListener('change', event => {
  const object = selectedLetterTemplate();
  if (!object) return;
  object.vectorDetailLevel = event.target.checked ? 'full' : 'structural';
  object.letterEditAnchors = object.vectorDetailLevel !== 'structural';
  state.letterVectorSelection = null;
  state.letterVectorLasso = null;
  $('letterAnchorLassoBtn')?.classList.remove('active');
  syncLetterControls(object);
  draw();
  statusText.textContent = object.letterEditAnchors
    ? 'מצב עריכת עוגנים פעיל: גרור נקודה בודדת, או הקף קבוצת עוגנים'
    : 'מצב עריכת העוגנים נסגר; האות נשארה וקטורית';
});
$('letterVectorLevelSelect')?.addEventListener('change', event => {
  const object = selectedLetterTemplate();
  if (!object) return;
  snapshot();
  object.vectorDetailLevel = ['structural', 'organs', 'curves', 'full'].includes(event.target.value)
    ? event.target.value
    : 'structural';
  object.letterEditAnchors = object.vectorDetailLevel !== 'structural';
  object.correctionHandleIds = [];
  state.letterVectorSelection = null;
  state.letterVectorLasso = null;
  $('letterAnchorLassoBtn')?.classList.remove('active');
  markObjectModified(object);
  syncLetterControls(object);
  draw();
  const messages = {
    structural: 'דרגת מבנה: אפשר להזיז ולשנות את מסגרת האות, והווקטור המלא נשמר מתחתיה',
    organs: 'דרגת איברים: כל נקודת שליטה מזיזה קבוצת עוגנים מקומית',
    curves: 'דרגת עקומות: מוצגות כל נקודות העוגן ללא עומס ידיות',
    full: 'דרגה מלאה: כל נקודות העוגן וידיות ה־Bézier מוצגות לעריכה מדויקת'
  };
  statusText.textContent = messages[object.vectorDetailLevel];
});
$('duplicateLetterBtn')?.addEventListener('click', duplicateSelectedLetter);
$('resetLetterRatioBtn')?.addEventListener('click', resetSelectedLetterRatio);
$('deleteLetterBtn')?.addEventListener('click', () => {
  if (selectedLetterTemplate()) deleteSelectedObject();
});

/*
 * app-3 registers its pointer-up handler after this file. Marking the active
 * vector edit here makes that handler's final render exact, while pointer-move
 * frames stay on the inexpensive editable Bézier preview.
 */
if (typeof canvas !== 'undefined' && canvas?.addEventListener) {
  canvas.addEventListener('pointerup', () => {
    if (typeof state !== 'undefined'
      && (state.dragging?.type === 'letterVectorHandle'
        || state.dragging?.type === 'letterVectorGroup'
        || (state.dragging?.type === 'letterResize'
          && state.objects?.find(object => object.id === state.dragging.id)?.letterMode === 'outline'))) {
      letterMorphForceExactId = state.dragging.id;
    }
  });
}

renderLetterKeyboard();
