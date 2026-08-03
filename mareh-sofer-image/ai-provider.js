(() => {
  'use strict';

  /**
   * Stable boundary between the standalone app and a future AI server.
   * The browser never stores a provider key. A production deployment should
   * point endpoint at an authenticated application server controlled by us.
   */
  class MarehSoferAIProvider {
    constructor(options = {}) {
      this.endpoint = options.endpoint || '';
      this.timeoutMs = options.timeoutMs || 90000;
    }

    get configured() {
      return Boolean(this.endpoint);
    }

    async enhance({ imageBlob, inkMaskBlob, settings, signal }) {
      if (!this.configured) {
        throw new Error('AI_PROVIDER_NOT_CONFIGURED');
      }
      if (!(imageBlob instanceof Blob)) throw new TypeError('imageBlob is required');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const abort = () => controller.abort();
      if (signal) signal.addEventListener('abort', abort, { once: true });

      try {
        const form = new FormData();
        form.append('image', imageBlob, 'source.png');
        if (inkMaskBlob instanceof Blob) form.append('ink_mask', inkMaskBlob, 'ink-mask.png');
        form.append('settings', JSON.stringify({
          version: 1,
          fidelityMode: 'locked-geometry',
          ...settings
        }));

        const response = await fetch(this.endpoint, {
          method: 'POST',
          body: form,
          signal: controller.signal,
          headers: { Accept: 'image/png, application/json' }
        });
        if (!response.ok) throw new Error(`AI_SERVER_${response.status}`);

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const payload = await response.json();
          if (!payload.imageUrl) throw new Error('AI_SERVER_INVALID_RESPONSE');
          const imageResponse = await fetch(payload.imageUrl, { signal: controller.signal });
          if (!imageResponse.ok) throw new Error('AI_IMAGE_DOWNLOAD_FAILED');
          return imageResponse.blob();
        }
        return response.blob();
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abort);
      }
    }
  }

  window.MarehSoferAIProvider = MarehSoferAIProvider;
})();
