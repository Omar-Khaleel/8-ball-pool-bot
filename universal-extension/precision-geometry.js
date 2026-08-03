(() => {
  'use strict';

  const Geometry = globalThis.PoolVisionGeometry;
  if (!Geometry || globalThis.__POOL_VISION_PRECISION_GEOMETRY__) return;

  const originalDirect = Geometry.recommendDirectShots.bind(Geometry);
  const originalBank = Geometry.recommendBankShots.bind(Geometry);
  const originalShots = Geometry.recommendShots.bind(Geometry);
  const state = globalThis.__POOL_VISION_PRECISION_STATE__ || { shots: [], updatedAt: 0 };
  globalThis.__POOL_VISION_PRECISION_STATE__ = state;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function enrichShot(shot, input) {
    const radius = Math.max(2, input.radius || shot.cue?.radius || 10);
    const approachDirection = Geometry.normalize(Geometry.sub(shot.ghost, shot.cue));
    const objectDirection = shot.kind === 'bank'
      ? Geometry.normalize(Geometry.sub(shot.bankPoint, shot.objectBall))
      : Geometry.normalize(Geometry.sub(shot.pocket, shot.objectBall));
    const normal = { x: -approachDirection.y, y: approachDirection.x };
    const objectDistance = shot.kind === 'bank'
      ? Geometry.distance(shot.objectBall, shot.bankPoint) + Geometry.distance(shot.bankPoint, shot.pocket)
      : Geometry.distance(shot.objectBall, shot.pocket);
    const pocketRadius = Math.max(radius * 1.12, shot.pocket?.radius || radius * 1.28);
    const pocketClearance = clamp(pocketRadius - radius * 0.72, radius * 0.10, radius * 0.72);
    const angularTolerance = Math.asin(clamp(pocketClearance / Math.max(objectDistance, radius * 2), 0, 0.42));
    const alignment = clamp(Geometry.dot(approachDirection, objectDirection), 0.12, 1);
    const aimTolerance = clamp(
      radius * 2.02 * Math.sin(angularTolerance) * (0.52 + alignment * 0.48),
      radius * 0.10,
      radius * 0.58
    );
    const cueImpact = Geometry.sub(shot.cue, Geometry.scale(approachDirection, radius * 0.94));
    const objectContact = Geometry.sub(shot.objectBall, Geometry.scale(objectDirection, radius * 0.98));

    return {
      ...shot,
      radius,
      aimDirection: approachDirection,
      cueImpact,
      objectContact,
      aimTolerance,
      aimGateA: Geometry.add(shot.ghost, Geometry.scale(normal, aimTolerance)),
      aimGateB: Geometry.sub(shot.ghost, Geometry.scale(normal, aimTolerance)),
      backGuide: Geometry.sub(cueImpact, Geometry.scale(approachDirection, radius * 4.2)),
    };
  }

  Geometry.recommendDirectShots = (input) => originalDirect(input).map((shot) => enrichShot(shot, input));
  Geometry.recommendBankShots = (input) => originalBank(input).map((shot) => enrichShot(shot, input));
  Geometry.recommendShots = (input) => {
    const shots = originalShots(input).map((shot) => enrichShot(shot, input));
    state.shots = shots;
    state.width = input.width;
    state.height = input.height;
    state.radius = input.radius;
    state.updatedAt = Date.now();
    window.dispatchEvent(new CustomEvent('pool-vision-precision-updated'));
    return shots;
  };

  globalThis.__POOL_VISION_PRECISION_GEOMETRY__ = true;
})();
