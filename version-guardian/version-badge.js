/* Mareh Sofer — Version Guardian UI */
(function (global) {
  'use strict';

  function init(options = {}) {
    const guardian = global.MarehSoferVersionGuardian;
    if (!guardian) throw new Error('MarehSoferVersionGuardian must be loaded first');
    const doc = global.document;
    if (!doc) return null;
    if (doc.getElementById('marehVersionGuardianButton')) return global.MarehSoferVersionBadge;

    const manifest = options.manifest || {};
    const runtime = options.runtime || {};
    const result = guardian.check({ manifest, runtime });
    const version = manifest.release?.display_version || runtime.display_version || '?';

    const style = doc.createElement('style');
    style.textContent = `
      #marehVersionGuardianButton{position:fixed;right:16px;bottom:16px;z-index:2147482900;border:1px solid #cfc7b9;background:#fff;color:#28251f;border-radius:999px;padding:8px 12px;font:600 13px system-ui,-apple-system,"Segoe UI",Arial,sans-serif;box-shadow:0 8px 28px rgba(30,24,18,.12);cursor:pointer}
      #marehVersionGuardianButton[data-status="mismatch"],#marehVersionGuardianButton[data-status="error"]{border-color:#a93636;background:#fff5f5;color:#7f1d1d}
      #marehVersionGuardianButton[data-status="warning"]{border-color:#b98518;background:#fffaf0;color:#704e00}
      #marehVersionGuardianDialog{width:min(620px,calc(100% - 24px));border:0;border-radius:18px;padding:0;box-shadow:0 24px 80px rgba(0,0,0,.24);direction:rtl;color:#231f1a}
      #marehVersionGuardianDialog::backdrop{background:rgba(20,18,15,.38)}
      #marehVersionGuardianDialog .mvg-wrap{padding:22px;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      #marehVersionGuardianDialog .mvg-row{display:grid;grid-template-columns:minmax(150px,.9fr) 1fr 1fr;gap:8px;padding:9px 0;border-bottom:1px solid #eee9df;font-size:13px}
      #marehVersionGuardianDialog .mvg-head{font-weight:700}
      #marehVersionGuardianDialog .mvg-muted{color:#746d62;font-size:13px;line-height:1.5}
      #marehVersionGuardianDialog button{font:inherit;border:1px solid #cfc7b9;background:#fff;border-radius:10px;padding:9px 13px;cursor:pointer;margin-top:16px}
    `;
    doc.head.appendChild(style);

    const button = doc.createElement('button');
    button.id = 'marehVersionGuardianButton';
    button.type = 'button';
    button.dataset.status = result.status;
    const suffix = result.status === 'ok' ? 'תקין' : result.status === 'warning' ? 'בדוק' : 'אי־התאמה';
    button.textContent = `גרסה ${version} · ${suffix}`;
    button.setAttribute('aria-label', 'פרטי גרסה ומקור אמת');

    const dialog = doc.createElement('dialog');
    dialog.id = 'marehVersionGuardianDialog';
    const rows = result.checks.map((c) => `
      <div class="mvg-row"><div>${c.label}</div><div>${c.actual ?? 'לא ידוע'}</div><div>${c.expected ?? 'לא מוגדר'} · ${c.status}</div></div>`).join('');
    dialog.innerHTML = `
      <div class="mvg-wrap">
        <h2 style="margin:0 0 4px">שומר הגרסה</h2>
        <div class="mvg-muted">${result.summary || ''}</div>
        <div class="mvg-row mvg-head"><div>מונה</div><div>בפועל</div><div>מקור האמת</div></div>
        ${rows}
        <div class="mvg-muted" style="margin-top:12px">גרסת מוצר ו־Sites source version הם מונים שונים ואינם מושווים זה לזה.</div>
        <button type="button" id="marehVersionGuardianClose">סגור</button>
      </div>`;

    doc.body.appendChild(button);
    doc.body.appendChild(dialog);
    button.addEventListener('click', () => dialog.showModal());
    doc.getElementById('marehVersionGuardianClose').addEventListener('click', () => dialog.close());

    function destroy() {
      button.remove();
      dialog.remove();
      style.remove();
      delete global.MarehSoferVersionBadge;
    }

    global.MarehSoferVersionBadge = Object.freeze({ result, destroy });
    return global.MarehSoferVersionBadge;
  }

  global.MarehSoferVersionBadge = Object.freeze({ init });
})(window);
