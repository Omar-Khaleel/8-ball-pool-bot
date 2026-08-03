'use strict';

const elements = {
  start: document.querySelector('#start'),
  calibrate: document.querySelector('#calibrate'),
  stop: document.querySelector('#stop'),
  status: document.querySelector('#status'),
  showPredictions: document.querySelector('#showPredictions'),
  showBankShots: document.querySelector('#showBankShots'),
  showVelocity: document.querySelector('#showVelocity'),
  colorThreshold: document.querySelector('#colorThreshold'),
  thresholdValue: document.querySelector('#thresholdValue'),
  intervalMs: document.querySelector('#intervalMs'),
  intervalValue: document.querySelector('#intervalValue'),
};

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.classList.toggle('error', isError);
}

function currentSettings() {
  return {
    showPredictions: elements.showPredictions.checked,
    showBankShots: elements.showBankShots.checked,
    showVelocity: elements.showVelocity.checked,
    colorThreshold: Number(elements.colorThreshold.value),
    intervalMs: Number(elements.intervalMs.value),
  };
}

function renderStatus(status) {
  if (!status) return;
  if (status.settings) {
    elements.showPredictions.checked = status.settings.showPredictions !== false;
    elements.showBankShots.checked = status.settings.showBankShots !== false;
    elements.showVelocity.checked = status.settings.showVelocity !== false;
    elements.colorThreshold.value = String(status.settings.colorThreshold || 53);
    elements.intervalMs.value = String(status.settings.intervalMs || 180);
    updateLabels();
  }
  if (status.error) {
    setStatus(status.error, true);
    return;
  }
  if (status.calibrating) {
    setStatus('وضع المعايرة فعال: ارسم مربعًا حول مساحة اللعب داخل الصفحة.');
    return;
  }
  if (status.running) {
    setStatus(`يعمل الآن: ${status.balls} كرة، ${status.moving} متحركة، ${status.shots} مسار محسوب.`);
    return;
  }
  setStatus(status.hasRoi ? 'المعايرة محفوظة. اضغط تشغيل التحليل.' : 'تحتاج إلى معايرة الطاولة أولًا.');
}

function command(commandName, settings) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'POOL_VISION_POPUP_COMMAND', command: commandName, settings },
      (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'Command failed'));
          return;
        }
        resolve(response.status);
      }
    );
  });
}

async function run(commandName, settings) {
  try {
    setStatus('جارٍ الاتصال بالصفحة…');
    const status = await command(commandName, settings);
    renderStatus(status);
    if (commandName === 'calibrate') window.close();
    return status;
  } catch (error) {
    setStatus(error.message, true);
    throw error;
  }
}

function updateLabels() {
  elements.thresholdValue.value = elements.colorThreshold.value;
  elements.thresholdValue.textContent = elements.colorThreshold.value;
  elements.intervalValue.value = `${elements.intervalMs.value} ms`;
  elements.intervalValue.textContent = `${elements.intervalMs.value} ms`;
}

elements.start.addEventListener('click', () => run('start', currentSettings()).catch(() => {}));
elements.calibrate.addEventListener('click', () => run('calibrate', currentSettings()).catch(() => {}));
elements.stop.addEventListener('click', () => run('stop').catch(() => {}));

for (const element of [
  elements.showPredictions,
  elements.showBankShots,
  elements.showVelocity,
  elements.colorThreshold,
  elements.intervalMs,
]) {
  element.addEventListener('input', () => {
    updateLabels();
    run('settings', currentSettings()).catch(() => {});
  });
}

updateLabels();
run('status').catch(() => {});
