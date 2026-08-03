(() => {
  'use strict';

  const Vision = globalThis.PoolVision;
  const Geometry = globalThis.PoolVisionGeometry;
  if (!Vision || !Geometry || globalThis.__POOL_VISION_PRECISION_VISION__) return;

  const OriginalBallTracker = Vision.BallTracker;
  const originalDetectBalls = Vision.detectBalls.bind(Vision);
  const originalDetectPockets = Vision.detectPockets.bind(Vision);
  const originalEstimateTableColor = Vision.estimateTableColor.bind(Vision);

  const precisionState = globalThis.__POOL_VISION_PRECISION_STATE__ || {
    shots: [],
    width: 0,
    height: 0,
    radius: 0,
    updatedAt: 0,
  };
  globalThis.__POOL_VISION_PRECISION_STATE__ = precisionState;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function connectedComponents(mask, width, height, minimumArea) {
    const visited = new Uint8Array(mask.length);
    const components = [];
    const queue = new Int32Array(mask.length);

    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      visited[start] = 1;
      let area = 0;
      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      let sumX = 0;
      let sumY = 0;

      while (head < tail) {
        const index = queue[head++];
        const x = index % width;
        const y = Math.floor(index / width);
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
            if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
            const next = ny * width + nx;
            if (!mask[next] || visited[next]) continue;
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }

      if (area >= minimumArea) {
        components.push({
          area,
          minX,
          maxX,
          minY,
          maxY,
          x: sumX / area,
          y: sumY / area,
        });
      }
    }
    return components;
  }

  function inspectCircle(imageData, width, height, centerX, centerY, radius) {
    const data = imageData.data;
    let count = 0;
    let white = 0;
    let lowSaturation = 0;
    let black = 0;
    let colored = 0;
    let sumLum = 0;
    let sumSat = 0;
    const radiusSquared = radius * radius;

    for (let y = Math.max(0, Math.floor(centerY - radius)); y <= Math.min(height - 1, Math.ceil(centerY + radius)); y += 1) {
      for (let x = Math.max(0, Math.floor(centerX - radius)); x <= Math.min(width - 1, Math.ceil(centerX + radius)); x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy > radiusSquared) continue;
        const offset = (y * width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const hsv = Vision.rgbToHsv(r, g, b);
        const lum = Vision.luminance(r, g, b);
        count += 1;
        sumLum += lum;
        sumSat += hsv.s;
        if (lum > 168 && hsv.s < 0.34) white += 1;
        if (hsv.s < 0.30) lowSaturation += 1;
        if (lum < 62) black += 1;
        if (hsv.s > 0.45 && lum > 55) colored += 1;
      }
    }

    return {
      meanLum: count ? sumLum / count : 0,
      meanSat: count ? sumSat / count : 0,
      whiteFraction: count ? white / count : 0,
      lowSaturationFraction: count ? lowSaturation / count : 0,
      blackFraction: count ? black / count : 0,
      coloredFraction: count ? colored / count : 0,
    };
  }

  function cueAppearanceScore(features) {
    const neutral = clamp((features.lowSaturationFraction - 0.58) / 0.40, 0, 1);
    const white = clamp((features.whiteFraction - 0.24) / 0.48, 0, 1);
    const brightness = clamp((features.meanLum - 125) / 85, 0, 1);
    const coloredPenalty = clamp(features.coloredFraction / 0.22, 0, 1);
    const blackPenalty = clamp(features.blackFraction / 0.20, 0, 1);
    return clamp(
      neutral * 0.34 + white * 0.31 + brightness * 0.18 - coloredPenalty * 0.24 - blackPenalty * 0.18,
      0,
      1
    );
  }

  function inspectCueStick(imageData, width, height, centerX, centerY, radius, tableColor) {
    const data = imageData.data;
    const angles = 48;
    const radialStep = Math.max(2, radius * 0.34);
    const maxDistance = radius * 11.5;
    let bestRun = 0;
    let bestAngle = null;
    let bestSupport = 0;

    function isNonTable(x, y) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) return false;
      const offset = (iy * width + ix) * 4;
      const pixel = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
      return Vision.luminance(pixel.r, pixel.g, pixel.b) > 28 && Vision.colorDistance(pixel, tableColor) > 38;
    }

    for (let angleIndex = 0; angleIndex < angles; angleIndex += 1) {
      const angle = (angleIndex / angles) * Math.PI * 2;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const px = -uy;
      const py = ux;
      let run = 0;
      let longestRun = 0;
      let supported = 0;
      let total = 0;
      let nearStartSupport = 0;

      for (let distance = radius * 1.15; distance <= maxDistance; distance += radialStep) {
        let hits = 0;
        let samples = 0;
        for (let offset = -radius * 0.24; offset <= radius * 0.24; offset += Math.max(1.5, radius * 0.12)) {
          samples += 1;
          if (isNonTable(centerX + ux * distance + px * offset, centerY + uy * distance + py * offset)) hits += 1;
        }
        const lineLike = samples && hits / samples >= 0.40;
        if (lineLike) {
          run += 1;
          supported += 1;
          if (total < 5) nearStartSupport += 1;
          longestRun = Math.max(longestRun, run);
        } else {
          run = 0;
        }
        total += 1;
      }

      if (nearStartSupport < 2) continue;
      const score = (total ? longestRun / total : 0) * 0.78 + (total ? supported / total : 0) * 0.22;
      if (score > bestSupport) {
        bestSupport = score;
        bestRun = longestRun;
        bestAngle = angle;
      }
    }

    return {
      score: clamp(bestSupport * 0.72 + clamp((bestRun - 3) / 18, 0, 1) * 0.28, 0, 1),
      angle: bestAngle,
    };
  }

  function inferBaseType(ball) {
    const features = ball.features || {};
    if ((features.blackFraction || 0) > 0.42 || (features.meanLum || 255) < 70) return 'eight';
    if ((features.whiteFraction || 0) > 0.25 && (features.coloredFraction || 0) > 0.08) return 'stripe';
    if ((features.coloredFraction || 0) > 0.16) return 'solid';
    return ball.type === 'cue' ? 'unknown' : ball.type || 'unknown';
  }

  function neutralCandidates(imageData, width, height, tableColor, expectedRadius, minimumRadius, maximumRadius) {
    const data = imageData.data;
    const mask = new Uint8Array(width * height);
    for (let y = 2; y < height - 2; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        const offset = (y * width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const hsv = Vision.rgbToHsv(r, g, b);
        const lum = Vision.luminance(r, g, b);
        if (lum > 148 && hsv.s < 0.31 && Vision.colorDistance({ r, g, b }, tableColor) > 34) {
          mask[y * width + x] = 1;
        }
      }
    }

    const minimumArea = Math.max(8, Math.PI * minimumRadius * minimumRadius * 0.10);
    return connectedComponents(mask, width, height, minimumArea)
      .map((component) => {
        const boxWidth = component.maxX - component.minX + 1;
        const boxHeight = component.maxY - component.minY + 1;
        const radiusFromBox = (boxWidth + boxHeight) / 4;
        const aspect = boxWidth / Math.max(1, boxHeight);
        if (radiusFromBox < minimumRadius * 0.72 || radiusFromBox > maximumRadius * 1.18) return null;
        if (aspect < 0.55 || aspect > 1.82) return null;
        const radius = clamp(expectedRadius * 0.98 + radiusFromBox * 0.02, minimumRadius, maximumRadius);
        const features = inspectCircle(imageData, width, height, component.x, component.y, radius);
        if (features.lowSaturationFraction < 0.62 || features.whiteFraction < 0.24 || features.meanLum < 125) return null;
        const stick = inspectCueStick(imageData, width, height, component.x, component.y, radius, tableColor);
        const appearance = cueAppearanceScore(features);
        return {
          x: component.x,
          y: component.y,
          radius,
          type: 'unknown',
          baseType: 'unknown',
          confidence: Math.max(0.58, appearance * 0.82),
          cueScore: clamp(appearance * 0.66 + stick.score * 0.46, 0, 1),
          cueStickScore: stick.score,
          cueStickAngle: stick.angle,
          features,
        };
      })
      .filter(Boolean);
  }

  function patchedDetectBalls(imageData, width, height, options = {}) {
    const result = originalDetectBalls(imageData, width, height, options);
    const tableColor = result.tableColor || options.tableColor || originalEstimateTableColor(imageData, width, height);
    const minDimension = Math.min(width, height);
    const expectedRadius = options.expectedRadius || result.radius || minDimension / 31;
    const minimumRadius = options.minimumRadius || minDimension / 58;
    const maximumRadius = options.maximumRadius || minDimension / 17;
    const balls = result.balls.map((ball) => {
      const baseType = inferBaseType(ball);
      const features = {
        ...(ball.features || {}),
        lowSaturationFraction: ball.features?.lowSaturationFraction ?? clamp(1 - (ball.features?.meanSat || 0), 0, 1),
      };
      const appearance = cueAppearanceScore(features);
      const stick = appearance > 0.42
        ? inspectCueStick(imageData, width, height, ball.x, ball.y, ball.radius || expectedRadius, tableColor)
        : { score: 0, angle: null };
      return {
        ...ball,
        type: baseType,
        baseType,
        features,
        cueScore: clamp(appearance * 0.66 + stick.score * 0.46, 0, 1),
        cueStickScore: stick.score,
        cueStickAngle: stick.angle,
      };
    });

    for (const candidate of neutralCandidates(imageData, width, height, tableColor, expectedRadius, minimumRadius, maximumRadius)) {
      const existing = balls.find((ball) => Geometry.distance(ball, candidate) < expectedRadius * 0.92);
      if (existing) {
        if (candidate.cueScore > (existing.cueScore || 0)) {
          existing.x = candidate.x;
          existing.y = candidate.y;
          existing.radius = candidate.radius;
          existing.features = candidate.features;
          existing.cueScore = candidate.cueScore;
          existing.cueStickScore = candidate.cueStickScore;
          existing.cueStickAngle = candidate.cueStickAngle;
          if (candidate.features.lowSaturationFraction > 0.86 && candidate.features.coloredFraction < 0.05) {
            existing.baseType = 'unknown';
            existing.type = 'unknown';
          }
        }
      } else {
        balls.push(candidate);
      }
    }

    for (const ball of balls) ball.type = ball.baseType || 'unknown';
    const ranked = [...balls].sort((a, b) => {
      const aScore = (a.cueScore || 0) + ((a.cueStickScore || 0) >= 0.34 ? 0.18 : 0);
      const bScore = (b.cueScore || 0) + ((b.cueStickScore || 0) >= 0.34 ? 0.18 : 0);
      return bScore - aScore;
    });
    const best = ranked[0];
    const runner = ranked[1];
    if (best) {
      const bestScore = (best.cueScore || 0) + ((best.cueStickScore || 0) >= 0.34 ? 0.18 : 0);
      const runnerScore = runner
        ? (runner.cueScore || 0) + ((runner.cueStickScore || 0) >= 0.34 ? 0.18 : 0)
        : 0;
      const strongStick = (best.cueStickScore || 0) >= 0.30;
      if ((strongStick && bestScore >= 0.56) || (bestScore >= 0.52 && bestScore - runnerScore >= 0.10)) {
        best.type = 'cue';
      }
    }

    precisionState.lastVision = { balls, tableColor, width, height, radius: result.radius || expectedRadius };
    return { ...result, balls, tableColor };
  }

  function patchedAnalyze(imageData, width, height, options = {}) {
    const detection = patchedDetectBalls(imageData, width, height, options);
    return {
      ...detection,
      pockets: originalDetectPockets(imageData, width, height, detection.radius),
      width,
      height,
    };
  }

  class PrecisionBallTracker extends OriginalBallTracker {
    constructor(options) {
      super(options);
      this.precisionCueTrackId = null;
    }

    reset() {
      super.reset();
      this.precisionCueTrackId = null;
    }

    update(detections, timestamp, radiusHint) {
      const enriched = detections.map((detection) => ({
        ...detection,
        features: {
          ...(detection.features || {}),
          precisionCueScore: detection.cueScore || 0,
          precisionCueStickScore: detection.cueStickScore || 0,
          precisionCueStickAngle: detection.cueStickAngle ?? null,
          precisionBaseType: detection.baseType || (detection.type === 'cue' ? 'unknown' : detection.type),
        },
      }));
      const visible = super.update(enriched, timestamp, radiusHint);
      let best = null;
      let bestScore = -1;

      for (const track of visible) {
        const cueScore = track.features?.precisionCueScore || track.cueScore || 0;
        const stickScore = track.features?.precisionCueStickScore || track.cueStickScore || 0;
        const score = cueScore + (stickScore >= 0.30 ? 0.18 : 0) + (track.id === this.precisionCueTrackId ? 0.14 : 0);
        if (score > bestScore) {
          best = track;
          bestScore = score;
        }
      }
      if (best && bestScore >= 0.58) this.precisionCueTrackId = best.id;

      for (const track of this.tracks) {
        const baseType = track.features?.precisionBaseType || (track.type === 'cue' ? 'unknown' : track.type) || 'unknown';
        track.type = track.id === this.precisionCueTrackId ? 'cue' : baseType;
      }

      return visible.map((track) => {
        const internal = this.tracks.find((candidate) => candidate.id === track.id);
        return {
          ...track,
          type: internal?.type || track.type,
          baseType: internal?.features?.precisionBaseType || track.baseType || 'unknown',
          cueScore: track.features?.precisionCueScore || 0,
          cueStickScore: track.features?.precisionCueStickScore || 0,
          cueStickAngle: track.features?.precisionCueStickAngle ?? null,
        };
      });
    }
  }

  Vision.detectBalls = patchedDetectBalls;
  Vision.analyze = patchedAnalyze;
  Vision.BallTracker = PrecisionBallTracker;
  globalThis.__POOL_VISION_PRECISION_VISION__ = true;
})();
