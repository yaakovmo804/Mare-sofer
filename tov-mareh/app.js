const $ = (id) => document.getElementById(id);

const state = {
  image: null,
  engine: 'local',
  zoom: 1,
  autoFit: true,
  history: [],
  historyIndex: -1,
  renderToken: 0,
  settings: {
    rotation: 0,
    perspective: 0,
    crop: 0,
    sharpness: 40,
    black: 36,
    uniformity: 42,
    gloss: 18,
    depth: 14,
    warmth: 14,
    texture: 10,
    brightness: 54,
    denoise: 12,
    deglare: 18,
    lock: 95
  },
  aiEndpoint: localStorage.getItem('tm_ipad_ai') || ''
};

const presets = {
  faithful: { sharpness: 34, black: 28, uniformity: 32, gloss: 6, depth: 6, warmth: 10, texture: 7, brightness: 56, denoise: 12, deglare: 18, lock: 97 },
  liveInk: { sharpness: 44, black: 48, uniformity: 48, gloss: 15, depth: 18, warmth: 12, texture: 9, brightness: 54, denoise: 10, deglare: 18, lock: 94 },
  gentleGloss: { sharpness: 42, black: 42, uniformity: 47, gloss: 28, depth: 20, warmth: 13, texture: 10, brightness: 54, denoise: 10, deglare: 14, lock: 93 },
  lacquer: { sharpness: 44, black: 52, uniformity: 58, gloss: 46, depth: 32, warmth: 14, texture: 10, brightness: 53, denoise: 8, deglare: 12, lock: 91 },
  faded: { sharpness: 55, black: 62, uniformity: 58, gloss: 8, depth: 12, warmth: 10, texture: 7, brightness: 58, denoise: 18, deglare: 20, lock: 96 },
  flash: { sharpness: 42, black: 39, uniformity: 50, gloss: 4, depth: 10, warmth: 15, texture: 12, brightness: 56, denoise: 16, deglare: 62, lock: 97 },
  parchment: { sharpness: 34, black: 31, uniformity: 36, gloss: 9, depth: 10, warmth: 28, texture: 27, brightness: 59, denoise: 14, deglare: 20, lock: 96 }
};

const before = $('beforeCanvas');
const after = $('afterCanvas');
const bctx = before.getContext('2d', { willReadFrequently: true });
const actx = after.getContext('2d', { willReadFrequently: true });

function bind() {
  ['imageInput', 'emptyImageInput'].forEach((id) => {
    $(id).addEventListener('change', (event) => loadFile(event.target.files[0]));
  });

  document.querySelectorAll('.tool').forEach((button) => {
    button.addEventListener('click', () => showPanel(button.dataset.tool, button));
  });

  document.querySelectorAll('[data-engine]').forEach((button) => {
    button.addEventListener('click', () => setEngine(button.dataset.engine));
  });

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => applyPreset(button.dataset.preset));
  });

  const controls = [
    'rotation', 'perspective', 'crop', 'sharpness', 'black', 'uniformity',
    'gloss', 'depth', 'warmth', 'texture', 'brightness', 'denoise', 'deglare'
  ];

  controls.forEach((id) => {
    $(id).addEventListener('input', () => {
      state.settings[id] = Number($(id).value);
      $(id + 'Out').textContent = id === 'rotation' ? $(id).value + '°' : $(id).value;
      scheduleRender();
    });
  });

  $('compareRange').addEventListener('input', updateDivider);
  $('compareDivider').addEventListener('pointerdown', startDividerDrag);

  $('zoomInBtn').onclick = () => {
    state.autoFit = false;
    setZoom(state.zoom + 0.15);
  };
  $('zoomOutBtn').onclick = () => {
    state.autoFit = false;
    setZoom(state.zoom - 0.15);
  };
  $('fitBtn').onclick = () => {
    state.autoFit = true;
    fitImageToStage();
  };

  $('applyBtn').onclick = () => render(true);
  $('autoAlignBtn').onclick = autoAlign;
  $('undoBtn').onclick = undo;
  $('redoBtn').onclick = redo;

  $('saveProjectBtn').onclick = saveProject;
  $('projectInput').addEventListener('change', (event) => loadProject(event.target.files[0]));
  $('exportBtn').onclick = exportImage;

  $('dismissStandaloneHint').onclick = () => {
    localStorage.setItem('tm_install_hint', '1');
    $('standaloneHint').hidden = true;
  };

  $('aiEndpoint').value = state.aiEndpoint;
  $('aiEndpoint').addEventListener('change', () => {
    state.aiEndpoint = $('aiEndpoint').value.trim();
    localStorage.setItem('tm_ipad_ai', state.aiEndpoint);
  });

  $('testServerBtn').onclick = testServer;
  $('applyAiBtn').onclick = () => setEngine('ai');

  if (
    !window.matchMedia('(display-mode: standalone)').matches &&
    !localStorage.getItem('tm_install_hint')
  ) {
    $('standaloneHint').hidden = false;
  }

  window.addEventListener('resize', refitAfterLayoutChange);
  window.addEventListener('orientationchange', () => {
    window.setTimeout(refitAfterLayoutChange, 250);
  });

  document.addEventListener('gesturestart', (event) => event.preventDefault());
}

