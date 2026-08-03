'use strict';

const armedTabs = new Set();

function setBadge(tabId, text) {
  return chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  armedTabs.add(tab.id);
  await setBadge(tab.id, 'ON');
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#16863a' }).catch(() => {});
  chrome.tabs.sendMessage(tab.id, { type: 'GZR_SNAPSHOT_ARMED' }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => armedTabs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  armedTabs.delete(tabId);
  setBadge(tabId, '');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'GZR_CAPTURE_VISIBLE') return false;

  const tab = sender.tab;
  if (!tab?.id || tab.windowId == null) {
    sendResponse({ ok: false, error: 'No active Gamezer tab was found.' });
    return false;
  }
  if (!armedTabs.has(tab.id)) {
    sendResponse({ ok: false, error: 'CLICK_EXTENSION_ICON' });
    return false;
  }

  chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
