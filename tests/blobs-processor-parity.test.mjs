import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
const processors = new Map();
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
await import('../src/instruments/blobs/processor.js');
const Processor = processors.get('blobs');
const { normalizeParams } = await import('../src/instruments/blobs/parameters.js');
const { buildPerformancePath } = await import('../src/instruments/blobs/paths.js');
const square = { tool: 'line', points: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }] };

function setup(overrides = {}, clockOverrides = {}, count = 1) {
  globalThis.currentTime = 0;
  const processor = new Processor();
  const params = normalizeParams({ speed: 1, heads: 2, ...overrides });
  const paths = Array.from({ length: count }, () => buildPerformancePath(square, params));
  const clock = { phase: .03, rotationPhase: 0, time: 0, playing: true, rotating: false, ...clockOverrides };
  processor.port.onmessage({ data: { type: 'scene', params, paths, clock } });
  return { processor, params, paths, clock };
}
function render(processor, blocks, visitor = () => {}) {
  const samples = []; let peak = 0, squareSum = 0;
  for (let block = 0; block < blocks; block++) {
    const channels = [new Float32Array(128), new Float32Array(128)];
    assert.equal(processor.process([], [channels]), true);
    for (const channel of channels) for (const value of channel) {
      assert.ok(Number.isFinite(value)); assert.ok(Math.abs(value) <= 1.00001);
      peak = Math.max(peak, Math.abs(value)); squareSum += value * value;
    }
    samples.push(...channels[0]);
    visitor(processor);
    globalThis.currentTime += 128 / sampleRate;
  }
  return { samples, peak, rms: Math.sqrt(squareSum / (blocks * 256)) };
}

test('all five Shape engines produce bounded sound without further UI messages', () => {
  const signals = new Map();
  for (const soundMode of ['sine', 'fm', 'pm', 'shepard', 'percussion']) {
    const { processor } = setup({ soundMode, amplitudeEnvelopeEnabled: false, fmRatio: 1.4, pmRatio: 2.3 });
    const result = render(processor, 400);
    assert.ok(result.peak > .01, soundMode);
    if (['sine', 'fm', 'pm'].includes(soundMode)) assert.ok([...processor.voices.values()].some(voice => Math.abs(voice.frequency - 130) > 1), 'live contour mapping');
    if (soundMode === 'shepard') assert.ok([...processor.voices.values()].some(voice => Math.abs(voice.shepardPosition) > .01), 'live Shepard travel');
    signals.set(soundMode, result.samples);
  }
  for (const soundMode of ['fm', 'pm', 'shepard', 'percussion']) {
    const difference = signals.get(soundMode).reduce((sum, value, i) => sum + (value - signals.get('sine')[i]) ** 2, 0);
    assert.ok(difference > 1, `${soundMode} differs from sine`);
  }
});

test('corner strikes follow all readers, both motion modes and both directions', () => {
  for (const playMethod of ['trace', 'scan', 'radial']) for (const motionMode of ['loop', 'pingpong']) for (const traversalDirection of [-1, 1]) {
    const { processor } = setup({ soundMode: 'percussion', playMethod, motionMode, traversalDirection });
    const result = render(processor, 420);
    assert.ok(processor.noteSequence >= 4, `${playMethod}/${motionMode}/${traversalDirection}: ${processor.noteSequence}`);
    assert.ok(result.peak > .01);
  }
});

test('closed seams and ping-pong turnarounds trigger each crossed corner exactly once', () => {
  for (const playMethod of ['trace', 'scan', 'radial']) for (const motionMode of ['loop', 'pingpong']) for (const traversalDirection of [-1, 1]) {
    const { processor } = setup({ soundMode: 'percussion', playMethod, motionMode, traversalDirection, heads: 1 });
    render(processor, 750);
    const expected = playMethod === 'scan' && motionMode === 'pingpong' ? 4 : 8;
    assert.equal(processor.noteSequence, expected, `${playMethod}/${motionMode}/${traversalDirection}`);
  }
});

test('dense equal-strength continuous readers retain contacts from every blob', () => {
  for (const soundMode of ['sine', 'shepard']) {
    const { processor } = setup({ soundMode, heads: 12, amplitudeEnvelopeEnabled: false }, {}, 6);
    render(processor, 24);
    const blobs = new Set([...processor.voices.keys()].map(key => key.split(':')[1]));
    assert.equal(blobs.size, 6);
    assert.ok(processor.voices.size <= (soundMode === 'shepard' ? 8 : 32));
  }
});

test('independent rotation sustains mapped pitches; only crossing readers strike during rotation alone', () => {
  const { processor } = setup({ amplitudeEnvelopeEnabled: false, rotationSpeed: 1 }, { playing: false, rotating: true, phase: .13 });
  const frequencies = [];
  const result = render(processor, 400, p => frequencies.push([...p.voices.values()][0]?.frequency ?? 130));
  assert.ok(result.peak > .01);
  assert.ok(Math.max(...frequencies) - Math.min(...frequencies) > 20);
  for (const playMethod of ['trace', 'scan', 'radial']) {
    const { processor: p } = setup({ soundMode: 'percussion', playMethod, rotationSpeed: 1 }, { playing: false, rotating: true, phase: .21 });
    render(p, 500);
    assert.equal(p.noteSequence > 0, playMethod !== 'trace', playMethod);
  }
});

test('stopping both transports releases engines and attack noise, then disposal stops processing', () => {
  for (const soundMode of ['sine', 'fm', 'pm', 'shepard', 'percussion']) {
    const scene = setup({ soundMode, percussionAttackNoise: 1 });
    render(scene.processor, 160);
    scene.processor.port.onmessage({ data: { type: 'scene', ...scene, clock: { ...scene.clock, time: currentTime, playing: false, rotating: false } } });
    render(scene.processor, 180);
    assert.ok(render(scene.processor, 20).peak < 1e-7, soundMode);
    scene.processor.port.onmessage({ data: { type: 'dispose' } });
    assert.equal(scene.processor.process([], [[new Float32Array(128), new Float32Array(128)]]), false);
  }
});

test('percussion attack noise changes sound and stays bounded at dense settings', () => {
  const clean = render(setup({ soundMode: 'percussion' }).processor, 350).samples;
  const noisy = render(setup({ soundMode: 'percussion', percussionAttackNoise: 1 }).processor, 350).samples;
  assert.ok(noisy.reduce((sum, value, i) => sum + (value - clean[i]) ** 2, 0) > .001);
  const { processor } = setup({ soundMode: 'percussion', heads: 12, speed: 4, rotationSpeed: 4, cornerMode: 'even', corners: 32, percussionAttackNoise: 1 }, { rotating: true }, 6);
  render(processor, 400, p => {
    assert.ok(p.voices.size <= 40); assert.ok(p.noteQueue.length <= 160); assert.ok(p.noiseVoices.length <= 16);
  });
});

test('geometry/clock edits discard stale future strikes and keep inherited messages available', () => {
  const scene = setup({ soundMode: 'percussion', heads: 1 });
  render(scene.processor, 9);
  const before = scene.processor.noteSequence;
  scene.processor.port.onmessage({ data: { type: 'scene', ...scene, params: normalizeParams({ ...scene.params, speed: 0 }), clock: { ...scene.clock, phase: 1e5 + .123, time: currentTime } } });
  render(scene.processor, 100);
  assert.equal(scene.processor.noteSequence, before);
  scene.processor.port.onmessage({ data: { type: 'cancel-scheduled-notes' } });
  assert.deepEqual(scene.processor.noteQueue, []);
});
