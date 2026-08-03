(() => {
  'use strict';

  const api = globalThis.__GAMEZER_RAY_GUIDER__;
  if (!api || globalThis.__GAMEZER_RAY_GUIDER_COMPAT__) return;
  globalThis.__GAMEZER_RAY_GUIDER_COMPAT__ = true;

  const state = api.state;
  const Physics = globalThis.GamezerRayPhysics;
  const workCanvas = document.createElement('canvas');
  const workContext = workCanvas.getContext('2d', { willReadFrequently: true });
  let mouseClient = null;
  let lastCaptureAt = 0;
  let statusNode = null;
  let topReady = false;

  function visibleCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement) || canvas.id === 'gamezer-ray-guider-overlay') return false;
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    return rect.width >= 280 && rect.height >= 150 &&
      style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }

  function collectCanvases(root, result) {
    if (!root?.querySelectorAll) return;
    for (const canvas of root.querySelectorAll('canvas')) result.push(canvas);
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) collectCanvases(element.shadowRoot, result);
    }
  }

  function findCanvas() {
    if (state.canvas?.isConnected && visibleCanvas(state.canvas)) return state.canvas;
    const canvases = [];
    collectCanvases(document, canvases);
    canvases.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    return canvases.find(visibleCanvas) || null;
  }

  function ensureStatus() {
    if (statusNode?.isConnected) return statusNode;
    const root = document.documentElement || document.body;
    if (!root) return null;
    statusNode = document.createElement('div');
    statusNode.id = 'gamezer-ray-guider-status';
    root.appendChild(statusNode);
    return statusNode;
  }

  function setStatus(text, mode = 'info') {
    const node = ensureStatus();
    if (!node) return;
    node.textContent = text;
    node.dataset.mode = mode;
    node.style.display = text ? 'block' : 'none';
  }

  function frameLooksUsable(data, width, height) {
    let visible = 0;
    let varied = 0;
    let previous = null;
    const stepX = Math.max(1, Math.floor(width / 16));
    const stepY = Math.max(1, Math.floor(height / 10));
    for (let y = Math.floor(stepY / 2); y < height; y += stepY) {
      for (let x = Math.floor(stepX / 2); x < width; x += stepX) {
        const index = (y * width + x) * 4;
        const current = [data[index], data[index + 1], data[index + 2], data[index + 3]];
        if (current[3] && current[0] + current[1] + current[2] > 8) visible += 1;
        if (previous && Math.abs(current[0] - previous[0]) + Math.abs(current[1] - previous[1]) + Math.abs(current[2] - previous[2]) > 12) varied += 1;
        previous = current;
      }
    }
    return visible >= 8 && varied >= 3;
  }

  function captureCanvas(force = false) {
    const now = performance.now();
    if (!force && now - lastCaptureAt < 90) return Boolean(state.frameTopDown);
    lastCaptureAt = now;
    const canvas = findCanvas();
    if (!canvas || !workContext) return false;

    const width = Math.max(1, canvas.width || Math.round(canvas.getBoundingClientRect().width));
    const height = Math.max(1, canvas.height || Math.round(canvas.getBoundingClientRect().height));
    try {
      if (workCanvas.width !== width || workCanvas.height !== height) {
        workCanvas.width = width;
        workCanvas.height = height;
      }
      workContext.clearRect(0, 0, width, height);
      workContext.drawImage(canvas, 0, 0, width, height);
      const image = workContext.getImageData(0, 0, width, height);
      if (!frameLooksUsable(image.data, width, height)) return false;
      state.canvas = canvas;
      state.frameTopDown = image.data;
      state.frameWidth = width;
      state.frameHeight = height;
      state.source = { type: 'bitmap-fallback', context: workContext };
      try {
        window.top.postMessage({ type: 'GAMEZER_GUIDER_CANVAS_READY' }, '*');
      } catch (_error) {
        // Ignore cross-frame notification errors.
      }
      return true;
    } catch (_error) {
      return false;
    }
  }

  function pixelAt(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!state.frameTopDown || ix < 0 || iy < 0 || ix >= state.frameWidth || iy >= state.frameHeight) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const index = (iy * state.frameWidth + ix) * 4;
    return {
      r: state.frameTopDown[index],
      g: state.frameTopDown[index + 1],
      b: state.frameTopDown[index + 2],
      a: state.frameTopDown[index + 3]
    };
  }

  function luminance(pixel) {
    return pixel.r * 0.2126 + pixel.g * 0.7152 + pixel.b * 0.0722;
  }

  function saturation(pixel) {
    const maximum = Math.max(pixel.r, pixel.g, pixel.b);
    const minimum = Math.min(pixel.r, pixel.g, pixel.b);
    return maximum ? (maximum - minimum) / maximum : 0;
  }

  function colorDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr * 0.8 + dg * dg * 1.2 + db * db * 0.8);
  }

  function clientToFrame(point) {
    const canvas = state.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((point.x - rect.left) / rect.width) * state.frameWidth,
      y: ((point.y - rect.top) / rect.height) * state.frameHeight
    };
  }

  function refineWhiteCenter(seed, searchRadius) {
    let sumX = 0;
    let sumY = 0;
    let weightSum = 0;
    const minX = Math.max(0, Math.floor(seed.x - searchRadius));
    const maxX = Math.min(state.frameWidth - 1, Math.ceil(seed.x + searchRadius));
    const minY = Math.max(0, Math.floor(seed.y - searchRadius));
    const maxY = Math.min(state.frameHeight - 1, Math.ceil(seed.y + searchRadius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - seed.x;
        const dy = y - seed.y;
        if (dx * dx + dy * dy > searchRadius * searchRadius) continue;
        const pixel = pixelAt(x, y);
        const lum = luminance(pixel);
        const sat = saturation(pixel);
        if (lum < 135 || sat > 0.48) continue;
        const weight = Math.max(1, lum - 120) * (1 - sat * 0.7);
        sumX += x * weight;
        sumY += y * weight;
        weightSum += weight;
      }
    }
    return weightSum ? { x: sumX / weightSum, y: sumY / weightSum } : null;
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  }

  function estimateTableColor(center, radius) {
    const colors = [];
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * Math.PI * 2;
      for (const multiplier of [2.2, 2.8, 3.4]) {
        const pixel = pixelAt(
          center.x + Math.cos(angle) * radius * multiplier,
          center.y + Math.sin(angle) * radius * multiplier
        );
        if (pixel.a && luminance(pixel) > 18) colors.push(pixel);
      }
    }
    return colors.length ? {
      r: median(colors.map((p) => p.r)),
      g: median(colors.map((p) => p.g)),
      b: median(colors.map((p) => p.b))
    } : { r: 35, g: 122, b: 86 };
  }

  function estimateTableRect(cue, tableColor, radius) {
    const step = Math.max(4, Math.round(radius * 0.5));
    const gridWidth = Math.ceil(state.frameWidth / step);
    const gridHeight = Math.ceil(state.frameHeight / step);
    const mask = new Uint8Array(gridWidth * gridHeight);
    for (let gy = 0; gy < gridHeight; gy += 1) {
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const pixel = pixelAt(gx * step, gy * step);
        if (pixel.a && colorDistance(pixel, tableColor) < 52) mask[gy * gridWidth + gx] = 1;
      }
    }

    const seeds = [];
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      const x = Math.round((cue.x + Math.cos(angle) * radius * 2.7) / step);
      const y = Math.round((cue.y + Math.sin(angle) * radius * 2.7) / step);
      if (x >= 0 && y >= 0 && x < gridWidth && y < gridHeight && mask[y * gridWidth + x]) seeds.push({ x, y });
    }
    if (!seeds.length) return { x: 0, y: 0, width: state.frameWidth, height: state.frameHeight };

    const visited = new Uint8Array(mask.length);
    const queue = [...seeds];
    let head = 0;
    let minX = gridWidth;
    let maxX = 0;
    let minY = gridHeight;
    let maxY = 0;
    let count = 0;
    for (const seed of seeds) visited[seed.y * gridWidth + seed.x] = 1;
    while (head < queue.length) {
      const point = queue[head++];
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      count += 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = point.x + dx;
        const ny = point.y + dy;
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        const index = ny * gridWidth + nx;
        if (visited[index] || !mask[index]) continue;
        visited[index] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
    if (count < 80) return { x: 0, y: 0, width: state.frameWidth, height: state.frameHeight };
    const margin = radius * 0.6;
    const x = Math.max(0, minX * step - margin);
    const y = Math.max(0, minY * step - margin);
    const right = Math.min(state.frameWidth, (maxX + 1) * step + margin);
    const bottom = Math.min(state.frameHeight, (maxY + 1) * step + margin);
    return { x, y, width: right - x, height: bottom - y };
  }

  function selectCueUnderCursor() {
    if (!mouseClient) {
      setStatus('Move the cursor over the white ball, then press C', 'error');
      return;
    }
    if (!captureCanvas(true)) {
      setStatus('Canvas found, but its pixels could not be read', 'error');
      return;
    }
    const point = clientToFrame(mouseClient);
    if (!point) return;
    const radius = Math.max(7, Math.min(state.frameWidth, state.frameHeight) / 42);
    const center = refineWhiteCenter(point, radius * 1.9);
    if (!center) {
      setStatus('White ball not found under the cursor — move closer to its center and press C', 'error');
      return;
    }
    state.cue = center;
    state.radius = radius;
    state.tableColor = estimateTableColor(center, radius);
    state.tableRect = estimateTableRect(center, state.tableColor, radius);
    state.guide = null;
    state.lastGoodGuideAt = 0;
    setStatus('Cue selected — move the mouse to aim', 'ready');
    setTimeout(() => setStatus(''), 1100);
  }

  window.addEventListener('pointermove', (event) => {
    mouseClient = { x: event.clientX, y: event.clientY };
  }, true);

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'c') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectCueUnderCursor();
  }, true);

  if (window.top === window) {
    window.addEventListener('message', (event) => {
      if (event.data?.type !== 'GAMEZER_GUIDER_CANVAS_READY') return;
      topReady = true;
      setStatus('');
    });
    setTimeout(() => {
      if (!topReady && !findCanvas()) {
        setStatus('Gamezer Guider loaded — waiting for the game frame', 'info');
      }
    }, 1600);
  }

  setInterval(() => {
    const available = captureCanvas(false);
    if (available && !state.cue) setStatus('Guider ready — hover the white ball and press C', 'ready');
  }, 95);
})();
