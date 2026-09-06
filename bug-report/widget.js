/* Mareh Sofer — Bug Report launcher/widget for the current app. */
(function (global) {
  'use strict';

  const DEFAULT_CONTROLS = [
    'שיחה', 'כרטיס תלמיד', 'מקורות', 'גשר ידע', 'סיעור מוחות',
    'שאלת חכם', 'בואו חשבון', 'משוב חזותי', 'מקרה מקביל',
    'בקש ביקורת עכשיו', 'שליחת שאלה', 'צלם או בחר תמונה'
  ];

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function init(options = {}) {
    const bug = global.MarehSoferBugReport;
    if (!bug) throw new Error('MarehSoferBugReport core must be loaded before widget.js');
    if (global.document.getElementById('marehBugReportLauncher')) return global.MarehSoferBugReportWidget;

    const doc = global.document;
    const allowed = new Set((options.allowedControls || DEFAULT_CONTROLS).map(cleanText));

    bug.setVersion(options.version || 'v81-candidate');
    bug.setScreen(options.screen || 'שיחה');
    Object.entries(options.sourceStatus || {}).forEach(([name, status]) => bug.setSourceStatus(name, status));

    const style = doc.createElement('style');
    style.textContent = `
      #marehBugReportLauncher{position:fixed;left:16px;bottom:16px;z-index:2147483000;border:1px solid #cfc7b9;background:#fff;color:#28251f;border-radius:999px;padding:9px 13px;font:600 14px system-ui,-apple-system,"Segoe UI",Arial,sans-serif;box-shadow:0 8px 28px rgba(30,24,18,.14);cursor:pointer}
      #marehBugReportDialog{width:min(560px,calc(100% - 24px));border:0;border-radius:18px;padding:0;box-shadow:0 24px 80px rgba(0,0,0,.24);direction:rtl;color:#231f1a}
      #marehBugReportDialog::backdrop{background:rgba(20,18,15,.38)}
      #marehBugReportDialog .msbr-wrap{padding:22px;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
      #marehBugReportDialog .msbr-muted{color:#746d62;font-size:13px;line-height:1.5}
      #marehBugReportDialog .msbr-row{display:grid;gap:6px;margin:14px 0}
      #marehBugReportDialog label{font-weight:650}
      #marehBugReportDialog select,#marehBugReportDialog input,#marehBugReportDialog textarea{width:100%;font:inherit;border:1px solid #cfc7b9;border-radius:10px;padding:10px;background:#fff;color:#231f1a}
      #marehBugReportDialog textarea{min-height:78px;resize:vertical}
      #marehBugReportDialog .msbr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
      #marehBugReportDialog button{font:inherit;border:1px solid #cfc7b9;background:#fff;border-radius:10px;padding:9px 13px;cursor:pointer}
      #marehBugReportDialog button.msbr-primary{background:#28251f;color:#fff;border-color:#28251f}
      #marehBugReportStatus{display:none;margin-top:12px;padding:10px;border-radius:10px;background:#f2efe7;white-space:pre-wrap;font-size:13px}
      #marehBugManualCopy{display:none;margin-top:10px;min-height:150px;direction:rtl;user-select:text;-webkit-user-select:text}
    `;
    doc.head.appendChild(style);

    const launcher = doc.createElement('button');
    launcher.id = 'marehBugReportLauncher';
    launcher.type = 'button';
    launcher.textContent = 'דווח תקלה';
    launcher.setAttribute('aria-label', 'דווח תקלה במראה סופר');

    const dialog = doc.createElement('dialog');
    dialog.id = 'marehBugReportDialog';
    dialog.innerHTML = `
      <div class="msbr-wrap">
        <h2 style="margin:0 0 4px">דיווח תקלה</h2>
        <div class="msbr-muted">מצורפים אוטומטית: גרסה, מסך, פעולות טכניות אחרונות ושגיאות. תוכן השיחה ופרטי תלמיד אינם נאספים.</div>
        <div class="msbr-row"><label for="marehBugCategory">סוג התקלה</label><select id="marehBugCategory"><option>תקלה בממשק</option><option>תקלה בחיבור</option><option>תוצאה שגויה</option><option>אחר</option></select></div>
        <div class="msbr-row"><label for="marehBugResult">מה קרה בפועל?</label><input id="marehBugResult" placeholder="לדוגמה: לחצתי ולא נפתח חלון"></div>
        <div class="msbr-row"><label for="marehBugNote">הערה קצרה</label><textarea id="marehBugNote" placeholder="משפט אחד או שניים מספיקים"></textarea></div>
        <div class="msbr-actions"><button type="button" class="msbr-primary" id="marehBugCopy">העתק דו״ח תקלה</button><button type="button" id="marehBugClose">סגור</button></div>
        <div id="marehBugReportStatus"></div>
        <textarea id="marehBugManualCopy" readonly aria-label="דו״ח תקלה להעתקה ידנית"></textarea>
      </div>`;

    doc.body.appendChild(launcher);
    doc.body.appendChild(dialog);

    const clickTracker = (event) => {
      const el = event.target && event.target.closest ? event.target.closest('button,a,[role="button"]') : null;
      if (!el || el.id === launcher.id || dialog.contains(el)) return;
      const label = cleanText(el.getAttribute('aria-label') || el.textContent);
      if (allowed.has(label)) bug.control(label);
    };
    doc.addEventListener('click', clickTracker, true);

    launcher.addEventListener('click', () => {
      bug.control('דווח תקלה');
      dialog.showModal();
    });
    doc.getElementById('marehBugClose').addEventListener('click', () => dialog.close());
    doc.getElementById('marehBugCopy').addEventListener('click', async () => {
      const out = await bug.copyReport({
        category: doc.getElementById('marehBugCategory').value,
        result: doc.getElementById('marehBugResult').value,
        userNote: doc.getElementById('marehBugNote').value,
      });
      const status = doc.getElementById('marehBugReportStatus');
      const manual = doc.getElementById('marehBugManualCopy');
      status.style.display = 'block';
      if (out.copied) {
        status.textContent = 'הדו״ח הועתק. אפשר להדביק אותו ישירות בשיחת הפיתוח.';
        manual.style.display = 'none';
        manual.value = '';
      } else {
        status.textContent = 'ההעתקה האוטומטית נחסמה. הדו״ח מוצג מתחת ומסומן להעתקה ידנית.';
        manual.value = out.report;
        manual.style.display = 'block';
        manual.focus();
        manual.select();
        manual.setSelectionRange?.(0, manual.value.length);
      }
    });

    function setScreen(name) { bug.setScreen(name); }
    function setSourceStatus(name, status) { bug.setSourceStatus(name, status); }
    function destroy() {
      doc.removeEventListener('click', clickTracker, true);
      launcher.remove();
      dialog.remove();
      style.remove();
      global.MarehSoferBugReportWidget = Object.freeze({ init });
    }

    global.MarehSoferBugReportWidget = Object.freeze({ setScreen, setSourceStatus, destroy });
    return global.MarehSoferBugReportWidget;
  }

  global.MarehSoferBugReportWidget = Object.freeze({ init });
})(window);
