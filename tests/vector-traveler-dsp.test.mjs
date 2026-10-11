import test from 'node:test';
import assert from 'node:assert/strict';
import { TraceDSP } from '../src/instruments/vector-fractals/trace-dsp.js';

const TAU = 2 * Math.PI, SIZE = 2048;
const state = { contourReader: 'traveler', traceRate: 1, travelerOctaves: 1,
  layerEnabled: [true, false, false], layerVoices: ['sine', 'sine', 'sine'], bendTimbre: 0, foldTimbre: 0 };
const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
const filled = value => new Float32Array(SIZE).fill(value);
function contact(turn = t => -TAU * t, turnPerLap = -TAU, y = 0) {
  return { x: filled(0), y: filled(y), bend: filled(0), fold: filled(0),
    turn: Float32Array.from({ length: SIZE }, (_, index) => turn(index / SIZE)), turnPerLap };
}
function bank(contacts = [contact()], reader = 'traveler') {
  return { id: 3, reader, view: { aspect: 1 }, layers: contacts.map(item => ({ contacts: [item], events: [] })) };
}
function make(options = {}, input = bank(), travel = 0, sampleRate = 24000) {
  const dsp = new TraceDSP(sampleRate); dsp.setState({ ...state, ...options });
  Object.assign(dsp.params, dsp.targets); dsp.rate = dsp.targetRate;
  dsp.setBank(input); dsp.setPhase(travel); return dsp;
}
function render(dsp, seconds, moving = true, baseFrequency = 160) {
  const left = new Float32Array(Math.round(seconds * dsp.sampleRate)), right = new Float32Array(left.length);
  const pair = new Float64Array(2);
  for (let index = 0; index < left.length; index++) {
    dsp.sample(pair, baseFrequency, moving); left[index] = pair[0]; right[index] = pair[1];
  }
  return { left, right };
}

test('Traveler turns right up and left down continuously; height and global Shepard direction do not set its pitch', () => {
  for (const [direction, expected] of [[-1, 80 * 2 ** .25], [1, 80 * 2 ** -.25]]) {
    for (const y of [-.4, .4]) {
      const dsp = make({ pitchDepth: 4, shepardDirection: 'fall', shepardCycles: 4 }, bank([contact(t => direction * TAU * t, direction * TAU, y)]));
      render(dsp, .25);
      const sound = render(dsp, .4, false);
      close(dsp.frequencies[0], expected, 1e-5); assert.ok(rms(sound.left) > .1);
      close(dsp.travelerPitch[0], -direction * .25, 1e-7);
    }
  }
  const fine = make(); render(fine, .031); render(fine, .4, false);
  close(fine.frequencies[0], 80 * 2 ** .031, 1e-5);
});

test('Traveler samples an unwrapped seam and all completed laps instead of returning to its starting pitch', () => {
  for (const laps of [0, 3, 42, 800]) {
    const dsp = make({}, bank(), laps + .997); render(dsp, .0001);
    const start = dsp.travelerPitch[0], pair = new Float64Array(2);
    let previous = start;
    for (let index = 0; index < 240; index++) {
      dsp.sample(pair, 160, true);
      const delta = dsp.travelerPitch[0] - previous;
      assert.ok(delta >= 0 && delta < .00005, `seam delta ${delta}`); previous = dsp.travelerPitch[0];
    }
    close(dsp.travelerPitch[0] - start, .01, 2e-7);
    close(dsp.travelerPitch[0], dsp.travel - (laps + .997) - 1 / dsp.sampleRate, 2e-7);
  }
});

test('each detail layer drives its own signed Shepard pitch, including concave changes of direction', () => {
  const contacts = [contact(), contact(t => TAU * t, TAU), contact(t => TAU * .25 * Math.sin(TAU * t), 0)];
  const dsp = make({ layerEnabled: [true, true, true], layerVoices: ['shepard', 'shepard', 'shepard'] }, bank(contacts));
  render(dsp, .25); render(dsp, .4, false);
  close(dsp.travelerPitch[0], .25); close(dsp.travelerPitch[1], -.25); close(dsp.travelerPitch[2], -.25);
  close(dsp.travelerPositions[0], .25); close(dsp.travelerPositions[1], .75);
  const before = Array.from(dsp.travelerPitch); render(dsp, .1);
  assert.ok(dsp.travelerPitch[0] > before[0]); assert.ok(dsp.travelerPitch[1] < before[1]);
  assert.ok(dsp.travelerPitch[2] > before[2], 'the curl changes from left to right turning');
});

