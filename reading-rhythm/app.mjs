import {
  calculateRhythm,
  clamp,
  createProject,
  validateProject,
} from './rhythm-core.mjs';

const STORAGE_KEY = 'mareh-sofer-reading-rhythm-v1';
const MAX_IMAGE_DIMENSION = 2200;
const HIT_RADIUS = 19;

const els = Object.fromEntries([
  'annotationCanvas', 'canvasStage', 'emptyState', 'playbackBadge', 'imageInput', 'uploadBtn', 'uploadBox',
  'projectTitle', 'bpmRange', 'bpmOutput', 'saveStatus', 'pointCount', 'fitBtn', 'undoBtn', 'reverseBtn',
  'deleteSelectedBtn', 'clearBtn', 'selectedEditor', 'selectedNumber', 'pointLabelInput', 'playMeasuredBtn',
  'playRegularBtn', 'stopBtn', 'uniformityBadge', 'metricPoints', 'metricUniformity', 'metricDuration',
  'rhythmStrip', 'stationList', 'newProjectBtn', 'exportProjectBtn', 'importProjectBtn', 'projectInput',
  'exportPngBtn', 'toast',
].map((id) => [id, document.getElementById(id)]));

const ctx = els.annotationCanvas.getContext('2d');

const state = {
  title: 'קצב הקריאה של הכתב',
  createdAt: new Date().toISOString(),
  image: null,
  imageElement: null,
  points: [],
  selectedPointId: null,
  bpm: 90,
  distanceMode: 'horizontal',
  activeBeatIndex: -1,
  playing: false,
  draggingPointId: null,
  playbackTimers: [],
  playbackNodes: [],
  audioContext: null,
};

let imageRect = { x: 0, y: 0, width: 0, height: 0 };
let toastTimer = null;
let saveTimer = null;

init();

function init() {
  bindEvents();
  restoreProject();
  resizeCanvas();
  render();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('keydown', handleKeyboard);
}

function bindEvents() {
  els.uploadBtn.addEventListener('click', () => els.imageInput.click());
  els.imageInput.addEventListener('change', (event) => handleImageFile(event.target.files?.[0]));
  els.uploadBox.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.uploadBox.classList.add('dragging');
  });
  els.uploadBox.addEventListener('dragleave', () => els.uploadBox.classList.remove('dragging'));
  els.uploadBox.addEventListener('drop', (event) => {
    event.preventDefault();
    els.uploadBox.classList.remove('dragging');
    handleImageFile(event.dataTransfer.files?.[0]);
  });

  els.projectTitle.addEventListener('input', () => {
    state.title = els.projectTitle.value.trim() || 'קצב הקריאה של הכתב';
    queueSave();
  });
  els.bpmRange.addEventListener('input', () => {
    state.bpm = Number(els.bpmRange.value);
    queueSave();
    render();
  });
  document.querySelectorAll('input[name="distanceMode"]').forEach((input) => {
    input.addEventListener('change', () => {
      state.distanceMode = input.value;
      queueSave();
      render();
    });
  });

  els.annotationCanvas.addEventListener('pointerdown', handlePointerDown);
  els.annotationCanvas.addEventListener('pointermove', handlePointerMove);
  els.annotationCanvas.addEventListener('pointerup', handlePointerUp);
  els.annotationCanvas.addEventListener('pointercancel', handlePointerUp);

  els.undoBtn.addEventListener('click', undoLastPoint);
  els.reverseBtn.addEventListener('click', reversePoints);
  els.deleteSelectedBtn.addEventListener('click', deleteSelectedPoint);
  els.clearBtn.addEventListener('click', clearPoints);
  els.fitBtn.addEventListener('click', resizeCanvas);
  els.pointLabelInput.addEventListener('input', updateSelectedLabel);

  els.playMeasuredBtn.addEventListener('click', () => playRhythm('measured'));
  els.playRegularBtn.addEventListener('click', () => playRhythm('regular'));
  els.stopBtn.addEventListener('click', stopPlayback);

  els.newProjectBtn.addEventListener('click', newProject);
  els.exportProjectBtn.addEventListener('click', exportProject);
  els.importProjectBtn.addEventListener('click', () => els.projectInput.click());
  els.projectInput.addEventListener('change', (event) => importProject(event.target.files?.[0]));
  els.exportPngBtn.addEventListener('click', exportAnnotatedPng);
}

