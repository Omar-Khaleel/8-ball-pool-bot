(() => {
  'use strict';

  const Physics = globalThis.GamezerRayPhysics;
  if (!Physics || globalThis.__GAMEZER_SNAPSHOT_GUIDER__) return;
  globalThis.__GAMEZER_SNAPSHOT_GUIDER__ = true;

  const MESSAGE_MARK = '__GAMEZER_SNAPSHOT_GUIDER_FRAME__';
  const isTop = window.top === window;
  let localPointer = null;
  let pointerRelayFrame = 0;

  function relayToParent(payload) {
    if (isTop) {
      handleTopMessage({
        ...payload,
        x: payload.x ?? localPointer?.x ?? 0,
        y: payload.y ?? localPointer?.y ?? 0,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      });
      return;
    }
    window.parent.postMessage({
      [MESSAGE_MARK]: true,
      ...payload,
      x: payload.x ?? localPointer?.x ?? 0,
      y: payload.y ?? localPointer?.y ?? 0,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    }, '*');
  }

  function frameForSource(source) {
    for (const element of document.querySelectorAll('iframe, frame')) {
      try {
        if (element.contentWindow === source) return element;
      } catch (_error) {
        // Cross-origin access is not needed for identity comparison.
      }
    }
    return null;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message?.[MESSAGE_MARK]) return;
    const frame = frameForSource(event.source);
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    const scaleX = rect.width / Math.max(1, message.viewportWidth || rect.width);
    const scaleY = rect.height / Math.max(1, message.viewportHeight || rect.height);
    const mapped = {
      ...message,
      x: rect.left + message.x * scaleX,
      y: rect.top + message.y * scaleY,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
    delete mapped[MESSAGE_MARK];
    relayToParent(mapped);
  }, true);

  window.addEventListener('pointermove', (event) => {
    localPointer = { x: event.clientX, y: event.clientY };
    if (pointerRelayFrame) return;
    pointerRelayFrame = requestAnimationFrame(() => {
      pointerRelayFrame = 0;
      relayToParent({ type: 'pointer' });
    });
  }, true);

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (!['c', 'r', 'g', 'escape'].includes(key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    relayToParent({ type: key === 'c' ? 'select' : 'control', control: key });
  }, true);

  if (!isTop) return;

  const overlay = document.createElement('canvas');
  overlay.id = 'gamezer-snapshot-guider-overlay';
  (document.documentElement || document).appendChild(overlay);
  const context = overlay.getContext('2d');

  const statusNode = document.createElement('div');
  statusNode.id = 'gamezer-snapshot-guider-status';
  statusNode.style.display = 'none';
  (document.documentElement || document).appendChild(statusNode);

  const analysisCanvas = document.createElement('canvas');
  const analysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true });

  const state = {
    armed: false,
    enabled: true,
    reverse: true,
    pointerCss: null,
    imageData: null,
    width: 0,
    height: 0,
    scaleX: 1,
    scaleY: 1,
    cue: null,
    radius: 12,
    tableColor: null,
    tableRect: null,
    balls: [],
    statusTimer: 0,
  };

  function setStatus(text, mode = 'info', timeout = 0) {
    clearTimeout(state.statusTimer);
    statusNode.textContent = text;
    statusNode.dataset.mode = mode;
    statusNode.style.display = text ? 'block' : 'none';
    if (timeout > 0) {
      state.statusTimer = setTimeout(() => {
        statusNode.style.display = 'none';
      }, timeout);
    }
  }

  function resizeOverlay() {
    const dpr = devicePixelRatio || 1;
    const width = Math.max(1, Math.round(innerWidth * dpr));
    const height = Math.max(1, Math.round(innerHeight * dpr));
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
      overlay.style.width = `${innerWidth}px`;
      overlay.style.height = `${innerHeight}px`;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function clearOverlay() {
    resizeOverlay();
    context.clearRect(0, 0, innerWidth, innerHeight);
  }

  function waitFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function requestSnapshot() {
    const oldOverlayDisplay = overlay.style.display;
    const oldStatusDisplay = statusNode.style.display;
    overlay.style.display = 'none';
    statusNode.style.display = 'none';
    await waitFrame();
    await waitFrame();
    try {
      return await chrome.runtime.sendMessage({ type: 'GZR_CAPTURE_VISIBLE' });
    } finally {
      overlay.style.display = oldOverlayDisplay || 'block';
      statusNode.style.display = oldStatusDisplay;
    }
  }

  function decodeImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The captured Gamezer frame could not be decoded.'));
      image.src = dataUrl;
    });
  }

  function pixelAt(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!state.imageData || ix < 0 || iy < 0 || ix >= state.width || iy >= state.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const index = (iy * state.width + ix) * 4;
    const data = state.imageData.data;
    return { r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] };
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

  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function cssToAnalysis(point) {
    return { x: point.x * state.scaleX, y: point.y * state.scaleY };
  }

  function analysisToCss(point) {
    return { x: point.x / state.scaleX, y: point.y / state.scaleY };
  }

  function refineCue(seed) {
    const expectedRadius = Math.max(8, Math.min(state.width, state.height) / 42);
    const searchRadius = expectedRadius * 1.9;
    let sumX = 0;
    let sumY = 0;
    let weightSum = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let y = Math.max(0, Math.floor(seed.y - searchRadius)); y <= Math.min(state.height - 1, Math.ceil(seed.y + searchRadius)); y += 1) {
      for (let x = Math.max(0, Math.floor(seed.x - searchRadius)); x <= Math.min(state.width - 1, Math.ceil(seed.x + searchRadius)); x += 1) {
        const dx = x - seed.x;
        const dy = y - seed.y;
        if (dx * dx + dy * dy > searchRadius * searchRadius) continue;
        const pixel = pixelAt(x, y);
        const lum = luminance(pixel);
        const sat = saturation(pixel);
        if (lum < 142 || sat > 0.43) continue;
        const weight = Math.max(1, lum - 125) * (1 - sat * 0.65);
        sumX += x * weight;
        sumY += y * weight;
        weightSum += weight;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    if (weightSum < 220) return null;
    const center = { x: sumX / weightSum, y: sumY / weightSum };
    const brightWidth = Number.isFinite(minX) ? maxX - minX + 1 : expectedRadius * 2;
    const brightHeight = Number.isFinite(minY) ? maxY - minY + 1 : expectedRadius * 2;
    const radius = Physics.clamp(Math.max(brightWidth, brightHeight) * 0.58, expectedRadius * 0.72, expectedRadius * 1.45);
    return { center, radius };
  }

  function estimateTableColor(cue, radius) {
    const bins = new Map();
    for (let index = 0; index < 96; index += 1) {
      const angle = (index / 96) * Math.PI * 2;
      for (const multiplier of [2.2, 2.8, 3.5, 4.2]) {
        const pixel = pixelAt(cue.x + Math.cos(angle) * radius * multiplier, cue.y + Math.sin(angle) * radius * multiplier);
        const lum = luminance(pixel);
        const sat = saturation(pixel);
        if (!pixel.a || lum < 24 || lum > 235 || sat < 0.14) continue;
        const key = `${pixel.r >> 4}:${pixel.g >> 4}:${pixel.b >> 4}`;
        const current = bins.get(key) || { count: 0, r: [], g: [], b: [] };
        current.count += 1;
        current.r.push(pixel.r);
        current.g.push(pixel.g);
        current.b.push(pixel.b);
        bins.set(key, current);
      }
    }
    let best = null;
    for (const entry of bins.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    if (!best) return { r: 31, g: 128, b: 91 };
    return { r: median(best.r), g: median(best.g), b: median(best.b) };
  }

  function estimateTableRect(cue, tableColor, radius) {
    const step = Math.max(4, Math.round(radius * 0.42));
    const gridWidth = Math.ceil(state.width / step);
    const gridHeight = Math.ceil(state.height / step);
    const mask = new Uint8Array(gridWidth * gridHeight);

    for (let gy = 0; gy < gridHeight; gy += 1) {
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const pixel = pixelAt(gx * step, gy * step);
        if (pixel.a && colorDistance(pixel, tableColor) < 64) mask[gy * gridWidth + gx] = 1;
      }
    }

    const queue = [];
    const visited = new Uint8Array(mask.length);
    for (let i = 0; i < 32; i += 1) {
      const angle = (i / 32) * Math.PI * 2;
      const gx = Math.round((cue.x + Math.cos(angle) * radius * 2.6) / step);
      const gy = Math.round((cue.y + Math.sin(angle) * radius * 2.6) / step);
      if (gx < 0 || gy < 0 || gx >= gridWidth || gy >= gridHeight) continue;
      const idx = gy * gridWidth + gx;
      if (!mask[idx] || visited[idx]) continue;
      visited[idx] = 1;
      queue.push({ x: gx, y: gy });
    }

    let head = 0;
    let minX = gridWidth;
    let maxX = -1;
    let minY = gridHeight;
    let maxY = -1;
    let count = 0;
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
        const idx = ny * gridWidth + nx;
        if (!mask[idx] || visited[idx]) continue;
        visited[idx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }

    if (count < 100 || maxX <= minX || maxY <= minY) {
      return { x: radius, y: radius, width: state.width - radius * 2, height: state.height - radius * 2 };
    }
    const margin = radius * 0.35;
    const x = Math.max(0, minX * step - margin);
    const y = Math.max(0, minY * step - margin);
    const right = Math.min(state.width, (maxX + 1) * step + margin);
    const bottom = Math.min(state.height, (maxY + 1) * step + margin);
    return { x, y, width: right - x, height: bottom - y };
  }

  function dilate(mask, width, height, iterations) {
    let current = mask;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const next = new Uint8Array(current);
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (current[index]) continue;
          if (current[index - 1] || current[index + 1] || current[index - width] || current[index + width]) {
            next[index] = 1;
          }
        }
      }
      current = next;
    }
    return current;
  }

  function detectBalls(cue, radius, tableColor, tableRect) {
    const left = Math.max(1, Math.floor(tableRect.x + radius * 0.55));
    const right = Math.min(state.width - 2, Math.ceil(tableRect.x + tableRect.width - radius * 0.55));
    const top = Math.max(1, Math.floor(tableRect.y + radius * 0.55));
    const bottom = Math.min(state.height - 2, Math.ceil(tableRect.y + tableRect.height - radius * 0.55));
    const mask = new Uint8Array(state.width * state.height);

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (Physics.distance({ x, y }, cue) < radius * 1.65) continue;
        const pixel = pixelAt(x, y);
        const lum = luminance(pixel);
        if (!pixel.a || lum < 16) continue;
        if (colorDistance(pixel, tableColor) > 45) mask[y * state.width + x] = 1;
      }
    }

    const expanded = dilate(mask, state.width, state.height, Math.max(1, Math.round(radius / 10)));
    const visited = new Uint8Array(expanded.length);
    const components = [];
    const queue = [];

    for (let startY = top; startY <= bottom; startY += 1) {
      for (let startX = left; startX <= right; startX += 1) {
        const startIndex = startY * state.width + startX;
        if (!expanded[startIndex] || visited[startIndex]) continue;
        queue.length = 0;
        queue.push(startIndex);
        visited[startIndex] = 1;
        let head = 0;
        let area = 0;
        let sumX = 0;
        let sumY = 0;
        let minX = startX;
        let maxX = startX;
        let minY = startY;
        let maxY = startY;

        while (head < queue.length) {
          const index = queue[head++];
          const x = index % state.width;
          const y = Math.floor(index / state.width);
          area += 1;
          sumX += x;
          sumY += y;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              if (!ox && !oy) continue;
              const nx = x + ox;
              const ny = y + oy;
              if (nx < left || nx > right || ny < top || ny > bottom) continue;
              const nextIndex = ny * state.width + nx;
              if (!expanded[nextIndex] || visited[nextIndex]) continue;
              visited[nextIndex] = 1;
              queue.push(nextIndex);
            }
          }
        }

        const width = maxX - minX + 1;
        const height = maxY - minY + 1;
        const aspect = width / Math.max(1, height);
        const componentRadius = Math.max(width, height) / 2;
        const circleArea = Math.PI * radius * radius;
        if (componentRadius < radius * 0.48 || componentRadius > radius * 1.85) continue;
        if (aspect < 0.48 || aspect > 2.08) continue;
        if (area < circleArea * 0.16 || area > circleArea * 3.2) continue;
        components.push({ x: sumX / area, y: sumY / area, radius, area });
      }
    }

    components.sort((a, b) => b.area - a.area);
    const deduplicated = [];
    for (const ball of components) {
      if (deduplicated.some((existing) => Physics.distance(existing, ball) < radius * 1.1)) continue;
      deduplicated.push(ball);
    }
    return deduplicated;
  }

  function drawLine(start, end, color, width) {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.shadowColor = 'rgba(0, 0, 0, 0.75)';
    context.shadowBlur = 3;
    context.stroke();
    context.shadowBlur = 0;
  }

  function updateGuide() {
    clearOverlay();
    if (!state.enabled || !state.cue || !state.pointerCss || !state.tableRect) return;
    const mouse = cssToAnalysis(state.pointerCss);
    let direction = Physics.normalize(Physics.sub(mouse, state.cue));
    if (state.reverse) direction = Physics.scale(direction, -1);
    if (Physics.length(direction) < 0.01) return;

    let best = null;
    for (const ball of state.balls) {
      const t = Physics.rayCircle(state.cue, direction, ball, state.radius * 2, state.radius * 0.55);
      if (t == null) continue;
      if (!best || t < best.t) best = { ball, t };
    }

    const cueStart = Physics.sub(state.cue, Physics.scale(direction, state.radius * 4.3));
    if (!best) {
      const rail = Physics.firstRectHit(state.cue, direction, state.tableRect, state.radius);
      if (!rail) return;
      drawLine(analysisToCss(cueStart), analysisToCss(rail), 'rgba(255,255,255,0.96)', 2.8);
      return;
    }

    const collision = Physics.collisionResult(state.cue, best.ball, direction, state.radius);
    if (!collision) return;
    const endpoint = Physics.targetEndpoint(best.ball, collision.targetDirection, state.tableRect, state.radius);
    if (!endpoint) return;

    drawLine(analysisToCss(cueStart), analysisToCss(collision.cueAtContact), 'rgba(255,255,255,0.97)', 2.8);
    drawLine(
      analysisToCss(best.ball),
      analysisToCss(endpoint.point),
      endpoint.outcome === 'pocket' ? 'rgba(72,255,112,0.98)' : 'rgba(255,207,62,0.98)',
      3.1
    );
  }

  async function captureAndSelect(pointCss) {
    state.pointerCss = pointCss;
    setStatus('Taking one clean snapshot…', 'info');
    let response;
    try {
      response = await requestSnapshot();
    } catch (error) {
      setStatus(error.message || 'Snapshot failed.', 'error');
      return;
    }
    if (!response?.ok) {
      if (response?.error === 'CLICK_EXTENSION_ICON') {
        setStatus('Click the extension icon once, then hover the white ball and press C.', 'error');
      } else {
        setStatus(response?.error || 'Snapshot failed.', 'error');
      }
      return;
    }

    try {
      const image = await decodeImage(response.dataUrl);
      const scale = Math.min(1, 1280 / image.naturalWidth, 820 / image.naturalHeight);
      state.width = Math.max(320, Math.round(image.naturalWidth * scale));
      state.height = Math.max(180, Math.round(image.naturalHeight * scale));
      analysisCanvas.width = state.width;
      analysisCanvas.height = state.height;
      analysisContext.clearRect(0, 0, state.width, state.height);
      analysisContext.drawImage(image, 0, 0, state.width, state.height);
      state.imageData = analysisContext.getImageData(0, 0, state.width, state.height);
      state.scaleX = state.width / Math.max(1, innerWidth);
      state.scaleY = state.height / Math.max(1, innerHeight);

      const seed = cssToAnalysis(pointCss);
      const refined = refineCue(seed);
      if (!refined) {
        setStatus('The white ball was not found under the cursor. Move to its center and press C again.', 'error');
        return;
      }
      state.cue = refined.center;
      state.radius = refined.radius;
      state.tableColor = estimateTableColor(state.cue, state.radius);
      state.tableRect = estimateTableRect(state.cue, state.tableColor, state.radius);
      state.balls = detectBalls(state.cue, state.radius, state.tableColor, state.tableRect);
      updateGuide();
      setStatus(`Ready — ${state.balls.length} object balls found. Aim normally.`, 'ready', 1400);
    } catch (error) {
      setStatus(error.message || 'The snapshot could not be analyzed.', 'error');
    }
  }

  function handleTopMessage(message) {
    if (message.type === 'pointer') {
      state.pointerCss = { x: message.x, y: message.y };
      updateGuide();
      return;
    }
    if (message.type === 'select') {
      captureAndSelect({ x: message.x, y: message.y });
      return;
    }
    if (message.type !== 'control') return;
    if (message.control === 'r') {
      state.reverse = !state.reverse;
      updateGuide();
      setStatus(state.reverse ? 'Aim direction: away from the mouse' : 'Aim direction: toward the mouse', 'info', 900);
    } else if (message.control === 'g') {
      state.enabled = !state.enabled;
      updateGuide();
      setStatus(state.enabled ? 'Guide ON' : 'Guide OFF', 'info', 700);
    } else if (message.control === 'escape') {
      state.cue = null;
      state.balls = [];
      clearOverlay();
      setStatus('Snapshot cleared. Hover the white ball and press C.', 'info', 1200);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'GZR_SNAPSHOT_ARMED') return;
    state.armed = true;
    setStatus('Armed — hover the white ball and press C. Do not click it.', 'ready', 1800);
  });

  window.addEventListener('resize', updateGuide);
  resizeOverlay();
  setTimeout(() => {
    setStatus('Click the extension icon once to arm it.', 'info', 2200);
  }, 900);
})();
