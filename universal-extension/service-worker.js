'use strict';

const MIN_CAPTURE_GAP_MS = 520;
let lastCaptureAt = 0;
let captureQueue = Promise.resolve();

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active browser tab was found');
  if (!/^https?:/i.test(tab.url || '')) {
    throw new Error('Pool Vision only runs on normal http/https pages');
  }
  return tab;
}

async function getInjectionState(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        assistant: Boolean(globalThis.__POOL_VISION_ASSISTANT__),
        captureGuard: Boolean(globalThis.__POOL_VISION_CAPTURE_GUARD__),
      }),
    });
    return result?.result || { assistant: false, captureGuard: false };
  } catch (_error) {
    return { assistant: false, captureGuard: false };
  }
}

async function ensureInjected(tabId) {
  const injectionState = await getInjectionState(tabId);

  if (!injectionState.assistant) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['styles.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['geometry.js', 'vision.js', 'content.js'],
    });
  }

  if (!injectionState.captureGuard) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['capture-guard.js'],
    });
  }
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

function sendTabSignal(tabId, type) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve(false);
        return;
      }
      resolve(Boolean(response?.ok));
    });
  });
}

function captureVisibleTab(windowId, tabId) {
  captureQueue = captureQueue
    .catch(() => {})
    .then(async () => {
      const waitMs = Math.max(0, MIN_CAPTURE_GAP_MS - (Date.now() - lastCaptureAt));
      if (waitMs) await sleep(waitMs);

      await sendTabSignal(tabId, 'POOL_VISION_PRE_CAPTURE');
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 84 }, (captured) => {
            const error = chrome.runtime.lastError;
            if (error) {
              reject(new Error(error.message));
              return;
            }
            resolve(captured);
          });
        });
        lastCaptureAt = Date.now();
        return dataUrl;
      } finally {
        await sendTabSignal(tabId, 'POOL_VISION_POST_CAPTURE');
      }
    });
  return captureQueue;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'POOL_VISION_CAPTURE') {
    const windowId = sender.tab?.windowId;
    const tabId = sender.tab?.id;
    if (windowId == null || tabId == null) {
      sendResponse({ ok: false, error: 'Capture request did not come from a browser tab' });
      return false;
    }

    captureVisibleTab(windowId, tabId)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
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
