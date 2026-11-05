import assert from 'node:assert/strict';
import test from 'node:test';
import { MidiOutputStream, audioMidiTimestamp } from '../src/midi-output-stream.js';

function fixture() {
  let now = 1000;
  const sent = [], queued = [], delivered = [], statuses = [];
  const deliver = () => {
    queued.sort((a, b) => a.timestamp - b.timestamp);
    while (queued.length && queued[0].timestamp <= now) delivered.push(queued.shift());
  };
  const manager = { clears: 0, panics: 0, send(bytes, timestamp) { const message = { bytes: [...bytes], timestamp }; sent.push(message); queued.push(message); deliver(); return true; },
    clearOutput() { deliver(); this.clears++; queued.length = 0; return true; }, panic() { this.panics++; } };
  const context = { state: 'running', currentTime: 1.04,
    getOutputTimestamp: () => ({ contextTime: 1, performanceTime: 1000 }) };
  const stream = new MidiOutputStream({ manager, runtime: { performance: { now: () => now } }, onStatus: state => statuses.push(state) });
  stream.setEnabled(true);
  const push = (events, producer = 'mixer', extra = {}) => stream.push({ epoch: stream.epoch, events, ...extra }, context, producer);
  const on = (id, time, source = 'layer:1', note = 60) => ({ type: 'noteOn', id, time, source, channel: 0, note, velocity: 90 });
  const off = (id, time, source = 'layer:1', note = 60) => ({ type: 'noteOff', id, time, source, channel: 0, note });
  return { stream, manager, sent, queued, delivered, statuses, context, push, on, off, advance: value => { now = value; deliver(); } };
}

test('audio output presentation timestamps preserve sample spacing without fixed extra delay', () => {
  const f = fixture();
  const at = 1.01, spacing = 32 / 48000;
  f.push([f.on(1, at), f.off(1, at + spacing), f.on(2, at + 2 * spacing, 'layer:1', 64)]);
  assert.equal(f.sent[0].timestamp, 1010);
  assert.ok(Math.abs(f.sent[1].timestamp - f.sent[0].timestamp - spacing * 1000) < 1e-9);
  assert.ok(Math.abs(f.sent[2].timestamp - f.sent[0].timestamp - 2 * spacing * 1000) < 1e-9);
  assert.deepEqual(f.sent.map(event => event.bytes), [[0x90, 60, 90], [0x80, 60, 0], [0x90, 64, 90]]);
});

test('timestamp fallback includes measured device latency and tolerates unsupported timestamp API', () => {
  const context = { currentTime: 12, baseLatency: .005, outputLatency: .01,
    getOutputTimestamp() { throw new Error('unavailable'); } };
  assert.ok(Math.abs(audioMidiTimestamp(context, 12.005, 5000) - 5020) < 1e-9);
  assert.equal(audioMidiTimestamp({}, 1, 5000), null);
});

test('each batch snapshots one device timestamp mapping for simultaneous state and notes', () => {
  const f = fixture();
  let reads = 0;
  f.context.getOutputTimestamp = () => ({ contextTime: 1, performanceTime: 1000 + reads++ * 5 });
  f.push([{ type: 'message', source: 'layer:1', time: 1.01, data: [0xc0, 12] },
    f.on(1, 1.01), f.off(1, 1.011)]);
  assert.equal(reads, 1);
  assert.equal(f.sent[0].timestamp, 1010);
  assert.equal(f.sent[1].timestamp, f.sent[0].timestamp);
  assert.ok(Math.abs(f.sent[2].timestamp - f.sent[1].timestamp - 1) < 1e-9);
  assert.deepEqual(f.sent.map(({ bytes }) => bytes[0]), [0xc0, 0x90, 0x80]);
});

test('main-thread stall drops overdue attacks while preserving releases already owed', () => {
  const f = fixture();
  f.push([f.on(1, 1.02)]);
  f.advance(1200);
  f.push([f.on(2, 1.04), f.off(1, 1.08), f.off(2, 1.1)]);
  assert.deepEqual(f.sent.map(event => event.bytes), [[0x90, 60, 90], [0x80, 60, 0]]);
  assert.equal(f.sent[1].timestamp, 1200);
  assert.equal(f.stream.stats.lateAttacks, 1);
  assert.equal(f.stream.stats.held, 0);
});

test('source release preserves other layers and keyboard ownership, even at matching pitches', () => {
  const f = fixture();
  f.push([f.on(1, 1.01, 'layer:a'), f.on(2, 1.01, 'layer:b')]);
  f.push([f.on(1, 1.01, 'pads')], 'file');
  f.push([{ type: 'release', source: 'layer:a', time: 1.02 }]);
  assert.equal(f.stream.stats.held, 2);
  assert.deepEqual(f.sent.at(-1).bytes, [0x80, 60, 0]);
  f.push([{ type: 'release', source: '*', time: 1.03 }]);
  assert.equal(f.stream.stats.held, 1);
  f.push([f.off(1, 1.04, 'pads')], 'file');
  assert.equal(f.stream.stats.held, 0);
  assert.equal(f.sent.filter(({ bytes }) => bytes[0] === 0x80).length, 3);
  assert.equal(f.sent.some(({ bytes }) => bytes[0] === 0xb0 && [120, 123].includes(bytes[1])), false);
});

