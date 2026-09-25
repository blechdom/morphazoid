import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { HOCKET_SOUND_ENGINES, createHocketState, sanitizeHocketState, editHocketCell, resizeHocketPattern, hocketPatternSignature, hocketFocusGain } from '../src/instruments/hocket-loom/hocket-loom.js';
import { hocketSharedVoiceEvent, hocketMarkerPlan, HOCKET_MARKER_SOURCE_LIMIT } from '../src/instruments/hocket-loom/hocket-loom-audio.js';
const app = await readFile(new URL('../src/instruments/hocket-loom/hocket-loom-app.js', import.meta.url), 'utf8');
const audioClass = app.slice(app.indexOf('class HocketAudio {'), app.indexOf('\nconst audio = new HocketAudio();'));

function harness() {
 const calls = { shared: [], native: [], prepared: [], released: [], stopped: 0, disposed: 0 };
 class Bank {
  constructor() { this.active = new Set(); }
  async prepare(context, destination) { this.context = context; calls.prepared.push({ context, destination }); this.ready = true; }
  trigger(event) { calls.shared.push(event); return { when: event.when, stopAt: event.when + event.duration }; }
  releaseVoice(handle, when) { calls.released.push({ handle, when }); this.active.delete(handle); }
  stop() { calls.stopped++; this.active.clear(); }
  dispose() { calls.disposed++; this.stop(); }
 }
 const Class = new vm.Script(`(${audioClass})`).runInNewContext({
  SequencerVoiceBank: Bank, hocketMarkerPlan, hocketSharedVoiceEvent, hocketFocusGain,
  HOCKET_MARKER_SOURCE_LIMIT, unlockAudioContext() {},
  scheduleHocketMarker(context, master, plan, options) {
   calls.native.push({ context, master, plan, options });
   return { startTime: options.when, endTime: options.when + plan.durationSeconds, sources: [{ stop() {} }], nodes: [], safetyGain: null };
  },
 });
 const runtime = { setTimeout: fn => { fn(); return 1; } };
 const audio = new Class(runtime);
 const context = { currentTime: 4, state: 'running', async close() { this.state = 'closed'; } };
 audio.context = context;
 audio.master = { gain: { cancelScheduledValues() {}, setTargetAtTime() {} } };
 audio.sharedVoices = new Bank();
 return { audio, context, calls };
}

test('Original plus all 11 shared engines preserve score identity through edits and resizing', () => {
 assert.equal(HOCKET_SOUND_ENGINES.length, 12);
 assert.equal(new Set(HOCKET_SOUND_ENGINES.map(engine => engine.id)).size, 12);
 const original = createHocketState();
 assert.equal(original.soundEngine, 'original');
 for (const { id } of HOCKET_SOUND_ENGINES) {
  const selected = sanitizeHocketState({ ...original, soundEngine: id });
  assert.equal(selected.soundEngine, id);
  assert.equal(hocketPatternSignature(selected), hocketPatternSignature(original));
  assert.equal(editHocketCell(selected, 0, 0).soundEngine, id);
  assert.equal(resizeHocketPattern(selected, 8).soundEngine, id);
 }
 assert.equal(sanitizeHocketState({ soundEngine: 'missing' }).soundEngine, 'original');
});

test('shared events preserve pitch ordering, lane panning, focus normalization, and material envelopes', () => {
 const state = { ...createHocketState(), soundEngine: 'simd-chiptune', voiceCount: 4 };
 const low = hocketSharedVoiceEvent({ voice: 0, tone: 1 }, state, .12);
 const high = hocketSharedVoiceEvent({ voice: 3, tone: 8 }, state, .24);
 assert.equal(low.voice, 'simd-chiptune');
 assert.ok(high.frequency > low.frequency);
 assert.ok(low.pan < 0 && high.pan > 0);
 assert.ok(high.velocity > low.velocity);
 for (const soundSet of ['wood', 'metal', 'breath']) {
  const settings = { ...state, soundSet };
  const plan = hocketMarkerPlan({ ...settings, voice: 2, tone: 4 });
  const event = hocketSharedVoiceEvent({ voice: 2, tone: 4 }, settings, .2);
  assert.equal(event.duration, plan.durationSeconds);
  assert.ok(Object.values(event).filter(value => typeof value === 'number').every(Number.isFinite));
  assert.ok(event.velocity > 0 && event.velocity <= .78);
  assert.ok(event.attack > 0 && event.release > 0);
 }
});

test('a shared engine replaces the original strike and reuses the existing armed context/master', async () => {
 const { audio, context, calls } = harness();
 const settings = { ...createHocketState(), soundEngine: 'simd-303' };
 await audio.start(settings);
 assert.equal(calls.prepared.length, 1);
 assert.equal(calls.prepared[0].context, context);
 assert.equal(calls.prepared[0].destination, audio.master);
 audio.schedule([{ voice: 0, tone: 2 }], 4.1, settings, 12, 3);
 assert.equal(calls.shared.length, 1);
 assert.equal(calls.native.length, 0);
 assert.equal(calls.shared[0].voice, 'simd-303');
 assert.equal(audio.scheduledSteps[0], 12);
 assert.equal(audio.strikeHistory[0].material, 'simd-303');
});

test('Original stays on the unchanged native route and suspended Audio never triggers either engine', async () => {
 const { audio, context, calls } = harness();
 const settings = createHocketState();
 await audio.start(settings);
 assert.equal(calls.prepared.length, 0);
 audio.strike({ voice: 1, tone: 3 }, 4.1, settings);
 assert.equal(calls.native.length, 1);
 assert.equal(calls.shared.length, 0);
 context.state = 'suspended';
 audio.strike({ voice: 1, tone: 3 }, 4.2, { ...settings, soundEngine: 'simd-synth' });
 assert.equal(calls.shared.length, 0);
});

test('future-note cancellation, panic, and close include shared voices without a second output', async () => {
 const { audio, calls } = harness();
 const sounding = { when: 3.9 }, future = { when: 4.2 };
 audio.sharedVoices.active.add(sounding); audio.sharedVoices.active.add(future);
 audio.cancelFuture(4);
 assert.equal(calls.released.length, 1);
 assert.equal(calls.released[0].handle, future);
 assert.equal(audio.sharedVoices.active.has(sounding), true);
 audio.panic();
 assert.equal(calls.stopped, 1);
 await audio.close();
 assert.equal(calls.disposed, 1);
 assert.equal(audio.context, null);
 assert.equal(audio.sharedVoices, null);
});
