(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MarehSoferImageCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function grayscaleFromRgba(data, width, height) {
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
      gray[i] = luminance(data[p], data[p + 1], data[p + 2]);
    }
    return gray;
  }

  function otsuThreshold(gray) {
    const histogram = new Uint32Array(256);
    for (let i = 0; i < gray.length; i += 1) histogram[clamp(Math.round(gray[i]), 0, 255)] += 1;

    let total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

    let sumBackground = 0;
    let weightBackground = 0;
    let bestVariance = -1;
    let bestThreshold = 128;

    for (let t = 0; t < 256; t += 1) {
      weightBackground += histogram[t];
      if (!weightBackground) continue;
      const weightForeground = total - weightBackground;
      if (!weightForeground) break;
      sumBackground += t * histogram[t];
      const meanBackground = sumBackground / weightBackground;
      const meanForeground = (sum - sumBackground) / weightForeground;
      const variance = weightBackground * weightForeground * Math.pow(meanBackground - meanForeground, 2);
      if (variance > bestVariance) {
        bestVariance = variance;
        bestThreshold = t;
      }
    }
    return clamp(bestThreshold, 55, 220);
  }

  function boxBlur(values, width, height, radius) {
    if (radius <= 0) return new Float32Array(values);
    const temp = new Float32Array(values.length);
    const output = new Float32Array(values.length);
    const size = radius * 2 + 1;

    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) sum += values[y * width + clamp(x, 0, width - 1)];
      for (let x = 0; x < width; x += 1) {
        temp[y * width + x] = sum / size;
        sum -= values[y * width + clamp(x - radius, 0, width - 1)];
        sum += values[y * width + clamp(x + radius + 1, 0, width - 1)];
      }
    }

    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) sum += temp[clamp(y, 0, height - 1) * width + x];
      for (let y = 0; y < height; y += 1) {
        output[y * width + x] = sum / size;
        sum -= temp[clamp(y - radius, 0, height - 1) * width + x];
        sum += temp[clamp(y + radius + 1, 0, height - 1) * width + x];
      }
    }
    return output;
  }

  function createInkMask(data, width, height, options) {
    const settings = Object.assign({ thresholdOffset: 0, feather: 18 }, options || {});
    const gray = grayscaleFromRgba(data, width, height);
    const threshold = clamp(otsuThreshold(gray) + settings.thresholdOffset, 45, 230);
    const binary = new Uint8Array(width * height);
    const alpha = new Float32Array(width * height);

    for (let i = 0; i < gray.length; i += 1) {
      binary[i] = gray[i] <= threshold ? 1 : 0;
      alpha[i] = 1 - smoothstep(threshold - settings.feather, threshold + settings.feather, gray[i]);
    }
    return { gray, threshold, binary, alpha };
  }

  function distanceInsideMask(mask, width, height) {
    const infinity = width + height;
    const distance = new Float32Array(mask.length);
    for (let i = 0; i < mask.length; i += 1) distance[i] = mask[i] ? infinity : 0;

    const diagonal = Math.SQRT2;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (!mask[i]) continue;
        let value = distance[i];
        if (x > 0) value = Math.min(value, distance[i - 1] + 1);
        if (y > 0) value = Math.min(value, distance[i - width] + 1);
        if (x > 0 && y > 0) value = Math.min(value, distance[i - width - 1] + diagonal);
        if (x + 1 < width && y > 0) value = Math.min(value, distance[i - width + 1] + diagonal);
        distance[i] = value;
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const i = y * width + x;
        if (!mask[i]) continue;
        let value = distance[i];
        if (x + 1 < width) value = Math.min(value, distance[i + 1] + 1);
        if (y + 1 < height) value = Math.min(value, distance[i + width] + 1);
        if (x + 1 < width && y + 1 < height) value = Math.min(value, distance[i + width + 1] + diagonal);
        if (x > 0 && y + 1 < height) value = Math.min(value, distance[i + width - 1] + diagonal);
        distance[i] = value;
      }
    }
    return distance;
  }

  function estimateRowAngle(data, width, height, options) {
    const settings = Object.assign({ maxDegrees: 8, stepDegrees: 0.25 }, options || {});
    const gray = data.length === width * height ? data : grayscaleFromRgba(data, width, height);
    let bestAngle = 0;
    let bestScore = -Infinity;
    const centerX = (width - 1) / 2;

    for (let angle = -settings.maxDegrees; angle <= settings.maxDegrees + 1e-6; angle += settings.stepDegrees) {
      const slope = Math.tan(angle * Math.PI / 180);
      const bins = new Float64Array(height + Math.ceil(Math.abs(slope) * width) + 4);
      const offset = Math.ceil(Math.abs(slope) * width / 2) + 2;
      for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
          const darkness = Math.max(0, 185 - gray[y * width + x]);
          if (darkness < 18) continue;
          const projectedY = Math.round(y - slope * (x - centerX)) + offset;
          if (projectedY >= 0 && projectedY < bins.length) bins[projectedY] += darkness;
        }
      }
      let score = 0;
      for (let i = 0; i < bins.length; i += 1) score += bins[i] * bins[i];
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }
    return bestAngle;
  }

  const PRESETS = {
    faithful: { sharpness: 0.55, denoise: 0.25, blackness: 0.35, uniformity: 0.2, gloss: 0.08, depth: 0.08, warmth: 0.08, parchmentTexture: 0.2, parchmentBrightness: 0.02 },
    liveInk: { sharpness: 0.7, denoise: 0.35, blackness: 0.72, uniformity: 0.45, gloss: 0.18, depth: 0.18, warmth: 0.1, parchmentTexture: 0.25, parchmentBrightness: 0.03 },
    softGloss: { sharpness: 0.65, denoise: 0.35, blackness: 0.72, uniformity: 0.5, gloss: 0.34, depth: 0.22, warmth: 0.12, parchmentTexture: 0.24, parchmentBrightness: 0.03 },
    lacquer: { sharpness: 0.62, denoise: 0.38, blackness: 0.82, uniformity: 0.58, gloss: 0.62, depth: 0.42, warmth: 0.14, parchmentTexture: 0.28, parchmentBrightness: 0.02 },
    naturalParchment: { sharpness: 0.52, denoise: 0.22, blackness: 0.5, uniformity: 0.28, gloss: 0.12, depth: 0.12, warmth: 0.32, parchmentTexture: 0.55, parchmentBrightness: 0.05 }
  };

  function applyPreset(name) {
    return Object.assign({}, PRESETS[name] || PRESETS.faithful);
  }

  function processImageData(input, width, height, options) {
    const settings = Object.assign({}, PRESETS.faithful, options || {});
    const source = input.data || input;
    const maskResult = createInkMask(source, width, height, settings);
    const { gray, binary, alpha, threshold } = maskResult;
    const denoiseRadius = Math.round(clamp(settings.denoise, 0, 1) * 2);
    const smoothGray = boxBlur(gray, width, height, denoiseRadius);
    const detailBlur = boxBlur(smoothGray, width, height, 2);
    const backgroundBlur = boxBlur(gray, width, height, 5);
    const distance = distanceInsideMask(binary, width, height);
    const output = new Uint8ClampedArray(source.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const p = i * 4;
        const localDetail = smoothGray[i] - detailBlur[i];
        const sharpened = clamp(smoothGray[i] + localDetail * (1.2 + settings.sharpness * 2.8), 0, 255);
        const backgroundDetail = gray[i] - backgroundBlur[i];
        const textureGain = 1 + clamp(settings.parchmentTexture, 0, 1) * 1.8;
        const warm = clamp(settings.warmth, -1, 1);
        const brightness = settings.parchmentBrightness * 80;

        let bgR = clamp(source[p] + backgroundDetail * (textureGain - 1) + brightness + warm * 22, 0, 255);
        let bgG = clamp(source[p + 1] + backgroundDetail * (textureGain - 1) + brightness + warm * 12, 0, 255);
        let bgB = clamp(source[p + 2] + backgroundDetail * (textureGain - 1) + brightness - warm * 14, 0, 255);

        const centerMass = clamp(distance[i] / 7, 0, 1);
        const inkNoise = (sharpened - threshold) / Math.max(20, threshold);
        const uniformity = clamp(settings.uniformity, 0, 1);
        const sourceInk = clamp(18 + inkNoise * 22, 4, 58);
        let inkValue = sourceInk * (1 - uniformity) + 12 * uniformity;
        inkValue *= 1 - clamp(settings.blackness, 0, 1) * 0.62;
        inkValue -= centerMass * clamp(settings.depth, 0, 1) * 5;

        const directional = 0.58 + 0.42 * (1 - x / Math.max(1, width - 1));
        const specular = clamp(settings.gloss, 0, 1) * 52 * Math.pow(centerMass, 0.62) * directional;
        const inkR = clamp(inkValue + specular, 0, 105);
        const inkG = clamp(inkValue + specular * 0.92, 0, 100);
        const inkB = clamp(inkValue + specular * 1.02, 0, 112);

        const a = clamp(alpha[i], 0, 1);
        output[p] = Math.round(bgR * (1 - a) + inkR * a);
        output[p + 1] = Math.round(bgG * (1 - a) + inkG * a);
        output[p + 2] = Math.round(bgB * (1 - a) + inkB * a);
        output[p + 3] = source[p + 3];
      }
    }

    return {
      data: output,
      width,
      height,
      mask: binary,
      alphaMask: alpha,
      threshold,
      metrics: {
        changedGeometryPixels: 0,
        totalInkPixels: binary.reduce((sum, value) => sum + value, 0)
      }
    };
  }

  return {
    PRESETS,
    applyPreset,
    boxBlur,
    createInkMask,
    distanceInsideMask,
    estimateRowAngle,
    grayscaleFromRgba,
    luminance,
    otsuThreshold,
    processImageData
  };
});
