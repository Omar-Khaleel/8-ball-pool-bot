'use strict';

const assert = require('node:assert/strict');
const Geometry = require('../geometry.js');
const Vision = require('../vision.js');

function testGeometry() {
  assert.equal(Math.round(Geometry.distance({ x: 0, y: 0 }, { x: 3, y: 4 })), 5);
  assert.equal(
    Math.round(Geometry.distancePointToSegment({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })),
    4
  );

  const balls = [
    { id: 1, x: 60, y: 100, radius: 8, type: 'cue' },
    { id: 2, x: 170, y: 100, radius: 8, type: 'solid' },
  ];
  const pockets = [{ id: 'right', x: 340, y: 100 }];
  const shots = Geometry.recommendDirectShots({ balls, pockets, width: 360, height: 200, radius: 8 });
  assert.ok(shots.length >= 1, 'Expected a clear direct shot');
  assert.equal(shots[0].objectBallId, 2);

  const blocked = [
    ...balls,
    { id: 3, x: 115, y: 100, radius: 8, type: 'stripe' },
  ];
  const blockedShots = Geometry.recommendDirectShots({
    balls: blocked,
    pockets,
    width: 360,
    height: 200,
    radius: 8,
  });
  assert.equal(blockedShots.length, 0, 'Blocked cue path should be rejected');
}

function createImage(width, height, background) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = background[0];
    data[offset + 1] = background[1];
    data[offset + 2] = background[2];
    data[offset + 3] = 255;
  }
  return { data };
}

function drawCircle(image, width, height, cx, cy, radius, rgb) {
  for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      const offset = (y * width + x) * 4;
      image.data[offset] = rgb[0];
      image.data[offset + 1] = rgb[1];
      image.data[offset + 2] = rgb[2];
      image.data[offset + 3] = 255;
    }
  }
}

function testVision() {
  const width = 420;
  const height = 220;
  const image = createImage(width, height, [28, 125, 86]);
  drawCircle(image, width, height, 90, 110, 10, [238, 238, 230]);
  drawCircle(image, width, height, 205, 110, 10, [235, 170, 32]);
  drawCircle(image, width, height, 320, 110, 10, [38, 38, 42]);

  const result = Vision.analyze(image, width, height, { colorThreshold: 42 });
  assert.ok(result.balls.length >= 3, `Expected at least three balls, found ${result.balls.length}`);
  assert.ok(result.balls.some((ball) => ball.type === 'cue'), 'Expected cue ball classification');
  assert.ok(result.pockets.length === 6, 'Expected six pocket anchors');

  const tracker = new Vision.BallTracker();
  const first = tracker.update(result.balls, 1000, result.radius);
  const shifted = result.balls.map((ball) => ({ ...ball, x: ball.x + 3 }));
  const second = tracker.update(shifted, 1100, result.radius);
  assert.equal(first.length, second.length);
  assert.ok(second.some((ball) => ball.vx > 0), 'Expected positive tracked velocity');
}

testGeometry();
testVision();
console.log('All Pool Vision tests passed.');
