(() => {
  'use strict';

  if (globalThis.__GAMEZER_RAY_GUIDER__) return;
  const Physics = globalThis.GamezerRayPhysics;
  if (!Physics) throw new Error('GamezerRayPhysics was not loaded');

  const contextByCanvas = new WeakMap();
  const originalCanvasGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, attributes) {
    const kind = String(type || '').toLowerCase();
    const options = attributes ? { ...attributes } : {};
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') {
      options.preserveDrawingBuffer = true;
    }
    const context = originalCanvasGetContext.call(this, type, options);
    if (context) contextByCanvas.set(this, { type: kind, context });
    return context;
  };

  const state = {
    enabled: true,
    reversed: false,
    canvas: null,
    source: null,
    overlay: null,
    overlayContext: null,
    mouseClient: null,
    cue: null,
    radius: null,
    tableColor: null,
    tableRect: null,
    lastFrameReadAt: 0,
    lastCanvasSearchAt: 0,
    lastGoodGuideAt: 0,
    guide: null,
    rawPixels: null,
    frameWidth: 0,
    frameHeight: 0,
    frameTopDown: null,
    animationFrame: 0
  };

  function colorDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr * 0.8 + dg * dg * 1.2 + db * db * 0.8);
  }

  function luminance(pixel) {
    return pixel.r * 0.2126 + pixel.g * 0.7152 + pixel.b * 0.0722;
  }

  function saturation(pixel) {
    const maximum = Math.max(pixel.r, pixel.g, pixel.b);
    const minimum = Math.min(pixel.r, pixel.g, pixel.b);
    return maximum ? (maximum - minimum) / maximum : 0;
  }

  function ensureOverlay() {
    if (state.overlay?.isConnected) return;
    const overlay = document.createElement('canvas');
    overlay.id = 'gamezer-ray-guider-overlay';
    (document.documentElement || document.body).appendChild(overlay);
    state.overlay = overlay;
    state.overlayContext = overlay.getContext('2d');
    resizeOverlay();
  }

  function resizeOverlay() {
    if (!state.overlay) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(innerWidth * dpr));
    const height = Math.max(1, Math.round(innerHeight * dpr));
    if (state.overlay.width !== width || state.overlay.height !== height) {
      state.overlay.width = width;
      state.overlay.height = height;
      state.overlay.style.width = `${innerWidth}px`;
      state.overlay.style.height = `${innerHeight}px`;
    }
    state.overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function visibleCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement) || canvas === state.overlay) return false;
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    return (
      rect.width >= 420 &&
      rect.height >= 240 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0
    );
  }

  function collectCanvases(root, output) {
    if (!root?.querySelectorAll) return;
    for (const canvas of root.querySelectorAll('canvas')) output.push(canvas);
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) collectCanvases(element.shadowRoot, output);
    }
  }

  function findCanvas(now) {
    if (state.canvas?.isConnected && visibleCanvas(state.canvas) && now - state.lastCanvasSearchAt < 1500) {
      return state.canvas;
    }
    state.lastCanvasSearchAt = now;
    const canvases = [];
    collectCanvases(document, canvases);
    canvases.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    state.canvas = canvases.find(visibleCanvas) || null;
    return state.canvas;
  }

  function resolveSource(canvas) {
    const recorded = contextByCanvas.get(canvas);
    if (recorded) return recorded;

    for (const type of ['webgl2', 'webgl', 'experimental-webgl', '2d']) {
      try {
        const context = originalCanvasGetContext.call(
          canvas,
          type,
          type === '2d' ? undefined : { preserveDrawingBuffer: true }
        );
        if (context) {
          const source = { type, context };
          contextByCanvas.set(canvas, source);
          return source;
        }
      } catch (_error) {
        // Try the next context type.
      }
    }
    return null;
  }

  function readFrame(now) {
    const canvas = findCanvas(now);
    if (!canvas) return false;
    const source = resolveSource(canvas);
    if (!source) return false;
    state.source = source;

    try {
      if (source.type === '2d') {
        const width = canvas.width;
        const height = canvas.height;
        const image = source.context.getImageData(0, 0, width, height);
        state.frameTopDown = image.data;
        state.frameWidth = width;
        state.frameHeight = height;
        return true;
      }

      const gl = source.context;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const needed = width * height * 4;
      if (!state.rawPixels || state.rawPixels.length !== needed) {
        state.rawPixels = new Uint8Array(needed);
        state.frameTopDown = new Uint8ClampedArray(needed);
      }
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, state.rawPixels);
      const rowBytes = width * 4;
      for (let sourceY = 0; sourceY < height; sourceY += 1) {
        const targetY = height - 1 - sourceY;
        state.frameTopDown.set(
          state.rawPixels.subarray(sourceY * rowBytes, sourceY * rowBytes + rowBytes),
          targetY * rowBytes
        );
      }
      state.frameWidth = width;
      state.frameHeight = height;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function pixelAt(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (
      !state.frameTopDown ||
      ix < 0 ||
      iy < 0 ||
      ix >= state.frameWidth ||
      iy >= state.frameHeight
    ) {
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

  function clientToFrame(clientPoint) {
    if (!state.canvas) return null;
    const rect = state.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientPoint.x - rect.left) / rect.width) * state.frameWidth,
      y: ((clientPoint.y - rect.top) / rect.height) * state.frameHeight
    };
  }

  function frameToClient(framePoint) {
    const rect = state.canvas.getBoundingClientRect();
    return {
      x: rect.left + (framePoint.x / state.frameWidth) * rect.width,
      y: rect.top + (framePoint.y / state.frameHeight) * rect.height
    };
  }

  function robustAverage(colors) {
    if (!colors.length) return { r: 32, g: 120, b: 86 };
    const sortedR = colors.map((color) => color.r).sort((a, b) => a - b);
    const sortedG = colors.map((color) => color.g).sort((a, b) => a - b);
    const sortedB = colors.map((color) => color.b).sort((a, b) => a - b);
    const middle = Math.floor(colors.length / 2);
    return { r: sortedR[middle], g: sortedG[middle], b: sortedB[middle] };
  }

  function estimateTableColor(cue, radius) {
    const colors = [];
    for (let angleIndex = 0; angleIndex < 48; angleIndex += 1) {
      const angle = (angleIndex / 48) * Math.PI * 2;
      for (const multiplier of [2.2, 2.8, 3.5]) {
        const pixel = pixelAt(
          cue.x + Math.cos(angle) * radius * multiplier,
          cue.y + Math.sin(angle) * radius * multiplier
        );
        if (pixel.a && luminance(pixel) > 18) colors.push(pixel);
      }
    }
    return robustAverage(colors);
  }

  function refineBrightCenter(seed, searchRadius) {
    let sumX = 0;
    let sumY = 0;
    let sumWeight = 0;
    const minimumX = Math.max(0, Math.floor(seed.x - searchRadius));
    const maximumX = Math.min(state.frameWidth - 1, Math.ceil(seed.x + searchRadius));
    const minimumY = Math.max(0, Math.floor(seed.y - searchRadius));
    const maximumY = Math.min(state.frameHeight - 1, Math.ceil(seed.y + searchRadius));

    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const pixel = pixelAt(x, y);
        const lum = luminance(pixel);
        const sat = saturation(pixel);
        if (lum < 132 || sat > 0.42) continue;
        const dx = x - seed.x;
        const dy = y - seed.y;
        if (dx * dx + dy * dy > searchRadius * searchRadius) continue;
        const weight = Math.max(1, lum - 120) * (1 - sat * 0.65);
        sumX += x * weight;
        sumY += y * weight;
        sumWeight += weight;
      }
    }
    return sumWeight ? { x: sumX / sumWeight, y: sumY / sumWeight } : { ...seed };
  }

  function estimateRadius(center) {
    const minimum = Math.max(5, Math.min(state.frameWidth, state.frameHeight) / 100);
    const maximum = Math.max(minimum + 2, Math.min(state.frameWidth, state.frameHeight) / 22);
    const provisional = Math.min(state.frameWidth, state.frameHeight) / 42;
    const table = estimateTableColor(center, provisional);
    const distances = [];

    for (let angleIndex = 0; angleIndex < 36; angleIndex += 1) {
      const angle = (angleIndex / 36) * Math.PI * 2;
      let similarRun = 0;
      for (let distance = minimum * 0.55; distance <= maximum; distance += 1) {
        const pixel = pixelAt(
          center.x + Math.cos(angle) * distance,
          center.y + Math.sin(angle) * distance
        );
        const similar = colorDistance(pixel, table) < 34;
        similarRun = similar ? similarRun + 1 : 0;
        if (similarRun >= 2) {
          distances.push(distance - 1);
          break;
        }
      }
    }

    if (distances.length < 8) return provisional;
    distances.sort((a, b) => a - b);
    return Physics.clamp(distances[Math.floor(distances.length * 0.48)], minimum, maximum);
  }

  function isTableLike(pixel, tableColor, threshold = 44) {
    return pixel.a > 0 && colorDistance(pixel, tableColor) < threshold;
  }

  function estimateTableRect(cue, tableColor, radius) {
    const step = Math.max(3, Math.round(radius * 0.38));
    const gridWidth = Math.ceil(state.frameWidth / step);
    const gridHeight = Math.ceil(state.frameHeight / step);
    const mask = new Uint8Array(gridWidth * gridHeight);

    for (let gy = 0; gy < gridHeight; gy += 1) {
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const pixel = pixelAt(gx * step, gy * step);
        if (isTableLike(pixel, tableColor, 48)) mask[gy * gridWidth + gx] = 1;
      }
    }

    const seeds = [];
    for (let angleIndex = 0; angleIndex < 24; angleIndex += 1) {
      const angle = (angleIndex / 24) * Math.PI * 2;
      const sx = Math.round((cue.x + Math.cos(angle) * radius * 2.8) / step);
      const sy = Math.round((cue.y + Math.sin(angle) * radius * 2.8) / step);
      if (sx >= 0 && sy >= 0 && sx < gridWidth && sy < gridHeight && mask[sy * gridWidth + sx]) {
        seeds.push({ x: sx, y: sy });
      }
    }
    if (!seeds.length) {
      return { x: 0, y: 0, width: state.frameWidth, height: state.frameHeight };
    }

    const visited = new Uint8Array(mask.length);
    const queue = [...seeds];
    let head = 0;
    let minimumX = gridWidth;
    let maximumX = 0;
    let minimumY = gridHeight;
    let maximumY = 0;
    let count = 0;

    for (const seed of seeds) visited[seed.y * gridWidth + seed.x] = 1;
    while (head < queue.length) {
      const point = queue[head++];
      minimumX = Math.min(minimumX, point.x);
      maximumX = Math.max(maximumX, point.x);
      minimumY = Math.min(minimumY, point.y);
      maximumY = Math.max(maximumY, point.y);
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

    if (count < 180) {
      return { x: 0, y: 0, width: state.frameWidth, height: state.frameHeight };
    }
    const margin = radius * 0.55;
    const x = Math.max(0, minimumX * step - margin);
    const y = Math.max(0, minimumY * step - margin);
    const right = Math.min(state.frameWidth, (maximumX + 1) * step + margin);
    const bottom = Math.min(state.frameHeight, (maximumY + 1) * step + margin);
    return { x, y, width: right - x, height: bottom - y };
  }

  function foregroundScore(point, direction, radius, tableColor) {
    const normal = { x: -direction.y, y: direction.x };
    let foreground = 0;
    let total = 0;
    for (let offset = -radius * 0.82; offset <= radius * 0.82; offset += Math.max(1, radius * 0.18)) {
      const pixel = pixelAt(point.x + normal.x * offset, point.y + normal.y * offset);
      if (!pixel.a) continue;
      total += 1;
      const distance = colorDistance(pixel, tableColor);
      const lum = luminance(pixel);
      if (distance > 48 && lum > 15) foreground += 1;
    }
    return total ? foreground / total : 0;
  }

  function candidateCenter(seed, radius, tableColor) {
    let best = null;
    const search = radius * 1.25;
    const step = Math.max(1.5, radius * 0.16);
    for (let cy = seed.y - search; cy <= seed.y + search; cy += step) {
      for (let cx = seed.x - search; cx <= seed.x + search; cx += step) {
        let insideForeground = 0;
        let insideTotal = 0;
        let outerTable = 0;
        let outerTotal = 0;
        const sampleStep = Math.max(2, radius * 0.26);
        for (let oy = -radius * 1.35; oy <= radius * 1.35; oy += sampleStep) {
          for (let ox = -radius * 1.35; ox <= radius * 1.35; ox += sampleStep) {
            const squared = ox * ox + oy * oy;
            const pixel = pixelAt(cx + ox, cy + oy);
            if (!pixel.a) continue;
            if (squared <= radius * radius) {
              insideTotal += 1;
              if (!isTableLike(pixel, tableColor, 47)) insideForeground += 1;
            } else if (squared <= radius * radius * 1.75) {
              outerTotal += 1;
              if (isTableLike(pixel, tableColor, 54)) outerTable += 1;
            }
          }
        }
        if (!insideTotal || !outerTotal) continue;
        const insideRatio = insideForeground / insideTotal;
        const outerRatio = outerTable / outerTotal;
        const score = insideRatio * 0.72 + outerRatio * 0.28;
        if (insideRatio < 0.34 || outerRatio < 0.24) continue;
        if (!best || score > best.score) best = { x: cx, y: cy, score };
      }
    }
    return best;
  }

  function firstTarget(cue, direction, radius, tableColor, tableRect) {
    const rail = Physics.firstRectHit(cue, direction, tableRect, radius);
    const maximumT = rail?.t || Math.hypot(state.frameWidth, state.frameHeight);
    const step = Math.max(1.5, radius * 0.14);
    let consecutive = 0;

    for (let t = radius * 2.25; t < maximumT - radius * 0.4; t += step) {
      const point = Physics.add(cue, Physics.scale(direction, t));
      const score = foregroundScore(point, direction, radius, tableColor);
      consecutive = score >= 0.34 ? consecutive + 1 : Math.max(0, consecutive - 1);
      if (consecutive < 3) continue;

      const seed = Physics.add(cue, Physics.scale(direction, t - step));
      const center = candidateCenter(seed, radius, tableColor);
      if (!center) {
        consecutive = 0;
        continue;
      }
      const collision = Physics.collisionResult(cue, center, direction, radius);
      if (!collision || collision.t < radius * 1.8) {
        consecutive = 0;
        continue;
      }
      return { center: { x: center.x, y: center.y }, collision };
    }
    return null;
  }

  function updateCuePosition() {
    if (!state.cue || !state.radius) return;
    const refined = refineBrightCenter(state.cue, state.radius * 1.25);
    const movement = Physics.distance(refined, state.cue);
    if (movement <= state.radius * 0.7) {
      state.cue.x += (refined.x - state.cue.x) * 0.42;
      state.cue.y += (refined.y - state.cue.y) * 0.42;
    }
  }

  function computeGuide() {
    if (!state.enabled || !state.cue || !state.radius || !state.mouseClient || !state.canvas) return null;
    const mouse = clientToFrame(state.mouseClient);
    if (!mouse) return null;
    const direction = state.reversed
      ? Physics.normalize(Physics.sub(mouse, state.cue))
      : Physics.normalize(Physics.sub(state.cue, mouse));
    if (Physics.length(direction) < 0.5 || Physics.distance(mouse, state.cue) < state.radius * 1.3) return null;

    const target = firstTarget(state.cue, direction, state.radius, state.tableColor, state.tableRect);
    if (!target) {
      const rail = Physics.firstRectHit(state.cue, direction, state.tableRect, state.radius);
      return rail
        ? {
            cue: { ...state.cue },
            cueEnd: { x: rail.x, y: rail.y },
            direction,
            target: null,
            targetEnd: null,
            outcome: 'rail'
          }
        : null;
    }

    const endpoint = Physics.targetEndpoint(
      target.center,
      target.collision.targetDirection,
      state.tableRect,
      state.radius
    );
    return {
      cue: { ...state.cue },
      cueEnd: target.collision.cueAtContact,
      direction,
      target: target.center,
      targetEnd: endpoint?.point || null,
      outcome: endpoint?.outcome || 'rail'
    };
  }

  function smoothPoint(previous, next, amount) {
    if (!previous) return { ...next };
    return {
      x: previous.x + (next.x - previous.x) * amount,
      y: previous.y + (next.y - previous.y) * amount
    };
  }

  function smoothGuide(previous, next) {
    if (!previous || !next || Boolean(previous.target) !== Boolean(next.target)) return next;
    return {
      ...next,
      cue: smoothPoint(previous.cue, next.cue, 0.58),
      cueEnd: smoothPoint(previous.cueEnd, next.cueEnd, 0.58),
      target: next.target ? smoothPoint(previous.target, next.target, 0.52) : null,
      targetEnd: next.targetEnd ? smoothPoint(previous.targetEnd, next.targetEnd, 0.46) : null
    };
  }

  function drawLine(start, end, color, width) {
    const context = state.overlayContext;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.lineWidth = width;
    context.lineCap = 'round';
    context.strokeStyle = 'rgba(0,0,0,0.76)';
    context.stroke();
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.lineWidth = Math.max(1.4, width - 1.5);
    context.strokeStyle = color;
    context.stroke();
  }

  function render() {
    ensureOverlay();
    resizeOverlay();
    const context = state.overlayContext;
    context.clearRect(0, 0, innerWidth, innerHeight);
    const guide = state.guide;
    if (!state.enabled || !guide || !state.canvas) return;

    const cue = frameToClient(guide.cue);
    const cueEnd = frameToClient(guide.cueEnd);
    const rect = state.canvas.getBoundingClientRect();
    const directionCss = {
      x: (guide.direction.x / state.frameWidth) * rect.width,
      y: (guide.direction.y / state.frameHeight) * rect.height
    };
    const unit = Physics.normalize(directionCss);
    const radiusCss = state.radius * ((rect.width / state.frameWidth + rect.height / state.frameHeight) / 2);
    const start = {
      x: cue.x - unit.x * Math.max(radiusCss * 4.2, 34),
      y: cue.y - unit.y * Math.max(radiusCss * 4.2, 34)
    };

    drawLine(start, cueEnd, 'rgba(255,255,255,0.98)', 4.2);
    if (guide.target && guide.targetEnd) {
      const target = frameToClient(guide.target);
      const targetEnd = frameToClient(guide.targetEnd);
      const color = guide.outcome === 'pocket'
        ? 'rgba(64,255,112,0.98)'
        : 'rgba(255,211,69,0.98)';
      drawLine(target, targetEnd, color, 4.4);
    }
  }

  function selectCue(clientPoint) {
    const now = performance.now();
    if (!state.frameTopDown && !readFrame(now)) return;
    const framePoint = clientToFrame(clientPoint);
    if (!framePoint) return;
    const provisional = Math.min(state.frameWidth, state.frameHeight) / 42;
    const center = refineBrightCenter(framePoint, provisional * 1.8);
    const radius = estimateRadius(center);
    state.cue = center;
    state.radius = radius;
    state.tableColor = estimateTableColor(center, radius);
    state.tableRect = estimateTableRect(center, state.tableColor, radius);
    state.guide = null;
    state.lastGoodGuideAt = 0;
  }

  function loop(now) {
    if (state.enabled && now - state.lastFrameReadAt >= 150) {
      state.lastFrameReadAt = now;
      if (readFrame(now) && state.cue) {
        updateCuePosition();
        if (!state.tableColor) state.tableColor = estimateTableColor(state.cue, state.radius);
        if (!state.tableRect) state.tableRect = estimateTableRect(state.cue, state.tableColor, state.radius);
      }
    }

    if (state.enabled && state.frameTopDown && state.cue && state.tableColor && state.tableRect) {
      const next = computeGuide();
      if (next) {
        state.guide = smoothGuide(state.guide, next);
        state.lastGoodGuideAt = now;
      } else if (now - state.lastGoodGuideAt > 260) {
        state.guide = null;
      }
    }
    render();
    state.animationFrame = requestAnimationFrame(loop);
  }

  window.addEventListener('pointermove', (event) => {
    state.mouseClient = { x: event.clientX, y: event.clientY };
  }, true);

  window.addEventListener('pointerdown', (event) => {
    if (!event.shiftKey || event.button !== 0) return;
    const canvas = findCanvas(performance.now());
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    state.mouseClient = { x: event.clientX, y: event.clientY };
    selectCue(state.mouseClient);
  }, true);

  window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'g') {
      state.enabled = !state.enabled;
      if (!state.enabled) state.guide = null;
    } else if (event.key.toLowerCase() === 'r') {
      state.reversed = !state.reversed;
    } else if (event.key === 'Escape') {
      state.cue = null;
      state.guide = null;
      state.tableColor = null;
      state.tableRect = null;
    } else {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('resize', resizeOverlay);

  globalThis.__GAMEZER_RAY_GUIDER__ = {
    state,
    selectCue,
    toggle() {
      state.enabled = !state.enabled;
      return state.enabled;
    }
  };

  const start = () => {
    ensureOverlay();
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = requestAnimationFrame(loop);
  };

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
