import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadBugReport() {
  const listeners = {};
  let clipboardText = '';
  const window = {
    navigator: {
      userAgent: 'Mareh-Sofer-Test',
      clipboard: {
        async writeText(text) { clipboardText = text; },
      },
    },
    addEventListener(type, handler) { listeners[type] = handler; },
  };
  const sandbox = { window, console, Date, Object, String, JSON };
  vm.createContext(sandbox);
  const source = fs.readFileSync(new URL('../bug-report.js', import.meta.url), 'utf8');
  vm.runInContext(source, sandbox);
  return {
    bug: window.MarehSoferBugReport,
    listeners,
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
  bug.setVersion('v80');
  bug.setScreen('שיחה');
  bug.setSourceStatus('Notion', 'מקומי בלבד');
  bug.control('מקרה מקביל');
  const report = bug.buildReport({
    category: 'תקלה בממשק',
    result: 'החלון לא נפתח',
    userNote: 'קרה פעמיים',
  });
  assert.match(report, /גרסה: v80/);
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

test('copyReport writes the report to clipboard when available', async () => {
  const { bug, getClipboardText } = loadBugReport();
  bug.setVersion('v80');
  bug.setScreen('שיחה');
  bug.control('דווח תקלה');
  const result = await bug.copyReport({ category: 'תקלה בחיבור' });
  assert.equal(result.copied, true);
  assert.equal(getClipboardText(), result.report);
  assert.match(result.report, /תקלה בחיבור/);
});

test('reset clears action history but preserves integration context', () => {
  const { bug } = loadBugReport();
  bug.setVersion('v80');
  bug.setSourceStatus('OpenAI', 'תקין');
  bug.setScreen('שיחה');
  bug.control('כרטיס תלמיד');
  bug.reset();
  const snapshot = bug.snapshot();
  assert.equal(snapshot.actions.length, 0);
  assert.equal(snapshot.appVersion, 'v80');
  assert.equal(snapshot.sourceStatus.OpenAI, 'תקין');
});