test('Traveler Shepard depends on contour turns rather than the other readers’ rise/fall clock', () => {
  const input = bank([contact(t => -.6 * Math.sin(TAU * t), 0)]);
  const a = make({ layerVoices: ['shepard'], shepardDirection: 'rise', shepardCycles: 4 }, input);
  const b = make({ layerVoices: ['shepard'], shepardDirection: 'fall', shepardCycles: 0 }, input);
  render(a, .5); render(b, .5);
  assert.deepEqual(render(a, .3).left, render(b, .3).left);
  assert.notEqual(a.shepardTravel, b.shepardTravel);
  close(a.travelerPitch[0], b.travelerPitch[0]);
});

test('Traveler Shepard crosses octaves both ways without an impulse and keeps sounding for many laps', () => {
  for (const direction of [-1, 1]) {
    const dsp = make({ layerVoices: ['shepard'] }, bank([contact(t => direction * TAU * t, direction * TAU)]));
    render(dsp, .5); const sound = render(dsp, 5);
    let jump = 0;
    for (let index = 1; index < sound.left.length; index++) jump = Math.max(jump, Math.abs(sound.left[index] - sound.left[index - 1]));
    assert.ok(jump < .018, `octave seam sample delta ${jump}`);
    assert.ok(rms(sound.left) > .07);
    close(dsp.travelerPitch[0], -direction * (dsp.travel - 1 / dsp.sampleRate), 3e-7);
    assert.ok(sound.left.every(value => Number.isFinite(value) && Math.abs(value) < .91));
  }
});

test('first activation joins late transport at its reference pitch and retains audible future contour detail', () => {
  for (const travel of [4.3, 50.75, 50000.37]) for (const direction of [-1, 1]) {
    const input = bank([contact(t => direction * TAU * t, direction * TAU)]);
    const dsp = make({}, input, travel); render(dsp, .4, false);
    close(dsp.travelerPitch[0], 0); close(dsp.frequencies[0], 80, 1e-5);
    render(dsp, .25); render(dsp, .4, false);
    close(dsp.travelerPitch[0], -direction * .25, 2e-7);
    close(dsp.frequencies[0], 80 * 2 ** (-direction * .25), 2e-5);
  }
  const dsp = make({ contourReader: 'trace' }, bank([contact()], 'trace'), 90.4);
  render(dsp, .2); dsp.setState(state); dsp.setBank(bank()); render(dsp, .4, false);
  close(dsp.travelerPitch[0], 0); close(dsp.frequencies[0], 80, 1e-5);
  render(dsp, .2); render(dsp, .4, false);
  close(dsp.travelerPitch[0], .2, 1e-7);
});

test('restored long-running ordinary voices keep their bounded excursion while Shepard keeps cycling', () => {
  for (const sampleRate of [22050, 48000, 96000]) for (const direction of [-1, 1]) {
    const input = bank([contact(t => direction * TAU * t, direction * TAU)]);
    const ordinary = make({}, input, 50000.37, sampleRate); render(ordinary, .4, false);
    const snapshot = ordinary.snapshotTraveler();
    snapshot.pitch[0] = snapshot.smoothedPitch[0] = -direction * 50000.37;
    ordinary.restoreTraveler(snapshot); render(ordinary, .4, false);
    close(ordinary.frequencies[0], direction < 0 ? 80 * 16 : 8, 1e-5);
    const endless = make({ layerVoices: ['shepard'] }, input, 50000.37, sampleRate);
    endless.restoreTraveler(snapshot);
    render(endless, .4); const sound = render(endless, .2);
    assert.ok(rms(sound.left) > .08);
    assert.ok(sound.left.every(value => Number.isFinite(value) && Math.abs(value) < .91));
    assert.ok(endless.travelerPositions[0] >= 0 && endless.travelerPositions[0] < 1);
  }
});

test('late-run source replacements and queued refinement preserve pitch while accepting the new turning profile', () => {
  const dsp = make({ layerVoices: ['shepard'] }, bank(), 800.4); render(dsp, .4);
  const pitch = dsp.travelerPitch[0], phases = Array.from(dsp.travelerPhases);
  dsp.setBank(bank([contact(t => TAU * t + 4, TAU)]));
  assert.deepEqual(Array.from(dsp.travelerPhases), phases, 'geometry arrival never resets oscillators');
  dsp.setBank(bank([contact(t => TAU * .3 * Math.sin(TAU * t), 0)]));
  render(dsp, .25);
  assert.ok(Math.abs(dsp.travelerPitch[0] - pitch) < .5, 'edits do not replay hundreds of lap transpositions');
  assert.equal(dsp.previous, null); assert.equal(dsp.pending, null);
  const held = dsp.travelerPitch[0]; render(dsp, 1);
  close(dsp.travelerPitch[0], held, 5e-7);
});