async function loadFile(file) {
  if (!file) return;

  setBusy(false);
  const url = URL.createObjectURL(file);
  const img = new Image();

  img.onload = () => {
    state.image = img;
    state.autoFit = true;
    URL.revokeObjectURL(url);
    $('emptyState').hidden = true;
    $('stage').hidden = false;
    pushHistory();
    render();
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    setBusy(false);
    alert('לא ניתן היה לפתוח את התמונה.');
  };

  img.src = url;
}

function showPanel(name, button) {
  document.querySelectorAll('.tool').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelectorAll('.inspector-page').forEach((item) => item.classList.remove('active'));
  $('panel-' + name)?.classList.add('active');
}

function setEngine(engine) {
  state.engine = engine;
  document.querySelectorAll('[data-engine]').forEach((item) => {
    item.classList.toggle('active', item.dataset.engine === engine);
  });
  render();
}

function applyPreset(name) {
  Object.assign(state.settings, presets[name]);
  syncUi();
  document.querySelectorAll('[data-preset]').forEach((item) => {
    item.classList.toggle('active', item.dataset.preset === name);
  });
  pushHistory();
  render();
}

function syncUi() {
  for (const [key, value] of Object.entries(state.settings)) {
    const input = $(key);
    if (input) input.value = value;
    const output = $(key + 'Out');
    if (output) output.textContent = key === 'rotation' ? value + '°' : value;
  }
  $('lockLabel').textContent = state.settings.lock + '%';
}

let timer;
function scheduleRender() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => render(), 70);
}

function render(commit = false) {
  if (!state.image) return;

  const token = ++state.renderToken;
  const useRemoteAi = state.engine === 'ai' && Boolean(state.aiEndpoint);
  setBusy(useRemoteAi);

  window.requestAnimationFrame(async () => {
    try {
      drawBase();

      if (useRemoteAi) {
        await renderAi(token);
      } else {
        processLocal(state.engine === 'ai' ? 1.12 : 1);
      }

      if (commit) pushHistory();
    } catch (error) {
      console.error(error);
      if (token === state.renderToken) {
        processLocal(state.engine === 'ai' ? 1.12 : 1);
        $('aiStatus').textContent = 'העיבוד המרוחק נכשל — הופעל המנוע המקומי';
      }
    } finally {
      if (token === state.renderToken) {
        setBusy(false);
        if (state.autoFit) {
          window.requestAnimationFrame(fitImageToStage);
        } else {
          setZoom(state.zoom);
        }
      }
    }
  });
}

function setBusy(isBusy) {
  const overlay = $('busyOverlay');
  overlay.hidden = !isBusy;
  overlay.setAttribute('aria-hidden', String(!isBusy));
}

