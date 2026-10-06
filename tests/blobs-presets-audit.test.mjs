import assert from 'node:assert/strict';
import test from 'node:test';
import { BLOB_PRESETS, randomizeBlobs } from '../src/instruments/blobs/presets.js';
import { buildPerformancePath } from '../src/instruments/blobs/paths.js';
import { expandPaths } from '../src/instruments/blobs/symmetry.js';
import { performanceState } from '../src/instruments/blobs/parameters.js';

globalThis.sampleRate = 48000;
globalThis.currentTime = 0;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
const processors = new Map();
globalThis.registerProcessor = (name, constructor) => processors.set(name, constructor);
await import('../src/instruments/blobs/processor.js');
const Processor = processors.get('blobs');

const polygonArea = points => Math.abs(points.reduce((sum, a, i) => {
  const b = points[(i + 1) % points.length];
  return sum + a.x * b.y - b.x * a.y;
}, 0)) / 2;

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const chain = [];
  for (const point of sorted) {
    while (chain.length > 1 && cross(chain.at(-2), chain.at(-1), point) <= 0) chain.pop();
    chain.push(point);
  }
  const lowerLength = chain.length;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const point = sorted[i];
    while (chain.length > lowerLength && cross(chain.at(-2), chain.at(-1), point) <= 0) chain.pop();
    chain.push(point);
  }
  return chain.slice(0, -1);
}

test('factory silhouettes include narrow, deeply indented and long winding contours', () => {
  const measures = BLOB_PRESETS.flatMap(({ snapshot }) => snapshot.blobs.map(blob => {
    // Measure the performed contour after form controls; varying a label,
    // synthesis parameter, position or size cannot create this breadth.
    const path = buildPerformancePath(blob, snapshot.params);
    assert.ok(path?.closed && path.totalLength > 0);
    const area = polygonArea(path.points);
    return {
      aspect: Math.max(path.bounds.width / path.bounds.height, path.bounds.height / path.bounds.width),
      solidity: area / polygonArea(convexHull(path.points)),
      complexity: path.totalLength ** 2 / (4 * Math.PI * Math.max(area, 1e-10)),
    };
  }));
  // The previous radial-only bank was 95–100% convex-hull-filled, with
  // normalized perimeter complexity below 1.37 and aspect below 2.17.
  assert.ok(measures.some(shape => shape.aspect > 2.5), 'at least one genuinely elongated contour');
  assert.ok(measures.filter(shape => shape.solidity < .65).length >= 3, 'several deeply concave or crossing contours');
  assert.ok(measures.filter(shape => shape.complexity > 2).length >= 4, 'several winding or strongly articulated contours');
  assert.ok(BLOB_PRESETS.some(({ snapshot }) => snapshot.blobs.length > 1), 'multiple source loops');
  assert.ok(BLOB_PRESETS.some(({ snapshot }) => snapshot.params.reflectionAxes.length > 0), 'reflected arrangements');
});

function renderScene(snapshot, label) {
  globalThis.currentTime = 0;
  const { params } = snapshot;
  const paths = expandPaths(snapshot.blobs.map(blob => buildPerformancePath(blob, params)), params.reflectionAxes);
  assert.ok(paths.length > 0 && paths.length <= 48, `${label}: bounded closed paths`);
  const processor = new Processor();
  const clock = { phase: 0, rotationPhase: 0, time: 0, playing: true, rotating: params.autoRotate };
  processor.port.onmessage({ data: { type: 'scene', params, paths, clock } });
  assert.equal(processor.paths.length, paths.length, `${label}: every path accepted by the worklet`);
  const state = performanceState(params, clock, 0);
  assert.ok(processor.admittedPaths(state).length <= (params.soundMode === 'shepard' ? 8 : 32), `${label}: path admission`);
  assert.ok(params.speed > 0, `${label}: playable preset speed`);
  // Run a complete natural traversal (both ping-pong legs), plus release time.
  // Do not disable envelopes or override any preset's musical parameters to
  // manufacture an audible result. No further UI messages drive the worklet.
  const seconds = (params.motionMode === 'pingpong' ? 2 : 1) / params.speed + .35;
  const blocks = Math.ceil(seconds * sampleRate / 128);
  const output = [new Float32Array(128), new Float32Array(128)];
  let peak = 0, squareSum = 0, invalidSamples = 0;
  for (let block = 0; block < blocks; block++) {
    assert.equal(processor.process([], [output]), true, label);
    for (const channel of output) for (const sample of channel) {
      if (!Number.isFinite(sample) || Math.abs(sample) > 1.00001) invalidSamples++;
      peak = Math.max(peak, Math.abs(sample));
      squareSum += sample * sample;
    }
    assert.ok(processor.voices.size <= 40, `${label}: voices including release tails`);
    assert.ok(processor.noteQueue.length <= 160, `${label}: queued notes`);
    assert.ok(processor.noiseVoices.length <= 16, `${label}: attack-noise voices`);
    globalThis.currentTime += 128 / sampleRate;
  }
  assert.equal(invalidSamples, 0, `${label}: finite output without clipping`);
  assert.ok(peak > .001, `${label}: audible peak ${peak}`);
  assert.ok(Math.sqrt(squareSum / (blocks * 256)) > .00001, `${label}: non-silent energy over a traversal`);
  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.process([], [output]), false, `${label}: disposed`);
}

test('all 30 factory scenes produce finite bounded sound with their authored contours and mappings', () => {
  assert.equal(BLOB_PRESETS.length, 30);
  for (const preset of BLOB_PRESETS) renderScene(preset.snapshot, `${preset.id} ${preset.label}`);
});

test('seeded complete-scene randomization remains playable across all engines', () => {
  let seed = 317;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const scenes = Array.from({ length: 20 }, () => randomizeBlobs(null, random));
  assert.equal(new Set(scenes.map(scene => scene.params.soundMode)).size, 5);
  for (const [index, snapshot] of scenes.entries()) renderScene(snapshot, `random scene ${index} (${snapshot.params.soundMode}/${snapshot.params.playMethod})`);
});

test('randomized fixed percussion loudness cannot invert into permanent silence', () => {
  // This seed previously selected fixed loudness + an inverted curve, making
  // a moving five-contour radar scene produce no strikes and exactly zero audio.
  let seed = 1601492;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const snapshot = randomizeBlobs(null, random);
  assert.equal(snapshot.params.soundMode, 'percussion');
  assert.equal(snapshot.params.percussionLevelSource, 'fixed');
  renderScene(snapshot, 'fixed-loudness random percussion regression');
});
