'use strict';

const assert = require('node:assert/strict');
const Geometry = require('../geometry.js');
global.PoolVisionGeometry = Geometry;
const Core = require('../simple-core.js');

const cue = { id: 1, type: 'cue', x: 40, y: 100, radius: 10 };
const target = { id: 2, type: 'solid', x: 140, y: 100, radius: 10 };
const pocket = { id: 'r', x: 300, y: 100, radius: 18 };

const pocketed = Core.predict({
  cue,
  direction: { x: 1, y: 0 },
  balls: [cue, target],
  pockets: [pocket],
  width: 300,
  height: 200,
  radius: 10,
});
assert.ok(pocketed);
assert.equal(pocketed.target.id, 2);
assert.equal(pocketed.outcome, 'pocket');
assert.ok(Math.abs(pocketed.cueEnd.x - 120) < 0.01);
assert.ok(Math.abs(pocketed.targetEnd.x - 300) < 0.01);

const missed = Core.predict({
  cue,
  direction: { x: 0, y: 1 },
  balls: [cue, target],
  pockets: [],
  width: 300,
  height: 200,
  radius: 10,
});
assert.ok(missed);
assert.equal(missed.target, null);
assert.equal(missed.outcome, 'rail');

const blocker = { id: 3, type: 'stripe', x: 210, y: 100, radius: 10 };
const blocked = Core.predict({
  cue,
  direction: { x: 1, y: 0 },
  balls: [cue, target, blocker],
  pockets: [pocket],
  width: 300,
  height: 200,
  radius: 10,
});
assert.equal(blocked.outcome, 'ball');
assert.equal(blocked.blocker.id, 3);

console.log('Simple guider core tests passed.');
