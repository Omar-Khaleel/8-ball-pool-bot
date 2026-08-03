(function (root, factory) {
  const geometry = root.PoolVisionGeometry || (typeof require === 'function' ? require('./geometry.js') : null);
  const api = factory(geometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PoolSimpleCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Geometry) {
  'use strict';

  if (!Geometry) throw new Error('PoolVisionGeometry is required');
  const EPS = 1e-7;

  function rayCircleIntersection(origin, direction, center, radius, minimumT = 0) {
    const dir = Geometry.normalize(direction);
    const relative = Geometry.sub(center, origin);
    const projection = Geometry.dot(relative, dir);
    const perpendicularSquared = Geometry.dot(relative, relative) - projection * projection;
    const radiusSquared = radius * radius;
    if (perpendicularSquared > radiusSquared) return null;

    const offset = Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
    let t = projection - offset;
    if (t < minimumT) t = projection + offset;
    if (t < minimumT) return null;
    return t;
  }

  function firstBallHit(origin, direction, movingRadius, balls, ignoredIds) {
    const ignored = new Set(ignoredIds || []);
    let best = null;
    for (const ball of balls || []) {
      if (ignored.has(ball.id)) continue;
      const combinedRadius = Math.max(2, movingRadius + (ball.radius || movingRadius));
      const t = rayCircleIntersection(origin, direction, ball, combinedRadius, Math.max(1, movingRadius * 0.12));
      if (t == null) continue;
      if (!best || t < best.t) best = { ball, t };
    }
    return best;
  }

  function firstRailHit(origin, direction, width, height, radius) {
    const dir = Geometry.normalize(direction);
    const bounds = {
      left: radius,
      right: width - radius,
      top: radius,
      bottom: height - radius,
    };
    const hits = [];

    if (Math.abs(dir.x) > EPS) {
      for (const rail of ['left', 'right']) {
        const x = bounds[rail];
        const t = (x - origin.x) / dir.x;
        const y = origin.y + dir.y * t;
        if (t > 0 && y >= bounds.top - EPS && y <= bounds.bottom + EPS) hits.push({ rail, x, y, t });
      }
    }

    if (Math.abs(dir.y) > EPS) {
      for (const rail of ['top', 'bottom']) {
        const y = bounds[rail];
        const t = (y - origin.y) / dir.y;
        const x = origin.x + dir.x * t;
        if (t > 0 && x >= bounds.left - EPS && x <= bounds.right + EPS) hits.push({ rail, x, y, t });
      }
    }

    hits.sort((a, b) => a.t - b.t);
    return hits[0] || null;
  }

  function firstPocketHit(origin, direction, movingRadius, pockets) {
    let best = null;
    for (const pocket of pockets || []) {
      const captureRadius = Math.max(movingRadius * 1.12, (pocket.radius || movingRadius * 1.35) * 0.82);
      const t = rayCircleIntersection(origin, direction, pocket, captureRadius, movingRadius * 0.10);
      if (t == null) continue;
      if (!best || t < best.t) best = { pocket, t };
    }
    return best;
  }

  function pointAlong(origin, direction, t) {
    return Geometry.add(origin, Geometry.scale(Geometry.normalize(direction), t));
  }

  function predict(input) {
    const balls = Array.isArray(input.balls) ? input.balls : [];
    const cue = input.cue || balls.find((ball) => ball.type === 'cue');
    if (!cue) return null;

    const direction = Geometry.normalize(input.direction || { x: 0, y: 0 });
    if (Geometry.length(direction) < EPS) return null;

    const cueRadius = Math.max(2, cue.radius || input.radius || 10);
    const width = Math.max(1, input.width || 1);
    const height = Math.max(1, input.height || 1);
    const cueHit = firstBallHit(cue, direction, cueRadius, balls, [cue.id]);

    if (!cueHit) {
      const rail = firstRailHit(cue, direction, width, height, cueRadius);
      return rail
        ? {
            cue,
            direction,
            target: null,
            cueEnd: { x: rail.x, y: rail.y },
            outcome: 'rail',
            targetEnd: null,
          }
        : null;
    }

    const target = cueHit.ball;
    const cueAtContact = pointAlong(cue, direction, cueHit.t);
    const targetDirection = Geometry.normalize(Geometry.sub(target, cueAtContact));
    if (Geometry.length(targetDirection) < EPS) return null;

    const targetRadius = Math.max(2, target.radius || cueRadius);
    const rail = firstRailHit(target, targetDirection, width, height, targetRadius);
    const pocket = firstPocketHit(target, targetDirection, targetRadius, input.pockets || []);
    const blocker = firstBallHit(target, targetDirection, targetRadius, balls, [cue.id, target.id]);

    let outcome = 'rail';
    let targetEnd = rail ? { x: rail.x, y: rail.y } : pointAlong(target, targetDirection, Math.hypot(width, height));
    let pocketResult = null;
    let blockerResult = null;
    let winningT = rail?.t ?? Number.POSITIVE_INFINITY;

    if (pocket && pocket.t < winningT + targetRadius * 0.35) {
      outcome = 'pocket';
      targetEnd = { x: pocket.pocket.x, y: pocket.pocket.y };
      pocketResult = pocket.pocket;
      winningT = pocket.t;
    }

    if (blocker && blocker.t < winningT) {
      outcome = 'ball';
      targetEnd = pointAlong(target, targetDirection, blocker.t);
      blockerResult = blocker.ball;
    }

    return {
      cue,
      direction,
      target,
      cueEnd: cueAtContact,
      targetDirection,
      targetEnd,
      outcome,
      pocket: pocketResult,
      blocker: blockerResult,
    };
  }

  return {
    firstBallHit,
    firstPocketHit,
    firstRailHit,
    pointAlong,
    predict,
    rayCircleIntersection,
  };
});
