(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PoolVisionGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EPS = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }

  function scale(v, factor) {
    return { x: v.x * factor, y: v.y * factor };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function length(v) {
    return Math.hypot(v.x, v.y);
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function normalize(v) {
    const len = length(v);
    if (len < EPS) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  function angleBetween(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    return Math.acos(clamp(dot(na, nb), -1, 1));
  }

  function closestPointOnSegment(point, start, end) {
    const segment = sub(end, start);
    const denom = dot(segment, segment);
    if (denom < EPS) return { ...start, t: 0 };
    const t = clamp(dot(sub(point, start), segment) / denom, 0, 1);
    const projected = add(start, scale(segment, t));
    return { ...projected, t };
  }

  function distancePointToSegment(point, start, end) {
    return distance(point, closestPointOnSegment(point, start, end));
  }

  function segmentClear(start, end, balls, clearance, ignoredIds) {
    const ignored = new Set(ignoredIds || []);
    for (const ball of balls) {
      if (ignored.has(ball.id)) continue;
      const closest = closestPointOnSegment(ball, start, end);
      if (closest.t <= 0.015 || closest.t >= 0.985) continue;
      if (distance(ball, closest) < clearance) return false;
    }
    return true;
  }

  function defaultPocketAnchors(width, height, inset) {
    const i = inset || 0;
    return [
      { id: 'tl', x: i, y: i },
      { id: 'tm', x: width / 2, y: i },
      { id: 'tr', x: width - i, y: i },
      { id: 'bl', x: i, y: height - i },
      { id: 'bm', x: width / 2, y: height - i },
      { id: 'br', x: width - i, y: height - i },
    ];
  }

  function recommendDirectShots(input) {
    const balls = Array.isArray(input.balls) ? input.balls : [];
    const cue = balls.find((ball) => ball.type === 'cue') || input.cueBall;
    if (!cue) return [];

    const radius = Math.max(2, input.radius || cue.radius || 10);
    const pockets = input.pockets || defaultPocketAnchors(input.width, input.height, radius * 0.8);
    const allowedTypes = input.allowedTypes ? new Set(input.allowedTypes) : null;
    const candidates = [];

    for (const objectBall of balls) {
      if (objectBall.id === cue.id || objectBall.type === 'cue') continue;
      if (objectBall.type === 'unknown' && input.excludeUnknown) continue;
      if (allowedTypes && !allowedTypes.has(objectBall.type)) continue;

      for (const pocket of pockets) {
        const objectToPocket = sub(pocket, objectBall);
        const objectDistance = length(objectToPocket);
        if (objectDistance < radius * 2.2) continue;

        const objectDirection = normalize(objectToPocket);
        const ghost = sub(objectBall, scale(objectDirection, radius * 2.02));
        const cueToGhost = sub(ghost, cue);
        const cueDistance = length(cueToGhost);
        if (cueDistance < radius * 1.5) continue;

        const approachDirection = normalize(cueToGhost);
        const alignment = dot(approachDirection, objectDirection);
        if (alignment < 0.12) continue;

        const cuePathClear = segmentClear(
          cue,
          ghost,
          balls,
          radius * 1.95,
          [cue.id, objectBall.id]
        );
        if (!cuePathClear) continue;

        const objectPathClear = segmentClear(
          objectBall,
          pocket,
          balls,
          radius * 1.82,
          [cue.id, objectBall.id]
        );
        if (!objectPathClear) continue;

        const cutAngle = angleBetween(approachDirection, objectDirection);
        const anglePenalty = cutAngle / (Math.PI / 2);
        const totalDistance = cueDistance + objectDistance;
        const tableDiagonal = Math.hypot(input.width || 1, input.height || 1);
        const distancePenalty = totalDistance / Math.max(tableDiagonal, 1);
        const pocketPreference = pocket.id === 'tm' || pocket.id === 'bm' ? 0.04 : 0;
        const score = clamp(1 - anglePenalty * 0.62 - distancePenalty * 0.26 - pocketPreference, 0, 1);

        candidates.push({
          kind: 'direct',
          score,
          cueBallId: cue.id,
          objectBallId: objectBall.id,
          pocketId: pocket.id,
          cue,
          objectBall,
          pocket,
          ghost,
          cutAngleRadians: cutAngle,
          cueDistance,
          objectDistance,
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  function reflectPointAcrossRail(point, rail, width, height) {
    switch (rail) {
      case 'left':
        return { x: -point.x, y: point.y };
      case 'right':
        return { x: width * 2 - point.x, y: point.y };
      case 'top':
        return { x: point.x, y: -point.y };
      case 'bottom':
        return { x: point.x, y: height * 2 - point.y };
      default:
        throw new Error(`Unknown rail: ${rail}`);
    }
  }

  function lineRailIntersection(start, end, rail, width, height) {
    const direction = sub(end, start);
    let t;
    if (rail === 'left' || rail === 'right') {
      const x = rail === 'left' ? 0 : width;
      if (Math.abs(direction.x) < EPS) return null;
      t = (x - start.x) / direction.x;
      const y = start.y + direction.y * t;
      if (t <= 0 || y <= 0 || y >= height) return null;
      return { x, y, t };
    }

    const y = rail === 'top' ? 0 : height;
    if (Math.abs(direction.y) < EPS) return null;
    t = (y - start.y) / direction.y;
    const x = start.x + direction.x * t;
    if (t <= 0 || x <= 0 || x >= width) return null;
    return { x, y, t };
  }

  function recommendBankShots(input) {
    const direct = recommendDirectShots(input);
    if (direct.length >= (input.minimumDirectShots || 2)) return [];

    const balls = Array.isArray(input.balls) ? input.balls : [];
    const cue = balls.find((ball) => ball.type === 'cue') || input.cueBall;
    if (!cue) return [];
    const radius = Math.max(2, input.radius || cue.radius || 10);
    const width = input.width;
    const height = input.height;
    const pockets = input.pockets || defaultPocketAnchors(width, height, radius * 0.8);
    const rails = ['left', 'right', 'top', 'bottom'];
    const candidates = [];

    for (const objectBall of balls) {
      if (objectBall.id === cue.id || objectBall.type === 'cue') continue;
      for (const pocket of pockets) {
        for (const rail of rails) {
          const reflectedPocket = reflectPointAcrossRail(pocket, rail, width, height);
          const bankPoint = lineRailIntersection(objectBall, reflectedPocket, rail, width, height);
          if (!bankPoint) continue;
          if (
            bankPoint.x < radius * 2.5 ||
            bankPoint.x > width - radius * 2.5 ||
            bankPoint.y < radius * 2.5 ||
            bankPoint.y > height - radius * 2.5
          ) {
            continue;
          }

          const outgoing = normalize(sub(pocket, bankPoint));
          const incoming = normalize(sub(bankPoint, objectBall));
          const ghost = sub(objectBall, scale(incoming, radius * 2.02));
          const cueApproach = normalize(sub(ghost, cue));
          if (dot(cueApproach, incoming) < 0.16) continue;

          if (!segmentClear(cue, ghost, balls, radius * 1.95, [cue.id, objectBall.id])) continue;
          if (!segmentClear(objectBall, bankPoint, balls, radius * 1.82, [cue.id, objectBall.id])) continue;
          if (!segmentClear(bankPoint, pocket, balls, radius * 1.82, [cue.id, objectBall.id])) continue;

          const cutAngle = angleBetween(cueApproach, incoming);
          const bankAngle = angleBetween(incoming, outgoing);
          const totalDistance = distance(cue, ghost) + distance(objectBall, bankPoint) + distance(bankPoint, pocket);
          const diagonal = Math.hypot(width, height);
          const score = clamp(
            0.72 - (cutAngle / (Math.PI / 2)) * 0.35 - (Math.abs(Math.PI - bankAngle) / Math.PI) * 0.18 - (totalDistance / diagonal) * 0.18,
            0,
            0.72
          );

          candidates.push({
            kind: 'bank',
            score,
            cueBallId: cue.id,
            objectBallId: objectBall.id,
            pocketId: pocket.id,
            rail,
            cue,
            objectBall,
            pocket,
            ghost,
            bankPoint,
          });
        }
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  function recommendShots(input) {
    const direct = recommendDirectShots(input);
    const bank = input.includeBanks === false ? [] : recommendBankShots({ ...input, minimumDirectShots: 2 });
    return [...direct, ...bank].sort((a, b) => b.score - a.score);
  }

  return {
    add,
    angleBetween,
    clamp,
    closestPointOnSegment,
    defaultPocketAnchors,
    distance,
    distancePointToSegment,
    dot,
    length,
    lineRailIntersection,
    normalize,
    recommendBankShots,
    recommendDirectShots,
    recommendShots,
    reflectPointAcrossRail,
    scale,
    segmentClear,
    sub,
  };
});
