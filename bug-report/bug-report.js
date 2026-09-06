/*
 * Mareh Sofer — Bug Report MVP
 * Framework-agnostic, browser-only helper.
 *
 * Goals:
 * - Keep the last 10 meaningful user/system actions.
 * - Capture window errors and unhandled promise rejections.
 * - Produce a short Hebrew report that can be copied into a development chat.
 * - Avoid collecting form values or personal content by default.
 */

(function (global) {
  'use strict';

  const MAX_ACTIONS = 10;
  const state = {
    appVersion: 'unknown',
    screen: 'unknown',
    lastControl: '',
    lastError: '',
    sourceStatus: {},
    actions: [],
    startedAt: new Date().toISOString(),
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

  function pushAction(label, meta) {
    const entry = {
      at: now(),
      label: clean(label, 120),
    };
    if (meta && typeof meta === 'object') {
      entry.meta = {};
      for (const [key, value] of Object.entries(meta)) {
        // Intentionally store only values explicitly supplied by integration code.
        // Never auto-read input values, textarea contents, file names or chat text.
        entry.meta[clean(key, 40)] = clean(value, 120);
      }
    }
    state.actions.push(entry);
    if (state.actions.length > MAX_ACTIONS) {
      state.actions.splice(0, state.actions.length - MAX_ACTIONS);
    }
    return entry;
  }

  function setScreen(name) {
    state.screen = clean(name, 120) || 'unknown';
    pushAction('פתיחת מסך', { screen: state.screen });
  }

  function setVersion(version) {
    state.appVersion = clean(version, 40) || 'unknown';
  }

  function setSourceStatus(name, status) {
    const key = clean(name, 60);
    if (!key) return;
    state.sourceStatus[key] = clean(status, 80) || 'לא ידוע';
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
