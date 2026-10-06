import assert from 'node:assert/strict';
import test from 'node:test';
import { boundsFromPoints, buildShape, pingPong01, pointAtPath } from '../src/geometry.js';
import { normalizeParams, performanceState } from '../src/instruments/blobs/parameters.js';
import { createShapeSoundModel } from '../src/families/geometry-presets/shape-sound.js';
import { expandPaths } from '../src/instruments/blobs/symmetry.js';

globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
const processors = new Map();
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
await import('../src/instruments/blobs/processor.js');
const Processor = processors.get('blobs');

// The existing Shape open arc supplies the common reader/worklet contract,
// independently of Blobs' drawing and resampling implementation.
const arc = () => buildShape({ sides: 2, curvature: .65, samplesPerEdge: 64 });
function polyline(points, closed = false) {
  const cumulativeLengths = [0];
  for (let i = 1; i < points.length; i++) cumulativeLengths.push(cumulativeLengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const totalLength = cumulativeLengths.at(-1) + (closed ? Math.hypot(points.at(-1).x - points[0].x, points.at(-1).y - points[0].y) : 0);
  return {
    ...arc(), points, closed, cumulativeLengths, totalLength, bounds: boundsFromPoints(points),
    vertexCount: points.length, vertexIndices: points.map((_, i) => i),
    vertexDistances: cumulativeLengths, cornerStrengths: points.map(() => 1), cornerTurns: points.map(() => 1),
  };
}
function setup(paths = [arc()], overrides = {}, clockOverrides = {}) {
  globalThis.currentTime = 0;
  const processor = new Processor();
  const params = normalizeParams({ speed: 1, heads: 1, ...overrides });
  const clock = { phase: .03, rotationPhase: 0, time: 0, playing: true, rotating: false, ...clockOverrides };
  processor.port.onmessage({ data: { type: 'scene', params, paths, clock } });
  assert.equal(processor.paths.length, paths.length);
  return { processor, params, paths, clock };
}
function render(processor, seconds) {
  let peak = 0;
  const channels = [new Float32Array(128), new Float32Array(128)];
  for (let block = 0; block < Math.ceil(seconds * sampleRate / 128); block++) {
    assert.equal(processor.process([], [channels]), true);
    for (const channel of channels) for (const sample of channel) {
      assert.ok(Number.isFinite(sample) && Math.abs(sample) <= 1.00001);
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(processor.voices.size <= 40);
    assert.ok(processor.noteQueue.length <= 160);
    globalThis.currentTime += 128 / sampleRate;
  }
  return peak;
}

test('two-anchor open arcs sound through all engines and release when transport stops', () => {
  for (const soundMode of ['sine', 'fm', 'pm', 'shepard', 'percussion']) {
    const scene = setup([arc()], { soundMode });
    assert.ok(render(scene.processor, 2.05) > .001, soundMode);
    scene.processor.port.onmessage({ data: { type: 'scene', ...scene, clock: { ...scene.clock, time: currentTime, playing: false, rotating: false } } });
    render(scene.processor, .8);
    assert.ok(render(scene.processor, .05) < 1e-7, `${soundMode}: release`);
  }
});

test('open trace pitches bounce at both endpoints for both directions while closed companions keep looping', () => {
  const points = [{ x: -.6, y: -.55 }, { x: .35, y: -.2 }, { x: .6, y: .6 }];
  const open = polyline(points), closed = polyline(points, true);
  for (const traversalDirection of [-1, 1]) for (const headDirection of [-1, 1]) {
    const { processor, params, clock } = setup([open, closed], {
      amplitudeEnvelopeEnabled: false, traversalDirection, traceHeadDirections: [headDirection],
    }, { phase: 0 });
    for (const time of [.2, .99, 1, 1.01, 1.8, 2.01]) {
      const state = performanceState(params, clock, time);
      const voices = processor.continuousVoices(state);
      const travel = time * traversalDirection * headDirection;
      const sound = createShapeSoundModel(state);
      for (const [index, path] of [open, closed].entries()) {
        const contact = pointAtPath(path, path.closed ? travel : pingPong01(travel));
        const expectedFrequency = sound.synthFrequencyForMapping(sound.mappingForContact(contact, path, 0));
        const actual = voices.find(voice => voice.key.startsWith(`blob:${index}:`));
        assert.ok(actual, `${index}/${time}: contact voice`);
        assert.ok(Math.abs(actual.frequency - expectedFrequency) < 1e-8, `${index}/${time}: physical contour pitch`);
      }
    }
  }
});

test('percussion reversals strike each endpoint once and interior corners on both legs', () => {
  const path = polyline([{ x: -.6, y: .6 }, { x: 0, y: -.3 }, { x: .6, y: .6 }]);
  for (const motionMode of ['loop', 'pingpong']) for (const traversalDirection of [-1, 1]) {
    const { processor } = setup([path], { soundMode: 'percussion', motionMode, traversalDirection });
    const strikes = [];
    const queueCorner = processor.queueCorner.bind(processor);
    processor.queueCorner = (intent, now) => { strikes.push(intent); queueCorner(intent, now); };
    render(processor, 2);
    const expected = traversalDirection === 1
      ? [[1, .47], [2, .97], [1, 1.47], [0, 1.97]]
      : [[0, .03], [1, .53], [2, 1.03], [1, 1.53]];
    assert.equal(strikes.length, 4, `${motionMode}/${traversalDirection}: one per crossing`);
    strikes.forEach((strike, index) => {
      assert.equal(strike.vertex, expected[index][0]);
      assert.ok(Math.abs(strike.at - expected[index][1]) < 1e-8, `${motionMode}/${traversalDirection}: sample-clock endpoint`);
    });
    assert.equal(processor.noteSequence, 4);
  }
});

test('scan and radar voices read the open segments without an imaginary closing edge', () => {
  const points = [{ x: -.6, y: .6 }, { x: 0, y: -.3 }, { x: .6, y: .6 }];
  for (const [playMethod, phase, expectedOpen, expectedClosed] of [['scan', 2 / 3, 1, 2], ['radial', .5, 0, 1]]) {
    const { processor, params, clock } = setup([polyline(points), polyline(points, true)], {
      playMethod, amplitudeEnvelopeEnabled: false,
    }, { phase });
    const voices = processor.continuousVoices(performanceState(params, clock, 0));
    assert.equal(voices.filter(voice => voice.key.startsWith('blob:0:')).length, expectedOpen, playMethod);
    assert.equal(voices.filter(voice => voice.key.startsWith('blob:1:')).length, expectedClosed, playMethod);
  }
});

test('reflected open paths keep endpoint voices bounded and preserve voice identities during edits', () => {
  const paths = expandPaths([arc()], ['vertical', 'diagonal']);
  const scene = setup(paths, { soundMode: 'shepard', heads: 12 });
  assert.ok(render(scene.processor, .1) > .001);
  const voices = new Map(scene.processor.voices);
  assert.equal(voices.size, 8);
  scene.processor.port.onmessage({ data: { type: 'scene', ...scene, paths: [...paths].reverse() } });
  render(scene.processor, .05);
  assert.deepEqual([...scene.processor.voices.keys()].sort(), [...voices.keys()].sort());
  for (const [key, voice] of voices) assert.equal(scene.processor.voices.get(key), voice);
});
