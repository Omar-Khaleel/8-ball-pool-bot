'use strict';

const assert = require('node:assert/strict');
global.window = { dispatchEvent() {} };
global.CustomEvent = function CustomEvent(type) { this.type = type; };
require('../geometry.js');
require('../vision.js');
require('../precision-vision.js');
require('../precision-geometry.js');

const Geometry = global.PoolVisionGeometry;
const Vision = global.PoolVision;

function createImage(width, height, rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    data[offset] = rgb[0];
    data[offset + 1] = rgb[1];
    data[offset + 2] = rgb[2];
    data[offset + 3] = 255;
  }
  return { data };
}

function drawCircle(image, width, height, cx, cy, radius, rgb) {
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      const offset = (y * width + x) * 4;
      image.data[offset] = rgb[0];
      image.data[offset + 1] = rgb[1];
      image.data[offset + 2] = rgb[2];
      image.data[offset + 3] = 255;
    }
  }
}

function drawLine(image, width, height, start, end, thickness, rgb) {
  const steps = Math.ceil(Geometry.distance(start, end));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps ? i / steps : 0;
    drawCircle(
      image,
      width,
      height,
      Math.round(start.x + (end.x - start.x) * t),
      Math.round(start.y + (end.y - start.y) * t),
      thickness,
      rgb
    );
  }
}

function testCueStickDisambiguation() {
  const width = 520;
  const height = 280;
  const image = createImage(width, height, [30, 112, 76]);
  drawCircle(image, width, height, 135, 145, 12, [235, 235, 232]);
  drawLine(image, width, height, { x: 127, y: 141 }, { x: 143, y: 149 }, 3, [130, 45, 80]);
  drawCircle(image, width, height, 410, 70, 12, [230, 230, 225]);
  drawLine(image, width, height, { x: 398, y: 82 }, { x: 255, y: 225 }, 3, [204, 151, 86]);
  drawLine(image, width, height, { x: 350, y: 130 }, { x: 255, y: 225 }, 3, [90, 35, 30]);

  const result = Vision.detectBalls(image, width, height, {
    colorThreshold: 42,
    expectedRadius: 12,
    minimumRadius: 7,
    maximumRadius: 22,
  });
  const cue = result.balls.find((ball) => ball.type === 'cue');
  assert.ok(cue, 'Expected a cue ball');
  assert.ok(Math.abs(cue.x - 410) < 5 && Math.abs(cue.y - 70) < 5, `Wrong cue at ${cue.x},${cue.y}`);
  assert.ok(cue.cueStickScore > 0.30, 'Expected long cue-stick evidence');
  const falseWhite = result.balls.find((ball) => Math.abs(ball.x - 135) < 5);
  assert.ok(falseWhite && falseWhite.type !== 'cue', 'False mostly-white ball must not become cue');
}

function testPrecisionGuide() {
  const balls = [
    { id: 1, x: 60, y: 100, radius: 8, type: 'cue' },
    { id: 2, x: 170, y: 100, radius: 8, type: 'solid' },
  ];
  const pockets = [{ id: 'right', x: 340, y: 100, radius: 13 }];
  const shots = Geometry.recommendShots({ balls, pockets, width: 360, height: 200, radius: 8, includeBanks: false });
  assert.ok(shots.length, 'Expected a shot');
  const shot = shots[0];
  assert.ok(shot.cueImpact, 'Expected cue-tip impact point');
  assert.ok(shot.objectContact, 'Expected object-ball contact point');
  assert.ok(shot.aimGateA && shot.aimGateB, 'Expected tolerance gate');
  assert.ok(shot.aimTolerance > 0, 'Expected positive tolerance');
  assert.ok(Geometry.distance(shot.ghost, shot.objectBall) > 15.5, 'Ghost center must be about two radii behind target');
}

testCueStickDisambiguation();
testPrecisionGuide();
console.log('Pool Vision precision tests passed.');
