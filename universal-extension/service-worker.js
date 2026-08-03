'use strict';

const SCRIPT_FILES = [
  'geometry.js',
  'vision.js',
  'precision-vision.js',
  'simple-core.js',
  'simple-guider.js',
];

async function isChallengePage(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = `${document.title || ''}\n${document.body?.innerText || ''}`.toLowerCase();
        return (
          text.includes('performing security verification') ||
          text.includes('checking your browser') ||
          text.includes('verify you are human') ||
          Boolean(document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]'))
        );
      },
    });
    return Boolean(result?.result);
  } catch (_error) {
    return false;
  }
}

async function executeAllFrames(tabId, details) {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, ...details });
  } catch (_error) {
    return chrome.scripting.executeScript({ target: { tabId }, ...details });
  }
}

async function insertCssAllFrames(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ['simple-guider.css'],
    });
  } catch (_error) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['simple-guider.css'] });
  }
}

async function guiderIsRunning(tabId) {
  try {
    const results = await executeAllFrames(tabId, {
      func: () => Boolean(globalThis.__POOL_SIMPLE_GUIDER__?.status?.().running),
    });
    return results.some((result) => Boolean(result.result));
  } catch (_error) {
    return false;
  }
}

async function startGuider(tab) {
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) return;
  if (await isChallengePage(tab.id)) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: 'WAIT' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b7791f' });
    return;
  }

  await insertCssAllFrames(tab.id);
  await executeAllFrames(tab.id, { files: SCRIPT_FILES });
  await executeAllFrames(tab.id, { func: () => globalThis.__POOL_SIMPLE_GUIDER__?.start?.() });
  await chrome.action.setBadgeText({ tabId: tab.id, text: 'ON' });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#16803c' });
}

async function stopGuider(tabId) {
  await executeAllFrames(tabId, { func: () => globalThis.__POOL_SIMPLE_GUIDER__?.stop?.() });
  await chrome.action.setBadgeText({ tabId, text: '' });
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (await guiderIsRunning(tab.id)) await stopGuider(tab.id);
    else await startGuider(tab);
  } catch (error) {
    console.error('Pool Simple Guider:', error);
    if (tab?.id) {
      await chrome.action.setBadgeText({ tabId: tab.id, text: 'ERR' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#b42318' });
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});
