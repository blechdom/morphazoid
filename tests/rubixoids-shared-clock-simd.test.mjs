import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RubixoidsClock } from '../src/instruments/rubixoids/clock.js';
import { createRubixSequenceSnapshot, createSolvedRubixCube } from '../src/instruments/rubixoids/rubix/rubix.js';
import { createRubixSimdSurfacePatterns, rubixSimdConfigurations, RubixSurfaceSimd303 } from '../src/instruments/rubixoids/rubix/rubix-simd-surface.js';
import { RUBIX_WEBGPU_303_DEFAULTS } from '../src/instruments/rubixoids/rubix/rubix-webgpu-303.js';

globalThis.sampleRate = 48_000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() { this.messages = []; this.port = { postMessage: data => this.messages.push(data) }; }
};
globalThis.registerProcessor = () => {};
const { RubixSimd303Processor } = await import('../src/instruments/rubixoids/rubix/rubix-simd-303-processor.js');
const scalarBytes = await readFile(new URL('../assets/wasm/simd-303-scalar.wasm', import.meta.url));
const simdBytes = await readFile(new URL('../assets/wasm/simd-303-simd.wasm', import.meta.url));

function faces({ readingMode = 'face', tempo = 120, swing = .3 } = {}) {
  return createRubixSimdSurfacePatterns(createRubixSequenceSnapshot(createSolvedRubixCube(3)), {
    readingMode, tempo, baseParams: { ...RUBIX_WEBGPU_303_DEFAULTS, swing },
  });
}

function rig({ readingMode = 'face', tempo = 120, swing = .3 } = {}) {
  globalThis.currentTime = 0;
  let wall = 0;
  const context = { state: 'running', get currentTime() { return globalThis.currentTime; } };
  const clock = new RubixoidsClock({ now: () => wall, tempo, swing });
  clock.attach('3d', context);
  clock.play();
  const source = faces({ readingMode, tempo, swing });
  const processor = new RubixSimd303Processor();
  processor.handleMessage({ type: 'install', scalarBytes, simdBytes, faces: rubixSimdConfigurations(source) });
  processor.handleMessage({ type: 'visibility', gains: Object.fromEntries(source.flatMap(face => face.stickerIds.map(id => [id, .5]))) });
  let resets = 0;
  for (const voice of processor.voices) {
    const kernel = voice.kernel;
    voice.kernel = { ...kernel, exports: { ...kernel.exports, reset() { resets += 1; return kernel.exports.reset(); } } };
  }
  const subdivisions = readingMode === 'face' ? 3 : 1;
  const options = { division: 4, subdivisions };
  const align = ({ step, resume = false } = {}) => {
    const grid = clock.next({ ...options, minTime: clock.now() + (resume ? .012 : 0) });
    const audioTime = clock.audioTime(context, grid.time);
    processor.handleMessage({ type: 'clock', audioTime, quarterBeat: grid.beat,
      tempo: clock.tempo, swing: clock.swing, revision: clock.revision,
      ...(resume ? { startAt: audioTime } : {}), ...(Number.isFinite(step) ? { step } : {}) });
    return { ...grid, audioTime };
  };
  return { clock, context, processor, align, options, resets: () => resets, wallAdvance: seconds => { wall += seconds; } };
}

function render(processor, startFrame, frames) {
  const output = [];
  for (let offset = 0; offset < frames; offset += 128) {
    globalThis.currentTime = (startFrame + offset) / sampleRate;
    const channels = [new Float32Array(128), new Float32Array(128)];
    processor.process([], [channels]);
    output.push(...channels[0]);
  }
  globalThis.currentTime = (startFrame + frames) / sampleRate;
  return output;
}

function assertSound(samples) {
  assert.ok(samples.every(Number.isFinite));
  assert.ok(samples.some(sample => Math.abs(sample) > .001));
}

test('owned SIMD joins the initial shared swung grid with its parked score cursor and six intact kernels', () => {
  const { processor, clock, align, options, resets } = rig();
  const first = align({ resume: true, step: 5 });
  assert.equal(first.ordinal, 0);
  assert.equal(first.audioTime, .045);
  processor.handleMessage({ type: 'playback', enabled: true });
  assertSound(render(processor, 0, 16_384));
  const steps = processor.messages.filter(message => message.type === 'step');
  assert.ok(steps.length >= 7);
  for (let index = 0; index < 7; index += 1) {
    assert.equal(steps[index].step, (5 + index) % 27);
    assert.ok(Math.abs(steps[index].time - clock.grid(index, options).time) < 2 / sampleRate);
  }
  assert.equal(processor.voices.length, 6);
  assert.equal(processor.backend, 'simd');
  assert.equal(resets(), 0);
  assert.ok(Math.abs(processor.beat - clock.beatAt() * 4) < 2 / sampleRate * processor.rate);
});

