(() => {
  'use strict';

  const state = {
    mode: 'local',
    aiEndpoint: '',
    aiAvailable: false
  };

  const buttons = Array.from(document.querySelectorAll('[data-engine-mode]'));
  const localNote = document.getElementById('localEngineNote');
  const aiNote = document.getElementById('aiEngineNote');
  const compareNote = document.getElementById('compareEngineNote');
  const engineStatus = document.getElementById('engineStatus');
  const aiAction = document.getElementById('aiEnhanceBtn');

  function setMode(mode) {
    state.mode = mode;
    document.documentElement.dataset.engineMode = mode;
    buttons.forEach((button) => {
      const active = button.dataset.engineMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    if (localNote) localNote.hidden = mode !== 'local';
    if (aiNote) aiNote.hidden = mode !== 'ai';
    if (compareNote) compareNote.hidden = mode !== 'compare';

    if (!engineStatus) return;
    if (mode === 'local') engineStatus.textContent = 'מנוע מקומי פעיל — עובד גם ללא רשת';
    else if (mode === 'ai') engineStatus.textContent = state.aiAvailable ? 'מנוע AI חומרי מחובר' : 'מנוע AI מוכן לחיבור שרת';
    else engineStatus.textContent = state.aiAvailable ? 'מצב השוואה: מקומי מול AI' : 'מצב השוואה יופעל לאחר חיבור שרת AI';
  }

  async function loadConfiguration() {
    try {
      const response = await fetch('./integration.json', { cache: 'no-store' });
      if (!response.ok) return;
      const config = await response.json();
      state.aiEndpoint = String(config.aiEndpoint || '').trim();
      state.aiAvailable = Boolean(state.aiEndpoint);
    } catch (_) {
      state.aiAvailable = false;
    }
    if (aiAction) {
      aiAction.disabled = !state.aiAvailable;
      aiAction.title = state.aiAvailable ? 'שליחה למנוע AI חומרי' : 'שרת AI טרם הוגדר';
    }
    setMode(state.mode);
  }

  buttons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.engineMode)));

  if (aiAction) {
    aiAction.addEventListener('click', () => {
      if (!state.aiAvailable) return;
      window.dispatchEvent(new CustomEvent('tov-mareh:ai-request', {
        detail: { endpoint: state.aiEndpoint }
      }));
    });
  }

  window.TovMarehEngines = {
    getMode: () => state.mode,
    setMode,
    isAiAvailable: () => state.aiAvailable,
    getAiEndpoint: () => state.aiEndpoint
  };

  setMode('local');
  loadConfiguration();
})();
