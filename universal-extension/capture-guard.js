(() => {
  'use strict';

  if (globalThis.__POOL_VISION_CAPTURE_GUARD__) return;
  let previousVisibility = '';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'POOL_VISION_PRE_CAPTURE') {
      const root = document.getElementById('pool-vision-root');
      if (root) {
        previousVisibility = root.style.visibility;
        root.style.visibility = 'hidden';
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => sendResponse({ ok: true }));
      });
      return true;
    }

    if (message?.type === 'POOL_VISION_POST_CAPTURE') {
      const root = document.getElementById('pool-vision-root');
      if (root) root.style.visibility = previousVisibility;
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  globalThis.__POOL_VISION_CAPTURE_GUARD__ = true;
})();
