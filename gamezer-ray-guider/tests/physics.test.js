'use strict';

const assert = require('node:assert/strict');
const Physics = require('../physics.js');

const hit = Physics.rayCircle(
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 20, y: 0 },
  4,
  0
);
assert.equal(hit, 16);

const collision = Physics.collisionResult(
  { x: 10, y: 50 },
  { x: 50, y: 50 },
  { x: 1, y: 0 },
  5
);
assert.ok(collision);
assert.equal(Math.round(collision.cueAtContact.x), 40);
assert.equal(Math.round(collision.targetDirection.x), 1);
assert.equal(Math.round(collision.targetDirection.y), 0);

const rect = { x: 0, y: 0, width: 200, height: 100 };
const rail = Physics.firstRectHit({ x: 50, y: 50 }, { x: 1, y: 0 }, rect, 5);
assert.equal(rail.rail, 'right');
assert.equal(rail.x, 195);

const pocket = Physics.targetEndpoint(
  { x: 100, y: 50 },
  { x: 0, y: -1 },
  rect,
  5
);
assert.equal(pocket.outcome, 'pocket');
assert.equal(pocket.pocketId, 'tm');

console.log('Gamezer Ray Guider physics tests passed.');
