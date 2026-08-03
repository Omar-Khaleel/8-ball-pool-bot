(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GamezerRayPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-8;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  function scale(vector, amount) {
    return { x: vector.x * amount, y: vector.y * amount };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function length(vector) {
    return Math.hypot(vector.x, vector.y);
  }

  function normalize(vector) {
    const magnitude = length(vector);
    if (magnitude < EPS) return { x: 0, y: 0 };
    return { x: vector.x / magnitude, y: vector.y / magnitude };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function rayCircle(origin, direction, center, radius, minimumT = 0) {
    const unit = normalize(direction);
    if (length(unit) < EPS) return null;
    const relative = sub(center, origin);
    const projection = dot(relative, unit);
    const perpendicularSquared = dot(relative, relative) - projection * projection;
    const radiusSquared = radius * radius;
    if (perpendicularSquared > radiusSquared) return null;
    const offset = Math.sqrt(Math.max(0, radiusSquared - perpendicularSquared));
    let t = projection - offset;
    if (t < minimumT) t = projection + offset;
    return t >= minimumT ? t : null;
  }

  function firstRectHit(origin, direction, rect, inset = 0) {
    const unit = normalize(direction);
    if (length(unit) < EPS) return null;

    const left = rect.x + inset;
    const right = rect.x + rect.width - inset;
    const top = rect.y + inset;
    const bottom = rect.y + rect.height - inset;
    const candidates = [];

    if (Math.abs(unit.x) > EPS) {
      for (const [rail, x] of [['left', left], ['right', right]]) {
        const t = (x - origin.x) / unit.x;
        const y = origin.y + unit.y * t;
        if (t > 0 && y >= top - EPS && y <= bottom + EPS) {
          candidates.push({ x, y, t, rail });
        }
      }
    }

    if (Math.abs(unit.y) > EPS) {
      for (const [rail, y] of [['top', top], ['bottom', bottom]]) {
        const t = (y - origin.y) / unit.y;
        const x = origin.x + unit.x * t;
        if (t > 0 && x >= left - EPS && x <= right + EPS) {
          candidates.push({ x, y, t, rail });
        }
      }
    }

    candidates.sort((a, b) => a.t - b.t);
    return candidates[0] || null;
  }

  function pocketAnchors(rect) {
    return [
      { id: 'tl', x: rect.x, y: rect.y },
      { id: 'tm', x: rect.x + rect.width / 2, y: rect.y },
      { id: 'tr', x: rect.x + rect.width, y: rect.y },
      { id: 'bl', x: rect.x, y: rect.y + rect.height },
      { id: 'bm', x: rect.x + rect.width / 2, y: rect.y + rect.height },
      { id: 'br', x: rect.x + rect.width, y: rect.y + rect.height }
    ];
  }

  function firstPocketHit(origin, direction, rect, captureRadius, maximumT) {
    let best = null;
    for (const pocket of pocketAnchors(rect)) {
      const t = rayCircle(origin, direction, pocket, captureRadius, 0);
      if (t == null || t > maximumT + captureRadius * 0.35) continue;
      if (!best || t < best.t) best = { ...pocket, t };
    }
    return best;
  }

  function collisionResult(cue, target, direction, radius) {
    const unit = normalize(direction);
    const t = rayCircle(cue, unit, target, radius * 2, radius * 0.3);
    if (t == null) return null;
    const cueAtContact = add(cue, scale(unit, t));
    const targetDirection = normalize(sub(target, cueAtContact));
    if (length(targetDirection) < EPS) return null;
    return { cueAtContact, targetDirection, t };
  }

  function targetEndpoint(target, direction, tableRect, radius) {
    const rail = firstRectHit(target, direction, tableRect, radius);
    if (!rail) return null;
    const pocket = firstPocketHit(
      target,
      direction,
      tableRect,
      Math.max(radius * 1.35, 6),
      rail.t
    );
    if (pocket) {
      return {
        point: { x: pocket.x, y: pocket.y },
        outcome: 'pocket',
        pocketId: pocket.id,
        t: pocket.t
      };
    }
    return {
      point: { x: rail.x, y: rail.y },
      outcome: 'rail',
      rail: rail.rail,
      t: rail.t
    };
  }

  return {
    add,
    clamp,
    collisionResult,
    distance,
    dot,
    firstPocketHit,
    firstRectHit,
    length,
    normalize,
    pocketAnchors,
    rayCircle,
    scale,
    sub,
    targetEndpoint
  };
});
