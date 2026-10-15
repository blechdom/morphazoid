import test from 'node:test';
import assert from 'node:assert/strict';
import { mountResonatorRecording } from '../src/instruments/simd-resonator-rust/recording.js';
import { buildSpartialTracks } from '../src/instruments/spartial/spartial-recording-export.js';
import { wavHeader } from '../src/output-recorder.js';

class Element {
  events = new Map(); dataset = {}; disabled = false; hidden = false; textContent = ''; open = false;
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  setAttribute(name, value) { this[name] = value; }
  async click() { for (const fn of this.events.get('click') || []) await fn(); }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function fixture() {
  const ids = ['Controls', 'Record', 'Time', 'Hint', 'Dialog', 'Summary', 'Message', 'Folder', 'Zip', 'Wav', 'Discard', 'Close', 'ChannelMap'];
  const elements = new Map(ids.map(id => ['multitrack' + id, new Element()]));
  const doc = { getElementById: id => elements.get(id) };
  const runtime = new Element(); runtime.AudioWorkletNode = class {}; runtime.isSecureContext = true;
  const instances = [];
  class Recorder {
    constructor({ onchange, channelCount }) { this.changed = onchange; this.channelCount = channelCount; instances.push(this); }
    async start({ filename }) {
      this.filename = filename;
      this.changed({ state: 'starting', maxSeconds: 100, channelCount: this.channelCount });
      this.changed({ state: 'recording', maxSeconds: 100, channelCount: this.channelCount });
    }
    async stop(reason = 'stopped') {
      this.changed({ state: 'stopping', maxSeconds: 100, channelCount: this.channelCount });
      this.changed({ state: 'ready', blob: new Blob(['take']), channelCount: this.channelCount,
        seconds: 1, frames: 48000, sampleRate: 48000, maxSeconds: 100, reason });
    }
    discard() { this.changed({ state: 'idle' }); }
    async destroy() { this.destroyed = true; }
  }
  let canRecord = false;
  const audio = { canRecord: () => canRecord, recordingSampleRate: () => 48000 };
  const patch = { layoutId: '7-4-1', enabled: true, omitLfe: true, musical: { span: 1 } };
  const locks = [];
  const recording = mountResonatorRecording({ audio, getPatch: () => patch, onLockChange: locked => locks.push(locked), doc, runtime, Recorder });
  return { recording, elements, patch, instances, locks, runtime, enable() { canRecord = true; recording.update(); } };
}

test('channel recording requires audio, locks setup, snapshots musical state, and retains export after Audio off', async () => {
  const f = fixture(), button = f.elements.get('multitrackRecord');
  assert.equal(button.textContent, 'Record channels'); assert.equal(button.disabled, true);
  await button.click(); assert.equal(f.instances.length, 0, 'programmatic click also respects Audio');
  f.enable(); await button.click();
  assert.equal(f.recording.locked, true); assert.equal(button.textContent, 'Stop recording');
  assert.ok(f.instances[0].filename.startsWith('rezoidinator-'));
  f.patch.musical.span = 3;
  assert.equal(f.recording.getStatus().metadata.musical.span, 1, 'metadata is an immutable take snapshot');
  await f.recording.stop('audio-off');
  assert.equal(f.recording.locked, false); assert.equal(f.recording.getStatus().hasTake, true);
  assert.equal(f.recording.getStatus().reason, 'audio-off');
  assert.equal('blob' in f.recording.getStatus(), false, 'public state is JSON-safe');
  assert.equal(f.elements.get('multitrackDialog').open, true);
  assert.match(f.elements.get('multitrackChannelMap').textContent, /4: LFE \(silent\)/);
  assert.equal(button.textContent, 'Export channels');
  await f.elements.get('multitrackDiscard').click();
  assert.equal(f.recording.getStatus().hasTake, false); assert.equal(button.textContent, 'Record channels');
  f.recording.destroy(); f.recording.destroy();
  assert.ok([...f.elements.values()].every(node => [...node.events.values()].every(handlers => handlers.size === 0)));
  assert.equal(f.runtime.events.get('beforeunload').size, 0);
});

test('shared export labels Rezoidinator while preserving synchronized PCM24 channels and silent LFE', async () => {
  const channels = 5, frames = 3, sampleRate = 48000;
  const samples = [[100, -100, 1], [200, -200, 2], [300, -300, 3], [400, -400, 4], [0, 0, 0]];
  const pcm = new Uint8Array(frames * channels * 3);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    const at = (frame * channels + channel) * 3, value = samples[channel][frame];
    pcm[at] = value & 255; pcm[at + 1] = value >> 8 & 255; pcm[at + 2] = value >> 16 & 255;
  }
  const blob = new Blob([wavHeader({ sampleRate, channelCount: channels, frames }), pcm, new Uint8Array(pcm.length % 2)]);
  const capture = { blob, frames, channelCount: channels, sampleRate };
  const metadata = { instrumentName: 'Rezoidinator', namePrefix: 'rezoidinator', createdAt: '2026-10-14T12:00:00Z',
    omitLfe: true, speakers: samples.map((_, index) => ({ channel: index + 1, label: index === 4 ? 'LFE' : 'S' + (index + 1), kind: index === 4 ? 'lfe' : 'speaker' })) };
  const result = await buildSpartialTracks(capture, metadata);
  assert.equal(result.name, 'rezoidinator-20261014T120000Z'); assert.equal(result.files.length, 6);
  const map = await result.files.at(-1).blob.text();
  assert.match(map, /^Morphazoid Rezoidinator multitrack recording/); assert.doesNotMatch(map, /SPARTIAL/);
  assert.match(map, /05  LFE  05-LFE.wav  \(omitted; silent\)/);
  for (let channel = 0; channel < channels; channel++) {
    const bytes = new Uint8Array(await result.files[channel].blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint16(34, true), 24);
    assert.equal(view.getUint32(40, true), frames * 3);
    for (let frame = 0; frame < frames; frame++) {
      const at = 44 + frame * 3, raw = bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
      assert.equal(raw & 0x800000 ? raw - 0x1000000 : raw, samples[channel][frame]);
    }
  }
});
