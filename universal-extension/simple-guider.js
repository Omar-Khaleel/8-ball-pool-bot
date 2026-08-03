(() => {
  'use strict';

  if (globalThis.__POOL_SIMPLE_GUIDER__) {
    globalThis.__POOL_SIMPLE_GUIDER__.start();
    return;
  }

  const Vision = globalThis.PoolVision;
  const Core = globalThis.PoolSimpleCore;
  if (!Vision || !Core) throw new Error('Simple Guider dependencies are missing');

  const overlay = document.createElement('canvas');
  overlay.id = 'pool-simple-guider-overlay';
  document.documentElement.appendChild(overlay);
  const context = overlay.getContext('2d');
  const tracker = new Vision.BallTracker({ velocitySmoothing: 0.72, maxMissingFrames: 3 });
  const work = new OffscreenCanvas(16, 16);
  const workContext = work.getContext('2d', { willReadFrequently: true });

  const state = {
    running: false,
    source: null,
    lastSourceSearch: 0,
    lastAnalysis: 0,
    animationFrame: 0,
    guide: null,
    sourceError: null,
  };

  function resizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
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

  function clear() {
    resizeOverlay();
    context.clearRect(0, 0, innerWidth, innerHeight);
  }

  function isVisibleCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement) || canvas === overlay) return false;
    const rect = canvas.getBoundingClientRect();
    const style = getComputedStyle(canvas);
    return (
      rect.width >= 320 &&
      rect.height >= 180 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0
    );
  }

  function findGameCanvas(now) {
    if (state.source?.isConnected && isVisibleCanvas(state.source) && now - state.lastSourceSearch < 1500) {
      return state.source;
    }
    state.lastSourceSearch = now;
    const canvases = [...document.querySelectorAll('canvas')].filter(isVisibleCanvas);
    canvases.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    state.source = canvases[0] || null;
    return state.source;
  }

  function captureCanvas(source) {
    const sourceWidth = Math.max(1, source.width || Math.round(source.getBoundingClientRect().width));
    const sourceHeight = Math.max(1, source.height || Math.round(source.getBoundingClientRect().height));
    const scale = Math.min(1, 1040 / sourceWidth, 620 / sourceHeight);
    const width = Math.max(160, Math.round(sourceWidth * scale));
    const height = Math.max(90, Math.round(sourceHeight * scale));
    if (work.width !== width || work.height !== height) {
      work.width = width;
      work.height = height;
    }
    workContext.clearRect(0, 0, width, height);
    workContext.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return {
      imageData: workContext.getImageData(0, 0, width, height),
      width,
      height,
      rect: source.getBoundingClientRect(),
    };
  }

  function selectCue(tracks) {
    const ranked = tracks
      .filter((ball) => Number.isFinite(ball.cueStickAngle))
      .map((ball) => ({
        ball,
        score: (ball.type === 'cue' ? 0.55 : 0) + (ball.cueScore || 0) + (ball.cueStickScore || 0) * 0.8,
      }))
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.score >= 0.58 ? ranked[0].ball : null;
  }

  function mapPoint(point, frame) {
    return {
      x: frame.rect.left + (point.x / frame.width) * frame.rect.width,
      y: frame.rect.top + (point.y / frame.height) * frame.rect.height,
    };
  }

  function mixPoint(previous, next, amount) {
    if (!previous) return { ...next };
    return {
      x: previous.x + (next.x - previous.x) * amount,
      y: previous.y + (next.y - previous.y) * amount,
    };
  }

  function smoothGuide(previous, next) {
    if (!previous || previous.target?.id !== next.target?.id || previous.outcome !== next.outcome) return next;
    return {
      ...next,
      cue: { ...next.cue, ...mixPoint(previous.cue, next.cue, 0.46) },
      cueEnd: mixPoint(previous.cueEnd, next.cueEnd, 0.46),
      target: next.target ? { ...next.target, ...mixPoint(previous.target, next.target, 0.46) } : null,
      targetEnd: next.targetEnd ? mixPoint(previous.targetEnd, next.targetEnd, 0.42) : null,
    };
  }

  function drawLine(start, end, color, width) {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.shadowColor = 'rgba(0, 0, 0, 0.72)';
    context.shadowBlur = 3;
    context.stroke();
    context.shadowBlur = 0;
  }

  function drawEndpoint(point, color) {
    context.beginPath();
    context.arc(point.x, point.y, 4.2, 0, Math.PI * 2);
    context.fillStyle = color;
    context.shadowColor = 'rgba(0, 0, 0, 0.8)';
    context.shadowBlur = 4;
    context.fill();
    context.shadowBlur = 0;
  }

  function render(guide, frame) {
    clear();
    if (!guide) return;

    const cue = mapPoint(guide.cue, frame);
    const cueEnd = mapPoint(guide.cueEnd, frame);
    const behindDistance = Math.max(34, (guide.cue.radius || 10) * (frame.rect.width / frame.width) * 4.4);
    const cssDirection = {
      x: (guide.direction.x / frame.width) * frame.rect.width,
      y: (guide.direction.y / frame.height) * frame.rect.height,
    };
    const cssLength = Math.hypot(cssDirection.x, cssDirection.y) || 1;
    const unit = { x: cssDirection.x / cssLength, y: cssDirection.y / cssLength };
    const start = { x: cue.x - unit.x * behindDistance, y: cue.y - unit.y * behindDistance };

    context.save();
    drawLine(start, cueEnd, 'rgba(255,255,255,0.96)', 2.8);

    if (guide.target && guide.targetEnd) {
      const target = mapPoint(guide.target, frame);
      const targetEnd = mapPoint(guide.targetEnd, frame);
      const color =
        guide.outcome === 'pocket'
          ? 'rgba(88,255,120,0.98)'
          : guide.outcome === 'ball'
            ? 'rgba(255,103,92,0.98)'
            : 'rgba(255,210,72,0.98)';
      drawLine(target, targetEnd, color, 3.1);
      drawEndpoint(targetEnd, color);
    } else {
      drawEndpoint(cueEnd, 'rgba(255,210,72,0.96)');
    }
    context.restore();
  }

  function analyze(now) {
    const source = findGameCanvas(now);
    if (!source) {
      state.guide = null;
      clear();
      return;
    }

    try {
      const frame = captureCanvas(source);
      const detected = Vision.analyze(frame.imageData, frame.width, frame.height, { colorThreshold: 48 });
      const tracks = tracker.update(detected.balls, performance.now(), detected.radius);
      const cue = selectCue(tracks);
      if (!cue) {
        state.guide = null;
        clear();
        return;
      }

      const stickAngle = cue.cueStickAngle;
      const direction = { x: -Math.cos(stickAngle), y: -Math.sin(stickAngle) };
      const nextGuide = Core.predict({
        cue,
        direction,
        balls: tracks,
        pockets: detected.pockets,
        width: frame.width,
        height: frame.height,
        radius: detected.radius,
      });
      state.guide = nextGuide ? smoothGuide(state.guide, nextGuide) : null;
      state.sourceError = null;
      render(state.guide, frame);
    } catch (error) {
      state.sourceError = error.message;
      state.guide = null;
      clear();
    }
  }

  function loop(now) {
    if (!state.running) return;
    if (now - state.lastAnalysis >= 135) {
      state.lastAnalysis = now;
      analyze(now);
    }
    state.animationFrame = requestAnimationFrame(loop);
  }

  function start() {
    if (state.running) return;
    state.running = true;
    overlay.style.display = 'block';
    state.lastAnalysis = 0;
    state.animationFrame = requestAnimationFrame(loop);
  }

  function stop() {
    state.running = false;
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = 0;
    state.guide = null;
    overlay.style.display = 'none';
    clear();
  }

  function status() {
    return {
      running: state.running,
      canvasFound: Boolean(state.source?.isConnected),
      error: state.sourceError,
    };
  }

  globalThis.__POOL_SIMPLE_GUIDER__ = { start, stop, status };
  start();
})();