test('owned SIMD resumes on the clock advanced by another mode without clearing envelopes or oscillator state', () => {
  const { processor, clock, context, align, options, resets, wallAdvance } = rig();
  align({ resume: true, step: 0 });
  processor.handleMessage({ type: 'playback', enabled: true });
  assertSound(render(processor, 0, 8192));
  const elapsed = processor.elapsed;
  const kernels = processor.voices.map(voice => voice.kernel);
  processor.handleMessage({ type: 'playback', enabled: false });
  clock.detach('3d');
  wallAdvance(.7);
  const other = { state: 'running', currentTime: 20 };
  clock.attach('2d', other);
  other.currentTime += .4;
  const beatWhileHidden = clock.beatAt();
  clock.detach('2d');
  clock.attach('3d', context);
  const first = align({ resume: true, step: 7 });
  assert.equal(processor.elapsed, elapsed);
  assert.deepEqual(processor.voices.map(voice => voice.kernel), kernels);
  assert.equal(resets(), 0);
  assert.ok(first.beat >= beatWhileHidden);
  processor.messages.length = 0;
  processor.handleMessage({ type: 'playback', enabled: true });
  assertSound(render(processor, 8192, 8192));
  const steps = processor.messages.filter(message => message.type === 'step');
  assert.ok(steps.length > 2);
  for (let index = 0; index < Math.min(4, steps.length); index += 1) {
    assert.equal(steps[index].step, (7 + index) % 27);
    const expected = first.audioTime + clock.grid(first.ordinal + index, options).time - first.time;
    assert.ok(Math.abs(steps[index].time - expected) < 2 / sampleRate);
  }
  assert.ok(processor.elapsed > elapsed);
  assert.ok(Math.abs(processor.beat - clock.beatAt() * 4) < 2 / sampleRate * processor.rate);
  assert.equal(resets(), 0);
});

test('owned SIMD live tempo and swing edits follow the shared anchor and retain the score offset and kernels', () => {
  const { processor, clock, align, options, resets } = rig();
  align({ resume: true, step: 3 });
  processor.handleMessage({ type: 'playback', enabled: true });
  assertSound(render(processor, 0, 8192));
  const elapsed = processor.elapsed;
  const scoreOffset = processor.scorePhaseOffset;
  const kernels = processor.voices.map(voice => voice.kernel);
  const oldRate = processor.rate;
  processor.handleMessage({ type: 'configure', faces: rubixSimdConfigurations(faces({ tempo: 211, swing: .16 })) });
  assert.equal(processor.rate, oldRate, 'pattern configuration must not become a separate tempo source');
  const beforeBeat = clock.beatAt();
  clock.configure({ tempo: 211, swing: .16 });
  assert.equal(clock.beatAt(), beforeBeat);
  align();
  assert.equal(processor.elapsed, elapsed);
  assert.equal(processor.scorePhaseOffset, scoreOffset);
  assert.deepEqual(processor.voices.map(voice => voice.kernel), kernels);
  assert.equal(resets(), 0);
  processor.messages.length = 0;
  const updateTime = currentTime;
  assertSound(render(processor, 8192, 12_288));
  const steps = processor.messages.filter(message => message.type === 'step' && message.time > updateTime + .03);
  assert.ok(steps.length >= 5);
  for (const step of steps) {
    const expected = clock.next({ ...options, minTime: step.time - 2 / sampleRate });
    assert.ok(Math.abs(step.time - expected.time) < 2 / sampleRate);
  }
  assert.ok(Math.abs(processor.beat - clock.beatAt() * 4) < 2 / sampleRate * processor.rate);
  assert.equal(resets(), 0);
});


test('parked SIMD cursor follows audio time when every worklet/visual callback is stale', () => {
  const { processor, clock, context, options, resets } = rig();
  const surface = new RubixSurfaceSimd303();
  surface.updateSurfacePatterns(faces());
  surface.context = context;
  // Messages reach the real processor, but no processor message is delivered
  // back to the surface: both lastStatus and any UI playhead remain stale.
  surface.node = { port: { postMessage: message => processor.handleMessage(message) } };
  const first = clock.next({ ...options, minTime: clock.now() + .012 });
  const firstTime = clock.audioTime(context, first.time);
  surface.syncClock({ audioTime: firstTime, quarterBeat: first.beat,
    tempo: clock.tempo, swing: clock.swing, revision: clock.revision,
    startAt: firstTime, step: 5 });
  assert.equal(surface.currentStepAt(), null);
  assert.equal(surface.nextStepAt(), 5, 'parking before the first attack retains the unplayed step');
  surface.setPlaybackEnabled(true);
  assertSound(render(processor, 0, 12_032));
  assert.equal(surface.lastStatus, null);
  assert.notEqual(processor.lastStep, 0);
  assert.equal(surface.currentStepAt(), processor.lastStep);
  assert.equal(surface.nextStepAt(), (processor.lastStep + 1) % 27);
  const offset = surface.scorePhaseOffset;
  clock.configure({ tempo: 203, swing: .17 });
  const next = clock.next({ ...options, minTime: clock.now() });
  surface.syncClock({ audioTime: clock.audioTime(context, next.time), quarterBeat: next.beat,
    tempo: clock.tempo, swing: clock.swing, revision: clock.revision });
  assert.equal(surface.scorePhaseOffset, offset);
  assert.equal(surface.scorePhaseOffset, processor.scorePhaseOffset);
  assert.equal(surface.clock.startAt, firstTime);
  assertSound(render(processor, 12_032, 8192));
  assert.equal(surface.currentStepAt(), processor.lastStep);
  assert.equal(surface.nextStepAt(), (processor.lastStep + 1) % 27);
  surface.updateSurfacePatterns(faces({ readingMode: 'parallel', tempo: 203, swing: .17 }));
  assert.equal(surface.scorePhaseOffset, Math.round(offset / 3));
  assert.equal(surface.scorePhaseOffset, processor.scorePhaseOffset);
  assert.equal(surface.clockDivisions, processor.divisions);
  assertSound(render(processor, 20_224, 8192));
  assert.equal(surface.currentStepAt(), processor.lastStep);
  assert.equal(surface.nextStepAt(), (processor.lastStep + 1) % 9);
  assert.equal(surface.lastStatus, null);
  assert.equal(resets(), 0);
});
