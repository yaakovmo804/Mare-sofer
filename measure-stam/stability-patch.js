'use strict';

(() => {
  const originalAnalyzeImage = analyzeImage;
  let analysisRunning = false;

  // הגרסה היציבה אינה מפעילה ניתוח כבד מיד עם העלאת התמונה.
  // המשתמש יכול להתחיל למדוד מיד ולהפעיל ניתוח נוסחת כתב לפי דרישה.
  loadImageSource = function loadImageSourceStable(source, resetProject, preparedImage = null) {
    analysisOverlay.hidden = true;
    const image = preparedImage || new Image();

    const handleLoad = () => {
      state.image = image;
      state.imageSrc = source;
      emptyState.style.display = 'none';

      if (resetProject) {
        state.objects = [];
        state.draft = null;
        state.draftHistory = [];
        state.selectedId = null;
        state.selectedPoint = null;
        state.selectedSegment = null;
        state.nextId = 1;
        state.history = [];
        state.future = [];
        state.formula = mergeFormula({});
      }

      fitImage();
      const savedView = !resetProject ? state.projectDocument?.uiState?.view : null;
      if (savedView && Number.isFinite(+savedView.x) && Number.isFinite(+savedView.y) && Number.isFinite(+savedView.scale)) {
        state.view = { x: +savedView.x, y: +savedView.y, scale: clamp(+savedView.scale, .03, 12) };
        zoomText.textContent = `${Math.round(state.view.scale * 100)}%`;
      }
      renderAll();
      for (const kastel of state.objects.filter(item => item.type === 'kastel' && !item.guides)) {
        initializeKastelGuides(kastel);
      }

      if (resetProject) {
        state.formula.analysis.status = 'idle';
        statusText.textContent = 'התמונה נטענה. אפשר להתחיל למדוד; ניתוח נוסחת הכתב מופעל לפי דרישה.';
        renderFormulaUI();
      }
    };

    image.onerror = () => {
      analysisOverlay.hidden = true;
      statusText.textContent = 'לא ניתן לפתוח את התמונה';
      alert('לא ניתן לפתוח את התמונה');
    };

    if (preparedImage) {
      handleLoad();
      return;
    }
    image.onload = handleLoad;
    image.src = source;
  };

  analyzeImage = async function analyzeImageStable(userInitiated = true) {
    if (analysisRunning) {
      statusText.textContent = 'הניתוח כבר פועל';
      return;
    }

    analysisRunning = true;
    const analyzeButton = $('analyzeBtn');
    if (analyzeButton) analyzeButton.disabled = true;

    try {
      await originalAnalyzeImage(userInitiated);
    } finally {
      analysisOverlay.hidden = true;
      analysisRunning = false;
      if (analyzeButton) analyzeButton.disabled = false;
    }
  };

  analysisOverlay.hidden = true;

  const emptyCopy = document.querySelector('#emptyState p');
  if (emptyCopy) emptyCopy.textContent = 'התמונה נטענת מיד. ניתוח עובי קולמוס ומרווחים מופעל רק בלחיצה.';

  const analysisNote = $('analysisNote');
  if (analysisNote) analysisNote.textContent = 'ליציבות, הניתוח אינו מופעל אוטומטית. אפשר להפעילו לפי הצורך או לסמן ידנית.';

  const analyzeButton = $('analyzeBtn');
  if (analyzeButton) analyzeButton.textContent = 'ניתוח נוסחת הכתב';
})();
