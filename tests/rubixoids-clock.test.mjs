import assert from 'node:assert/strict';
import test from 'node:test';
import { RubixoidsClock } from '../src/instruments/rubixoids/clock.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);
function fixture() {
  let time = 10;
  const clock = new RubixoidsClock({ now: () => time, tempo: 120, swing: .2 });
  return { clock, advance(seconds) { time += seconds; } };
}

test('native pulse divisions share quarter beats and preserve their swung subdivisions', () => {
  const { clock } = fixture();
  clock.play({ leadSeconds: .05 });
  for (const division of [1, 2, 4, 8, 16]) {
    const start = clock.grid(0, { division });
    close(start.time, 10.05);
    close(start.duration, .5 / division * 1.2);
    close(clock.grid(1, { division }).duration, .5 / division * .8);
    close(clock.grid(division * 2, { division }).time, 11.05);
  }
  const faces = clock.grid(1, { division: 4, subdivisions: 3 });
  close(faces.duration, .5 / 4 * 1.2 / 3);
  close(faces.pulseDuration, .5 / 4 * 1.2);
  close(clock.grid(6, { division: 4, subdivisions: 3 }).time, 10.3);
});

test('next boundary respects scheduling lead through long and short pulses', () => {
  const { clock } = fixture();
  clock.play({ leadSeconds: .05 });
  assert.equal(clock.next({ division: 4, minTime: 10.012 }).ordinal, 0);
  for (const division of [1, 2, 4, 8, 16]) {
    for (const subdivisions of [1, 3]) {
      for (let ordinal = 0; ordinal < 30; ordinal++) {
        const point = clock.grid(ordinal, { division, subdivisions });
        assert.equal(clock.next({ division, subdivisions, minTime: point.time }).ordinal, ordinal);
        assert.equal(clock.next({ division, subdivisions, minTime: point.time + .0001 }).ordinal, ordinal + 1);
      }
    }
  }
});

test('audio clock wins over delayed UI time and dimension handoff preserves phase', () => {
  const { clock, advance } = fixture();
  const cube = { currentTime: 2, state: 'running' };
  clock.attach('3d', cube);
  clock.play({ leadSeconds: 0 });
  advance(2);
  cube.currentTime += .25;
  close(clock.snapshot().beat, .5);
  clock.detach('3d');
  advance(.15);
  close(clock.snapshot().beat, .8);
  const hyper = { currentTime: 0, state: 'running' };
  clock.attach('4d', hyper);
  close(clock.snapshot().beat, .8);
  hyper.currentTime = .35;
  close(clock.snapshot().beat, 1.5);
  close(clock.audioTime(hyper, clock.now() + .1), .45);
  clock.detach('3d');
  assert.equal(clock.snapshot().owner, '4d');
});

test('tempo and swing edits preserve beat while changing future grid deadlines', () => {
  const { clock, advance } = fixture();
  clock.play({ leadSeconds: 0 });
  advance(.35);
  const beat = clock.snapshot().beat;
  const revision = clock.revision;
  assert.equal(clock.configure({ tempo: 240, swing: .4 }), true);
  close(clock.snapshot().beat, beat);
  close(clock.grid(2, { division: 1 }).time, 10.35 + (2 - beat) * .25);
  assert.equal(clock.revision, revision + 1);
  assert.equal(clock.configure({ tempo: 240, swing: .4 }), false);
  advance(.25);
  close(clock.snapshot().beat, beat + 1);
});

test('pause freezes the common beat and resume does not reset it', () => {
  const { clock, advance } = fixture();
  clock.play({ leadSeconds: 0 });
  advance(.4);
  clock.pause();
  close(clock.snapshot().beat, .8);
  advance(20);
  close(clock.snapshot().beat, .8);
  clock.play({ leadSeconds: .05 });
  close(clock.snapshot().beat, .8);
  advance(.3);
  close(clock.snapshot().beat, 1.3);
});

for (const state of ['suspended', 'interrupted']) {
  test(`attached ${state} audio holds the beat and resumes without a catch-up freeze`, () => {
    const { clock, advance } = fixture();
    const context = { currentTime: 2, state: 'running' };
    clock.attach('3d', context);
    clock.play({ leadSeconds: 0 });
    context.currentTime += .25;
    advance(.25);
    close(clock.snapshot().beat, .5);
    context.state = state;
    advance(5);
    close(clock.snapshot().beat, .5);
    assert.equal(clock.snapshot().source, 'audio');
    close(clock.audioTime(context, clock.grid(2).time), 3);
    context.state = 'running';
    context.currentTime += .125;
    advance(.125);
    close(clock.snapshot().beat, .75);
    context.state = state;
    clock.detach('3d');
    advance(.25);
    close(clock.snapshot().beat, 1.25);
    assert.equal(clock.snapshot().source, 'silent');
  });
}