function drawBase() {
  const img = state.image;
  const settings = state.settings;
  const margin = settings.crop / 100;
  const sourceWidth = img.width * (1 - margin * 2);
  const sourceHeight = img.height * (1 - margin * 2);
  const maxPixelWidth = 1800;
  const pixelScale = Math.min(1, maxPixelWidth / sourceWidth);
  const width = Math.max(120, Math.round(sourceWidth * pixelScale));
  const height = Math.max(80, Math.round(sourceHeight * pixelScale));

  [before, after].forEach((canvas) => {
    canvas.width = width;
    canvas.height = height;
  });

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#f5f1e8';
  sctx.fillRect(0, 0, width, height);
  sctx.save();
  sctx.translate(width / 2, height / 2);
  sctx.rotate(settings.rotation * Math.PI / 180);
  sctx.drawImage(
    img,
    img.width * margin,
    img.height * margin,
    sourceWidth,
    sourceHeight,
    -width / 2,
    -height / 2,
    width,
    height
  );
  sctx.restore();

  bctx.clearRect(0, 0, width, height);
  const perspective = settings.perspective / 100;
  if (Math.abs(perspective) < 0.001) {
    bctx.drawImage(scratch, 0, 0);
  } else {
    const source = sctx.getImageData(0, 0, width, height);
    const target = bctx.createImageData(width, height);
    const inset = Math.abs(perspective) * width * 0.18;
    for (let y = 0; y < height; y++) {
      const t = y / Math.max(1, height - 1);
      const left = perspective > 0 ? inset * (1 - t) : inset * t;
      const right = perspective > 0 ? width - inset * (1 - t) : width - inset * t;
      for (let x = 0; x < width; x++) {
        const u = x / Math.max(1, width - 1);
        const sourceX = left + u * (right - left);
        sampleBilinear(source.data, width, height, sourceX, y, target.data, (y * width + x) * 4);
      }
    }
    bctx.putImageData(target, 0, 0);
  }

  actx.clearRect(0, 0, width, height);
  actx.drawImage(before, 0, 0);
  updateDivider();

  if (state.autoFit) fitImageToStage();
  else setZoom(state.zoom);
}

function processLocal(multiplier = 1) {
  const width = before.width;
  const height = before.height;
  const original = bctx.getImageData(0, 0, width, height);
  const settings = state.settings;

  const denoiseRadius = Math.round((settings.denoise / 100) * 3);
  const source = denoiseRadius > 0
    ? edgePreservingDenoise(original, width, height, denoiseRadius, settings.denoise / 100)
    : original;
  const illumination = boxBlur(original, width, height, Math.max(3, Math.round(7 + settings.deglare / 9)));
  const output = actx.createImageData(width, height);
  const maskImage = actx.createImageData(width, height);
  const data = source.data;
  const originalData = original.data;
  const illumData = illumination.data;
  const out = output.data;
  const maskOut = maskImage.data;

  const sharp = settings.sharpness / 100 * multiplier;
  const black = settings.black / 100 * multiplier;
  const uniformity = settings.uniformity / 100;
  const gloss = settings.gloss / 100 * multiplier;
  const depth = settings.depth / 100;
  const warmth = settings.warmth / 100;
  const texture = settings.texture / 100;
  const brightness = (settings.brightness - 50) * 1.8;
  const deglare = settings.deglare / 100;
  const lock = settings.lock / 100;
  const threshold = 178 - black * 23;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const luminance = luminanceAt(data, index);
      const originalLuminance = luminanceAt(originalData, index);
      const localLight = luminanceAt(illumData, index);
      const edge = edgeAt(originalData, width, height, x, y);

      const corrected = luminance - (localLight - 225) * deglare * 0.82;
      const glareRecovery = clamp((originalLuminance - 214) / 38, 0, 1) * deglare * edge * 0.62;
      let rawInk = clamp((threshold - corrected) / 112 + glareRecovery, 0, 1);

      const confidenceFloor = 0.025 + lock * 0.055;
      if (rawInk < confidenceFloor) rawInk = 0;
      const mask = Math.pow(rawInk, 0.92 + lock * 0.18 - uniformity * 0.22);
      const core = clamp(mask * (1 - edge * 0.72), 0, 1);

      const fibre = (
        Math.sin(x * 0.013 + y * 0.004) * 0.48 +
        Math.sin(x * 0.004 - y * 0.017) * 0.34 +
        Math.cos((x + y) * 0.006) * 0.18
      ) * texture * 5.2;
      const pore = (hashNoise(x, y) - 0.5) * texture * 2.0;
      const paperR = clamp(244 + warmth * 13 + brightness + fibre + pore, 210, 255);
      const paperG = clamp(239 + warmth * 4 + brightness + fibre * 0.78 + pore, 203, 253);
      const paperB = clamp(228 - warmth * 14 + brightness + fibre * 0.52 + pore, 188, 249);

      const targetBlack = 5 + (1 - black) * 20;
      const fill = clamp(mask * (0.88 + black * 0.62), 0, 1);
      const fillCorrection = uniformity * core * (corrected - targetBlack) * 0.34;

      let red = lerp(paperR, targetBlack, fill) - fillCorrection;
      let green = lerp(paperG, targetBlack, fill) - fillCorrection;
      let blue = lerp(paperB, targetBlack, fill) - fillCorrection;

      if (mask > 0.015) {
        const band = 0.5 + 0.5 * Math.sin((x * 0.009) + (y * 0.003));
        const shineShape = core * (0.62 + band * 0.38) * (1 - edge * 0.7);
        const highlight = gloss * shineShape * 34;
        const mass = depth * core * 22;
        red = red - mass + highlight;
        green = green - mass * 0.95 + highlight * 0.92;
        blue = blue - mass * 0.9 + highlight * 0.82;
      }

      out[index] = clamp(red, 0, 255);
      out[index + 1] = clamp(green, 0, 255);
      out[index + 2] = clamp(blue, 0, 255);
      out[index + 3] = 255;
      const maskByte = Math.round(mask * 255);
      maskOut[index] = maskOut[index + 1] = maskOut[index + 2] = maskByte;
      maskOut[index + 3] = 255;
    }
  }

  actx.putImageData(output, 0, 0);
  if (sharp > 0) maskedUnsharp(sharp, maskImage.data);
  $('deltaLabel').textContent = estimateDelta(original, actx.getImageData(0, 0, width, height)).toFixed(1) + '%';
}

