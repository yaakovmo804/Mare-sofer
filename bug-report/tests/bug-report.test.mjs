import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadBugReport(options = {}) {
  const listeners = {};
  let clipboardText = '';
  const storageMap = options.storageMap || new Map();
  const sessionStorage = {
    getItem(key) { return storageMap.has(key) ? storageMap.get(key) : null; },
    setItem(key, value) { storageMap.set(key, String(value)); },
    removeItem(key) { storageMap.delete(key); },
  };
  const window = {
    navigator: {
      userAgent: 'Mareh-Sofer-Test',
      clipboard: {
        async writeText(text) {
          if (options.clipboardReject) {
            const error = new Error('Clipboard blocked');
            error.name = 'NotAllowedError';
            throw error;
          }
          clipboardText = text;
        },
      },
    },
    sessionStorage,
    addEventListener(type, handler) { listeners[type] = handler; },
  };
  const sandbox = { window, console, Date, Object, String, JSON, Map };
  vm.createContext(sandbox);
  const source = fs.readFileSync(new URL('../bug-report.js', import.meta.url), 'utf8');
  vm.runInContext(source, sandbox);
  return {
    bug: window.MarehSoferBugReport,
    listeners,
    storageMap,
    getClipboardText: () => clipboardText,
  };
}

test('keeps only the last 10 actions', () => {
  const { bug } = loadBugReport();
  bug.setScreen('שיחה');
  for (let i = 1; i <= 12; i += 1) bug.control(`פעולה ${i}`);
  const snapshot = bug.snapshot();
  assert.equal(snapshot.actions.length, 10);
  assert.equal(snapshot.lastControl, 'פעולה 12');
  assert.equal(snapshot.actions.at(-1).meta.control, 'פעולה 12');
});

test('builds a short Hebrew report with context and replay path', () => {
  const { bug } = loadBugReport();
  bug.setVersion('v81-candidate');
  bug.setScreen('שיחה');
  bug.setSourceStatus('Notion', 'מקומי בלבד');
  bug.control('מקרה מקביל');
  const report = bug.buildReport({
    category: 'תקלה בממשק',
    result: 'החלון לא נפתח',
    userNote: 'קרה פעמיים',
  });
  assert.match(report, /גרסה: v81-candidate/);
  assert.match(report, /מסך: שיחה/);
  assert.match(report, /Notion: מקומי בלבד/);
  assert.match(report, /מקרה מקביל/);
  assert.match(report, /החלון לא נפתח/);
  assert.match(report, /קרה פעמיים/);
});

test('captures global browser errors', () => {
  const { bug, listeners } = loadBugReport();
  listeners.error({ message: 'boom', filename: 'app.js', lineno: 42 });
  const snapshot = bug.snapshot();
  assert.equal(snapshot.lastError, 'boom');
  assert.equal(snapshot.actions.at(-1).label, 'שגיאת מערכת');
});

test('redacts URL query and hash details from captured errors', () => {
  const { bug, listeners } = loadBugReport();
  listeners.error({
    message: 'failed at https://example.test/api?token=SECRET#trace',
    filename: 'https://example.test/app.js?build=81#module',
    lineno: 8,
  });
  const snapshot = bug.snapshot();
  assert.equal(snapshot.lastError, 'failed at https://example.test/api');
  assert.equal(snapshot.actions.at(-1).meta.source, 'https://example.test/app.js');
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET|build=81/);
});

test('copyReport writes the report to clipboard when available', async () => {
  const { bug, getClipboardText } = loadBugReport();
  bug.setVersion('v81-candidate');
  bug.setScreen('שיחה');
  bug.control('דווח תקלה');
  const result = await bug.copyReport({ category: 'תקלה בחיבור' });
  assert.equal(result.copied, true);
  assert.equal(result.method, 'clipboard');
  assert.equal(getClipboardText(), result.report);
  assert.match(result.report, /תקלה בחיבור/);
});

test('copyReport falls back to manual report when iPad clipboard is blocked', async () => {
  const { bug } = loadBugReport({ clipboardReject: true });
  bug.setVersion('v81-candidate');
  bug.setScreen('שיחה');
  bug.control('דווח תקלה');
  const result = await bug.copyReport({ category: 'תקלה בממשק' });
  assert.equal(result.copied, false);
  assert.equal(result.method, 'manual');
  assert.equal(result.copyError, 'NotAllowedError');
  assert.match(result.report, /מראה סופר — דו״ח תקלה/);
});

test('restores the recent diagnostic trail after a reload in the same tab', () => {
  const sharedStorage = new Map();
  const first = loadBugReport({ storageMap: sharedStorage });
  first.bug.setVersion('v81-candidate');
  first.bug.setScreen('שיחה');
  first.bug.control('מקרה מקביל');

  const second = loadBugReport({ storageMap: sharedStorage });
  const snapshot = second.bug.snapshot();
  assert.equal(snapshot.restoredFromSession, true);
  assert.equal(snapshot.appVersion, 'v81-candidate');
  assert.match(snapshot.replayPath, /שיחה/);
  assert.match(snapshot.replayPath, /מקרה מקביל/);
  assert.match(second.bug.buildReport(), /שוחזרה לאחר רענון באותו טאב/);
});

test('reset clears action history but preserves integration context', () => {
  const { bug } = loadBugReport();
  bug.setVersion('v81-candidate');
  bug.setSourceStatus('OpenAI', 'תקין');
  bug.setScreen('שיחה');
  bug.control('כרטיס תלמיד');
  bug.reset();
  const snapshot = bug.snapshot();
  assert.equal(snapshot.actions.length, 0);
  assert.equal(snapshot.restoredFromSession, false);
  assert.equal(snapshot.appVersion, 'v81-candidate');
  assert.equal(snapshot.sourceStatus.OpenAI, 'תקין');
});
