/* Tov Mareh Preview Engine 2.1 */
(() => {
  let previewTimer;

  scheduleRender = function scheduleRenderV21() {
    window.clearTimeout(previewTimer);
    const compare = $('compareRange');
    if (compare) {
      compare.value = 0;
      updateDivider();
    }
    previewTimer = window.setTimeout(() => render(), 120);
  };

  drawBase = function drawBaseV21() {
    const img = state.image;
    const settings = state.settings;
    const margin = settings.crop / 100;
    const sourceWidth = img.width * (1 - margin * 2);
    const sourceHeight = img.height * (1 - margin * 2);
    const maxPixelWidth = 960;
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
      const inset = Math.abs(perspective) * width * 0.18;
      for (let y = 0; y < height; y++) {
        const t = y / Math.max(1, height - 1);
        const left = perspective > 0 ? inset * (1 - t) : inset * t;
        const right = perspective > 0 ? width - inset * (1 - t) : width - inset * t;
        bctx.drawImage(scratch, 0, y, width, 1, left, y, Math.max(1, right - left), 1);
      }
    }

    actx.clearRect(0, 0, width, height);
    actx.drawImage(before, 0, 0);
    updateDivider();
    if (state.autoFit) fitImageToStage();
    else setZoom(state.zoom);
  };

  processLocal = function processLocalV21(multiplier = 1) {
    const width = before.width;
    const height = before.height;
    const source = bctx.getImageData(0, 0, width, height);
    const output = actx.createImageData(width, height);
    const data = source.data;
    const out = output.data;
    const settings = state.settings;

    const sharp = settings.sharpness / 100 * multiplier;
    const black = settings.black / 100 * multiplier;
    const uniformity = settings.uniformity / 100;
    const gloss = settings.gloss / 100 * multiplier;
    const depth = settings.depth / 100;
    const warmth = settings.warmth / 100;
    const texture = settings.texture / 100;
    const brightness = (settings.brightness - 50) * 2.4;
    const denoise = settings.denoise / 100;
    const deglare = settings.deglare / 100;
    const threshold = 188 - black * 48;
    const targetBlack = 18 - black * 15;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        let red = data[index];
        let green = data[index + 1];
        let blue = data[index + 2];

        if (denoise > 0 && x > 0 && y > 0 && x < width - 1 && y < height - 1) {
          const neighbours = [index - 4, index + 4, index - width * 4, index + width * 4];
          let nr = 0, ng = 0, nb = 0;
          for (const n of neighbours) {
            nr += data[n]; ng += data[n + 1]; nb += data[n + 2];
          }
          const blend = denoise * 0.55;
          red = lerp(red, nr / 4, blend);
          green = lerp(green, ng / 4, blend);
          blue = lerp(blue, nb / 4, blend);
        }

        let luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
        const edge = edgeAt(data, width, height, x, y);

        if (deglare > 0 && luminance > 205) {
          const highlight = (luminance - 205) / 50;
          const correction = deglare * highlight * 44;
          red -= correction;
          green -= correction;
          blue -= correction * 0.9;
          luminance -= correction;
        }

        const rawInk = clamp((threshold - luminance) / 115, 0, 1);
        const inkMask = Math.pow(rawInk, 0.72 + uniformity * 0.32);
        const paperMask = 1 - inkMask;
        const fibre = (
          Math.sin(x * 0.018 + y * 0.006) * 0.55 +
          Math.sin(x * 0.004 - y * 0.021) * 0.30 +
          Math.cos((x + y) * 0.007) * 0.15
        ) * texture * 10;

        const paperR = clamp(red + brightness + warmth * 20 + fibre, 0, 255);
        const paperG = clamp(green + brightness + warmth * 7 + fibre * 0.8, 0, 255);
        const paperB = clamp(blue + brightness - warmth * 19 + fibre * 0.55, 0, 255);
        const sourceInk = luminance;
        const unifiedInk = lerp(sourceInk, targetBlack, uniformity * 0.88);
        const blackenedInk = clamp(unifiedInk - black * 72, 0, 255);
        const core = inkMask * (1 - edge * 0.78);
        const band = Math.sin((x / Math.max(1, width)) * Math.PI * 1.35 - 0.4) * 0.5 + 0.5;
        const stableGloss = gloss * core * band * 52;
        const inkMass = depth * core * 46;
        const inkValue = clamp(blackenedInk - inkMass + stableGloss, 0, 255);

        out[index] = clamp(paperR * paperMask + inkValue * inkMask, 0, 255);
        out[index + 1] = clamp(paperG * paperMask + inkValue * inkMask, 0, 255);
        out[index + 2] = clamp(paperB * paperMask + inkValue * 0.98 * inkMask, 0, 255);
        out[index + 3] = 255;
      }
    }

    actx.putImageData(output, 0, 0);
    if (sharp > 0.01) unsharp(sharp * 1.45);
    $('deltaLabel').textContent = estimateDelta(source, output).toFixed(1) + '%';
  };

  const brandLine = document.querySelector('.brand p');
  if (brandLine) brandLine.textContent = 'מראה סופר — שיפור וליטוש תמונת הכתב · Engine 2.1';
  const status = $('aiStatus');
  if (status && !state.aiEndpoint) status.textContent = 'מנוע מקומי 2.1 פעיל';
})();