async function renderAi(token) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 18000);

  try {
    const response = await fetch(state.aiEndpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: before.toDataURL('image/png'),
        controls: state.settings,
        prompt: 'שפר את תמונת כתב הסת״ם ללא שום שינוי בצורת האותיות, בתגים, בעובי ובשלד.'
      })
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);

    const payload = await response.json();
    if (!payload.image) throw new Error('השרת לא החזיר תמונה.');

    const img = new Image();
    img.src = payload.image;
    await img.decode();

    if (token !== state.renderToken) return;

    actx.clearRect(0, 0, after.width, after.height);
    actx.drawImage(img, 0, 0, after.width, after.height);
    $('aiStatus').textContent = 'העיבוד התקבל מהשרת';
  } catch (error) {
    if (token !== state.renderToken) return;
    $('aiStatus').textContent = error.name === 'AbortError'
      ? 'השרת לא הגיב בזמן — הופעל המנוע המקומי'
      : 'השרת אינו זמין — הופעל המנוע המקומי';
    processLocal(1.12);
  } finally {
    window.clearTimeout(timeout);
  }
}

function edgeAt(data, width, height, x, y) {
  if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return 1;
  const luminanceAtLocal = (index) => 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
  const index = (y * width + x) * 4;
  return clamp(
    (
      Math.abs(luminanceAtLocal(index + 4) - luminanceAtLocal(index - 4)) +
      Math.abs(luminanceAtLocal(index + width * 4) - luminanceAtLocal(index - width * 4))
    ) / 180,
    0,
    1
  );
}

function maskedUnsharp(amount, mask) {
  const width = after.width;
  const height = after.height;
  const image = actx.getImageData(0, 0, width, height);
  const data = image.data;
  const blurred = boxBlur(image, width, height, 1).data;

  for (let index = 0; index < data.length; index += 4) {
    const inkWeight = mask[index] / 255;
    const strength = amount * (0.32 + inkWeight * 0.9);
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = clamp(
        data[index + channel] + (data[index + channel] - blurred[index + channel]) * strength,
        0,
        255
      );
    }
  }
  actx.putImageData(image, 0, 0);
}

