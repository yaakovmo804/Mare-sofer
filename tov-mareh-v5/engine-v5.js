/* Tov Mareh fresh runtime marker and live-control guard — Engine 5.0 */
(() => {
  window.TOV_MAREH_ENGINE_VERSION = '5.0';
  let liveTimer = 0;

  const subtitle = document.querySelector('.brand p');
  if (subtitle) subtitle.textContent = 'מראה סופר — שיפור וליטוש תמונת הכתב • מנוע 5.0';

  const title = document.querySelector('.brand');
  if (title && !document.getElementById('engineBadge')) {
    const badge = document.createElement('span');
    badge.id = 'engineBadge';
    badge.textContent = '5.0 LIVE';
    badge.style.cssText = 'display:inline-flex;align-items:center;align-self:center;padding:5px 9px;border-radius:999px;border:1px solid #d0a969;color:#f5d59d;background:#17222d;font-size:11px;font-weight:800;white-space:nowrap';
    title.appendChild(badge);
  }

  const controls = [
    'rotation', 'perspective', 'crop', 'sharpness', 'black', 'uniformity',
    'gloss', 'depth', 'warmth', 'texture', 'brightness', 'denoise', 'deglare'
  ];

  function showAfterSide() {
    const compare = document.getElementById('compareRange');
    if (!compare) return;
    compare.value = '0';
    if (typeof updateDivider === 'function') updateDivider();
  }

  function scheduleVerifiedPreview() {
    showAfterSide();
    const delta = document.getElementById('deltaLabel');
    if (delta) delta.textContent = 'מעבד…';
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(async () => {
      try {
        if (typeof render === 'function') await render(false, false);
      } catch (error) {
        console.error('Engine 5.0 preview failed', error);
        if (delta) delta.textContent = 'שגיאה';
      }
    }, 65);
  }

  controls.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', () => {
      if (typeof state !== 'undefined' && state.settings) state.settings[id] = Number(input.value);
      scheduleVerifiedPreview();
    });
    input.addEventListener('change', scheduleVerifiedPreview);
  });

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => window.setTimeout(scheduleVerifiedPreview, 0));
  });

  const status = document.getElementById('aiStatus');
  if (status && (typeof state === 'undefined' || !state.aiEndpoint)) {
    status.textContent = 'מנוע מקומי 5.0 פעיל — הסליידרים מחוברים לתצוגה חיה';
  }
})();