test('live span edits affect future turns, zero holds pitch, and pause/reset preserve the accumulated note', () => {
  const dsp = make({}, bank(), 700.25); render(dsp, .4);
  const pitch = dsp.travelerPitch[0];
  dsp.setState({ ...state, travelerOctaves: 4 }); render(dsp, .5);
  assert.ok(dsp.travelerPitch[0] > pitch + 1.8 && dsp.travelerPitch[0] < pitch + 2.1);
  dsp.setState({ ...state, travelerOctaves: 0 }); render(dsp, .5);
  const held = dsp.travelerPitch[0]; render(dsp, .5); close(dsp.travelerPitch[0], held);
  dsp.setState(state); render(dsp, .4);
  const travel = dsp.travel;
  render(dsp, .001, false); // Observe the last completed sample-clock step once.
  const paused = dsp.travelerPitch[0];
  render(dsp, .4, false); close(dsp.travel, travel); close(dsp.travelerPitch[0], paused);
  dsp.reset(); render(dsp, .2, false); close(dsp.travel, 0); close(dsp.travelerPitch[0], paused);
  render(dsp, .2); close(dsp.travelerPitch[0] - paused, .2 - 1 / dsp.sampleRate, 1e-7);
});

test('Traveler snapshot restores musical accumulation at the current position without replaying Audio-off turns', () => {
  const input = bank(), original = make({}, input, 200.25); render(original, .4);
  original.setState({ ...state, travelerOctaves: 2 }); render(original, .4);
  const snapshot = original.snapshotTraveler(), elapsed = .37;
  const resumed = make({ travelerOctaves: 2 }, input, original.travel + elapsed);
  resumed.restoreTraveler(JSON.parse(JSON.stringify(snapshot))); render(resumed, .001, false);
  close(resumed.travelerPitch[0], original.travelerPitch[0], 3e-7);
  assert.ok(resumed.travelerPositions[0] >= 0 && resumed.travelerPositions[0] < 1);
  const before = resumed.snapshotTraveler(); resumed.restoreTraveler({ ...snapshot, pitch: [NaN] });
  assert.deepEqual(resumed.snapshotTraveler(), before, 'malformed persisted state is ignored transactionally');
});

test('reader changes hold Traveler history and resuming never replays time spent in another reader', () => {
  const dsp = make({}, bank(), 30.4); render(dsp, .4);
  const pitch = dsp.travelerPitch[0], carrier = dsp.carriers[0], travel = dsp.travel;
  dsp.setState({ ...state, contourReader: 'radar' });
  close(dsp.carriers[0], carrier); close(dsp.travel, travel);
  render(dsp, 2); close(dsp.travelerPitch[0], pitch);
  dsp.setState(state); render(dsp, .2, false);
  close(dsp.travelerPitch[0], pitch);
  render(dsp, .2); close(dsp.travelerPitch[0] - pitch, .2 - 1 / dsp.sampleRate, 1e-7);
});

test('Traveler drums use their explicit base pitch rather than a hidden height mapping', () => {
  for (const y of [-.4, .4]) {
    const input = bank([contact(undefined, undefined, y)]);
    input.layers[0].events = [{ phase: .2, bead: 3, x: 0, y, bend: 0, fold: 0 }];
    const dsp = make({ layerSustain: [false], layerDrums: [true], drumPitch: 200, pitchDepth: 4 }, input);
    const sound = render(dsp, .3); close(dsp.drumVoices[0].frequency, 100);
    assert.equal(dsp.drumTriggerCounts[0], 1); assert.ok(rms(sound.left) > .005);
  }
});

test('invalid turning input remains bounded and silent when its contact is rejected', () => {
  const broken = contact(); broken.turn[30] = NaN;
  const dsp = make({ travelerOctaves: Infinity }, bank([broken]));
  assert.equal(rms(render(dsp, .2).left), 0);
  dsp.setBank(bank([contact(() => 1e30, 1e30)]));
  dsp.setState({ ...state, travelerOctaves: 4, layerVoices: ['shepard'] });
  const sound = render(dsp, .4);
  assert.ok(sound.left.every(value => Number.isFinite(value) && Math.abs(value) <= .91));
});