function boxBlur(image, width, height, radius) {
  radius = Math.max(0, Math.round(radius));
  if (radius === 0) return new ImageData(new Uint8ClampedArray(image.data), width, height);

  const source = image.data;
  const horizontal = new Float32Array(source.length);
  const output = new ImageData(width, height);
  const out = output.data;
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let red = 0, green = 0, blue = 0;
    for (let x = -radius; x <= radius; x++) {
      const sx = clamp(x, 0, width - 1);
      const i = (y * width + sx) * 4;
      red += source[i]; green += source[i + 1]; blue += source[i + 2];
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      horizontal[i] = red / windowSize;
      horizontal[i + 1] = green / windowSize;
      horizontal[i + 2] = blue / windowSize;
      horizontal[i + 3] = 255;
      const removeX = clamp(x - radius, 0, width - 1);
      const addX = clamp(x + radius + 1, 0, width - 1);
      const remove = (y * width + removeX) * 4;
      const add = (y * width + addX) * 4;
      red += source[add] - source[remove];
      green += source[add + 1] - source[remove + 1];
      blue += source[add + 2] - source[remove + 2];
    }
  }

  for (let x = 0; x < width; x++) {
    let red = 0, green = 0, blue = 0;
    for (let y = -radius; y <= radius; y++) {
      const sy = clamp(y, 0, height - 1);
      const i = (sy * width + x) * 4;
      red += horizontal[i]; green += horizontal[i + 1]; blue += horizontal[i + 2];
    }
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      out[i] = red / windowSize;
      out[i + 1] = green / windowSize;
      out[i + 2] = blue / windowSize;
      out[i + 3] = 255;
      const removeY = clamp(y - radius, 0, height - 1);
      const addY = clamp(y + radius + 1, 0, height - 1);
      const remove = (removeY * width + x) * 4;
      const add = (addY * width + x) * 4;
      red += horizontal[add] - horizontal[remove];
      green += horizontal[add + 1] - horizontal[remove + 1];
      blue += horizontal[add + 2] - horizontal[remove + 2];
    }
  }
  return output;
}

function edgePreservingDenoise(image, width, height, radius, amount) {
  const source = image.data;
  const result = new ImageData(width, height);
  const out = result.data;
  const range = 18 + amount * 52;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const center = luminanceAt(source, index);
      let weightSum = 0;
      let red = 0, green = 0, blue = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = clamp(y + dy, 0, height - 1);
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = clamp(x + dx, 0, width - 1);
          const sample = (sy * width + sx) * 4;
          const difference = Math.abs(luminanceAt(source, sample) - center);
          const spatial = 1 / (1 + dx * dx + dy * dy);
          const tonal = Math.exp(-(difference * difference) / (2 * range * range));
          const weight = spatial * tonal;
          red += source[sample] * weight;
          green += source[sample + 1] * weight;
          blue += source[sample + 2] * weight;
          weightSum += weight;
        }
      }
      out[index] = red / weightSum;
      out[index + 1] = green / weightSum;
      out[index + 2] = blue / weightSum;
      out[index + 3] = 255;
    }
  }
  return result;
}

