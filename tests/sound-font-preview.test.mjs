import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundFontPreview, MAX_PREVIEW_VOICES, MAX_PREVIEW_SECONDS } from '../src/site/sound-fonts/preview-audio.js';

class Parameter {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); }
  setTargetAtTime(value, time) { this.events.push({ type: 'target', value, time }); }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
}
class Node {
  constructor() { this.connections = new Set(); }
  connect(node) { this.connections.add(node); return node; }
  disconnect(node) { if (node) this.connections.delete(node); else this.connections.clear(); }
}
class Context {
  static made = 0;
  constructor() { Context.made += 1; this.currentTime = 0; this.state = 'suspended'; this.destination = new Node(); this.sources = []; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { return Object.assign(new Node(), { gain: new Parameter(1) }); }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Parameter() }); }
  createAnalyser() { return Object.assign(new Node(), { fftSize: 1024 }); }
  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length);
    return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
  }
  createBufferSource() {
    const source = Object.assign(new Node(), {
      playbackRate: new Parameter(1), start(time) { this.started = time; }, stop(time = 0) { this.stopped = time; },
    });
    this.sources.push(source);
    return source;
  }
}
const sample = () => ({ sampleRate: 8000, data: new Float32Array(8000).fill(0.5) });
const zone = (extra = {}) => ({ sampleIndex: 0, rootKey: 60, lowKey: 0, highKey: 127, attack: 0.01,
  release: 0.4, loop: true, loopStart: 100, loopEnd: 7900, ...extra });
const font = (zones = [zone()]) => ({ samples: [sample()], presets: [{ zones }] });

async function setup(t) {
  const original = globalThis.AudioContext;
  globalThis.AudioContext = Context;
  const preview = new SoundFontPreview();
  t.after(async () => { await preview.dispose(); globalThis.AudioContext = original; });
  return preview;
}

test('loading, selecting, and playing do not arm Audio; disarm invalidates pending resume', async t => {
  const preview = await setup(t);
  const before = Context.made;
  preview.setFont(font());
  preview.setVolume(0.8);
  preview.setPreset(0);
  assert.equal(preview.noteOn(60), null);
  assert.equal(Context.made, before);
  const pending = preview.setEnabled(true);
  await preview.setEnabled(false);
  await pending;
  assert.equal(preview.enabled, false);
  assert.equal(preview.noteOn(60), null);
  await preview.setEnabled(true);
  assert.equal(preview.noteOn(60), 60);
  await preview.setEnabled(false);
  assert.equal(preview.enabled, false);
  assert.ok(preview.context.sources.every(source => source.stopped <= 0.012));
});

test('key and velocity zones control triggering; pitch, PCM loop, pan, and attenuation are applied', async t => {
  const preview = await setup(t);
  preview.setFont(font([zone({ lowKey: 61, highKey: 80, lowVelocity: 50, highVelocity: 100, tune: 100, pan: -0.7, attenuation: 6 })]));
  await preview.setEnabled(true);
  assert.equal(preview.noteOn(60), null);
  assert.equal(preview.noteOn(72, 0.1), null);
  assert.equal(preview.noteOn(72, 0.6), 72);
  const voice = [...preview.voices][0];
  assert.ok(Math.abs(voice.source.playbackRate.value - 2 ** (13 / 12)) < 1e-12);
  assert.equal(voice.source.loopStart, 100 / 8000);
  assert.equal(voice.source.loopEnd, 7900 / 8000);
  assert.equal(voice.pan.pan.value, -0.7);
  assert.ok(Math.abs(voice.level - 0.05 * 0.6 * 10 ** (-6 / 20)) < 1e-12);
  preview.context.currentTime = 0.1;
  preview.noteOff(72);
  assert.equal(voice.source.stopped, 0.5);
  assert.equal(voice.gain.gain.events.at(-1).value, 0);
  voice.source.onended();
  assert.equal(preview.voices.size, 0);
  assert.equal(voice.source.connections.size, 0);
  assert.equal(voice.pan.connections.size, 0);
});

test('voices and release tails remain bounded even during dense attacks', async t => {
  const preview = await setup(t);
  preview.setFont(font());
  await preview.setEnabled(true);
  for (let note = 40; note < 90; note += 1) preview.noteOn(note);
  assert.equal(preview.voices.size, MAX_PREVIEW_VOICES);
  assert.equal(preview.context.sources.length, MAX_PREVIEW_VOICES);
  assert.ok(preview.context.sources.every(source => source.stopped === MAX_PREVIEW_SECONDS));
  preview.context.currentTime = 0.2;
  for (let note = 40; note < 90; note += 1) preview.noteOff(note);
  assert.equal(preview.noteOn(100), null, 'release tails still occupy capacity');
  const ended = preview.context.sources[0];
  ended.onended();
  assert.equal(preview.noteOn(100), 100);
  assert.equal(preview.voices.size, MAX_PREVIEW_VOICES);
});

test('font changes stop old voices, presets preserve held notes, and disposal disconnects everything', async t => {
  const preview = await setup(t);
  const selected = font();
  selected.presets.push({ zones: [zone({ rootKey: 72 })] });
  preview.setFont(selected);
  await preview.setEnabled(true);
  preview.noteOn(60);
  preview.context.currentTime = 0.1;
  preview.setPreset(1);
  assert.equal(preview.context.sources[0].stopped, MAX_PREVIEW_SECONDS);
  preview.noteOn(60);
  assert.equal(preview.context.sources[1].playbackRate.value, 0.5);
  preview.setFont(font());
  assert.equal(preview.buffers.size, 0);
  assert.ok(preview.context.sources.every(source => source.stopped <= 0.112));
  const context = preview.context;
  await preview.dispose();
  assert.equal(context.state, 'closed');
  assert.equal(preview.voices.size, 0);
  assert.ok(context.sources.every(source => source.connections.size === 0));
  assert.equal(await preview.setEnabled(true), false);
});

test('non-looping sample playback fades at natural end and malformed PCM stays bounded', async t => {
  const preview = await setup(t);
  const selected = font([zone({ loop: false, release: Infinity, attenuation: -100 })]);
  selected.samples[0].data[0] = Infinity;
  selected.samples[0].data[1] = NaN;
  selected.samples[0].data[2] = 20;
  preview.setFont(selected);
  await preview.setEnabled(true);
  preview.noteOn(72, 1);
  const voice = [...preview.voices][0];
  assert.equal(voice.source.stopped, 0.5);
  assert.equal(voice.gain.gain.events.at(-1).time, 0.5);
  assert.ok(voice.source.buffer.getChannelData(0).every(value => Number.isFinite(value) && Math.abs(value) <= 1));
  assert.ok(voice.level * MAX_PREVIEW_VOICES < 1);
});