test('out-of-order worklet batches recover matching release without replaying delivered attacks', () => {
  const f = fixture();
  f.push([f.off(7, 1.04)]);
  f.push([f.on(7, 1.02)]);
  assert.deepEqual(f.sent.map(event => event.bytes), [[0x90, 60, 90], [0x80, 60, 0]]);
  assert.equal(f.stream.stats.held, 0);
  f.advance(1100);
  f.push([f.on(8, 1.12), f.off(8, 1.13)]);
  assert.equal(f.sent.filter(({ bytes }) => bytes[0] === 0x90).length, 2);
});

test('overlapping same-pitch retriggers retain one note-off per note-on', () => {
  const f = fixture();
  f.push([f.on(1, 1.01), f.on(2, 1.02), f.off(1, 1.03), f.off(2, 1.04)]);
  assert.deepEqual(f.sent.map(event => event.bytes[0]), [0x90, 0x90, 0x80, 0x80]);
});

test('an earlier batch that changes source-release order replaces future releases correctly', () => {
  const f = fixture();
  f.push([f.on(1, 1.02), { type: 'release', source: 'layer:1', time: 1.04 }]);
  const clears = f.manager.clears;
  f.push([f.on(2, 1.01, 'layer:1', 64)]);
  assert.equal(f.manager.clears, clears + 1);
  assert.deepEqual(f.queued.filter(({ bytes }) => bytes[0] === 0x80).map(({ bytes }) => bytes[1]).sort(), [60, 64]);
  assert.deepEqual(f.queued.filter(({ bytes }) => bytes[0] === 0x90).map(({ bytes }) => bytes[1]).sort(), [60, 64]);
});

test('work spent reading a delayed batch cannot replay an attack already delivered by the device', () => {
  for (const duplicate of [false, true]) {
    const f = fixture();
    f.push([f.on(1, 1.002), { type: 'release', source: 'layer:1', time: 1.005 }]);
    const timestamp = f.context.getOutputTimestamp;
    f.context.getOutputTimestamp = () => { f.advance(1003); return timestamp(); };
    f.push([f.on(duplicate ? 1 : 2, 1.001, 'layer:1', duplicate ? 60 : 64)]);
    f.advance(1010);
    assert.deepEqual(f.delivered.filter(({ bytes }) => bytes[0] === 0x90).map(({ bytes }) => bytes[1]), duplicate ? [60] : [60, 64]);
    assert.deepEqual(f.delivered.filter(({ bytes }) => bytes[0] === 0x80).map(({ bytes }) => bytes[1]).sort(), duplicate ? [60] : [60, 64]);
    assert.equal(f.stream.stats.held, 0);
  }
});

test('device delivery during a future-plan rebuild is settled before cancellation and replay', () => {
  for (const elapsed of [3, 20]) {
    const f = fixture();
    f.push([f.on(1, 1.002), { type: 'release', source: 'layer:1', time: 1.005 }]);
    const apply = f.stream._apply.bind(f.stream);
    let consumedTime = false;
    f.stream._apply = (state, event) => {
      const result = apply(state, event);
      // Model main-thread work while the independent MIDI device keeps playing.
      if (!consumedTime && state !== f.stream.base) { consumedTime = true; f.advance(1000 + elapsed); }
      return result;
    };
    f.push([f.on(2, 1.001, 'layer:1', 64)]);
    f.advance(1100);
    const expected = elapsed > 8 ? [60] : [60, 64];
    assert.deepEqual(f.delivered.filter(({ bytes }) => bytes[0] === 0x90).map(({ bytes }) => bytes[1]), expected);
    assert.deepEqual(f.delivered.filter(({ bytes }) => bytes[0] === 0x80).map(({ bytes }) => bytes[1]).sort(), expected);
    assert.equal(f.stream.stats.held, 0);
    assert.equal(f.stream.stats.lateAttacks, elapsed > 8 ? 1 : 0);
  }
});

test('channel-mode cleanup and mixed producer releases cannot strand owned notes or pedals', () => {
  const f = fixture();
  const pedal = (time, data = [0xb1, 64, 127]) => ({ type: 'message', source: 'layer:1', time, data });
  f.push([{ ...f.on(1, 1.01, 'layer:1', 61), channel: 1 }, f.on(2, 1.01, 'layer:1', 62), pedal(1.01)]);
  f.push([{ ...f.on(1, 1.01, 'layer:1', 64), channel: 1 }, pedal(1.01)], 'file');
  f.push([pedal(1.02, [0xb1, 123, 0])]);
  assert.equal(f.stream.stats.held, 2);
  f.push([{ type: 'release', source: '*', time: 1.03 }]);
  assert.equal(f.stream.stats.held, 1);
  f.push([{ type: 'release', source: '*', time: 1.04 }], 'file');
  f.advance(1100);
  assert.equal(f.stream.stats.held, 0);
  assert.deepEqual(f.delivered.filter(({ bytes }) => (bytes[0] & 0xf0) === 0x80).map(({ bytes }) => bytes.slice(0, 2)), [[0x81, 61], [0x80, 62], [0x81, 64]]);
  assert.deepEqual(f.delivered.filter(({ bytes }) => bytes[0] === 0xb1 && bytes[1] === 64 && bytes[2] === 0).map(({ timestamp }) => timestamp), [1040]);
  assert.equal(f.delivered.some(({ bytes }) => bytes[1] === 123), false);
});

