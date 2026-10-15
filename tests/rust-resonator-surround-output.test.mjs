import test from 'node:test';
import assert from 'node:assert/strict';
import { createResonatorSurroundOutput, RESONATOR_SURROUND_LAYOUTS } from '../src/instruments/simd-resonator-rust/surround-output.js';
import { spartialLayout, spartialSpeakers } from '../src/instruments/spartial/spartial-audio.js';

class Events {
  events = new Map();
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  emit(type) { for (const fn of this.events.get(type) || []) fn(); }
}
class AudioNode {
  constructor(kind, channels = 2) {
    this.kind = kind; this.channels = channels; this.connections = [];
    this.gain = { value: 1, events: [], cancelAndHoldAtTime() {},
      linearRampToValueAtTime(value, time) { this.events.push([value, time]); this.value = value; } };
    this.pan = { value: 0 };
  }
  connect(target, output = 0, input = 0) { this.connections.push({ target, output, input }); return target; }
  disconnect(target) { this.connections = target ? this.connections.filter(edge => edge.target !== target) : []; }
}
function fixture(settings = {}, capacity = 2) {
  const context = new Events(); context.currentTime = 0; context.state = 'running'; context.sampleRate = 48000;
  context.destination = new AudioNode('destination'); context.destination.maxChannelCount = capacity;
  context.createGain = () => new AudioNode('gain');
  context.createChannelSplitter = count => new AudioNode('splitter', count);
  context.createChannelMerger = count => new AudioNode('merger', count);
  context.createStereoPanner = () => new AudioNode('panner');
  const runtime = new Events(), timers = new Map();
  runtime.setTimeout = fn => { const id = Symbol(); timers.set(id, fn); return id; };
  runtime.clearTimeout = id => timers.delete(id);
  const stereoSource = new AudioNode('source'), spatialSource = new AudioNode('source');
  let audioOn = true;
  const notifications = [];
  const output = createResonatorSurroundOutput({ context, stereoSource, spatialSource, runtime, settings,
    getAudioOn: () => audioOn, onRoute: info => notifications.push(info) });
  function flush() { context.currentTime += .04; for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } }
  return { context, stereoSource, spatialSource, output, notifications, timers, flush, setAudio(value) { audioOn = value; } };
}

// Linear graph traversal verifies physical wiring with distinct bus amplitudes.
function signal(source, values, target) {
  const result = Array(32).fill(0);
  function visit(node, samples, input = 0) {
    if (node === target) { samples.forEach((value, index) => { result[index] += value; }); return; }
    let next = samples;
    if (node.kind === 'gain') next = samples.map(value => value * node.gain.value);
    if (node.kind === 'merger') { next = Array(node.channels).fill(0); next[input] = samples[0]; }
    if (node.kind === 'panner') {
      const angle = (node.pan.value + 1) * Math.PI / 4;
      next = [samples[0] * Math.cos(angle), samples[0] * Math.sin(angle)];
    }
    for (const edge of node.connections) visit(edge.target, node.kind === 'splitter' ? [next[edge.output] || 0] : next, edge.input);
  }
  visit(source, values); return result;
}

test('Surround off preserves stereo amplitudes and never sends spatial buses to the device', () => {
  const f = fixture();
  assert.equal(f.notifications.length, 1); assert.equal(f.output.snapshot().mode, 'stereo');
  assert.deepEqual(signal(f.stereoSource, [.25, -.125], f.context.destination).slice(0, 4), [.25, -.125, 0, 0]);
  assert.ok(signal(f.spatialSource, Array(16).fill(1), f.context.destination).every(value => value === 0));
  assert.equal(f.output.canRecord(), false);
  f.output.destroy(); f.output.destroy();
  assert.equal(f.stereoSource.connections.length, 0); assert.equal(f.spatialSource.connections.length, 0);
});

