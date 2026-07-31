'use strict';

(() => {
  // Keep the analysis controls single-flight without replacing the image
  // lifecycle. The current lifecycle intentionally starts local roof
  // detection after a new image is loaded.
  const originalAnalyzeImage = analyzeImage;
  let analysisRunning = false;

  analyzeImage = async function analyzeImageStable(userInitiated = true) {
    if (analysisRunning) {
      statusText.textContent = 'הזיהוי כבר פועל';
      return;
    }
    analysisRunning = true;
    const analyzeButton = $('analyzeBtn');
    if (analyzeButton) analyzeButton.disabled = true;
    try {
      await originalAnalyzeImage(userInitiated);
    } finally {
      if (state.formula.analysis.status !== 'running') analysisOverlay.hidden = true;
      analysisRunning = false;
      if (analyzeButton) analyzeButton.disabled = false;
    }
  };

  analysisOverlay.hidden = true;

  const emptyCopy = document.querySelector('#emptyState p');
  if (emptyCopy) {
    emptyCopy.textContent = 'התמונה נטענת ומנותחת מקומית. עובי הקולמוס מזוהה מן הגגות וניתן לתיקון ידני.';
  }

  const analysisNote = $('analysisNote');
  if (analysisNote) {
    analysisNote.textContent = 'המערכת מאתרת גגות ישרים בתמונה, מודדת חתכים יציבים וקובעת את עובי הקולמוס אוטומטית. ערך ידני מאומת נשאר נעול.';
  }

  const analyzeButton = $('analyzeBtn');
  if (analyzeButton) analyzeButton.textContent = 'זיהוי אוטומטי';
})();