test('the pending bound clears queued work and panics held notes from every producer', () => {
  const f = fixture();
  f.push([f.on(1, 1.001)]);
  f.push([f.on(1, 1.001, 'layer:1', 64)], 'file');
  f.advance(1002);
  const block = Array.from({ length: 4096 }, () => ({ type: 'message', source: 'layer:1', time: 1.9, data: [0xb0, 1, 64] }));
  for (let index = 0; index < 4; index++) assert.equal(f.push(block, index % 2 ? 'file' : 'mixer'), true);
  assert.equal(f.stream.stats.pending, 16384);
  const panics = f.manager.panics;
  assert.equal(f.push([f.on(2, 1.95)], 'file'), false);
  assert.equal(f.manager.panics, panics + 1);
  assert.equal(f.stream.stats.pending, 0);
  assert.equal(f.stream.stats.held, 0);
  assert.equal(f.stream.stats.enabled, false);
  assert.equal(f.queued.length, 0);
});

test('a channel-scoped release retains other channels in the same source', () => {
  const f = fixture();
  f.push([f.on(1, 1.01), { ...f.on(2, 1.01), channel: 1 },
    { type: 'release', source: 'layer:1', channel: 0, time: 1.02 }]);
  assert.equal(f.stream.stats.held, 1);
  assert.deepEqual(f.sent.at(-1).bytes, [0x80, 60, 0]);
  f.push([{ type: 'release', source: '*', time: 1.03 }]);
  assert.deepEqual(f.sent.at(-1).bytes, [0x81, 60, 0]);
});

test('a release arriving before a slightly overdue attack cannot strand that attack', () => {
  for (const type of ['noteOff', 'release']) {
    const f = fixture(); f.advance(1200);
    f.push([type === 'noteOff' ? f.off(1, 1.199) : { type, source: 'layer:1', time: 1.199 }]);
    f.push([f.on(1, 1.198)]);
    assert.equal(f.sent.length, 0);
    assert.equal(f.stream.stats.held, 0);
    f.push([f.on(2, 1.202)]);
    assert.equal(f.sent.length, 1);
  }
});

test('a loop release followed by its new attack at the same sample keeps the downbeat', () => {
  const f = fixture();
  f.push([f.on(1, 1.01), { type: 'release', source: 'layer:1', time: 1.02 }, f.on(2, 1.02), f.off(2, 1.03)]);
  assert.deepEqual(f.sent.map(event => event.bytes[0]), [0x90, 0x80, 0x90, 0x80]);
  assert.equal(f.stream.stats.held, 0);
});

test('route change rejects stale batches and global panic clears future reservations', () => {
  const f = fixture();
  f.push([f.on(1, 1.04)]);
  const previous = f.stream.epoch, clears = f.manager.clears;
  assert.ok(f.stream.panic() > previous);
  assert.equal(f.stream.stats.held, 0);
  assert.equal(f.stream.stats.pending, 0);
  assert.ok(f.manager.clears > clears);
  assert.equal(f.push([f.on(2, 1.05)], 'mixer', { epoch: previous }), false);
  assert.equal(f.sent.length, 1);
  f.stream.setEnabled(false);
  assert.equal(f.push([f.on(3, 1.05)]), false);
});

test('overflow, disconnected output, and interrupted audio clocks fail closed', () => {
  for (const failure of ['overflow', 'disconnect', 'suspend']) {
    const f = fixture(); f.push([f.on(1, 1.01)]);
    if (failure === 'disconnect') f.manager.send = () => { throw new Error('disconnected'); };
    if (failure === 'suspend') f.context.state = 'suspended';
    assert.equal(f.push([f.on(2, 1.02)], 'mixer', { overflow: failure === 'overflow' }), false);
    assert.equal(f.stream.enabled, false);
    assert.equal(f.stream.stats.held, 0);
    assert.ok(f.manager.panics >= 2);
    assert.ok(f.statuses.at(-1).error);
  }
});

test('controllers are timestamped and source cleanup releases its pedal', () => {
  const f = fixture();
  f.push([{ type: 'message', source: 'layer:1', time: 1.01, data: [0xc0, 12] },
    { type: 'message', source: 'layer:1', time: 1.02, data: [0xe0, 0, 72] },
    { type: 'message', source: 'layer:1', time: 1.03, data: [0xb0, 64, 127] },
    f.on(1, 1.04), { type: 'release', source: 'layer:1', time: 1.05 }]);
  assert.deepEqual(f.sent.map(event => event.bytes), [[0xc0, 12], [0xe0, 0, 72], [0xb0, 64, 127], [0x90, 60, 90], [0x80, 60, 0], [0xb0, 64, 0]]);
  assert.equal(f.sent.at(-1).timestamp, 1050);
});
