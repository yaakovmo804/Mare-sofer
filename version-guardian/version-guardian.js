/* Mareh Sofer — Version Guardian */
(function (global) {
  'use strict';

  function clean(value) {
    if (value === null || value === undefined) return null;
    return String(value).trim();
  }

  function eq(a, b) {
    return clean(a) === clean(b);
  }

  function check({ manifest, runtime = {} }) {
    if (!manifest || typeof manifest !== 'object') {
      return { status: 'error', blocking: true, issues: ['manifest missing'], checks: [] };
    }

    const checks = [];
    const issues = [];

    function sameNamespace(label, expected, actual, severity = 'error') {
      if (actual === undefined || actual === null || actual === '') {
        checks.push({ label, status: 'unknown', expected, actual: null });
        return;
      }
      const ok = eq(expected, actual);
      checks.push({ label, status: ok ? 'ok' : 'mismatch', expected, actual });
      if (!ok) issues.push({ label, severity, expected, actual });
    }

    sameNamespace('display_version', manifest.release?.display_version, runtime.display_version);
    sameNamespace('site.source_version_number', manifest.site?.source_version_number, runtime.site_source_version_number);
    sameNamespace('site.projection_revision', manifest.site?.projection_revision, runtime.projection_revision, 'warning');

    if (manifest.source?.git_is_canonical === true) {
      sameNamespace('git_commit', manifest.source?.git_commit, runtime.git_commit);
    } else {
      checks.push({
        label: 'git_commit',
        status: 'not-canonical',
        expected: manifest.source?.git_commit || null,
        actual: runtime.git_commit || null,
      });
    }

    // Important: display_version is NOT compared with Sites source_version_number.
    const blocking = issues.some((x) => x.severity === 'error');
    const hasWarning = issues.some((x) => x.severity === 'warning');
    const status = blocking ? 'mismatch' : hasWarning ? 'warning' : 'ok';

    return {
      status,
      blocking,
      release_id: manifest.release?.release_id || null,
      checks,
      issues,
      summary: blocking
        ? 'גרסת הריצה אינה תואמת למקור האמת.'
        : hasWarning
          ? 'גרסת המוצר תואמת; קיימת סטיית תשתית שאינה חוסמת.'
          : 'גרסת המוצר ומקור האמת תואמים.',
    };
  }

  function format(result) {
    const rows = result.checks.map((c) => {
      const mark = c.status === 'ok' ? '✓' : c.status === 'mismatch' ? '✗' : '·';
      return `${mark} ${c.label}: ${c.actual ?? 'לא ידוע'}${c.expected !== undefined ? ` (צפוי ${c.expected ?? 'לא מוגדר'})` : ''}`;
    });
    return [
      `שומר הגרסה — ${result.status}`,
      result.summary || '',
      ...rows,
    ].filter(Boolean).join('\n');
  }

  global.MarehSoferVersionGuardian = Object.freeze({ check, format });
})(typeof window !== 'undefined' ? window : globalThis);
