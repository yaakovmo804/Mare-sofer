#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(testDirectory, '..');
const read = filename => fs.readFileSync(path.join(appDirectory, filename), 'utf8');

function loadMasterSystem() {
  const context = vm.createContext({ console, Math, Object, Array, Map, Set });
  context.globalThis = context;
  vm.runInContext(read('master-system.js'), context, { filename: 'master-system.js' });
  return context.MEDIDAOT_MASTER_SYSTEM;
}

function loadLetterOrganHelpers() {
  const source = read('letter-tools.js');
  const start = source.indexOf('function representativeOrganHandle');
  const end = source.indexOf('function drawLetterVectorHandles', start);
  assert.ok(start >= 0 && end > start, 'letter organ helpers must remain available');
  const context = vm.createContext({
    Math,
    Map,
    Set,
    String,
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    pointInPolygon(point, polygon) {
      let inside = false;
      for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
        const a = polygon[index];
        const b = polygon[previous];
        if (((a.y > point.y) !== (b.y > point.y)) &&
            point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
      }
      return inside;
    }
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.organLevelVectorHandles = organLevelVectorHandles; this.anchorIdsInsideLasso = anchorIdsInsideLasso;`, context);
  return context;
}

function loadCorrectionGeometryHelpers() {
  const source = read('professional-tools.js');
  const start = source.indexOf('function selectedFeatureAngle');
  const end = source.indexOf('function createCorrectionPreview', start);
  assert.ok(start >= 0 && end > start, 'correction geometry helper must remain available');
  const system = loadMasterSystem();
  const context = vm.createContext({ Math, Number, MASTER_SYSTEM: system });
  vm.runInContext(`${source.slice(start, end)}\nthis.selectedFeatureAngle = selectedFeatureAngle;`, context);
  return context.selectedFeatureAngle;
}

test('רגעים and אמן preserve the approved acronym structure', () => {
  const system = loadMasterSystem();
  const regaim = system.GROUPS.find(group => group.id === 'regaim');
  const aman = system.GROUPS.find(group => group.id === 'aman');
  assert.equal(regaim.name, 'רגעים');
  assert.deepEqual(
    Array.from(regaim.entries, entry => [entry.letter, Array.from(entry.metricIds)]),
    [['ר', ['widths']], ['ג', ['heights']], ['ע', ['nib']], ['י', ['straightness']], ['ם', ['weights', 'gaps']]]
  );
  assert.equal(aman.name, 'אמן');
  assert.deepEqual(
    Array.from(aman.entries, entry => [entry.letter, Array.from(entry.metricIds)]),
    [['א', ['white-balance']], ['מ', ['optical-center', 'balconies']], ['ן', ['slants-parallels']]]
  );
});

test('every professional metric has one stable semantic color', () => {
  const system = loadMasterSystem();
  const professionalIds = system.GROUPS.flatMap(group => group.entries.flatMap(entry => entry.metricIds));
  const colors = professionalIds.map(id => system.metric(id)?.color);
  assert.ok(colors.every(color => /^#[0-9a-f]{6}$/i.test(color)));
  assert.equal(new Set(colors).size, colors.length, 'professional colors must not collide');
  for (const id of professionalIds) {
    assert.equal(system.colorFor({ semanticMetricId: id }), system.metric(id).color);
  }
  const structuralCategories = ['roof', 'seat', 'stem', 'reference-template', 'other'];
  const structuralColors = structuralCategories.map(category => system.colorFor({ category }));
  assert.equal(new Set(structuralColors).size, structuralColors.length, 'selectable structural definitions need distinct colors');
  assert.equal(system.colorFor({ category: 'roof' }), system.metric('roofs').color);
  assert.equal(system.colorFor({ category: 'seat' }), system.metric('seats').color);
});

test('row alignment excludes final nun and yod from the lowest-seat baseline', () => {
  const system = loadMasterSystem();
  const result = system.rowAlignmentFromCandidates([
    { id: 'bet', letter: 'ב', y: 100, eligible: true },
    { id: 'kaf', letter: 'כ', y: 104, eligible: true },
    { id: 'nun', letter: 'נ', y: 102, eligible: true },
    { id: 'final-nun', letter: 'ן', y: 116, eligible: true },
    { id: 'yod', letter: 'י', y: 120, eligible: true },
    { id: 'unconfirmed', y: 130, eligible: false }
  ], 8);
  assert.equal(result.baselineY, 104);
  assert.deepEqual(Array.from(result.candidates, candidate => candidate.id), ['bet', 'kaf', 'nun']);
  assert.equal(result.candidates.find(candidate => candidate.id === 'bet').deviationNib, .5);
});

test('row alignment refuses to invent a baseline before reference letters are confirmed', () => {
  const system = loadMasterSystem();
  const result = system.rowAlignmentFromCandidates([
    { id: 'candidate-1', y: 100, eligible: false },
    { id: 'candidate-2', y: 110, eligible: false }
  ], 8);
  assert.equal(result.baselineY, null);
  assert.deepEqual(Array.from(result.candidates), []);
});

test('balcony comparison stays numeric without inventing a pass/fail rule', () => {
  const system = loadMasterSystem();
  const comparison = system.compareBalconies([
    { letter: 'ו', value: 1.1 }, { letter: 'ו', value: 1.3 },
    { letter: 'ת', value: 1.6 }, { letter: 'ת', value: 1.8 }
  ]);
  assert.ok(Math.abs(comparison.vav.median - 1.2) < 1e-9);
  assert.ok(Math.abs(comparison.tav.median - 1.7) < 1e-9);
  assert.ok(Math.abs(comparison.difference - .5) < 1e-9);
  assert.equal(comparison.classification, null);
  const uncalibrated = system.compareBalconies([
    { letter: 'ו', value: null }, { letter: 'ת', value: undefined }
  ]);
  assert.equal(uncalibrated.vav.count, 0);
  assert.equal(uncalibrated.tav.count, 0);
  assert.equal(uncalibrated.difference, null);
});

test('signed slants preserve direction instead of collapsing opposite angles', () => {
  const system = loadMasterSystem();
  const right = system.signedVerticalAngle({ x: 0, y: 0 }, { x: 10, y: 100 });
  const left = system.signedVerticalAngle({ x: 0, y: 0 }, { x: -10, y: 100 });
  assert.ok(right * left < 0, 'opposite slants must keep opposite signs');
  assert.ok(Math.abs(Math.abs(right) - Math.abs(left)) < 1e-9);
});

test('signed angle shear lands exactly on positive, zero and crossing targets', () => {
  const system = loadMasterSystem();
  const pivot = { x: 0, y: 100 };
  for (const [current, target] of [[10, 20], [10, 0], [-10, 20], [-10, -20]]) {
    const top = { x: Math.tan(current * Math.PI / 180) * 100, y: 0 };
    const moved = system.shearPointToAngle(top, pivot.y, current, target);
    assert.ok(Math.abs(system.signedVerticalAngle(moved, pivot) - target) < 1e-9, `${current}→${target}`);
  }
});

test('correction angle rejects isotropic anchor clouds', () => {
  const selectedFeatureAngle = loadCorrectionGeometryHelpers();
  const square = [
    { point: { x: 0, y: 0 } }, { point: { x: 10, y: 0 } },
    { point: { x: 10, y: 10 } }, { point: { x: 0, y: 10 } }
  ];
  assert.equal(selectedFeatureAngle(square), null);
  const vertical = [{ point: { x: 0, y: 0 } }, { point: { x: 2, y: 50 } }, { point: { x: 4, y: 100 } }];
  assert.ok(Number.isFinite(selectedFeatureAngle(vertical)));
});

test('the integrated shell exposes composition, vector levels, info and active geometry tools', () => {
  for (const filename of ['index.html', 'medidaot.html']) {
    const html = read(filename);
    for (const required of [
      'professionalSuitePanel', 'compositionWorkspace', 'compositionInspector', 'compositionBackgroundSelect',
      'metricInfoDialog', 'metricMeasurementText', 'professionalReferenceInfo',
      'semanticColorHint', 'letterVectorLevelSelect', 'transferLetterBtn'
    ]) assert.match(html, new RegExp(`id="${required}"`));
    for (const tool of ['rowAlign', 'circle', 'ellipse']) {
      assert.match(html, new RegExp(`data-tool="${tool}"`));
    }
    assert.match(html, /master-system\.js\?v=20260801b/);
    assert.match(html, /professional-tools\.js\?v=20260801b/);
    assert.match(html, /id="compositionCanvas"[^>]*tabindex="0"/);
    assert.match(html, /id="statusText"[^>]*aria-live="polite"/);
    assert.match(html, /id="metricInfoDialog"[^>]*aria-labelledby="metricInfoTitle"/);
  }
});

test('project data persists the professional suite and accepts legacy schema 3', () => {
  const source = read('app-4.js');
  assert.match(source, /schemaVersion:\s*'4\.0\.0'/);
  assert.match(source, /professionalSuite:\s*captured\.professionalSuite/);
  assert.match(source, /measurementDescription:\s*captured\.professionalSuite\.measurementNotes/);
  assert.match(source, /\^\[34\]/);
  assert.match(source, /linkedKastelId/);
});

test('professional information and deferred letter families are data, not hidden algorithms', () => {
  const system = loadMasterSystem();
  const notes = system.defaultMeasurementNotes();
  assert.ok(system.METRICS.every(metric => notes[metric.id]?.length > 0));
  assert.deepEqual(
    Array.from(system.LETTER_FAMILIES, family => [family.id, Array.from(family.letters), family.status]),
    [
      ['narrow-letters', ['נ', 'י', 'ו', 'ז'], 'definition-pending'],
      ['internal-white', ['ב', 'ד', 'ה', 'ת'], 'definition-pending']
    ]
  );
});

test('local information persistence gives saved text priority and correction keeps semantic linkage', () => {
  const source = read('professional-tools.js');
  assert.match(source, /\.\.\.professionalSuite\.descriptions,[\s\S]*\.\.\.savedDescriptions/);
  assert.match(source, /medidaot-professional-info/);
  assert.match(source, /featureSelectionMethod/);
  assert.match(source, /semanticMetricId:\s*measurement\.semanticMetricId/);
  assert.match(source, /nearest-organ-group/);
  assert.match(source, /function selectedFeatureAngle/);
  assert.match(source, /currentFeatureAngleDeg/);
  assert.match(source, /measurementAngleDeg/);
  assert.match(source, /signedTarget = clamp\(targetAngle, -35, 35\)/);
  assert.match(source, /function armProfessionalMeasurement/);
  assert.match(source, /draftLetter !== next\.letter\) cancelDraft\(\)/);
  assert.match(source, /function refreshCompositionSourceAvailability/);
  assert.match(source, /source-missing-copy-preserved/);
  assert.match(source, /duplicatedFromSessionId/);
  assert.match(source, /previewCompositionUid = copy\.uid/);
});

test('transient measurement arming is not restored or persisted as project data', () => {
  const app1 = read('app-1.js');
  const app4 = read('app-4.js');
  assert.match(app1, /pendingMeasurement:\s*null/);
  assert.doesNotMatch(app1, /pendingMeasurement:\s*saved\.pendingMeasurement/);
  assert.match(app4, /captured\.professionalSuite\.pendingMeasurement = null/);
});

test('compound information and row candidates describe the action that is actually available', () => {
  const professional = read('professional-tools.js');
  const app2 = read('app-2.js');
  assert.match(professional, /className = 'metric-info-stack'/);
  assert.match(professional, /openMetricInfo\(metric\.id\)/);
  assert.match(professional, /אחרת תיבחר קבוצת האיברים הקרובה למדידה/);
  assert.match(app2, /מועמדים ממתינים לסיווג/);
});

test('composition is isolated, undoable and exported without diagnostic overlays', () => {
  const professional = read('professional-tools.js');
  const app1 = read('app-1.js');
  const app3 = read('app-3.js');
  const app4 = read('app-4.js');
  assert.match(professional, /function undoComposition/);
  assert.match(professional, /function handleCompositionKeyboardShortcut/);
  assert.match(professional, /propertiesPanel\?\.classList\.toggle\('composition-mode'/);
  assert.match(professional, /cleanExport: true/);
  assert.match(professional, /sourceFrameUid: sourceFrame\?\.uid/);
  assert.match(app1, /independentProfessionalState[\s\S]*composition:[\s\S]*correctionSessions:/);
  assert.doesNotMatch(app1, /professionalSuite:\s*structuredCloneSafe\(state\.professionalSuite\)/);
  assert.match(app3, /restoreProfessionalSuite\(retainedProfessionalInfo\)/);
  assert.doesNotMatch(app3, /removeCorrectionLinksForSources/);
  assert.match(app4, /handleCompositionKeyboardShortcut/);
  assert.match(app4, /signedAngleDeg/);
  assert.match(app4, /refreshCompositionSourceAvailability/);
});

test('asynchronous source loads are generation-guarded and row deviations use current calibration', () => {
  const app1 = read('app-1.js');
  const app2 = read('app-2.js');
  const app3 = read('app-3.js');
  const app4 = read('app-4.js');
  assert.match(app1, /loadGeneration:\s*0/);
  assert.match(app3, /const loadGeneration = requestedGeneration \?\? \+\+state\.loadGeneration/);
  assert.match(app3, /if \(loadGeneration !== state\.loadGeneration\) return/);
  assert.match(app4, /const loadGeneration = \+\+state\.loadGeneration/);
  assert.match(app1, /function currentRowDeviation/);
  assert.match(app2, /currentRowDeviation\(candidate\)/);
  assert.match(app4, /deviationNib:\s*currentRowDeviation\(candidate\)\.nib/);
});

test('four vector control levels keep a full editable source under the coarse views', () => {
  const source = read('letter-tools.js');
  for (const level of ['structural', 'organs', 'curves', 'full']) {
    assert.match(source, new RegExp(`['"]${level}['"]`));
  }
  assert.match(source, /function organLevelVectorHandles/);
  assert.match(source, /groupIds:\s*group\.map/);
  assert.match(source, /vectorDetailLevel:\s*'organs'/);
  assert.match(source, /maximumAnchors:\s*260/);
});

test('organ controls contain contiguous anchors from one vector path only', () => {
  const { organLevelVectorHandles } = loadLetterOrganHelpers();
  const handles = [];
  for (let commandIndex = 0; commandIndex < 9; commandIndex++) {
    handles.push({
      id: `p0:c${commandIndex}:anchor`, kind: 'anchor', pathIndex: 0, commandIndex,
      point: { x: commandIndex % 2 ? 100 : 0, y: commandIndex * 10 }
    });
  }
  for (const commandIndex of [12, 13]) {
    handles.push({
      id: `p0:c${commandIndex}:anchor`, kind: 'anchor', pathIndex: 0, commandIndex,
      point: { x: 50, y: commandIndex * 10 }
    });
  }
  for (let commandIndex = 0; commandIndex < 4; commandIndex++) {
    handles.push({
      id: `p1:c${commandIndex}:anchor`, kind: 'anchor', pathIndex: 1, commandIndex,
      point: { x: commandIndex % 2 ? 0 : 100, y: commandIndex * 10 }
    });
  }
  handles.push({
    id: 'p0:c1:control-in', kind: 'control', pathIndex: 0, commandIndex: 1,
    point: { x: 50, y: 5 }
  });

  const groups = Array.from(organLevelVectorHandles(handles));
  assert.equal(groups.length, 6);
  for (const group of groups) {
    const members = Array.from(group.groupIds, id => {
      const match = /^p(\d+):c(\d+):anchor$/.exec(id);
      assert.ok(match, `unexpected member ${id}`);
      return { pathIndex: +match[1], commandIndex: +match[2] };
    });
    assert.equal(new Set(members.map(member => member.pathIndex)).size, 1, 'an organ group may not mix paths');
    for (let index = 1; index < members.length; index++) {
      assert.equal(members[index].commandIndex, members[index - 1].commandIndex + 1, 'organ members must be contiguous in path order');
    }
    assert.match(group.groupLabel, new RegExp(`^path:${members[0].pathIndex}:run:\\d+:group:\\d+$`));
  }
  assert.ok(groups.some(group => Array.from(group.groupIds).join(',') === 'p0:c12:anchor,p0:c13:anchor'));
});

test('organ-level freeform lasso selects exact full anchors instead of coarse representatives', () => {
  const { anchorIdsInsideLasso } = loadLetterOrganHelpers();
  const handles = [
    { id: 'p0:c0:anchor', kind: 'anchor', pathIndex: 0, commandIndex: 0, point: { x: 2, y: 2 } },
    { id: 'p0:c1:anchor', kind: 'anchor', pathIndex: 0, commandIndex: 1, point: { x: 8, y: 2 } },
    { id: 'p0:c2:anchor', kind: 'anchor', pathIndex: 0, commandIndex: 2, point: { x: 16, y: 2 } },
    { id: 'p1:c0:anchor', kind: 'anchor', pathIndex: 1, commandIndex: 0, point: { x: 5, y: 6 } },
    { id: 'p0:c1:control-in', kind: 'control', pathIndex: 0, commandIndex: 1, point: { x: 4, y: 4 } }
  ];
  const polygon = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.deepEqual(
    Array.from(anchorIdsInsideLasso(handles, polygon)),
    ['p0:c0:anchor', 'p0:c1:anchor', 'p1:c0:anchor']
  );
  const source = read('letter-tools.js');
  assert.match(source, /anchorIdsInsideLasso\(allLetterVectorHandles\(object\), points\)/);
});
