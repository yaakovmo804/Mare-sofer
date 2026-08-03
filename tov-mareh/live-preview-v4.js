/* Tov Mareh live-preview engine v4
 * Keeps slider interaction responsive on iPad by processing a 720px preview.
 * Full resolution is used only by Apply and Export.
 */
(() => {
  const PREVIEW_WIDTH = 720;
  const FULL_WIDTH = 1800;
  let previewTimer = 0;

  window.TOV_MAREH_ENGINE_VERSION = '4.0';

  scheduleRender = function scheduleRenderV4() {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => render(false, false), 35);
  };

  render = function renderV4(commit = false, fullQuality = false) {
    if (!state.image) return Promise.resolve();

    const token = ++state.renderToken;
    const useRemoteAi = state.engine === 'ai' && Boolean(state.aiEndpoint);
    setBusy(useRemoteAi || fullQuality);

    return new Promise((resolve) => {
      window.requestAnimationFrame(async () => {
        try {
          drawBase(fullQuality ? FULL_WIDTH : PREVIEW_WIDTH);
          if (useRemoteAi) await renderAi(token);
          else processLocal(state.engine === 'ai' ? 1.12 : 1, fullQuality);
          if (commit) pushHistory();
        } catch (error) {
          console.error(error);
          if (token === state.renderToken) {
            processLocal(state.engine === 'ai' ? 1.12 : 1, fullQuality);
            $('aiStatus').textContent = 'העיבוד המרוחק נכשל — הופעל המנוע המקומי';
          }
        } finally {
          if (token === state.renderToken) {
            setBusy(false);
            if (state.autoFit) window.requestAnimationFrame(fitImageToStage);
            else setZoom(state.zoom);
          }
          resolve();
        }
      });
    });
  };

  drawBase = function drawBaseV4(maxPixelWidth = PREVIEW_WIDTH) {
    const img = state.image;
    const settings = state.settings;
    const margin = settings.crop / 100;
    const sourceWidth = img.width * (1 - margin * 2);
    const sourceHeight = img.height * (1 - margin * 2);
    const pixelScale = Math.min(1, maxPixelWidth / sourceWidth);
    const width = Math.max(120, Math.round(sourceWidth * pixelScale));
    const height = Math.max(80, Math.round(sourceHeight * pixelScale));

    [before, after].forEach((canvas) => {
      canvas.width = width;
      canvas.height = height;
    });

    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    sctx.fillStyle = '#f5f1e8';
    sctx.fillRect(0, 0, width, height);
    sctx.save();
    sctx.translate(width / 2, height / 2);
    sctx.rotate(settings.rotation * Math.PI / 180);
    sctx.drawImage(
      img,
      img.width * margin,
      img.height * margin,
      sourceWidth,
      sourceHeight,
      -width / 2,
      -height / 2,
      width,
      height
    );
    sctx.restore();

    bctx.clearRect(0, 0, width, height);
    const perspective = settings.perspective / 100;
    if (Math.abs(perspective) < 0.001) {
      bctx.drawImage(scratch, 0, 0);
    } else {
      const source = sctx.getImageData(0, 0, width, height);
      const target = bctx.createImageData(width, height);
      const inset = Math.abs(perspective) * width * 0.18;
      for (let y = 0; y < height; y++) {
        const t = y / Math.max(1, height - 1);
        const left = perspective > 0 ? inset * (1 - t) : inset * t;
        const right = perspective > 0 ? width - inset * (1 - t) : width - inset * t;
        for (let x = 0; x < width; x++) {
          const u = x / Math.max(1, width - 1);
          sampleBilinear(source.data, width, height, left + u * (right - left), y, target.data, (y * width + x) * 4);
        }
      }
      bctx.putImageData(target, 0, 0);
    }

    actx.clearRect(0, 0, width, height);
    actx.drawImage(before, 0, 0);
    updateDivider();
    if (state.autoFit) fitImageToStage();
    else setZoom(state.zoom);
  };

  const originalProcessLocal = processLocal;
  processLocal = function processLocalV4(multiplier = 1, fullQuality = false) {
    const denoise = state.settings.denoise;
    const deglare = state.settings.deglare;
    if (!fullQuality) {
      state.settings.denoise = Math.min(denoise, 34);
      state.settings.deglare = Math.min(deglare, 45);
    }
    try {
      originalProcessLocal(multiplier);
    } finally {
      state.settings.denoise = denoise;
      state.settings.deglare = deglare;
    }
  };

  const applyButton = $('applyBtn');
  if (applyButton) applyButton.onclick = () => render(true, true);

  exportImage = async function exportImageV4() {
    if (!state.image) return;
    await render(false, true);
    after.toBlob((blob) => download(blob, 'tov-mareh.png'));
  };
  const exportButton = $('exportBtn');
  if (exportButton) exportButton.onclick = exportImage;

  if (!localStorage.getItem('tm_engine_v4_reset')) {
    localStorage.setItem('tm_engine_v4_reset', '1');
    if ('caches' in window) {
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key.includes('tov-mareh')).map((key) => caches.delete(key))));
    }
  }

  const subtitle = document.querySelector('.brand p');
  if (subtitle && !subtitle.textContent.includes('4.0')) subtitle.textContent += ' • מנוע 4.0';
})();
