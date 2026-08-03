(() => {
  'use strict';

  const core = window.MarehSoferImageCore;
  if (!core) throw new Error('MarehSoferImageCore is required');

  const imageInput = document.getElementById('imageInput');
  const exportBtn = document.getElementById('exportBtn');
  const resetBtn = document.getElementById('resetBtn');
  const autoStraightenBtn = document.getElementById('autoStraightenBtn');
  const rotateLeftBtn = document.getElementById('rotateLeftBtn');
  const rotateRightBtn = document.getElementById('rotateRightBtn');
  const beforeCanvas = document.getElementById('beforeCanvas');
  const afterCanvas = document.getElementById('afterCanvas');
  const previewStage = document.getElementById('previewStage');
  const emptyState = document.getElementById('emptyState');
  const afterClip = document.getElementById('afterClip');
  const splitLine = document.getElementById('splitLine');
  const splitInput = document.getElementById('splitInput');
  const strengthInput = document.getElementById('strengthInput');
  const strengthOutput = document.getElementById('strengthOutput');
  const geometryMetric = document.getElementById('geometryMetric');
  const maskToggle = document.getElementById('maskToggle');
  const statusText = document.getElementById('statusText');
  const resolutionText = document.getElementById('resolutionText');
  const angleStatus = document.getElementById('angleStatus');
  const settingInputs = Array.from(document.querySelectorAll('[data-setting]'));
  const presetButtons = Array.from(document.querySelectorAll('[data-preset]'));

  const state = {
    loaded: false,
    initialImageData: null,
    initialWidth: 0,
    initialHeight: 0,
    sourceImageData: null,
    width: 0,
    height: 0,
    rotation: 0,
    preset: 'faithful',
    settings: core.applyPreset('faithful'),
    strength: 1,
    renderToken: 0
  };

  const sourceCanvas = document.createElement('canvas');
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const beforeContext = beforeCanvas.getContext('2d');
  const afterContext = afterCanvas.getContext('2d');

  function setStatus(message) {
    statusText.textContent = message;
  }

  function updateSplit() {
    const value = Number(splitInput.value);
    afterClip.style.width = `${value}%`;
    splitLine.style.left = `${value}%`;
  }

  function syncPreviewSizing() {
    if (!state.loaded) return;
    previewStage.style.aspectRatio = `${state.width} / ${state.height}`;
    requestAnimationFrame(() => {
      const rect = previewStage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      afterCanvas.style.width = `${rect.width}px`;
      afterCanvas.style.height = `${rect.height}px`;
    });
  }

  function writeSourceToCanvas(imageData, width, height) {
    state.width = width;
    state.height = height;
    state.sourceImageData = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    sourceContext.putImageData(state.sourceImageData, 0, 0);

    beforeCanvas.width = width;
    beforeCanvas.height = height;
    afterCanvas.width = width;
    afterCanvas.height = height;
    beforeContext.clearRect(0, 0, width, height);
    beforeContext.drawImage(sourceCanvas, 0, 0);
    syncPreviewSizing();
    resolutionText.textContent = `${width}×${height}`;
  }

  function updateControlValues() {
    settingInputs.forEach((input) => {
      const key = input.dataset.setting;
      const value = Math.round((state.settings[key] || 0) * 100);
      input.value = String(value);
      const output = document.querySelector(`[data-output="${key}"]`);
      if (output) output.textContent = `${value}%`;
    });
    strengthInput.value = String(Math.round(state.strength * 100));
    strengthOutput.textContent = `${Math.round(state.strength * 100)}%`;
  }

  function activatePreset(name) {
    state.preset = name;
    state.settings = core.applyPreset(name);
    presetButtons.forEach((button) => button.classList.toggle('active', button.dataset.preset === name));
    updateControlValues();
    scheduleRender();
  }

  function effectiveSettings() {
    const neutral = {
      sharpness: 0.18,
      denoise: 0,
      blackness: 0,
      uniformity: 0,
      gloss: 0,
      depth: 0,
      warmth: 0,
      parchmentTexture: 0,
      parchmentBrightness: 0
    };
    const output = {};
    Object.keys(state.settings).forEach((key) => {
      output[key] = neutral[key] + (state.settings[key] - neutral[key]) * state.strength;
    });
    return output;
  }

  function drawMask(mask) {
    const imageData = afterContext.createImageData(state.width, state.height);
    for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
      const value = mask[i] ? 0 : 244;
      imageData.data[p] = value;
      imageData.data[p + 1] = value;
      imageData.data[p + 2] = value;
      imageData.data[p + 3] = 255;
    }
    afterContext.putImageData(imageData, 0, 0);
  }

  function scheduleRender() {
    if (!state.loaded) return;
    const token = ++state.renderToken;
    setStatus('מעבד דיו וקלף…');
    requestAnimationFrame(() => {
      if (token !== state.renderToken) return;
      const result = core.processImageData(state.sourceImageData, state.width, state.height, effectiveSettings());
      if (token !== state.renderToken) return;
      if (maskToggle.checked) {
        drawMask(result.mask);
      } else {
        afterContext.putImageData(new ImageData(result.data, state.width, state.height), 0, 0);
      }
      geometryMetric.textContent = `${result.metrics.changedGeometryPixels} פיקסלים`;
      setStatus(maskToggle.checked ? 'מסכת הדיו מוצגת' : 'השיפור מוכן');
    });
  }

  async function decodeFile(file) {
    if ('createImageBitmap' in window) return createImageBitmap(file);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = URL.createObjectURL(file);
    });
  }

  async function loadFile(file) {
    if (!file) return;
    setStatus('טוען תמונה…');
    const bitmap = await decodeFile(file);
    const maxDimension = 2200;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    sourceCanvas.width = width;
    sourceCanvas.height = height;
    sourceContext.setTransform(1, 0, 0, 1, 0, 0);
    sourceContext.clearRect(0, 0, width, height);
    sourceContext.drawImage(bitmap, 0, 0, width, height);
    const imageData = sourceContext.getImageData(0, 0, width, height);

    state.initialImageData = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
    state.initialWidth = width;
    state.initialHeight = height;
    state.rotation = 0;
    state.loaded = true;
    writeSourceToCanvas(imageData, width, height);

    emptyState.hidden = true;
    previewStage.hidden = false;
    requestAnimationFrame(syncPreviewSizing);
    [exportBtn, resetBtn, autoStraightenBtn, rotateLeftBtn, rotateRightBtn].forEach((element) => { element.disabled = false; });
    angleStatus.textContent = 'זווית: 0.00°';
    activatePreset('faithful');
    setStatus('התמונה נטענה');
  }

  function rotateCurrent(deltaDegrees) {
    if (!state.loaded) return;
    state.rotation += deltaDegrees;
    const radians = deltaDegrees * Math.PI / 180;
    const rotated = document.createElement('canvas');
    rotated.width = state.width;
    rotated.height = state.height;
    const context = rotated.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#f5f1e8';
    context.fillRect(0, 0, rotated.width, rotated.height);
    context.translate(rotated.width / 2, rotated.height / 2);
    context.rotate(radians);
    context.drawImage(sourceCanvas, -state.width / 2, -state.height / 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const rotatedData = context.getImageData(0, 0, state.width, state.height);
    writeSourceToCanvas(rotatedData, state.width, state.height);
    angleStatus.textContent = `זווית: ${state.rotation.toFixed(2)}°`;
    scheduleRender();
  }

  function resetAll() {
    if (!state.initialImageData) return;
    state.rotation = 0;
    state.strength = 1;
    writeSourceToCanvas(state.initialImageData, state.initialWidth, state.initialHeight);
    angleStatus.textContent = 'זווית: 0.00°';
    maskToggle.checked = false;
    activatePreset('faithful');
    setStatus('חזר למקור');
  }

  function autoStraighten() {
    if (!state.loaded) return;
    setStatus('מזהה את קו הגגות…');
    requestAnimationFrame(() => {
      const angle = core.estimateRowAngle(state.sourceImageData.data, state.width, state.height);
      if (Math.abs(angle) < 0.12) {
        setStatus('השורה כבר מיושרת');
        return;
      }
      rotateCurrent(-angle);
      setStatus(`בוצע יישור של ${(-angle).toFixed(2)}°`);
    });
  }

  function exportImage() {
    if (!state.loaded) return;
    afterCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mareh-sofer-restored-${Date.now()}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  imageInput.addEventListener('change', (event) => loadFile(event.target.files && event.target.files[0]).catch((error) => {
    console.error(error);
    setStatus('לא ניתן היה לפתוח את התמונה');
  }));
  exportBtn.addEventListener('click', exportImage);
  resetBtn.addEventListener('click', resetAll);
  autoStraightenBtn.addEventListener('click', autoStraighten);
  rotateLeftBtn.addEventListener('click', () => rotateCurrent(-0.25));
  rotateRightBtn.addEventListener('click', () => rotateCurrent(0.25));
  splitInput.addEventListener('input', updateSplit);
  strengthInput.addEventListener('input', () => {
    state.strength = Number(strengthInput.value) / 100;
    strengthOutput.textContent = `${strengthInput.value}%`;
    scheduleRender();
  });
  maskToggle.addEventListener('change', scheduleRender);

  presetButtons.forEach((button) => button.addEventListener('click', () => activatePreset(button.dataset.preset)));
  settingInputs.forEach((input) => input.addEventListener('input', () => {
    const key = input.dataset.setting;
    state.settings[key] = Number(input.value) / 100;
    state.preset = 'custom';
    presetButtons.forEach((button) => button.classList.remove('active'));
    const output = document.querySelector(`[data-output="${key}"]`);
    if (output) output.textContent = `${input.value}%`;
    scheduleRender();
  }));

  window.addEventListener('resize', syncPreviewSizing);
  updateSplit();
  updateControlValues();
})();