test('every physical layout maps logical azimuth buses to numbered channels with silent LFE', () => {
  for (const layoutId of RESONATOR_SURROUND_LAYOUTS) {
    const f = fixture({ enabled: true, layoutId }, 32);
    const layout = spartialLayout(layoutId), speakers = spartialSpeakers(layout, true);
    const values = Array.from({ length: 16 }, (_, index) => (index + 1) / 64);
    const expected = Array(32).fill(0);
    speakers.forEach((speaker, index) => { expected[speaker.channel - 1] = values[index]; });
    assert.equal(f.output.snapshot().mode, 'discrete');
    assert.equal(f.context.destination.channelCount, layout.speakers.length);
    assert.deepEqual(signal(f.spatialSource, values, f.context.destination), expected, layoutId);
    const recorder = new AudioNode('capture');
    const release = f.output.tapInto(f.context, recorder);
    assert.deepEqual(signal(f.spatialSource, values, recorder), expected, `${layoutId} recorder`);
    release(); release(); assert.ok(signal(f.spatialSource, values, recorder).every(value => value === 0));
    f.output.destroy();
  }
});

test('stereo preview keeps azimuth, while recording remains discrete across monitor and sink changes', () => {
  const f = fixture({ enabled: true, layoutId: '7-4-1' }, 2);
  const recorder = new AudioNode('capture'), failures = [];
  const release = f.output.tapInto(f.context, recorder, { onerror: error => failures.push(error.message) });
  const source = Array.from({ length: 16 }, (_, index) => (index + 1) / 100);
  const captured = signal(f.spatialSource, source, recorder);
  assert.equal(captured[3], 0, 'physical LFE is silent');
  assert.equal(f.output.snapshot().mode, 'preview');
  const preview = signal(f.spatialSource, source, f.context.destination);
  assert.ok(preview[0] > 0 && preview[1] > 0); assert.ok(preview.slice(2).every(value => value === 0));
  assert.equal(f.output.route({ enabled: false }), false);
  assert.equal(f.output.route({ layoutId: '4-ring' }), false);
  assert.equal(f.output.route({ forcePreview: true }), true);
  assert.equal(f.output.canRecord(), true, 'monitor fade cannot interrupt a pending capture start');
  assert.deepEqual(signal(f.spatialSource, source, recorder), captured, 'monitor fade does not mute capture');
  f.flush();
  f.context.destination.maxChannelCount = 32; f.context.emit('sinkchange'); f.flush();
  f.output.route({ forcePreview: false }); f.flush();
  assert.equal(f.output.snapshot().mode, 'discrete');
  assert.deepEqual(signal(f.spatialSource, source, recorder), captured);
  assert.deepEqual(failures, []);
  release(); assert.equal(f.output.route({ layoutId: '16-ring' }), true);
  assert.equal(f.output.canRecord(), false, 'new physical map must finish its monitor transition first');
  f.flush(); assert.equal(f.output.canRecord(), true);
  f.output.destroy();
});

test('pending route edits coalesce, disabled Audio cannot record, and teardown releases capture and timers', () => {
  const f = fixture({ enabled: true, layoutId: '8-circle' }, 16);
  f.output.route({ layoutId: '4-ring' }); f.output.route({ layoutId: '16-ring' });
  assert.equal(f.timers.size, 1); f.flush(); assert.equal(f.output.snapshot().layoutId, '16-ring');
  f.setAudio(false); assert.equal(f.output.canRecord(), false);
  assert.throws(() => f.output.tapInto(f.context, new AudioNode('capture')), /Enable Surround and Audio/);
  f.setAudio(true); f.output.setLocked(true);
  assert.equal(f.output.route({ enabled: false }), false);
  f.output.setLocked(false);
  const errors = []; f.output.tapInto(f.context, new AudioNode('capture'), { onerror: error => errors.push(error.message) });
  f.output.route({ forcePreview: true }); f.output.destroy();
  assert.equal(f.timers.size, 0); assert.equal(f.spatialSource.connections.length, 0);
  assert.equal(errors.length, 1); assert.equal(f.context.events.get('sinkchange').size, 0);
  assert.equal(f.output.canRecord(), false);
});
