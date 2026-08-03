(() => {
  'use strict';

  if (globalThis.__POOL_VISION_ASSISTANT__) return;
  if (!globalThis.PoolVision || !globalThis.PoolVisionGeometry) {
    throw new Error('Pool Vision dependencies were not injected');
  }

  const Vision = globalThis.PoolVision;
  const Geometry = globalThis.PoolVisionGeometry;
  const STORAGE_KEY = `poolVision:${location.origin}`;
  const tracker = new Vision.BallTracker();

  const state = {
    running: false,
    calibrating: false,
    captureInFlight: false,
    roi: null,
    frameTimer: null,
    lastAnalysis: null,
    lastError: null,
    settings: {
      intervalMs: 180,
      colorThreshold: 53,
      showPredictions: true,
      showBankShots: true,
      showVelocity: true,
      maximumShots: 3,
    },
  };

  const root = document.createElement('div');
  root.id = 'pool-vision-root';
  root.setAttribute('aria-hidden', 'true');

  const overlay = document.createElement('canvas');
  overlay.id = 'pool-vision-overlay';

  const panel = document.createElement('div');
  panel.id = 'pool-vision-panel';
  panel.innerHTML = `
    <div class="pva-title">Pool Vision</div>
    <div class="pva-status">Ready</div>
    <div class="pva-meta">Alt+Shift+C: calibrate · Alt+Shift+B: toggle</div>
  `;

  root.append(overlay, panel);
  document.documentElement.appendChild(root);
  const context = overlay.getContext('2d');

  function resizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
      overlay.style.width = `${window.innerWidth}px`;
      overlay.style.height = `${window.innerHeight}px`;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setPanel(status, meta) {
    panel.querySelector('.pva-status').textContent = status;
    if (meta) panel.querySelector('.pva-meta').textContent = meta;
  }

  function saveState() {
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        roi: state.roi,
        settings: state.settings,
      },
    });
  }

  async function loadState() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const saved = result[STORAGE_KEY];
    if (saved?.roi) state.roi = saved.roi;
    if (saved?.settings) state.settings = { ...state.settings, ...saved.settings };
  }

  function normalizeRoi(roi) {
    const x = Math.max(0, Math.min(window.innerWidth - 1, roi.x));
    const y = Math.max(0, Math.min(window.innerHeight - 1, roi.y));
    const width = Math.max(40, Math.min(window.innerWidth - x, roi.width));
    const height = Math.max(40, Math.min(window.innerHeight - y, roi.height));
    return { x, y, width, height };
  }

  function beginCalibration() {
    stop(false);
    state.calibrating = true;
    tracker.reset();
    clearOverlay();
    setPanel('Calibration mode', 'Drag from one table corner to the opposite corner');

    const calibration = document.createElement('div');
    calibration.id = 'pool-vision-calibration';
    calibration.innerHTML = '<div class="pva-calibration-help">اسحب مربعًا حول مساحة اللعب داخل طاولة البلياردو</div>';
    document.documentElement.appendChild(calibration);

    let start = null;
    let box = null;

    const cleanup = () => {
      calibration.remove();
      state.calibrating = false;
    };

    calibration.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      start = { x: event.clientX, y: event.clientY };
      box = document.createElement('div');
      box.className = 'pva-selection-box';
      calibration.appendChild(box);
      calibration.setPointerCapture(event.pointerId);
    });

    calibration.addEventListener('pointermove', (event) => {
      if (!start || !box) return;
      const left = Math.min(start.x, event.clientX);
      const top = Math.min(start.y, event.clientY);
      const width = Math.abs(event.clientX - start.x);
      const height = Math.abs(event.clientY - start.y);
      Object.assign(box.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    });

    calibration.addEventListener('pointerup', (event) => {
      if (!start) return;
      const left = Math.min(start.x, event.clientX);
      const top = Math.min(start.y, event.clientY);
      const width = Math.abs(event.clientX - start.x);
      const height = Math.abs(event.clientY - start.y);
      start = null;
      if (width < 120 || height < 70) {
        box?.remove();
        box = null;
        setPanel('Selection too small', 'Select the full playable cloth area');
        return;
      }
      state.roi = normalizeRoi({ x: left, y: top, width, height });
      saveState();
      cleanup();
      startAnalysis();
    });

    calibration.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      cleanup();
      setPanel('Calibration cancelled', 'Use the extension popup to try again');
    });
  }

  function clearOverlay() {
    resizeOverlay();
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function requestCapture() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'POOL_VISION_CAPTURE' }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.ok || !response.dataUrl) {
          reject(new Error(response?.error || 'Unable to capture the current tab'));
          return;
        }
        resolve(response.dataUrl);
      });
    });
  }

  function decodeImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Captured image could not be decoded'));
      image.src = dataUrl;
    });
  }

  function captureCrop(image) {
    const roi = normalizeRoi(state.roi);
    state.roi = roi;
    const screenshotScaleX = image.naturalWidth / Math.max(window.innerWidth, 1);
    const screenshotScaleY = image.naturalHeight / Math.max(window.innerHeight, 1);
    const sourceX = Math.round(roi.x * screenshotScaleX);
    const sourceY = Math.round(roi.y * screenshotScaleY);
    const sourceWidth = Math.max(1, Math.round(roi.width * screenshotScaleX));
    const sourceHeight = Math.max(1, Math.round(roi.height * screenshotScaleY));
    const analysisScale = Math.min(1, 980 / sourceWidth, 580 / sourceHeight);
    const width = Math.max(80, Math.round(sourceWidth * analysisScale));
    const height = Math.max(40, Math.round(sourceHeight * analysisScale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    return {
      imageData: ctx.getImageData(0, 0, width, height),
      width,
      height,
      transform: {
        roi,
        localToCssX: 1 / (analysisScale * screenshotScaleX),
        localToCssY: 1 / (analysisScale * screenshotScaleY),
      },
    };
  }

  function localToViewport(point, transform) {
    return {
      x: transform.roi.x + point.x * transform.localToCssX,
      y: transform.roi.y + point.y * transform.localToCssY,
    };
  }

  function colorForBall(ball) {
    switch (ball.type) {
      case 'cue':
        return '#ffffff';
      case 'eight':
        return '#171717';
      case 'stripe':
        return '#ffca28';
      case 'solid':
        return '#ff7043';
      default:
        return '#90caf9';
    }
  }

  function drawArrow(start, end, color, lineWidth) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = 8;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }

  function drawShot(shot, transform, rank) {
    const cue = localToViewport(shot.cue, transform);
    const ghost = localToViewport(shot.ghost, transform);
    const objectBall = localToViewport(shot.objectBall, transform);
    const pocket = localToViewport(shot.pocket, transform);
    const hue = rank === 0 ? '#7CFF6B' : rank === 1 ? '#64D8FF' : '#FFD166';

    context.save();
    context.globalAlpha = rank === 0 ? 0.95 : 0.72;
    context.setLineDash(rank === 0 ? [] : [8, 6]);
    drawArrow(cue, ghost, hue, rank === 0 ? 3 : 2);
    context.setLineDash([5, 5]);
    drawArrow(objectBall, shot.kind === 'bank' ? localToViewport(shot.bankPoint, transform) : pocket, hue, 2);
    if (shot.kind === 'bank') {
      const bank = localToViewport(shot.bankPoint, transform);
      drawArrow(bank, pocket, hue, 2);
    }
    context.setLineDash([]);
    context.fillStyle = hue;
    context.font = '600 12px system-ui, sans-serif';
    context.fillText(`${rank + 1} · ${Math.round(shot.score * 100)}%`, ghost.x + 7, ghost.y - 7);
    context.restore();
  }

  function render(analysis) {
    resizeOverlay();
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const { transform, tracks, pockets, radius, shots } = analysis;
    const roi = transform.roi;

    context.save();
    context.strokeStyle = 'rgba(83, 226, 255, 0.9)';
    context.lineWidth = 2;
    context.setLineDash([9, 6]);
    context.strokeRect(roi.x, roi.y, roi.width, roi.height);
    context.setLineDash([]);

    for (const pocket of pockets) {
      const p = localToViewport(pocket, transform);
      context.beginPath();
      context.fillStyle = 'rgba(0, 0, 0, 0.28)';
      context.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      context.arc(p.x, p.y, Math.max(6, pocket.radius * transform.localToCssX), 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    if (state.settings.showPredictions) {
      shots.slice(0, state.settings.maximumShots).forEach((shot, index) => drawShot(shot, transform, index));
    }

    for (const ball of tracks) {
      const p = localToViewport(ball, transform);
      const cssRadius = Math.max(5, radius * (transform.localToCssX + transform.localToCssY) / 2);
      context.beginPath();
      context.fillStyle = `${colorForBall(ball)}33`;
      context.strokeStyle = colorForBall(ball);
      context.lineWidth = ball.type === 'cue' ? 3 : 2;
      context.arc(p.x, p.y, cssRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.fillStyle = '#0b1116';
      context.font = '700 11px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(ball.id), p.x, p.y);

      if (state.settings.showVelocity && ball.speed > radius * 0.45) {
        const velocityScale = 0.055;
        drawArrow(
          p,
          {
            x: p.x + ball.vx * velocityScale * transform.localToCssX,
            y: p.y + ball.vy * velocityScale * transform.localToCssY,
          },
          '#ff4d6d',
          2
        );
      }
    }
    context.restore();
  }

  async function analyzeFrame() {
    if (!state.running || state.captureInFlight || !state.roi) return;
    state.captureInFlight = true;
    try {
      const dataUrl = await requestCapture();
      const image = await decodeImage(dataUrl);
      const crop = captureCrop(image);
      const detected = Vision.analyze(crop.imageData, crop.width, crop.height, {
        colorThreshold: state.settings.colorThreshold,
      });
      const tracks = tracker.update(detected.balls, performance.now(), detected.radius);
      const movingCount = tracks.filter((ball) => ball.moving).length;
      const shots = movingCount === 0
        ? Geometry.recommendShots({
            balls: tracks,
            pockets: detected.pockets,
            width: detected.width,
            height: detected.height,
            radius: detected.radius,
            includeBanks: state.settings.showBankShots,
          })
        : [];

      state.lastAnalysis = {
        ...detected,
        ...crop,
        tracks,
        movingCount,
        shots,
        timestamp: Date.now(),
      };
      state.lastError = null;
      render(state.lastAnalysis);
      const cueFound = tracks.some((ball) => ball.type === 'cue');
      const motionText = movingCount ? `${movingCount} moving` : 'table stable';
      setPanel(
        `${tracks.length} balls · ${motionText}`,
        cueFound
          ? `${shots.length} shot paths · capture every ${state.settings.intervalMs} ms`
          : 'Cue ball not confidently identified; adjust calibration or threshold'
      );
    } catch (error) {
      state.lastError = error.message;
      setPanel('Capture error', error.message);
    } finally {
      state.captureInFlight = false;
    }
  }

  function scheduleLoop() {
    clearTimeout(state.frameTimer);
    if (!state.running) return;
    state.frameTimer = setTimeout(async () => {
      await analyzeFrame();
      scheduleLoop();
    }, state.settings.intervalMs);
  }

  function startAnalysis() {
    if (!state.roi) {
      beginCalibration();
      return;
    }
    state.running = true;
    state.calibrating = false;
    root.classList.add('pva-active');
    setPanel('Starting analysis…', 'Keep the game tab visible');
    analyzeFrame();
    scheduleLoop();
  }

  function stop(clear = true) {
    state.running = false;
    state.captureInFlight = false;
    clearTimeout(state.frameTimer);
    state.frameTimer = null;
    root.classList.remove('pva-active');
    if (clear) clearOverlay();
    setPanel('Paused', 'Use the extension popup or Alt+Shift+B to resume');
  }

  function status() {
    return {
      installed: true,
      running: state.running,
      calibrating: state.calibrating,
      hasRoi: Boolean(state.roi),
      roi: state.roi,
      settings: state.settings,
      balls: state.lastAnalysis?.tracks?.length || 0,
      moving: state.lastAnalysis?.movingCount || 0,
      shots: state.lastAnalysis?.shots?.length || 0,
      error: state.lastError,
    };
  }

  async function handleCommand(message) {
    switch (message.command) {
      case 'start':
        if (message.settings) state.settings = { ...state.settings, ...message.settings };
        startAnalysis();
        break;
      case 'stop':
        stop();
        break;
      case 'calibrate':
        if (message.settings) state.settings = { ...state.settings, ...message.settings };
        beginCalibration();
        break;
      case 'toggle':
        state.running ? stop() : startAnalysis();
        break;
      case 'settings':
        state.settings = { ...state.settings, ...(message.settings || {}) };
        saveState();
        if (state.running) scheduleLoop();
        break;
      case 'status':
        break;
      default:
        throw new Error(`Unknown Pool Vision command: ${message.command}`);
    }
    return status();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'POOL_VISION_COMMAND') return false;
    handleCommand(message)
      .then((result) => sendResponse({ ok: true, status: result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  window.addEventListener('resize', () => {
    if (state.roi) state.roi = normalizeRoi(state.roi);
    if (state.lastAnalysis) render(state.lastAnalysis);
    else resizeOverlay();
  });

  window.addEventListener('keydown', (event) => {
    if (!(event.altKey && event.shiftKey)) return;
    if (event.code === 'KeyB') {
      event.preventDefault();
      state.running ? stop() : startAnalysis();
    }
    if (event.code === 'KeyC') {
      event.preventDefault();
      beginCalibration();
    }
  });

  globalThis.__POOL_VISION_ASSISTANT__ = {
    status,
    start: startAnalysis,
    stop,
    calibrate: beginCalibration,
  };

  loadState()
    .then(() => {
      resizeOverlay();
      setPanel(state.roi ? 'Ready' : 'Calibration required', state.roi ? 'Open the extension popup to start' : 'Select the table once');
    })
    .catch((error) => setPanel('Storage error', error.message));
})();
