export const PROJECT_TYPE = 'mareh-sofer.reading-rhythm';
export const PROJECT_VERSION = 1;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizePoint(point) {
  return {
    ...point,
    x: clamp(Number(point.x) || 0, 0, 1),
    y: clamp(Number(point.y) || 0, 0, 1),
  };
}

export function segmentDistance(from, to, mode = 'horizontal') {
  const dx = Math.abs(Number(to.x) - Number(from.x));
  const dy = Math.abs(Number(to.y) - Number(from.y));
  return mode === 'path' ? Math.hypot(dx, dy) : dx;
}

export function calculateUniformity(distances) {
  const valid = distances.filter((distance) => Number.isFinite(distance) && distance >= 0);
  if (valid.length < 2) return 100;
  const average = valid.reduce((sum, distance) => sum + distance, 0) / valid.length;
  if (average <= Number.EPSILON) return 100;
  const meanAbsoluteDeviation = valid.reduce((sum, distance) => sum + Math.abs(distance - average), 0) / valid.length;
  return Math.round(clamp((1 - meanAbsoluteDeviation / average) * 100, 0, 100));
}

export function calculateRhythm(points, options = {}) {
  const bpm = clamp(Number(options.bpm) || 90, 30, 240);
  const mode = options.mode === 'path' ? 'path' : 'horizontal';
  const ordered = [...points]
    .map(normalizePoint)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (ordered.length < 2) {
    return {
      bpm,
      mode,
      points: ordered,
      segments: [],
      beatTimesMs: ordered.length === 1 ? [0] : [],
      regularBeatTimesMs: ordered.length === 1 ? [0] : [],
      averageDistance: 0,
      baseIntervalMs: 60000 / bpm,
      totalDurationMs: 0,
      uniformity: 100,
    };
  }

  const rawSegments = ordered.slice(1).map((to, index) => {
    const from = ordered[index];
    return {
      index,
      from,
      to,
      distance: segmentDistance(from, to, mode),
    };
  });

  const distances = rawSegments.map((segment) => segment.distance);
  const averageDistance = distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
  const safeAverageDistance = averageDistance > Number.EPSILON ? averageDistance : 1;
  const baseIntervalMs = 60000 / bpm;

  const segments = rawSegments.map((segment) => {
    const ratio = averageDistance > Number.EPSILON ? segment.distance / safeAverageDistance : 1;
    const intervalMs = clamp(baseIntervalMs * ratio, 70, 4000);
    return {
      ...segment,
      ratio,
      intervalMs,
    };
  });

  const beatTimesMs = [0];
  for (const segment of segments) {
    beatTimesMs.push(beatTimesMs.at(-1) + segment.intervalMs);
  }

  const regularBeatTimesMs = ordered.map((_, index) => index * baseIntervalMs);

  return {
    bpm,
    mode,
    points: ordered,
    segments,
    beatTimesMs,
    regularBeatTimesMs,
    averageDistance,
    baseIntervalMs,
    totalDurationMs: beatTimesMs.at(-1),
    uniformity: calculateUniformity(distances),
  };
}

export function createProject(state) {
  const now = new Date().toISOString();
  return {
    type: PROJECT_TYPE,
    version: PROJECT_VERSION,
    title: state.title || 'קצב הקריאה של הכתב',
    createdAt: state.createdAt || now,
    updatedAt: now,
    image: state.image
      ? {
          name: state.image.name || 'כתב',
          width: Number(state.image.width) || 0,
          height: Number(state.image.height) || 0,
          dataUrl: state.image.dataUrl || '',
        }
      : null,
    settings: {
      bpm: clamp(Number(state.bpm) || 90, 30, 240),
      distanceMode: state.distanceMode === 'path' ? 'path' : 'horizontal',
    },
    points: [...(state.points || [])]
      .map(normalizePoint)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((point, index) => ({
        id: String(point.id ?? cryptoSafeId(index)),
        order: index + 1,
        x: point.x,
        y: point.y,
        label: String(point.label || ''),
      })),
  };
}

export function validateProject(project) {
  if (!project || typeof project !== 'object') throw new Error('קובץ הפרויקט אינו תקין.');
  if (project.type !== PROJECT_TYPE) throw new Error('זה אינו קובץ של קצב הקריאה של הכתב.');
  if (Number(project.version) !== PROJECT_VERSION) throw new Error('גרסת הפרויקט אינה נתמכת.');
  if (!Array.isArray(project.points)) throw new Error('בקובץ חסרות תחנות המקצב.');
  return {
    ...project,
    points: project.points.map(normalizePoint),
  };
}

function cryptoSafeId(index) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `point-${Date.now()}-${index}`;
}