async function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('יש לבחור קובץ תמונה.');
    return;
  }

  try {
    const image = await fileToImage(file);
    const prepared = downscaleImage(image, file.name);
    await applyImage(prepared);
    state.points = [];
    state.selectedPointId = null;
    queueSave(true);
    render();
    showToast('התמונה נטענה. עכשיו מסמנים תחנות לפי סדר הקריאה.');
  } catch (error) {
    console.error(error);
    showToast('לא הצלחתי לקרוא את התמונה.');
  }
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function downscaleImage(image, name) {
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const imageContext = canvas.getContext('2d');
  imageContext.fillStyle = '#ffffff';
  imageContext.fillRect(0, 0, width, height);
  imageContext.drawImage(image, 0, 0, width, height);
  return {
    name: name || 'כתב',
    width,
    height,
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
  };
}

async function applyImage(imageData) {
  state.image = imageData;
  state.imageElement = await loadImage(imageData.dataUrl);
  resizeCanvas();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function resizeCanvas() {
  const stageRect = els.canvasStage.getBoundingClientRect();
  const cssWidth = Math.max(320, Math.floor(stageRect.width));
  const fallbackHeight = Math.max(480, Math.min(window.innerHeight * 0.68, 820));
  let cssHeight = fallbackHeight;

  if (state.image) {
    const aspect = state.image.height / state.image.width;
    cssHeight = clamp(cssWidth * aspect + 28, 460, Math.max(560, window.innerHeight * 0.72));
  }

  els.canvasStage.style.height = `${cssHeight}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.annotationCanvas.width = Math.floor(cssWidth * dpr);
  els.annotationCanvas.height = Math.floor(cssHeight * dpr);
  els.annotationCanvas.style.width = `${cssWidth}px`;
  els.annotationCanvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawCanvas();
}

function computeImageRect() {
  const width = els.annotationCanvas.clientWidth;
  const height = els.annotationCanvas.clientHeight;
  if (!state.image) return { x: 0, y: 0, width, height };
  const padding = 14;
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(availableWidth / state.image.width, availableHeight / state.image.height);
  const drawWidth = state.image.width * scale;
  const drawHeight = state.image.height * scale;
  return {
    x: (width - drawWidth) / 2,
    y: (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

function drawCanvas() {
  const width = els.annotationCanvas.clientWidth;
  const height = els.annotationCanvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  if (!state.imageElement) return;

  imageRect = computeImageRect();
  ctx.save();
  ctx.shadowColor = 'rgba(19, 35, 45, 0.18)';
  ctx.shadowBlur = 22;
  ctx.drawImage(state.imageElement, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  ctx.restore();

  const ordered = orderedPoints();
  if (ordered.length > 1) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(15, 76, 92, 0.72)';
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ordered.forEach((point, index) => {
      const screen = pointToScreen(point);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  ordered.forEach((point, index) => drawPoint(point, index));
}

function drawPoint(point, index) {
  const { x, y } = pointToScreen(point);
  const selected = point.id === state.selectedPointId;
  const active = index === state.activeBeatIndex;
  const radius = active ? 18 : selected ? 16 : 14;

  ctx.save();
  if (active) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(184, 146, 63, 0.24)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = active ? '#b8923f' : selected ? '#0b3a45' : '#0f4c5c';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 13px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(index + 1), x, y + 0.5);

  if (point.label) {
    const label = point.label.length > 22 ? `${point.label.slice(0, 21)}…` : point.label;
    ctx.font = '700 12px Arial';
    const labelWidth = ctx.measureText(label).width + 18;
    const labelX = clamp(x - labelWidth / 2, imageRect.x + 4, imageRect.x + imageRect.width - labelWidth - 4);
    const labelY = y - radius - 31;
    ctx.fillStyle = 'rgba(11, 58, 69, 0.92)';
    roundRect(ctx, labelX, labelY, labelWidth, 24, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, labelX + labelWidth / 2, labelY + 12);
  }
  ctx.restore();
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function handlePointerDown(event) {
  if (!state.imageElement || state.playing) return;
  const position = pointerPosition(event);
  const hit = findPointAt(position);
  if (hit) {
    state.selectedPointId = hit.id;
    state.draggingPointId = hit.id;
    els.annotationCanvas.setPointerCapture(event.pointerId);
    render();
    return;
  }
  if (!insideImage(position)) return;
  const normalized = screenToPoint(position);
  const point = {
    id: crypto.randomUUID?.() || `point-${Date.now()}-${state.points.length}`,
    order: state.points.length + 1,
    x: normalized.x,
    y: normalized.y,
    label: '',
  };
  state.points.push(point);
  state.selectedPointId = point.id;
  queueSave();
  render();
}

function handlePointerMove(event) {
  if (!state.draggingPointId || !state.imageElement) return;
  const position = pointerPosition(event);
  const normalized = screenToPoint({
    x: clamp(position.x, imageRect.x, imageRect.x + imageRect.width),
    y: clamp(position.y, imageRect.y, imageRect.y + imageRect.height),
  });
  const point = state.points.find((item) => item.id === state.draggingPointId);
  if (!point) return;
  point.x = normalized.x;
  point.y = normalized.y;
  queueSave();
  render();
}

function handlePointerUp(event) {
  if (state.draggingPointId) {
    state.draggingPointId = null;
    try { els.annotationCanvas.releasePointerCapture(event.pointerId); } catch {}
  }
}

function pointerPosition(event) {
  const rect = els.annotationCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pointToScreen(point) {
  return {
    x: imageRect.x + point.x * imageRect.width,
    y: imageRect.y + point.y * imageRect.height,
  };
}

function screenToPoint(position) {
  return {
    x: clamp((position.x - imageRect.x) / imageRect.width, 0, 1),
    y: clamp((position.y - imageRect.y) / imageRect.height, 0, 1),
  };
}

function insideImage(position) {
  return position.x >= imageRect.x && position.x <= imageRect.x + imageRect.width
    && position.y >= imageRect.y && position.y <= imageRect.y + imageRect.height;
}

function findPointAt(position) {
  return [...orderedPoints()].reverse().find((point) => {
    const screen = pointToScreen(point);
    return Math.hypot(screen.x - position.x, screen.y - position.y) <= HIT_RADIUS;
  });
}

function orderedPoints() {
  return [...state.points].sort((a, b) => a.order - b.order);
}

function renumberPoints() {
  orderedPoints().forEach((point, index) => { point.order = index + 1; });
}

function undoLastPoint() {
  const ordered = orderedPoints();
  const point = ordered.at(-1);
  if (!point) return;
  state.points = state.points.filter((item) => item.id !== point.id);
  if (state.selectedPointId === point.id) state.selectedPointId = null;
  renumberPoints();
  queueSave();
  render();
}

function reversePoints() {
  const ordered = orderedPoints().reverse();
  ordered.forEach((point, index) => { point.order = index + 1; });
  queueSave();
  render();
  showToast('סדר התחנות התהפך.');
}

function deleteSelectedPoint() {
  if (!state.selectedPointId) return;
  state.points = state.points.filter((point) => point.id !== state.selectedPointId);
  state.selectedPointId = null;
  renumberPoints();
  queueSave();
  render();
}

function clearPoints() {
  if (!state.points.length) return;
  const accepted = window.confirm('למחוק את כל תחנות המקצב?');
  if (!accepted) return;
  state.points = [];
  state.selectedPointId = null;
  queueSave();
  render();
}

function updateSelectedLabel() {
  const point = state.points.find((item) => item.id === state.selectedPointId);
  if (!point) return;
  point.label = els.pointLabelInput.value.trim();
  queueSave();
  render();
}

function handleKeyboard(event) {
  const editingText = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (editingText) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    undoLastPoint();
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelectedPoint();
  }
  if (event.key === 'Escape') {
    state.selectedPointId = null;
    stopPlayback();
    render();
  }
}

function rhythmData() {
  return calculateRhythm(state.points, { bpm: state.bpm, mode: state.distanceMode });
}

async function playRhythm(mode) {
  if (state.points.length < 2) return;
  stopPlayback();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    showToast('הדפדפן אינו תומך בהשמעת הצליל.');
    return;
  }
  const audioContext = state.audioContext || new AudioContextClass();
  state.audioContext = audioContext;
  if (audioContext.state === 'suspended') await audioContext.resume();

  const rhythm = rhythmData();
  const beatTimes = mode === 'regular' ? rhythm.regularBeatTimesMs : rhythm.beatTimesMs;
  const startAt = audioContext.currentTime + 0.12;
  state.playing = true;
  state.activeBeatIndex = -1;
  els.stopBtn.disabled = false;
  els.playMeasuredBtn.disabled = true;
  els.playRegularBtn.disabled = true;

  beatTimes.forEach((beatTimeMs, index) => {
    scheduleTick(audioContext, startAt + beatTimeMs / 1000, index === 0);
    const timer = window.setTimeout(() => {
      state.activeBeatIndex = index;
      els.playbackBadge.hidden = false;
      els.playbackBadge.textContent = `${mode === 'regular' ? 'מקצב אחיד' : 'מקצב הכתב'} · תחנה ${index + 1}`;
      renderPlaybackOnly();
    }, 120 + beatTimeMs);
    state.playbackTimers.push(timer);
  });

  const endTime = beatTimes.at(-1) + 700;
  state.playbackTimers.push(window.setTimeout(stopPlayback, 120 + endTime));
}

function scheduleTick(audioContext, time, accent) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(accent ? 1320 : 920, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.28 : 0.18, time + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.07);
  state.playbackNodes.push(oscillator);
}

function stopPlayback() {
  state.playbackTimers.forEach(clearTimeout);
  state.playbackTimers = [];
  state.playbackNodes.forEach((node) => {
    try { node.stop(); } catch {}
    try { node.disconnect(); } catch {}
  });
  state.playbackNodes = [];
  state.playing = false;
  state.activeBeatIndex = -1;
  els.playbackBadge.hidden = true;
  els.stopBtn.disabled = true;
  render();
}

function renderPlaybackOnly() {
  drawCanvas();
  [...els.rhythmStrip.querySelectorAll('.rhythm-bar')].forEach((bar, index) => {
    bar.classList.toggle('active', index === state.activeBeatIndex - 1);
  });
}

function render() {
  const rhythm = rhythmData();
  const hasImage = Boolean(state.imageElement);
  const canPlay = state.points.length >= 2 && !state.playing;
  const selected = state.points.find((point) => point.id === state.selectedPointId);

  els.projectTitle.value = state.title;
  els.bpmRange.value = String(state.bpm);
  els.bpmOutput.value = `${state.bpm} BPM`;
  document.querySelector(`input[name="distanceMode"][value="${state.distanceMode}"]`).checked = true;
  els.emptyState.hidden = hasImage;
  els.pointCount.textContent = `${state.points.length} ${state.points.length === 1 ? 'תחנה' : 'תחנות'}`;
  els.metricPoints.textContent = String(state.points.length);
  els.metricUniformity.textContent = state.points.length >= 2 ? `${rhythm.uniformity}%` : '—';
  els.metricDuration.textContent = state.points.length >= 2 ? formatDuration(rhythm.totalDurationMs) : '—';
  els.uniformityBadge.textContent = state.points.length >= 2 ? `אחידות ${rhythm.uniformity}%` : 'טרם נמדד';

  els.fitBtn.disabled = !hasImage;
  els.undoBtn.disabled = !state.points.length || state.playing;
  els.reverseBtn.disabled = state.points.length < 2 || state.playing;
  els.deleteSelectedBtn.disabled = !selected || state.playing;
  els.clearBtn.disabled = !state.points.length || state.playing;
  els.playMeasuredBtn.disabled = !canPlay;
  els.playRegularBtn.disabled = !canPlay;
  els.exportProjectBtn.disabled = !hasImage;
  els.exportPngBtn.disabled = !hasImage;

  els.selectedEditor.hidden = !selected;
  if (selected) {
    els.selectedNumber.textContent = String(orderedPoints().findIndex((point) => point.id === selected.id) + 1);
    if (document.activeElement !== els.pointLabelInput) els.pointLabelInput.value = selected.label || '';
  }

  renderRhythmStrip(rhythm);
  renderStationList(rhythm);
  drawCanvas();
}

function renderRhythmStrip(rhythm) {
  if (!rhythm.segments.length) {
    els.rhythmStrip.innerHTML = '<p class="strip-empty">סמן לפחות שתי תחנות כדי לראות ולשמוע את המקצב.</p>';
    return;
  }
  const maxInterval = Math.max(...rhythm.segments.map((segment) => segment.intervalMs));
  els.rhythmStrip.innerHTML = rhythm.segments.map((segment, index) => {
    const height = clamp((segment.intervalMs / maxInterval) * 82, 20, 82);
    const ratio = Number.isFinite(segment.ratio) ? segment.ratio.toFixed(2) : '1.00';
    return `<div class="rhythm-bar" style="height:${height}px" title="מקטע ${index + 1}: ${Math.round(segment.intervalMs)} אלפיות השנייה"><span>×${ratio}</span></div>`;
  }).join('');
}

function renderStationList(rhythm) {
  els.stationList.innerHTML = rhythm.points.map((point, index) => {
    const segment = index > 0 ? rhythm.segments[index - 1] : null;
    const label = point.label || `תחנה ${index + 1}`;
    const coordinates = `${Math.round(point.x * 100)}% · ${Math.round(point.y * 100)}%`;
    return `<li class="station-item ${point.id === state.selectedPointId ? 'selected' : ''}" data-point-id="${escapeHtml(point.id)}">
      <span class="station-index">${index + 1}</span>
      <span class="station-copy"><strong>${escapeHtml(label)}</strong><small>${coordinates}</small></span>
      <span class="station-gap">${segment ? `${Math.round(segment.intervalMs)}ms` : 'התחלה'}</span>
    </li>`;
  }).join('');

  els.stationList.querySelectorAll('.station-item').forEach((item) => {
    item.addEventListener('click', () => {
      state.selectedPointId = item.dataset.pointId;
      render();
    });
  });
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)} שנ׳`;
}

function queueSave(immediate = false) {
  els.saveStatus.textContent = 'שומר…';
  els.saveStatus.classList.remove('saved');
  clearTimeout(saveTimer);
  if (immediate) saveProject();
  else saveTimer = window.setTimeout(saveProject, 350);
}

function saveProject() {
  try {
    const project = createProject(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    els.saveStatus.textContent = 'נשמר במכשיר';
    els.saveStatus.classList.add('saved');
  } catch (error) {
    console.warn(error);
    els.saveStatus.textContent = 'לא נשמר';
    els.saveStatus.classList.remove('saved');
  }
}

async function restoreProject() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const project = validateProject(JSON.parse(raw));
    await hydrateProject(project);
    els.saveStatus.textContent = 'שוחזר מהמכשיר';
    els.saveStatus.classList.add('saved');
    render();
  } catch (error) {
    console.warn(error);
    localStorage.removeItem(STORAGE_KEY);
  }
}

