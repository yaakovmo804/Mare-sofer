/*
 * Mareh Sofer — Bug Report MVP
 * Framework-agnostic, browser-only helper.
 *
 * Goals:
 * - Keep the last 10 meaningful user/system actions.
 * - Survive a same-tab reload by using sessionStorage only.
 * - Capture window errors and unhandled promise rejections.
 * - Produce a short Hebrew report that can be copied into a development chat.
 * - Avoid collecting form values or personal content by default.
 */

(function (global) {
  'use strict';

  const MAX_ACTIONS = 10;
  const STORAGE_KEY = 'mareh-sofer-bug-report-v1';
  const state = {
    appVersion: 'unknown',
    screen: 'unknown',
    lastControl: '',
    lastError: '',
    sourceStatus: {},
    actions: [],
    startedAt: new Date().toISOString(),
    restoredFromSession: false,
  };

  function now() {
    return new Date().toISOString();
  }

  function clean(value, max = 220) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function stripUrlDetails(value, max = 320) {
    const text = clean(value, max);
    return text.replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1');
  }

  function safeSource(value) {
    const text = clean(value, 180);
    if (!text) return '';
    return text.split(/[?#]/, 1)[0].slice(0, 140);
  }

  function safeMeta(meta) {
    const out = {};
    if (!meta || typeof meta !== 'object') return out;
    for (const [key, value] of Object.entries(meta)) {
      out[clean(key, 40)] = clean(value, 120);
    }
    return out;
  }

  function sessionStore() {
    try {
      return global.sessionStorage || null;
    } catch (_) {
      return null;
    }
  }

  function persist() {
    const storage = sessionStore();
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        appVersion: state.appVersion,
        screen: state.screen,
        lastControl: state.lastControl,
        lastError: state.lastError,
        sourceStatus: state.sourceStatus,
        actions: state.actions,
        startedAt: state.startedAt,
      }));
    } catch (_) {
      // Storage can be blocked by browser/privacy settings. Reporting must still work in memory.
    }
  }

  function restore() {
    const storage = sessionStore();
    if (!storage) return;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;

      state.appVersion = clean(saved.appVersion, 40) || state.appVersion;
      state.screen = clean(saved.screen, 120) || state.screen;
      state.lastControl = clean(saved.lastControl, 120);
      state.lastError = stripUrlDetails(saved.lastError, 320);
      state.startedAt = clean(saved.startedAt, 60) || state.startedAt;

      state.sourceStatus = {};
      if (saved.sourceStatus && typeof saved.sourceStatus === 'object') {
        for (const [name, status] of Object.entries(saved.sourceStatus)) {
          const key = clean(name, 60);
          if (key) state.sourceStatus[key] = clean(status, 80) || 'לא ידוע';
        }
      }

      if (Array.isArray(saved.actions)) {
        state.actions = saved.actions.slice(-MAX_ACTIONS).map((item) => ({
          at: clean(item?.at, 60) || now(),
          label: clean(item?.label, 120),
          ...(item?.meta && typeof item.meta === 'object' ? { meta: safeMeta(item.meta) } : {}),
        })).filter((item) => item.label);
      }
      state.restoredFromSession = state.actions.length > 0;
    } catch (_) {
      // Corrupt or inaccessible storage is ignored; start a fresh in-memory trail.
    }
  }

  function pushAction(label, meta) {
    const entry = {
      at: now(),
      label: clean(label, 120),
    };
    if (meta && typeof meta === 'object') entry.meta = safeMeta(meta);
    state.actions.push(entry);
    if (state.actions.length > MAX_ACTIONS) {
      state.actions.splice(0, state.actions.length - MAX_ACTIONS);
    }
    persist();
    return entry;
  }

  function setScreen(name) {
    state.screen = clean(name, 120) || 'unknown';
    pushAction('פתיחת מסך', { screen: state.screen });
  }

  function setVersion(version) {
    state.appVersion = clean(version, 40) || 'unknown';
    persist();
  }

  function setSourceStatus(name, status) {
    const key = clean(name, 60);
    if (!key) return;
    state.sourceStatus[key] = clean(status, 80) || 'לא ידוע';
    persist();
  }

  function control(label, meta) {
    state.lastControl = clean(label, 120);
    return pushAction('לחיצה', { control: state.lastControl, ...(meta || {}) });
  }

  function error(message, meta) {
    state.lastError = stripUrlDetails(message, 320) || 'שגיאה ללא הודעה';
    return pushAction('שגיאת מערכת', { message: state.lastError, ...(meta || {}) });
  }

  function deviceSummary() {
    const nav = global.navigator || {};
    return clean(nav.userAgent || 'לא ידוע', 220);
  }

  function replayPath() {
    return state.actions
      .filter((item) => item.label === 'פתיחת מסך' || item.label === 'לחיצה')
      .map((item) => {
        if (item.label === 'פתיחת מסך') return item.meta?.screen || 'מסך';
        return item.meta?.control || 'לחיצה';
      })
      .join(' ← ');
  }

  function buildReport(options = {}) {
    const userNote = clean(options.userNote, 600);
    const category = clean(options.category, 60) || 'לא סווג';
    const result = clean(options.result, 240);
    const sourceLines = Object.entries(state.sourceStatus)
      .map(([name, status]) => `- ${name}: ${status}`)
      .join('\n');
    const actionLines = state.actions
      .map((item, index) => {
        const meta = item.meta && Object.keys(item.meta).length
          ? ' — ' + Object.entries(item.meta).map(([k, v]) => `${k}: ${v}`).join(', ')
          : '';
        return `${index + 1}. ${item.label}${meta}`;
      })
      .join('\n');

    return [
      'מראה סופר — דו״ח תקלה',
      `גרסה: ${state.appVersion}`,
      `מסך: ${state.screen}`,
      `סוג תקלה: ${category}`,
      `הכפתור/פעולה האחרונה: ${state.lastControl || 'לא נרשם'}`,
      `שגיאת מערכת: ${state.lastError || 'לא נרשמה שגיאה'}`,
      state.restoredFromSession ? 'היסטוריית פעולות: שוחזרה לאחר רענון באותו טאב' : '',
      result ? `מה קרה בפועל: ${result}` : '',
      userNote ? `הערת המשתמש: ${userNote}` : '',
      `מסלול שחזור: ${replayPath() || 'אין עדיין רצף פעולות'}`,
      '',
      'מצב מקורות וחיבורים:',
      sourceLines || '- לא נמסר מידע',
      '',
      '10 הפעולות האחרונות:',
      actionLines || 'לא נרשמו פעולות',
      '',
      `מכשיר/דפדפן: ${deviceSummary()}`,
      `זמן יצירת הדו״ח: ${now()}`,
    ].filter(Boolean).join('\n');
  }

  async function copyReport(options) {
    const report = buildReport(options);
    if (global.navigator?.clipboard?.writeText) {
      try {
        await global.navigator.clipboard.writeText(report);
        return { copied: true, report, method: 'clipboard' };
      } catch (copyError) {
        return {
          copied: false,
          report,
          method: 'manual',
          copyError: clean(copyError?.name || copyError?.message || 'clipboard blocked', 80),
        };
      }
    }
    return { copied: false, report, method: 'manual' };
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({ ...state, replayPath: replayPath() }));
  }

  function reset() {
    state.lastControl = '';
    state.lastError = '';
    state.actions = [];
    state.startedAt = now();
    state.restoredFromSession = false;
    persist();
  }

  function installGlobalErrorCapture() {
    global.addEventListener?.('error', (event) => {
      const message = event?.message || event?.error?.message || 'window.error';
      error(message, {
        source: event?.filename ? safeSource(event.filename) : 'browser',
        line: event?.lineno || '',
      });
    });

    global.addEventListener?.('unhandledrejection', (event) => {
      const reason = event?.reason;
      const message = reason?.message || reason || 'Unhandled promise rejection';
      error(message, { source: 'promise' });
    });
  }

  restore();
  installGlobalErrorCapture();

  global.MarehSoferBugReport = Object.freeze({
    setVersion,
    setScreen,
    setSourceStatus,
    action: pushAction,
    control,
    error,
    buildReport,
    copyReport,
    replayPath,
    snapshot,
    reset,
  });
})(window);
