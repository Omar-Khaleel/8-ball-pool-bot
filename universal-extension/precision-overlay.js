(() => {
  'use strict';

  if (globalThis.__POOL_VISION_PRECISION_OVERLAY__) return;
  const root = document.querySelector('#pool-vision-root');
  if (!root) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'pool-vision-precision-overlay';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '3',
  });
  root.appendChild(canvas);
  const context = canvas.getContext('2d');
  const state = globalThis.__POOL_VISION_PRECISION_STATE__;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(innerWidth * dpr));
    const height = Math.max(1, Math.round(innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function toViewport(point, roi) {
    return {
      x: roi.x + point.x * (roi.width / Math.max(1, state.width)),
      y: roi.y + point.y * (roi.height / Math.max(1, state.height)),
    };
  }

  function crosshair(point, radius, color, label) {
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(point.x - radius * 1.5, point.y);
    context.lineTo(point.x + radius * 1.5, point.y);
    context.moveTo(point.x, point.y - radius * 1.5);
    context.lineTo(point.x, point.y + radius * 1.5);
    context.stroke();
    context.beginPath();
    context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
    context.fill();
    context.font = '700 12px system-ui, sans-serif';
    context.textAlign = 'center';
    const metrics = context.measureText(label);
    const boxWidth = metrics.width + 12;
    const boxX = point.x - boxWidth / 2;
    const boxY = point.y - radius * 2 - 22;
    context.fillStyle = 'rgba(5, 12, 16, 0.90)';
    context.fillRect(boxX, boxY, boxWidth, 20);
    context.fillStyle = color;
    context.fillText(label, point.x, boxY + 15);
    context.restore();
  }

  function render() {
    resize();
    context.clearRect(0, 0, innerWidth, innerHeight);
    const assistant = globalThis.__POOL_VISION_ASSISTANT__;
    const status = assistant?.status?.();
    if (!status?.running || !status.roi || !state?.shots?.length) return;
    if (Date.now() - state.updatedAt > 900) return;

    const shot = state.shots[0];
    if (!shot?.cueImpact || !shot?.objectContact || !shot?.aimGateA || !shot?.aimGateB) return;
    const roi = status.roi;
    const cue = toViewport(shot.cue, roi);
    const ghost = toViewport(shot.ghost, roi);
    const objectBall = toViewport(shot.objectBall, roi);
    const pocket = toViewport(shot.pocket, roi);
    const cueImpact = toViewport(shot.cueImpact, roi);
    const objectContact = toViewport(shot.objectContact, roi);
    const gateA = toViewport(shot.aimGateA, roi);
    const gateB = toViewport(shot.aimGateB, roi);
    const backGuide = toViewport(shot.backGuide, roi);
    const scale = (roi.width / Math.max(1, state.width) + roi.height / Math.max(1, state.height)) / 2;
    const ballRadius = Math.max(6, (shot.radius || state.radius || 10) * scale);
    const hue = '#7CFF6B';

    context.save();
    context.fillStyle = 'rgba(124, 255, 107, 0.10)';
    context.strokeStyle = 'rgba(124, 255, 107, 0.82)';
    context.lineWidth = 1.3;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(cue.x, cue.y);
    context.lineTo(gateA.x, gateA.y);
    context.lineTo(gateB.x, gateB.y);
    context.closePath();
    context.fill();
    context.stroke();

    context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    context.lineWidth = 2;
    context.setLineDash([10, 5]);
    context.beginPath();
    context.moveTo(backGuide.x, backGuide.y);
    context.lineTo(ghost.x, ghost.y);
    context.stroke();

    context.fillStyle = 'rgba(255, 255, 255, 0.14)';
    context.strokeStyle = hue;
    context.lineWidth = 2.5;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.arc(ghost.x, ghost.y, ballRadius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = '#ffdd57';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(objectBall.x, objectBall.y);
    context.lineTo(pocket.x, pocket.y);
    context.stroke();
    context.restore();

    crosshair(cueImpact, 5.5, '#ffffff', 'اضرب هنا — مركز بلا سبن');
    crosshair(objectContact, 4.5, '#ffdd57', 'نقطة التصادم');

    context.save();
    context.fillStyle = hue;
    context.font = '700 13px system-ui, sans-serif';
    context.textAlign = 'left';
    const tolerance = Math.max(0.1, (shot.aimTolerance || 0) * scale);
    context.fillText(`سماحية التصويب ±${tolerance.toFixed(1)}px`, ghost.x + 10, ghost.y - ballRadius - 8);
    context.restore();
  }

  window.addEventListener('pool-vision-precision-updated', () => requestAnimationFrame(render));
  window.addEventListener('resize', render);
  setInterval(render, 220);
  globalThis.__POOL_VISION_PRECISION_OVERLAY__ = { render, canvas };
})();
