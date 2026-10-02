import test from 'node:test';
import assert from 'node:assert/strict';
import { SynthesisAudio } from '../src/instruments/synthesis/audio.js';
import { SynthesisInput } from '../src/instruments/synthesis/input.js';

function harness() {
  let armed = true, grant;
  const changes = [], tracks = [], sources = [];
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  const context = {
    createAnalyser: node,
    createMediaStreamSource(stream) { const source = node(); source.stream = stream; sources.push(source); return source; },
    createBufferSource() { return { ...node(), start() { this.started = true; }, stop() { this.stopped = true; } }; },
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: c => data[c] };
    },
  };
  const runtime = { navigator: { mediaDevices: { getUserMedia(constraints) {
    assert.equal(constraints.audio.autoGainControl.ideal, false);
    return new Promise(resolve => { grant = resolve; });
  } } } };
  const input = new SynthesisInput({ isArmed: () => armed, onChange: status => changes.push(status), runtime });
  input.attach(context, node());
  return { input, context, changes, tracks, sources, setArmed(value) { armed = value; }, grant() {
    const track = { stops: 0, stop() { this.stops++; }, label: 'Test input', addEventListener(_, callback) { this.ended = callback; }, getSettings: () => ({ channelCount: 1 }) };
    tracks.push(track);
    grant({ getTracks: () => [track], getAudioTracks: () => [track] });
    return track;
  } };
}

test('microphone capture requires armed Audio and uses cancellable permission ownership', async () => {
  const h = harness();
  h.setArmed(false);
  await assert.rejects(h.input.startMicrophone(), /Enable Audio/);
  h.setArmed(true);
  const request = h.input.startMicrophone();
  assert.equal(h.input.status().pending, true);
  h.input.stop();
  const track = h.grant();
  assert.equal(await request, false);
  assert.equal(track.stops, 1);
  assert.equal(h.sources.length, 0, 'late permission never connects');
  assert.equal(h.input.status().kind, 'none');
});

test('muting or disposing while permission is pending closes the eventual stream', async () => {
  for (const action of ['mute', 'dispose']) {
    const h = harness(); const request = h.input.startMicrophone();
    if (action === 'mute') h.setArmed(false); else h.input.dispose();
    const track = h.grant();
    assert.equal(await request, false);
    assert.equal(track.stops, 1);
    assert.equal(h.sources.length, 0);
  }
});

test('stopping and device-ended events release capture nodes and tracks', async () => {
  const h = harness(); const request = h.input.startMicrophone(); const track = h.grant();
  assert.equal(await request, true);
  assert.equal(h.input.status().kind, 'microphone');
  assert.equal(h.input.status().pending, false);
  track.ended();
  assert.equal(track.stops, 1);
  assert.equal(h.sources[0].disconnected, true);
  assert.equal(h.input.status().kind, 'none');
  h.input.dispose();
  assert.equal(track.stops, 1, 'release is idempotent');
});

test('file loops are stereo, bounded, restartable and released separately from retained data', () => {
  const h = harness();
  const decoded = h.context.createBuffer(3, 121000, 1000);
  decoded.getChannelData(0).fill(.25); decoded.getChannelData(1).fill(-.5);
  h.input.setFile(decoded, 'fixture.wav');
  assert.equal(h.input.fileBuffer.length, 120000);
  assert.equal(h.input.fileBuffer.numberOfChannels, 2);
  assert.equal(h.input.fileBuffer.getChannelData(1)[0], -.5);
  const source = h.input.node;
  assert.equal(source.loop, true); assert.equal(source.started, true);
  h.input.stop();
  assert.equal(source.stopped, true); assert.equal(source.disconnected, true);
  assert.equal(h.input.status().hasFile, true);
  h.setArmed(false); assert.equal(h.input.startFile(), false);
  h.setArmed(true); assert.equal(h.input.startFile(), true);
  h.input.dispose(); assert.equal(h.input.fileBuffer, null);
});


test('new source intent invalidates an unfinished file decode before it can override the user', async () => {
  for (const action of ['stopInput', 'mute', 'restoreSource', 'startMicrophone', 'startFile']) {
    let decode;
    const audio = new SynthesisAudio();
    audio.armed = true;
    audio.context = { state: "running", decodeAudioData: () => new Promise(resolve => { decode = resolve; }) };
    audio.input.startMicrophone = async () => true;
    audio.input.startFile = () => false;
    const pending = audio.loadFile({ size: 1, name: 'late.wav', arrayBuffer: async () => new ArrayBuffer(0) }, { processing: true });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(typeof decode, 'function');
    await audio[action]();
    decode({});
    await assert.rejects(pending, /cancelled/, action);
    assert.equal(audio.input.kind, 'none');
  }
});

test('restoring or importing a new source cancels an in-progress microphone capture', async () => {
  const audio = new SynthesisAudio();
  audio.armed = true;
  audio.node = { port: { postMessage() {} } };
  audio.input.startMicrophone = async () => true;
  const captured = audio.captureSource();
  await Promise.resolve();
  assert.ok(audio.captureRequest);
  audio.restoreSource();
  assert.equal(await captured, null);
  assert.equal(audio.captureRequest, null);
});

test('Loop input changes the playing source in place and ended inputs remain replayable', () => {
  const h = harness();
  h.input.setFile(h.context.createBuffer(1, 1000, 1000), 'one-shot.wav');
  const first = h.input.node;
  h.input.setLoop(false);
  assert.equal(h.input.node, first, 'changing loop mode does not restart the source');
  assert.equal(first.loop, false);
  h.input.setLoop(true);
  assert.equal(first.loop, true);
  h.input.setLoop(false);
  first.onended();
  assert.equal(first.disconnected, true);
  assert.equal(h.input.node, null);
  assert.equal(h.input.status().kind, 'none');
  assert.equal(h.input.status().ended, true);
  assert.equal(h.input.status().hasFile, true);
  assert.equal(h.input.startFile(), true);
  const replacement = h.input.node;
  assert.notEqual(replacement, first);
  assert.equal(replacement.loop, false, 'replay retains loop preference');
  assert.equal(h.input.status().ended, false);
  first.onended();
  assert.equal(h.input.node, replacement, 'stale ended callback cannot release the new source');
  h.input.dispose();
});

test('a replaced sample ending cannot disconnect microphone input', async () => {
  const h = harness();
  h.input.setFile(h.context.createBuffer(1, 1000, 1000), 'old.wav');
  const old = h.input.node;
  const pending = h.input.startMicrophone();
  const track = h.grant();
  await pending;
  const microphone = h.input.node;
  old.onended();
  h.input.setLoop(false);
  assert.equal(h.input.node, microphone);
  assert.equal(h.input.kind, 'microphone');
  assert.equal(track.stops, 0);
  assert.equal(microphone.loop, undefined);
  h.input.dispose();
});
