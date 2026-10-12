import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiMixerEngine, compileDeck } from '../src/instruments/midi-mixer/midi-mixer-engine.js';
import { MidiSampleClock } from '../src/instruments/midi-mixer/midi-mixer-clock.js';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';

// One beat with a short gate in its final sixteenth: the display can miss the
// entire attack/release between its last active frame and the completion.
const clip = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,
  77,84,114,107,0,0,0,12,90,144,60,100,5,128,60,0,1,255,47,0]).buffer;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('silent natural completion retains the final gates and exact finish time after skipped display frames', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  const source = engine.triggerSample(clip, { name: 'Final gate', midi: { transpose: 12 }, gain: .4 });
  now = 450; assert.equal(engine.state.samples.length, 1);
  now = 650;
  const state = engine.state, finished = state.finishedSamples[0];
  assert.equal(state.samples.length, 0); assert.equal(finished.id, source.id);
  near(finished.finishedAt, .5); assert.equal(finished.positionBeats, 1);
  assert.equal(finished.analysis.notes.length, 1); assert.equal(finished.midi.transpose, 12); assert.equal(finished.gain, .4);
  assert.equal(finished.ended, true); assert.equal(finished.pending, false); assert.equal(finished.cycle, 0);
  engine.setTempo(240); now = 900; near(engine.state.finishedSamples[0].finishedAt, .5);
  finished.midi.transpose = 0; assert.equal(engine.state.finishedSamples[0].midi.transpose, 12);
  now = 31000; assert.equal(engine.state.finishedSamples.length, 0);
  now = 32000; assert.equal(engine.state.finishedSamples.length, 0, 'expired sources never reappear');
  await engine.dispose();
});

test('finish metadata follows sync changes, tempo edits, quantized starts and the last loop cycle', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  engine.triggerSample(clip); now = 250; engine.setTempo(240); now = 500;
  near(engine.state.finishedSamples[0].finishedAt, .375);
  const free = engine.triggerSample(clip, { sync: false }); now = 1100;
  near(engine.state.finishedSamples.find(item => item.id === free.id).finishedAt, 1);
  const loop = engine.triggerSample(clip, { loop: true }); now = 1725;
  engine.configureSample(loop.id, { loop: false }); now = 2000;
  const finished = engine.state.finishedSamples.find(item => item.id === loop.id);
  assert.equal(finished.cycle, 2); near(finished.finishedAt, 1.85);
  await engine.loadDeck(0, clip); engine.play(); now = 2050;
  const queued = engine.triggerSample(clip); assert.equal(queued.pending, true);
  now = 2700; near(engine.state.finishedSamples.find(item => item.id === queued.id).finishedAt, 2.5);
  await engine.dispose();
});

test('explicit stops and stolen slots never become completions; retention and disposal stay bounded', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  const stopped = engine.triggerSample(clip); now = 100; engine.stopSample(stopped.id);
  const stolen = engine.triggerSample(clip);
  for (let index = 0; index < 4; index++) engine.triggerSample(clip);
  engine.stopSamples(); now = 1000;
  assert.deepEqual(engine.state.finishedSamples, []);
  for (let index = 0; index < 12; index++) { engine.triggerSample(clip); now += 600; assert.equal(engine.state.samples.length, 0); }
  const history = engine.state.finishedSamples;
  assert.equal(history.length, 8); assert.ok(history.every(item => ![stopped.id, stolen.id].includes(item.id)));
  assert.equal(new Set(history.map(item => item.id)).size, 8);
  await engine.dispose(); assert.equal(engine.state.finishedSamples.length, 0);
});

test('processor completion supplies exact frame-clock time and survives removal from active engine samples', async () => {
  let now = 0;
  const engine = new MidiMixerEngine({ runtime: { performance: { now: () => now } } });
  const sample = engine.triggerSample(clip), analysis = parseMidi(clip), data = compileDeck(analysis);
  const events = [], clock = new MidiSampleClock({ emit: (_source, event, frame) => events.push({ ...event, frame }) });
  clock.load(0, { id: sample.id, revision: sample.revision, data, startBeat: 0, sync: true, loop: false });
  clock.process(30000, 48000, 120);
  const telemetry = clock.snapshot(); assert.equal(telemetry.length, 1);
  near(telemetry[0].finishedAt, .5); assert.equal(telemetry[0].positionBeats, 1);
  assert.equal(events.find(event => event.kind === 9).frame, 22500);
  assert.equal(events.find(event => event.kind === 8).frame, 23750);
  // This is the same receiver invoked by the actual worklet 'state' handler.
  now = 625; engine._receiveSampleTimings(telemetry, clock.beat, clock.seconds);
  assert.equal(engine._samples.length, 0); near(engine.state.finishedSamples[0].finishedAt, .5);
  assert.equal(clock.snapshot().length, 0, 'completion telemetry is consumed once');
  engine.triggerSample(clip); engine.stopSamples(); clock.stopAll();
  engine._receiveSampleTimings(telemetry, clock.beat, clock.seconds);
  assert.equal(engine.state.finishedSamples.length, 1, 'late duplicate telemetry cannot invent a canceled source');
  await engine.dispose();
});