async function hydrateProject(project) {
  state.title = project.title || 'קצב הקריאה של הכתב';
  state.createdAt = project.createdAt || new Date().toISOString();
  state.bpm = project.settings?.bpm || 90;
  state.distanceMode = project.settings?.distanceMode === 'path' ? 'path' : 'horizontal';
  state.points = project.points.map((point, index) => ({ ...point, order: index + 1 }));
  state.selectedPointId = null;
  if (project.image?.dataUrl) await applyImage(project.image);
}

function newProject() {
  const accepted = window.confirm('לפתוח פרויקט חדש? התחנות והתמונה הנוכחיות יימחקו מהמכשיר.');
  if (!accepted) return;
  stopPlayback();
  state.title = 'קצב הקריאה של הכתב';
  state.createdAt = new Date().toISOString();
  state.image = null;
  state.imageElement = null;
  state.points = [];
  state.selectedPointId = null;
  state.bpm = 90;
  state.distanceMode = 'horizontal';
  localStorage.removeItem(STORAGE_KEY);
  els.saveStatus.textContent = 'לא נשמר';
  els.saveStatus.classList.remove('saved');
  resizeCanvas();
  render();
}

function exportProject() {
  const project = createProject(state);
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${safeFilename(state.title)}.json`);
  showToast('קובץ הפרויקט נשמר.');
}

async function importProject(file) {
  if (!file) return;
  try {
    const project = validateProject(JSON.parse(await file.text()));
    stopPlayback();
    await hydrateProject(project);
    queueSave(true);
    render();
    showToast('הפרויקט נטען.');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'לא הצלחתי לטעון את הפרויקט.');
  } finally {
    els.projectInput.value = '';
  }
}

function exportAnnotatedPng() {
  if (!state.imageElement || !state.image) return;
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = state.image.width;
  exportCanvas.height = state.image.height;
  const exportContext = exportCanvas.getContext('2d');
  exportContext.drawImage(state.imageElement, 0, 0, exportCanvas.width, exportCanvas.height);

  const ordered = orderedPoints();
  if (ordered.length > 1) {
    exportContext.save();
    exportContext.strokeStyle = 'rgba(15, 76, 92, 0.82)';
    exportContext.lineWidth = Math.max(3, exportCanvas.width / 600);
    exportContext.setLineDash([exportCanvas.width / 120, exportCanvas.width / 140]);
    exportContext.beginPath();
    ordered.forEach((point, index) => {
      const x = point.x * exportCanvas.width;
      const y = point.y * exportCanvas.height;
      if (index === 0) exportContext.moveTo(x, y);
      else exportContext.lineTo(x, y);
    });
    exportContext.stroke();
    exportContext.restore();
  }

  ordered.forEach((point, index) => {
    const x = point.x * exportCanvas.width;
    const y = point.y * exportCanvas.height;
    const radius = Math.max(14, exportCanvas.width / 50);
    exportContext.beginPath();
    exportContext.arc(x, y, radius, 0, Math.PI * 2);
    exportContext.fillStyle = '#0f4c5c';
    exportContext.fill();
    exportContext.lineWidth = Math.max(3, radius / 5);
    exportContext.strokeStyle = '#ffffff';
    exportContext.stroke();
    exportContext.fillStyle = '#ffffff';
    exportContext.font = `800 ${Math.round(radius)}px Arial`;
    exportContext.textAlign = 'center';
    exportContext.textBaseline = 'middle';
    exportContext.fillText(String(index + 1), x, y + 1);
  });

  exportCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${safeFilename(state.title)}-מסומן.png`);
  }, 'image/png');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(value) {
  return String(value || 'reading-rhythm')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
