import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadGuardian() {
  const sandbox = { globalThis: {}, console, String, Object };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const source = fs.readFileSync(new URL('../version-guardian.js', import.meta.url), 'utf8');
  vm.runInContext(source, sandbox);
  return sandbox.MarehSoferVersionGuardian;
}

function manifest() {
  return {
    release: { display_version: '82', release_id: 'mareh-sofer-taste-82' },
    site: { source_version_number: 83, projection_revision: 39 },
    source: { git_is_canonical: false, git_commit: null },
  };
}

test('different version namespaces do not conflict: display 82 and Sites source 83', () => {
  const guardian = loadGuardian();
  const out = guardian.check({
    manifest: manifest(),
    runtime: { display_version: '82', site_source_version_number: 83, projection_revision: 39 },
  });
  assert.equal(out.status, 'ok');
  assert.equal(out.blocking, false);
});

test('display version mismatch is blocking', () => {
  const guardian = loadGuardian();
  const out = guardian.check({
    manifest: manifest(),
    runtime: { display_version: '81', site_source_version_number: 83, projection_revision: 39 },
  });
  assert.equal(out.status, 'mismatch');
  assert.equal(out.blocking, true);
  assert.equal(out.issues[0].label, 'display_version');
});

test('Sites source version mismatch is blocking', () => {
  const guardian = loadGuardian();
  const out = guardian.check({
    manifest: manifest(),
    runtime: { display_version: '82', site_source_version_number: 84, projection_revision: 39 },
  });
  assert.equal(out.status, 'mismatch');
  assert.equal(out.blocking, true);
});

test('projection revision mismatch warns but does not block', () => {
  const guardian = loadGuardian();
  const out = guardian.check({
    manifest: manifest(),
    runtime: { display_version: '82', site_source_version_number: 83, projection_revision: 40 },
  });
  assert.equal(out.status, 'warning');
  assert.equal(out.blocking, false);
});

test('Git commit is not enforced while GitHub is not canonical', () => {
  const guardian = loadGuardian();
  const out = guardian.check({
    manifest: manifest(),
    runtime: { display_version: '82', site_source_version_number: 83, projection_revision: 39, git_commit: 'deadbeef' },
  });
  const gitCheck = out.checks.find((x) => x.label === 'git_commit');
  assert.equal(gitCheck.status, 'not-canonical');
  assert.equal(out.blocking, false);
});

test('missing manifest blocks safely', () => {
  const guardian = loadGuardian();
  const out = guardian.check({ manifest: null, runtime: {} });
  assert.equal(out.status, 'error');
  assert.equal(out.blocking, true);
});
