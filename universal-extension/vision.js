(function (root, factory) {
  const geometry = root.PoolVisionGeometry || (typeof require === 'function' ? require('./geometry.js') : null);
  const api = factory(geometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PoolVision = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Geometry) {
  'use strict';

  if (!Geometry) throw new Error('PoolVisionGeometry must be loaded before vision.js');

  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;
    if (delta > 0) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return {
      h,
      s: max === 0 ? 0 : delta / max,
      v: max,
    };
  }

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function colorDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr * 0.8 + dg * dg * 1.25 + db * db * 0.7);
  }

  function estimateTableColor(imageData, width, height) {
    const data = imageData.data;
    const bins = new Map();
    const xMargin = Math.floor(width * 0.08);
    const yMargin = Math.floor(height * 0.08);
    const step = Math.max(2, Math.floor(Math.min(width, height) / 130));

    for (let y = yMargin; y < height - yMargin; y += step) {
      for (let x = xMargin; x < width - xMargin; x += step) {
        const offset = (y * width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const hsv = rgbToHsv(r, g, b);
        const lum = luminance(r, g, b);
        if (hsv.s < 0.18 || lum < 30 || lum > 225) continue;
        const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
        const current = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
        current.count += 1;
        current.r += r;
        current.g += g;
        current.b += b;
        bins.set(key, current);
      }
    }

    let best = null;
    for (const value of bins.values()) {
      if (!best || value.count > best.count) best = value;
    }

    if (!best) return { r: 36, g: 126, b: 92 };
    return {
      r: best.r / best.count,
      g: best.g / best.count,
      b: best.b / best.count,
    };
  }

  function buildForegroundMask(imageData, width, height, tableColor, options) {
    const data = imageData.data;
    const mask = new Uint8Array(width * height);
    const threshold = options.colorThreshold || 53;
    const borderX = Math.max(2, Math.floor(width * 0.025));
    const borderY = Math.max(2, Math.floor(height * 0.045));

    for (let y = borderY; y < height - borderY; y += 1) {
      for (let x = borderX; x < width - borderX; x += 1) {
        const offset = (y * width + x) * 4;
        const pixel = { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
        const hsv = rgbToHsv(pixel.r, pixel.g, pixel.b);
        const dist = colorDistance(pixel, tableColor);
        const lum = luminance(pixel.r, pixel.g, pixel.b);
        const tableLum = luminance(tableColor.r, tableColor.g, tableColor.b);
        const standout = dist > threshold || Math.abs(lum - tableLum) > 66;
        const useful = lum > 18 && (hsv.s > 0.08 || lum > 145 || lum < 72);
        if (standout && useful) mask[y * width + x] = 1;
      }
    }
    return mask;
  }

  function dilate(mask, width, height, iterations) {
    let current = mask;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const next = new Uint8Array(current);
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x;
          if (current[index]) continue;
          if (
            current[index - 1] ||
            current[index + 1] ||
            current[index - width] ||
            current[index + width] ||
            current[index - width - 1] ||
            current[index - width + 1] ||
            current[index + width - 1] ||
            current[index + width + 1]
          ) {
            next[index] = 1;
          }
        }
      }
      current = next;
    }
    return current;
  }

  function connectedComponents(mask, width, height, minimumArea) {
    const visited = new Uint8Array(mask.length);
    const components = [];
    const queueX = new Int32Array(mask.length);
    const queueY = new Int32Array(mask.length);

    for (let startY = 1; startY < height - 1; startY += 1) {
      for (let startX = 1; startX < width - 1; startX += 1) {
        const startIndex = startY * width + startX;
        if (!mask[startIndex] || visited[startIndex]) continue;

        let head = 0;
        let tail = 0;
        queueX[tail] = startX;
        queueY[tail] = startY;
        tail += 1;
        visited[startIndex] = 1;

        let area = 0;
        let minX = startX;
        let maxX = startX;
        let minY = startY;
        let maxY = startY;
        let sumX = 0;
        let sumY = 0;

        while (head < tail) {
          const x = queueX[head];
          const y = queueY[head];
          head += 1;
          area += 1;
          sumX += x;
          sumY += y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;

          for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              if (ox === 0 && oy === 0) continue;
              const nx = x + ox;
              const ny = y + oy;
              if (nx <= 0 || ny <= 0 || nx >= width - 1 || ny >= height - 1) continue;
              const index = ny * width + nx;
              if (!mask[index] || visited[index]) continue;
              visited[index] = 1;
              queueX[tail] = nx;
              queueY[tail] = ny;
              tail += 1;
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
    }
    return components;
  }

  function inspectCircle(imageData, width, height, centerX, centerY, radius) {
    const data = imageData.data;
    let count = 0;
    let sumLum = 0;
    let sumSat = 0;
    let white = 0;
    let black = 0;
    let colored = 0;
    let edgeLum = 0;
    let edgeCount = 0;

    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
    const radiusSquared = radius * radius;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > radiusSquared) continue;
        const offset = (y * width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const hsv = rgbToHsv(r, g, b);
        const lum = luminance(r, g, b);
        count += 1;
        sumLum += lum;
        sumSat += hsv.s;
        if (lum > 172 && hsv.s < 0.34) white += 1;
        if (lum < 62) black += 1;
        if (hsv.s > 0.45 && lum > 55) colored += 1;
        if (distanceSquared > radiusSquared * 0.55) {
          edgeLum += lum;
          edgeCount += 1;
        }
      }
    }

    return {
      meanLum: count ? sumLum / count : 0,
      meanSat: count ? sumSat / count : 0,
      whiteFraction: count ? white / count : 0,
      blackFraction: count ? black / count : 0,
      coloredFraction: count ? colored / count : 0,
      edgeLum: edgeCount ? edgeLum / edgeCount : 0,
    };
  }

  function classifyBall(features) {
    if (features.whiteFraction > 0.52 && features.meanLum > 145 && features.coloredFraction < 0.22) {
      return 'cue';
    }
    if (features.blackFraction > 0.42 || features.meanLum < 70) return 'eight';
    if (features.whiteFraction > 0.28 && features.coloredFraction > 0.12) return 'stripe';
    if (features.coloredFraction > 0.16) return 'solid';
    return 'unknown';
  }

  function detectBalls(imageData, width, height, options) {
    const tableColor = options.tableColor || estimateTableColor(imageData, width, height);
    const minDimension = Math.min(width, height);
    const expectedRadius = options.expectedRadius || minDimension / 31;
    const minimumRadius = options.minimumRadius || minDimension / 58;
    const maximumRadius = options.maximumRadius || minDimension / 17;
    const foreground = buildForegroundMask(imageData, width, height, tableColor, options);
    const expanded = dilate(foreground, width, height, Math.max(1, Math.round(expectedRadius / 9)));
    const components = connectedComponents(expanded, width, height, Math.max(10, Math.PI * minimumRadius * minimumRadius * 0.12));
    const candidates = [];

    for (const component of components) {
      const boxWidth = component.maxX - component.minX + 1;
      const boxHeight = component.maxY - component.minY + 1;
      const aspect = boxWidth / boxHeight;
      const radius = Math.max(boxWidth, boxHeight) / 2;
      if (radius < minimumRadius || radius > maximumRadius) continue;
      if (aspect < 0.58 || aspect > 1.72) continue;
      const circleArea = Math.PI * radius * radius;
      const fill = component.area / circleArea;
      if (fill < 0.16 || fill > 1.55) continue;

      const features = inspectCircle(imageData, width, height, component.x, component.y, radius);
      const type = classifyBall(features);
      const radiusFit = 1 - Math.min(1, Math.abs(radius - expectedRadius) / Math.max(expectedRadius, 1));
      const roundness = 1 - Math.min(1, Math.abs(1 - aspect));
      const score = radiusFit * 0.42 + roundness * 0.34 + Math.min(1, fill) * 0.24;
      candidates.push({
        x: component.x,
        y: component.y,
        radius,
        type,
        confidence: score,
        features,
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const deduplicated = [];
    for (const candidate of candidates) {
      const duplicate = deduplicated.some(
        (existing) => Geometry.distance(existing, candidate) < Math.min(existing.radius, candidate.radius) * 0.9
      );
      if (!duplicate) deduplicated.push(candidate);
    }

    const cueCandidates = deduplicated.filter((ball) => ball.type === 'cue');
    if (cueCandidates.length > 1) {
      cueCandidates.sort((a, b) => b.features.meanLum - a.features.meanLum);
      for (let index = 1; index < cueCandidates.length; index += 1) cueCandidates[index].type = 'stripe';
    } else if (cueCandidates.length === 0 && deduplicated.length) {
      const brightest = [...deduplicated].sort((a, b) => b.features.meanLum - a.features.meanLum)[0];
      if (brightest.features.whiteFraction > 0.32 || brightest.features.meanLum > 155) brightest.type = 'cue';
    }

    return {
      balls: deduplicated,
      tableColor,
      radius: deduplicated.length
        ? deduplicated.reduce((sum, ball) => sum + ball.radius, 0) / deduplicated.length
        : expectedRadius,
    };
  }

  function detectPockets(imageData, width, height, radius) {
    const data = imageData.data;
    const anchors = Geometry.defaultPocketAnchors(width, height, radius * 0.55);
    const searchRadius = Math.max(radius * 2.2, Math.min(width, height) * 0.045);
    const pockets = [];

    for (const anchor of anchors) {
      let best = { x: anchor.x, y: anchor.y, lum: Number.POSITIVE_INFINITY };
      const minX = Math.max(0, Math.floor(anchor.x - searchRadius));
      const maxX = Math.min(width - 1, Math.ceil(anchor.x + searchRadius));
      const minY = Math.max(0, Math.floor(anchor.y - searchRadius));
      const maxY = Math.min(height - 1, Math.ceil(anchor.y + searchRadius));
      const step = Math.max(1, Math.round(radius / 3));

      for (let y = minY; y <= maxY; y += step) {
        for (let x = minX; x <= maxX; x += step) {
          const offset = (y * width + x) * 4;
          const lum = luminance(data[offset], data[offset + 1], data[offset + 2]);
          const anchorPenalty = Geometry.distance({ x, y }, anchor) * 0.35;
          const score = lum + anchorPenalty;
          if (score < best.lum) best = { x, y, lum: score };
        }
      }
      pockets.push({ id: anchor.id, x: best.x, y: best.y, radius: radius * 1.25 });
    }
    return pockets;
  }

  class BallTracker {
    constructor(options) {
      this.options = {
        maxMissingFrames: 6,
        velocitySmoothing: 0.62,
        ...options,
      };
      this.tracks = [];
      this.nextId = 1;
      this.lastTimestamp = null;
    }

    reset() {
      this.tracks = [];
      this.nextId = 1;
      this.lastTimestamp = null;
    }

    update(detections, timestamp, radiusHint) {
      const now = timestamp || performance.now();
      const deltaSeconds = this.lastTimestamp ? Math.max(0.016, (now - this.lastTimestamp) / 1000) : 0.1;
      this.lastTimestamp = now;
      const radius = radiusHint || 10;
      const unmatchedDetections = new Set(detections.map((_, index) => index));

      for (const track of this.tracks) {
        let bestIndex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        const predicted = {
          x: track.x + track.vx * deltaSeconds,
          y: track.y + track.vy * deltaSeconds,
        };
        for (const index of unmatchedDetections) {
          const detection = detections[index];
          const dist = Geometry.distance(predicted, detection);
          const typePenalty = track.type !== 'unknown' && detection.type !== 'unknown' && track.type !== detection.type ? radius : 0;
          const score = dist + typePenalty;
          if (score < bestDistance) {
            bestDistance = score;
            bestIndex = index;
          }
        }

        if (bestIndex >= 0 && bestDistance < radius * 3.4) {
          const detection = detections[bestIndex];
          const measuredVx = (detection.x - track.x) / deltaSeconds;
          const measuredVy = (detection.y - track.y) / deltaSeconds;
          const smoothing = this.options.velocitySmoothing;
          track.vx = track.vx * smoothing + measuredVx * (1 - smoothing);
          track.vy = track.vy * smoothing + measuredVy * (1 - smoothing);
          track.x = detection.x;
          track.y = detection.y;
          track.radius = detection.radius;
          track.type = detection.type === 'unknown' ? track.type : detection.type;
          track.confidence = detection.confidence;
          track.features = detection.features;
          track.missing = 0;
          track.age += 1;
          unmatchedDetections.delete(bestIndex);
        } else {
          track.missing += 1;
          track.x += track.vx * deltaSeconds;
          track.y += track.vy * deltaSeconds;
          track.vx *= 0.78;
          track.vy *= 0.78;
        }
      }

      for (const index of unmatchedDetections) {
        const detection = detections[index];
        this.tracks.push({
          ...detection,
          id: this.nextId++,
          vx: 0,
          vy: 0,
          missing: 0,
          age: 1,
        });
      }

      this.tracks = this.tracks.filter((track) => track.missing <= this.options.maxMissingFrames);
      return this.tracks
        .filter((track) => track.missing <= 1)
        .map((track) => ({
          ...track,
          speed: Math.hypot(track.vx, track.vy),
          moving: Math.hypot(track.vx, track.vy) > radius * 0.8,
        }));
    }
  }

  function analyze(imageData, width, height, options) {
    const detection = detectBalls(imageData, width, height, options || {});
    const pockets = detectPockets(imageData, width, height, detection.radius);
    return {
      ...detection,
      pockets,
      width,
      height,
    };
  }

  return {
    BallTracker,
    analyze,
    classifyBall,
    colorDistance,
    detectBalls,
    detectPockets,
    estimateTableColor,
    luminance,
    rgbToHsv,
  };
});
