import fs from 'node:fs';
import vm from 'node:vm';

const runtimePath = process.argv[2];
const manifestPath = process.argv[3] || new URL('./version-manifest.json', import.meta.url);

if (!runtimePath) {
  console.error('Usage: node guard-release.mjs <runtime.json> [manifest.json]');
  process.exit(2);
}

function readJson(pathOrUrl) {
  return JSON.parse(fs.readFileSync(pathOrUrl, 'utf8'));
}

const sandbox = { globalThis: {}, console, String, Object };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const guardianSource = fs.readFileSync(new URL('./version-guardian.js', import.meta.url), 'utf8');
vm.runInContext(guardianSource, sandbox);

const manifest = readJson(manifestPath);
const runtime = readJson(runtimePath);
const guardian = sandbox.MarehSoferVersionGuardian;
const result = guardian.check({ manifest, runtime });

console.log(guardian.format(result));

if (result.blocking || result.status === 'error') {
  console.error('RELEASE BLOCKED: version mismatch');
  process.exit(1);
}

if (result.status === 'warning') {
  console.warn('RELEASE WARNING: non-blocking infrastructure revision difference');
}

process.exit(0);
