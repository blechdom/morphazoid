import assert from 'node:assert/strict';
import test from 'node:test';
globalThis.sampleRate = 48000; globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
const registered = new Map();
globalThis.registerProcessor = (name, constructor) => registered.set(name, constructor);
await import('../src/instruments/blobs/processor.js');
const Processor = registered.get('blobs');
const { normalizeParams, performanceState } = await import('../src/instruments/blobs/parameters.js');
const { buildPerformancePath } = await import('../src/instruments/blobs/paths.js');
const { boundsFromPoints } = await import('../src/geometry.js');
const rectangle = { tool: 'line', points: [{ x: .21, y: .24 }, { x: .68, y: .24 }, { x: .68, y: .72 }, { x: .21, y: .72 }] };

function reflectedPaths(count, params) {
  const base = buildPerformancePath(rectangle, params);
  return Array.from({ length: 8 }, (_, reflection) => Array.from({ length: count }, (_, sourceIndex) => {
    const angle = reflection % 4 * Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle), parity = reflection >= 4 ? -1 : 1;
    const points = base.points.map(p => ({ x: parity * (p.x * c - p.y * s), y: p.x * s + p.y * c }));
    const reflectionId = `d4-${reflection}`;
    return { ...base, points, bounds: boundsFromPoints(points), cornerTurns: base.cornerTurns.map(turn => turn * parity), sourceIndex, reflectionId, pathKey: `blob:${sourceIndex}:${reflectionId}` };
  })).flat();
}

function scene(count = 6, overrides = {}) {
  globalThis.currentTime = 0;
  const processor = new Processor();
  const params = normalizeParams({ heads: 1, speed: 1, amplitudeEnvelopeEnabled: false, percussionLevelSource: 'fixed', ...overrides });
  const paths = reflectedPaths(count, params);
  const clock = { phase: .03, rotationPhase: 0, time: 0, playing: true, rotating: false };
  processor.port.onmessage({ data: { type: 'scene', params, paths, clock } });
  return { processor, params, paths, clock };
}

function render(processor, blocks = 64) {
  let peak = 0;
  for (let i = 0; i < blocks; i++) {
    const output = [new Float32Array(128), new Float32Array(128)];
    assert.equal(processor.process([], [output]), true);
    for (const channel of output) for (const sample of channel) {
      assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1.00001);
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(processor.voices.size <= 40);
    assert.ok(processor.noteQueue.length <= 160);
    globalThis.currentTime += 128 / sampleRate;
  }
  return peak;
}

test('six D4 sources share path admission across sources and all reflections within engine budgets', () => {
  for (const soundMode of ['sine', 'fm', 'pm', 'shepard']) {
    const { processor, params, clock } = scene(6, { soundMode });
    assert.equal(processor.paths.length, 48);
    const voices = processor.continuousVoices(performanceState(params, clock, 0));
    assert.equal(voices.length, soundMode === 'shepard' ? 8 : 32);
    assert.equal(new Set(voices.map(voice => voice.key.split(':')[1])).size, 6);
    assert.equal(new Set(voices.map(voice => voice.key.split(':')[2])).size, 8);
    assert.ok(voices.every(voice => /^blob:\d:d4-\d:shape:/.test(voice.key)));
    assert.ok(render(processor) > .001);
  }
});

test('two D4 sources preserve reflected voice identity across path reordering and release removed copies', () => {
  const { processor, params, paths, clock } = scene(2);
  render(processor);
  const voices = new Map(processor.voices);
  assert.equal(voices.size, 16);
  processor.port.onmessage({ data: { type: 'scene', params, paths: [...paths].reverse(), clock } });
  render(processor, 4);
  assert.deepEqual([...processor.voices.keys()].sort(), [...voices.keys()].sort());
  for (const [key, voice] of voices) assert.equal(processor.voices.get(key), voice);
  const originals = paths.filter(path => path.reflectionId === 'd4-0');
  processor.port.onmessage({ data: { type: 'scene', params, paths: originals, clock } });
  render(processor, 180);
  assert.equal(processor.voices.size, 2);
  assert.ok([...processor.voices.keys()].every(key => key.includes(':d4-0:')));
});

test('unadmitted reflections receive no heads or continuous/percussion geometry work', () => {
  for (const soundMode of ['sine', 'shepard', 'percussion']) {
    const { processor, params, clock } = scene(6, { soundMode, playMethod: 'scan' });
    const state = performanceState(params, clock, 0), admitted = new Set(processor.admittedPaths(state));
    assert.equal(admitted.size, soundMode === 'shepard' ? 8 : 32);
    for (let index = 0; index < processor.paths.length; index++) if (!admitted.has(index)) {
      assert.deepEqual(processor.audibleHeads(state, index), []);
      const path = processor.paths[index];
      processor.paths[index] = { ...path, get points() { throw new Error('Unadmitted geometry was read'); } };
    }
    if (soundMode === 'percussion') processor.percussionIntents(0, .008, state, performanceState(params, clock, .008));
    else processor.continuousVoices(state);
    assert.ok(processor.pathComplexities.filter(Boolean).length <= admitted.size);
  }
});

test('reflected percussion keys remain distinct and all engines stay bounded across mode changes', () => {
  const current = scene(6, { soundMode: 'percussion' });
  const scheduled = [];
  const queue = current.processor.queueNotes.bind(current.processor);
  current.processor.queueNotes = data => { scheduled.push(...data.voices.map(voice => voice.key)); queue(data); };
  assert.ok(render(current.processor, 220) > .001);
  assert.equal(new Set(scheduled.map(key => key.split(':')[1])).size, 6);
  assert.equal(new Set(scheduled.map(key => key.split(':')[2])).size, 8);
  assert.ok(scheduled.every(key => /^blob:\d:d4-\d:corner:/.test(key)));
  for (const soundMode of ['shepard', 'pm', 'sine', 'fm', 'percussion']) {
    current.params = normalizeParams({ ...current.params, soundMode });
    current.processor.port.onmessage({ data: { type: 'scene', params: current.params, paths: current.paths, clock: current.clock } });
    assert.ok(render(current.processor, 220) > .001, soundMode);
    assert.ok(current.processor.admittedPaths(performanceState(current.params, current.clock, currentTime)).length <= (soundMode === 'shepard' ? 8 : 32));
  }
});

test('legacy unreflected paths retain their original voice keys and full small scenes', () => {
  const { processor, params, clock } = scene(2);
  const path = buildPerformancePath(rectangle, params);
  processor.port.onmessage({ data: { type: 'scene', params, paths: [path, path], clock } });
  render(processor);
  assert.deepEqual([...processor.voices.keys()].sort(), ['blob:0:shape:trace:0', 'blob:1:shape:trace:0']);
});
