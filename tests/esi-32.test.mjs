import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESI32_DEFAULT_PATCH, ESI32_DEMO_SAMPLES, ESI32_PRESETS,
  ESI32_MAX_FILE_BYTES, ESI32_MAX_BUFFER_BYTES,
  createEsi32DemoData, randomizeEsi32Patch, samplePlaybackRate, sanitizeEsi32Patch,
} from '../src/instruments/esi-32/esi-32-model.js';
import { Esi32Audio } from '../src/instruments/esi-32/esi-32-audio.js';

const makeParam = (value = 0) => ({
  value, events: [],
  setValueAtTime(next, time) { this.events.push(['set', next, time]); this.value = next; },
  linearRampToValueAtTime(next, time) { this.events.push(['ramp', next, time]); },
  setTargetAtTime(next, time, duration) { this.events.push(['target', next, time, duration]); this.value = next; },
  cancelScheduledValues(time) { this.events.push(['cancel', time]); },
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); },
});
const makeNode = fields => ({
  connections: [], disconnected: false, ...fields,
  connect(destination) { this.connections.push(destination); return destination; },
  disconnect() { this.disconnected = true; this.connections = []; },
});
class FakeBuffer {
  constructor(channels = 1, length = 16000, sampleRate = 8000) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(index) { return this.data[index]; }
}
class FakeContext {
  constructor() {
    this.state = 'suspended'; this.currentTime = 1; this.sampleRate = 8000;
    this.destination = makeNode({}); this.nodes = []; this.resumes = 0;
  }
  make(fields) { const node = makeNode(fields); this.nodes.push(node); return node; }
  createDynamicsCompressor() { return this.make(Object.fromEntries(['threshold', 'knee', 'ratio', 'attack', 'release'].map(key => [key, makeParam()]))); }
  createWaveShaper() { return this.make({}); }
  createAnalyser() { return this.make({ fftSize: 512 }); }
  createGain() { return this.make({ gain: makeParam(1) }); }
  createStereoPanner() { return this.make({ pan: makeParam() }); }
  createBiquadFilter() { return this.make({ frequency: makeParam(), Q: makeParam(), detune: makeParam() }); }
  createOscillator() {
    return this.make({ frequency: makeParam(), starts: [], stops: [],
      start(...values) { this.starts.push(values); }, stop(time) { this.stops.push(time); } });
  }
  createBufferSource() {
    return this.make({ playbackRate: makeParam(1), detune: makeParam(), starts: [], stops: [],
      start(...values) { this.starts.push(values); }, stop(time) { this.stops.push(time); } });
  }
  createBuffer(channels, length, rate) { return new FakeBuffer(channels, length, rate); }
  async decodeAudioData() { return new FakeBuffer(); }
  async resume() { this.resumes += 1; this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}
function makeAudio(Context = FakeContext) { return new Esi32Audio({ AudioContext: Context }); }
function regionAssertions(patch) {
  assert.ok(patch.start >= 0 && patch.start < patch.end && patch.end <= 1);
  assert.ok(patch.loopStart >= patch.start && patch.loopStart < patch.loopEnd && patch.loopEnd <= patch.end);
  for (const value of Object.values(patch)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
}

test('ESI-32 patch admission constrains hostile regions and keeps nested loops valid', () => {
  for (const values of [null, {}, { start: 9, end: -1, loopStart: 9, loopEnd: -2 }, { start: NaN, end: Infinity, cutoff: 'bad', fine: 1e20 }, { start: .9, end: .91, loopStart: 0, loopEnd: 1 }]) {
    const patch = sanitizeEsi32Patch(values);
    regionAssertions(patch);
    assert.deepEqual(sanitizeEsi32Patch(patch), patch);
  }
  const extreme = sanitizeEsi32Patch({ cutoff: 1e10, resonance: 90, tune: -100, sampleSlot: 100, attack: -10, level: 9 });
  assert.equal(extreme.cutoff, 20000); assert.equal(extreme.resonance, 1);
  assert.equal(extreme.tune, -36); assert.equal(extreme.sampleSlot, 7);
  assert.equal(extreme.attack, .002); assert.equal(extreme.level, 1);
});

test('ESI-32 full randomizer is deterministic, bounded and varies every patch field', () => {
  const base = { ...ESI32_DEFAULT_PATCH, cutoff: 40 };
  assert.deepEqual(randomizeEsi32Patch(123, base), randomizeEsi32Patch(123, base));
  assert.equal(base.cutoff, 40);
  const variants = Array.from({ length: 100 }, (_, seed) => randomizeEsi32Patch(seed, base));
  variants.forEach(regionAssertions);
  for (const key of Object.keys(ESI32_DEFAULT_PATCH)) {
    assert.ok(new Set(variants.map(patch => patch[key])).size > 1, `frozen field ${key}`);
  }
  assert.equal(new Set(ESI32_PRESETS.map(preset => preset.id)).size, 12);
  assert.equal(new Set(ESI32_PRESETS.map(preset => JSON.stringify(preset.patch))).size, 12);
  ESI32_PRESETS.forEach(preset => assert.deepEqual(sanitizeEsi32Patch(preset.patch), preset.patch));
});

test('ESI-32 demos are original deterministic PCM with bounded, distinct signals', () => {
  assert.equal(ESI32_DEMO_SAMPLES.length, 8);
  const signatures = [];
  for (let slot = 0; slot < 8; slot += 1) {
    const data = createEsi32DemoData(slot, 8000);
    const copy = createEsi32DemoData(slot, 8000);
    assert.deepEqual(data.channels[0], copy.channels[0]);
    assert.equal(data.rootNote, ESI32_DEMO_SAMPLES[slot].rootNote);
    let squareSum = 0; let peak = 0;
    for (const sample of data.channels[0]) {
      assert.ok(Number.isFinite(sample));
      peak = Math.max(peak, Math.abs(sample)); squareSum += sample * sample;
    }
    const rms = Math.sqrt(squareSum / data.channels[0].length);
    assert.ok(peak <= .801 && peak >= .79);
    assert.ok(rms > .04 && rms < .65);
    assert.equal(Math.abs(data.channels[0][0]), 0);
    assert.equal(Math.abs(data.channels[0].at(-1)), 0);
    signatures.push(rms.toFixed(5));
  }
  assert.equal(new Set(signatures).size, 8);
});

test('sample pitch follows note, root, fine, transpose and bend while staying finite', () => {
  assert.equal(samplePlaybackRate(60), 1);
  assert.equal(samplePlaybackRate(72), 2);
  assert.equal(samplePlaybackRate(48), .5);
  assert.equal(samplePlaybackRate(60, { rootNote: 48 }), 2);
  assert.equal(samplePlaybackRate(60, { tune: 11, fine: 100 }), 2);
  assert.equal(samplePlaybackRate(60, {}, -12), .5);
  assert.equal(samplePlaybackRate(Infinity), 1);
  assert.ok(samplePlaybackRate(127, { rootNote: 0, tune: 36 }, 24) <= 64);
});

test('only explicit start arms audio, concurrent start shares context, stop preserves samples', async () => {
  let created = 0;
  class CountedContext extends FakeContext { constructor() { super(); created += 1; } }
  const audio = makeAudio(CountedContext);
  assert.equal(audio.noteOn(60), null); assert.equal(created, 0);
  const first = audio.start(); const second = audio.start();
  assert.equal(first, second);
  assert.equal(await first, true); assert.equal(created, 1); assert.equal(audio.samples.size, 8);
  const sample = audio.samples.get(0);
  audio.noteOn(60, 1, 'a');
  await audio.stop();
  assert.equal(audio.context.state, 'suspended'); assert.equal(audio.voiceCount, 0);
  assert.equal(audio.noteOn(60), null); assert.equal(audio.samples.get(0), sample);
  await audio.start(); assert.equal(audio.samples.get(0), sample); assert.equal(created, 1);
  await audio.dispose(); assert.equal(audio.context, null);
  await assert.rejects(audio.start(), /disposed/);
});

test('stop/dispose win a pending resume and never re-arm late', async () => {
  let finishResume;
  class SlowContext extends FakeContext {
    resume() { return new Promise(resolve => { finishResume = () => { this.state = 'running'; resolve(); }; }); }
  }
  const audio = makeAudio(SlowContext);
  const starting = audio.start(); const context = audio.context;
  await audio.stop(); finishResume();
  assert.equal(await starting, false); assert.equal(audio.enabled, false); assert.equal(context.state, 'suspended');
  const startingAgain = audio.start();
  await audio.dispose(); finishResume();
  assert.equal(await startingAgain, false); assert.equal(audio.enabled, false); assert.equal(audio.context, null);
});

test('trim, independent loops and reverse use actual PCM buffers and original coordinates', async () => {
  const audio = makeAudio(); await audio.start();
  const buffer = new FakeBuffer();
  buffer.getChannelData(0)[0] = .75;
  buffer.getChannelData(0)[buffer.length - 1] = -.5;
  audio.setSample(0, buffer);
  const patch = { start: .1, end: .8, loopStart: .25, loopEnd: .6, loopMode: 'forward' };
  audio.noteOn(72, 1, 'forward', patch);
  const forward = audio.voices.get('forward');
  assert.equal(forward.source.buffer, buffer);
  assert.equal(forward.source.playbackRate.value, 2);
  assert.deepEqual(forward.source.starts[0], [1, .2]);
  assert.equal(forward.source.loopStart, .5); assert.equal(forward.source.loopEnd, 1.2);
  audio.noteOn(60, 1, 'reverse', { ...patch, reverse: true });
  const reverse = audio.voices.get('reverse');
  assert.notEqual(reverse.source.buffer, buffer);
  assert.equal(reverse.source.buffer.getChannelData(0)[0], -.5);
  assert.equal(reverse.source.buffer.getChannelData(0).at(-1), .75);
  assert.ok(Math.abs(reverse.offset - .4) < 1e-8);
  assert.ok(Math.abs(reverse.source.loopStart - .8) < 1e-8);
  assert.equal(reverse.source.loopEnd, 1.5);
  audio.context.currentTime = 2;
  audio.getPlayheads().forEach(head => assert.ok(head.position >= .1 && head.position <= .8));
  audio.noteOn(60, 1, 'trim', { ...patch, loopMode: 'off' });
  assert.deepEqual(audio.voices.get('trim').source.starts[0], [2, 0, 1.4000000000000001]);
  assert.equal(audio.voices.get('trim').offset, .2);
  await audio.dispose();
});

test('polyphony honors 32 mono channels, stereo costs two and retirement nodes stay bounded', async () => {
  const audio = makeAudio(); await audio.start();
  for (let index = 0; index < 80; index += 1) audio.noteOn(60, .8, `mono-${index}`);
  assert.equal(audio.channelCount, 32); assert.equal(audio.voiceCount, 32);
  assert.ok(audio.retiring.size <= 32);
  assert.equal(audio.voices.has('mono-0'), false);
  audio.setSample(1, new FakeBuffer(2));
  for (let index = 0; index < 80; index += 1) audio.noteOn(60, .8, `stereo-${index}`, { sampleSlot: 1 });
  assert.equal(audio.channelCount, 32); assert.equal(audio.voiceCount, 16);
  assert.ok(audio.retiring.size <= 32);
  audio.panic(); assert.equal(audio.voiceCount, 0); assert.equal(audio.retiring.size, 0);
  assert.ok(audio.context.nodes.filter(node => node.starts).every(node => node.disconnected));
  await audio.dispose();
});

test('note-off holds interrupted ADSR, schedules release and cleans on source end', async () => {
  const audio = makeAudio(); await audio.start();
  audio.noteOn(60, .9, 'early', { attack: 2, decay: 1, sustain: .4, release: .7, filterEnv: 24, loopMode: 'forward' });
  const voice = audio.voices.get('early');
  audio.context.currentTime = 1.1;
  assert.equal(audio.noteOff('early'), true); assert.equal(audio.noteOff('early'), false);
  assert.ok(voice.envelope.gain.events.some(event => event[0] === 'hold' && event[1] === 1.1));
  assert.deepEqual(voice.envelope.gain.events.at(-1), ['ramp', 0, 1.8]);
  assert.equal(voice.source.stops[0], 1.803);
  voice.source.onended();
  assert.equal(audio.voiceCount, 0); assert.equal(voice.source.disconnected, true); assert.equal(voice.lfo.disconnected, true);
  await audio.dispose();
});

test('live tone/mix changes preserve held sample/envelopes and pitch bend updates active rates', async () => {
  const audio = makeAudio(); await audio.start();
  audio.noteOn(60, .5, 'held', { sampleSlot: 0, loopMode: 'forward' });
  audio.noteOn(60, .5, 'other', { sampleSlot: 1 });
  const held = audio.voices.get('held'); const other = audio.voices.get('other');
  const envelopeEvents = [...held.envelope.gain.events];
  const original = held.source.buffer;
  audio.context.currentTime = 1.25;
  audio.updateLivePatch({ sampleSlot: 0, cutoff: 800, resonance: .7, pan: -.8, level: .2, lfoDepth: 80, lfoRate: 2 });
  assert.equal(held.source.buffer, original); assert.deepEqual(held.envelope.gain.events, envelopeEvents);
  assert.equal(held.filters[0].frequency.value, 800); assert.equal(other.filters[0].frequency.value, 3600);
  assert.equal(held.panner.pan.value, -.8); assert.equal(held.lfoGain.gain.value, 80);
  assert.equal(held.level.gain.value, .2 * .5 * .16);
  const before = audio.getPlayheads().find(head => head.id === 'held').position;
  audio.setPitchBend(12);
  assert.equal(held.source.playbackRate.value, 2);
  assert.equal(audio.getPlayheads().find(head => head.id === 'held').position, before);
  audio.setSample(0, new FakeBuffer()); assert.equal(held.source.buffer, original);
  audio.setPatch({ sampleSlot: 3 }); assert.equal(audio.voices.size, 2);
  await audio.dispose();
});

test('loaded samples reject malformed/oversized data, sanitize PCM and serialize decoding', async () => {
  const audio = makeAudio();
  await assert.rejects(audio.decodeSample(0, new ArrayBuffer(16)), /Enable Audio/);
  await audio.start();
  assert.throws(() => audio.setSample(9, new FakeBuffer()), /slot/);
  assert.throws(() => audio.setSample(0, new FakeBuffer(3)), /mono or stereo/);
  assert.throws(() => audio.setSample(0, { ...new FakeBuffer(), duration: 61, getChannelData() {} }), /60 seconds/);
  const corrupted = new FakeBuffer(); corrupted.data[0].set([NaN, Infinity, 8, -4]);
  audio.setSample(0, corrupted); assert.deepEqual([...corrupted.data[0].slice(0, 4)], [0, 0, 1, -1]);
  await assert.rejects(audio.decodeSample(0, new ArrayBuffer(ESI32_MAX_FILE_BYTES + 1)), /32 MiB/);
  let finish;
  audio.context.decodeAudioData = () => new Promise(resolve => { finish = resolve; });
  const decoding = audio.decodeSample(2, new ArrayBuffer(16));
  await assert.rejects(audio.decodeSample(3, new ArrayBuffer(16)), /already loading/);
  finish(new FakeBuffer()); await decoding;
  assert.equal(audio.decodePromise, null);
  const existing = audio.samples.get(2);
  const wouldExceed = { numberOfChannels: 2, length: 192000 * 60, sampleRate: 192000, duration: 60, getChannelData() { throw new Error('should reject before PCM read'); } };
  const oldResident = audio.residentBytes.bind(audio);
  audio.residentBytes = () => ESI32_MAX_BUFFER_BYTES + 1;
  assert.throws(() => audio.setSample(2, wouldExceed), /128 MiB/);
  assert.equal(audio.samples.get(2), existing); audio.residentBytes = oldResident;
  assert.ok(audio.memoryBytes > 0);
  await audio.dispose(); assert.equal(audio.memoryBytes, 0);
});


test('nonloop cuts cache short PCM edge fades, preserve originals, handle reverse and account memory', async () => {
  const audio = makeAudio(); await audio.start();
  const original = new FakeBuffer(); original.data[0].fill(.75);
  audio.setSample(0, original);
  const baseBytes = audio.memoryBytes;
  const patch = { start: .2, end: .8, loopMode: 'off' };
  audio.noteOn(60, .8, 'first-cut', patch);
  const first = audio.voices.get('first-cut');
  const pcm = first.source.buffer.getChannelData(0);
  assert.equal(pcm[0], 0); assert.equal(pcm.at(-1), 0); assert.equal(pcm[100], .75);
  assert.equal(original.data[0][3200], .75);
  assert.ok(audio.memoryBytes > baseBytes);
  audio.noteOn(67, .8, 'same-cut', patch);
  assert.equal(audio.voices.get('same-cut').source.buffer, first.source.buffer);
  audio.noteOn(60, .8, 'reverse-cut', { ...patch, reverse: true });
  assert.equal(audio.voices.get('reverse-cut').source.buffer.getChannelData(0)[0], 0);
  assert.equal(audio.voices.get('reverse-cut').source.buffer.getChannelData(0).at(-1), 0);
  assert.equal(audio.reverseBuffers.size, 0, 'reverse cuts do not allocate a full-size reverse first');
  assert.equal(audio.regionBuffers.size, 1, 'one cache entry per slot; held old cuts remain voice-owned');
  assert.equal(audio.voices.get('first-cut').source.buffer, first.source.buffer);
  audio.context.currentTime = 1.1;
  const head = audio.getPlayheads().find(item => item.id === 'first-cut');
  assert.ok(Math.abs(head.position - .25) < 1e-8, 'cut playheads retain original-buffer coordinates');
  audio.setSample(0, new FakeBuffer()); assert.equal(audio.regionBuffers.size, 0);
  audio.panic(); await audio.dispose(); assert.equal(audio.memoryBytes, 0);
});
