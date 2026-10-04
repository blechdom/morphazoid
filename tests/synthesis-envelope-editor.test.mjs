import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNTH_ADSR_EDITOR_MODEL,
  adsrFromPoints,
  adsrPoints,
} from '../src/instruments/synthesis/envelope.js';

const close = (actual, expected, tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);
};

test('Shape-style T/A/D/S/R points round-trip the full Synthesaurus ADSR range', () => {
  for (const envelope of [
    { attack: .001, decay: .002, sustain: 0, release: .003 },
    { attack: .018, decay: .22, sustain: .8, release: .35 },
    { attack: 12, decay: 12, sustain: 1, release: 16 },
  ]) {
    const points = adsrPoints(envelope);
    assert.equal(points.length, 5);
    assert.deepEqual(SYNTH_ADSR_EDITOR_MODEL.labels, ['T', 'A', 'D', 'S', 'R']);
    const restored = adsrFromPoints(points);
    for (const key of Object.keys(envelope)) close(restored[key], envelope[key]);
  }
});

test('ADSR graph keeps T fixed, links D/S level, and gives each time its own log lane', () => {
  const original = adsrPoints({ attack: .02, decay: .4, sustain: .6, release: .8 });
  assert.deepEqual(SYNTH_ADSR_EDITOR_MODEL.fixedNodes, [0]);
  const fixedMove = SYNTH_ADSR_EDITOR_MODEL.moveNode(original, 0, { x: 1, y: 1 });
  assert.equal(fixedMove.length, original.length);
  for (const [index, point] of fixedMove.entries()) {
    close(point.x, original[index].x);
    close(point.y, original[index].y);
  }

  const decay = SYNTH_ADSR_EDITOR_MODEL.moveNode(original, 2, { x: .5, y: .23 });
  close(decay[2].y, .23); close(decay[3].y, .23);
  const sustain = SYNTH_ADSR_EDITOR_MODEL.moveNode(decay, 3, { x: 0, y: .91 });
  close(sustain[2].y, .91); close(sustain[3].y, .91);

  const short = adsrPoints({ attack: .001, decay: .002, sustain: .5, release: .003 });
  const long = adsrPoints({ attack: 12, decay: 12, sustain: .5, release: 16 });
  assert.ok(short[1].x < long[1].x);
  assert.ok(short[2].x < long[2].x);
  assert.ok(short[4].x < long[4].x);
});
