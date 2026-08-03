'use strict';

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active browser tab was found');
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('Pool Vision only runs on normal http/https pages');
  }
  return tab;
}

async function isInjected(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.__POOL_VISION_ASSISTANT__),
    });
    return Boolean(result?.result);
  } catch (_error) {
    return false;
  }
}

async function ensureInjected(tabId) {
  if (await isInjected(tabId)) return;
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['styles.css'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['geometry.js', 'vision.js', 'content.js'],
  });
}

function sendCommand(tabId, command, settings) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: 'POOL_VISION_COMMAND', command, settings },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'The page did not accept the command'));
          return;
        }
        resolve(response);
      }
    );
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'POOL_VISION_CAPTURE') {
    const windowId = sender.tab?.windowId;
    if (windowId == null) {
      sendResponse({ ok: false, error: 'Capture request did not come from a browser tab' });
      return false;
    }

    chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 84 }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        sendResponse({ ok: false, error: error.message });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });
    return true;
  }

  if (message?.type === 'POOL_VISION_POPUP_COMMAND') {
    (async () => {
      const tab = await getActiveTab();
      await ensureInjected(tab.id);
      const response = await sendCommand(tab.id, message.command, message.settings);
      return { ...response, tabId: tab.id };
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