function sampleBilinear(source, width, height, x, y, target, targetIndex) {
  x = clamp(x, 0, width - 1);
  y = clamp(y, 0, height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const indices = [
    (y0 * width + x0) * 4,
    (y0 * width + x1) * 4,
    (y1 * width + x0) * 4,
    (y1 * width + x1) * 4
  ];
  for (let channel = 0; channel < 4; channel++) {
    const top = lerp(source[indices[0] + channel], source[indices[1] + channel], tx);
    const bottom = lerp(source[indices[2] + channel], source[indices[3] + channel], tx);
    target[targetIndex + channel] = lerp(top, bottom, ty);
  }
}

function luminanceAt(data, index) {
  return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
}

function hashNoise(x, y) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function estimateDelta(source, result) {
  let changed = 0;
  let samples = 0;

  for (let index = 0; index < source.data.length; index += 20) {
    const sourceInk = (
      0.299 * source.data[index] +
      0.587 * source.data[index + 1] +
      0.114 * source.data[index + 2]
    ) < 170;
    const resultInk = (
      0.299 * result.data[index] +
      0.587 * result.data[index + 1] +
      0.114 * result.data[index + 2]
    ) < 170;
    if (sourceInk !== resultInk) changed++;
    samples++;
  }

  return samples ? changed / samples * 100 : 0;
}

function updateDivider() {
  after.style.clipPath = `inset(0 0 0 ${$('compareRange').value}%)`;
  $('compareDivider').style.left = $('compareRange').value + '%';
}

function startDividerDrag(event) {
  event.preventDefault();

  const move = (pointerEvent) => {
    const rect = $('canvasWrap').getBoundingClientRect();
    const percent = clamp((pointerEvent.clientX - rect.left) / rect.width * 100, 0, 100);
    $('compareRange').value = percent;
    updateDivider();
  };

  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function fitImageToStage() {
  if (!state.image || !before.width || $('stage').hidden) return;

  const stage = $('stage');
  const horizontalPadding = 48;
  const verticalPadding = 48;
  const availableWidth = Math.max(120, stage.clientWidth - horizontalPadding);
  const availableHeight = Math.max(100, stage.clientHeight - verticalPadding);
  const fittedZoom = Math.min(
    availableWidth / before.width,
    availableHeight / before.height,
    1.25
  );

  setZoom(clamp(fittedZoom, 0.12, 2.5));
}

function refitAfterLayoutChange() {
  if (!state.autoFit || !state.image) return;
  window.requestAnimationFrame(fitImageToStage);
}

function setZoom(zoom) {
  state.zoom = clamp(zoom, 0.12, 2.5);

  const displayedWidth = Math.max(1, Math.round(before.width * state.zoom));
  const displayedHeight = Math.max(1, Math.round(before.height * state.zoom));
  const wrap = $('canvasWrap');

  wrap.style.transform = 'none';
  wrap.style.width = displayedWidth + 'px';
  wrap.style.height = displayedHeight + 'px';

  [before, after].forEach((canvas) => {
    canvas.style.width = displayedWidth + 'px';
    canvas.style.height = displayedHeight + 'px';
  });

  $('zoomLabel').textContent = Math.round(state.zoom * 100) + '%';
}

function autoAlign() {
  state.settings.rotation = 0;
  syncUi();
  pushHistory();
  render();
}

function pushHistory() {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(JSON.stringify(state.settings));
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  state.settings = JSON.parse(state.history[state.historyIndex]);
  syncUi();
  render();
  updateHistoryButtons();
}

function redo() {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  state.settings = JSON.parse(state.history[state.historyIndex]);
  syncUi();
  render();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undoBtn').disabled = state.historyIndex <= 0;
  $('redoBtn').disabled = state.historyIndex >= state.history.length - 1;
}

function saveProject() {
  if (!state.image) return;
  const project = {
    version: 2,
    settings: state.settings,
    image: before.toDataURL('image/png')
  };
  download(
    new Blob([JSON.stringify(project)], { type: 'application/json' }),
    'tov-mareh-project.json'
  );
}

function loadProject(file) {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = () => {
    const project = JSON.parse(reader.result);
    state.settings = { ...state.settings, ...project.settings };
    syncUi();

    const img = new Image();
    img.onload = () => {
      state.image = img;
      state.autoFit = true;
      $('emptyState').hidden = true;
      $('stage').hidden = false;
      pushHistory();
      render();
    };
    img.src = project.image;
  };

  reader.readAsText(file);
}

function exportImage() {
  if (!state.image) return;
  after.toBlob((blob) => download(blob, 'tov-mareh.png'));
}

function download(blob, name) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
}

async function testServer() {
  try {
    const health = state.aiEndpoint.replace(/\/api\/process$/, '/api/health');
    const response = await fetch(health);
    if (!response.ok) throw new Error();
    $('aiStatus').textContent = 'השרת מחובר';
  } catch {
    $('aiStatus').textContent = 'אין חיבור לשרת';
  }
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const lerp = (start, end, amount) => start + (end - start) * amount;

bind();
syncUi();
updateHistoryButtons();
setBusy(false);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
