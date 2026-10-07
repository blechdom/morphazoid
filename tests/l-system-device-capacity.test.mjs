import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { measureAudioCapacity, nextPreparedCapacity, createPreparedCapacityController } from '../src/instruments/micmic/native/device-capacity.js';

const statusFor = (prepared, overrides = {}) => ({ voiceLimit: prepared, calibratedVoices: prepared,
  requestedTargets: prepared, targetVoices: prepared, activeVoices: prepared,
  cpuLoad: .6, peakLoad: .6, topologyRevision: 4, deadlineMisses: 0, underruns: 0, overruns: 0,
  failure: null, ...overrides });
const sample = (controller, nowSeconds, overrides = {}) => controller.observe({ nowSeconds,
  current: 512, requested: 100000, status: statusFor(512), topologyRevision: 4,
  eligibleVoices: 512, preparedVoices: 512, settled: true, ...overrides });
function prove(controller, start, overrides = {}) {
  for (let step = 0; step < 12; step++) assert.equal(sample(controller, start + step / 4, overrides), overrides.current ?? 512);
  return sample(controller, start + 3, overrides);
}

test('cold capacity measurement processes actual pitched Rust DSP and releases its disposable instance', async () => {
  const module = await WebAssembly.compile(fs.readFileSync(new URL('../assets/wasm/l-system-delay.wasm', import.meta.url)));
  const measured = measureAudioCapacity(module, 8000, { timeAllowanceMs: 40 });
  assert.ok(Number.isSafeInteger(measured.voices) && measured.voices > 0);
  assert.equal(measured.sampleRate, 8000);
  assert.ok(measured.measurements.length > 0);
  assert.ok(measured.measurements.every(({ voices, load }) => voices > 0 && Number.isFinite(load) && load > 0));
  assert.ok(measured.voices <= Math.max(...measured.measurements.map(probe => probe.voices)));
  assert.ok(measured.elapsedMs >= 0);
});

test('capacity can exceed any former fixed ceiling when a full pool proves headroom', () => {
  for (const current of [48, 2048, 16384, 131072]) {
    assert.ok(nextPreparedCapacity(current, statusFor(current, { cpuLoad: .2, peakLoad: .3 }), current * 10) > current);
  }
  assert.ok(nextPreparedCapacity(4096, statusFor(3100, { cpuLoad: .2, peakLoad: .3 }), 100000) > 4096,
    'complete tiling substitutions below the current budget can still seek larger derivations');
});

test('small presets and silent graphs never erase or inflate learned capacity', () => {
  assert.equal(nextPreparedCapacity(4096, statusFor(32, { cpuLoad: .1, peakLoad: .2 }), 32), 4096);
  assert.equal(nextPreparedCapacity(4096, statusFor(4096, { cpuLoad: 0, peakLoad: 0 }), 100000), 4096);
  assert.equal(nextPreparedCapacity(4096, statusFor(4096, { voiceLimit: 0 }), 100000), 4096);
});

test('deadline pressure leaves the prepared graph intact while Rust reduces live admission', () => {
  assert.equal(nextPreparedCapacity(4096, statusFor(4096, { voiceLimit: 512, targetVoices: 512,
    activeVoices: 768, calibratedVoices: 512, cpuLoad: .96, peakLoad: 1.1 }), 100000), 4096);
  assert.ok(nextPreparedCapacity(4096, statusFor(4096, { cpuLoad: .6, peakLoad: .8 }), 100000) > 4096,
    'the conservative cold probe target is not a permanent processing ceiling');
  assert.equal(nextPreparedCapacity(4096, statusFor(4096, { cpuLoad: .96, peakLoad: .99 }), 100000), 4096);
  assert.equal(nextPreparedCapacity(4096, statusFor(4096, { calibratedVoices: 0, cpuLoad: 1.3, peakLoad: 1.4 }), 100000), 4096);
});

test('growth approaches the deadline using measured remaining headroom instead of recurring 35 percent jumps', () => {
  const candidate = nextPreparedCapacity(512, statusFor(512, { cpuLoad: .9, peakLoad: .9 }), 100000);
  assert.ok(candidate > 512 && candidate < 512 * 1.05, candidate);
  assert.equal(nextPreparedCapacity(512, statusFor(512, { cpuLoad: .2, peakLoad: .2 }), 100000), 691);
  assert.equal(nextPreparedCapacity(512, statusFor(512, { cpuLoad: .94999, peakLoad: .94999 }), 100000), 513,
    'positive measurable headroom remains discoverable even below one whole voice');
  let current = 512;
  for (let step = 0; step < 100; step++) {
    const load = current / 800;
    const next = nextPreparedCapacity(current, statusFor(current, { cpuLoad: load, peakLoad: load }), 100000);
    assert.ok(next >= current && next <= 760, `${current} -> ${next} at ${load}`);
    current = next;
  }
  assert.equal(current, 760, 'constant linear DSP cost converges without rebuilding smaller recursions');
});

test('growth requires full eligible, validated, settled admission from the installed topology', () => {
  const context = { preparedVoices: 512, eligibleVoices: 512, topologyRevision: 4 };
  for (const overrides of [
    { voiceLimit: 487, targetVoices: 487, activeVoices: 487 },
    { calibratedVoices: 511 }, { activeVoices: 600 }, { activeVoices: 511 },
    { targetVoices: 511 }, { requestedTargets: 513 }, { topologyRevision: 3 },
    { failure: 'engine stopped' }, { error: 'install rejected' }, { cpuLoad: NaN }, { cpuLoad: -.1 },
  ]) assert.equal(nextPreparedCapacity(512, statusFor(512, overrides), 100000, context), 512, JSON.stringify(overrides));
  assert.equal(nextPreparedCapacity(512, statusFor(512, { voiceLimit: 256, targetVoices: 256, activeVoices: 256 }), 100000,
    { ...context, eligibleVoices: 256 }), 512, 'ineligible storage cannot prove the full pool');
  assert.equal(nextPreparedCapacity(512, statusFor(512), 100000, { ...context, settled: false }), 512);
});

test('capacity controller requires three seconds of coherent full admission, not two widely spaced snapshots', () => {
  const controller = createPreparedCapacityController();
  assert.equal(sample(controller, 0), 512);
  assert.equal(sample(controller, 3), 512, 'unobserved intervals cannot prove headroom');
  assert.ok(prove(controller, 3) > 512);
});

test('overload, partial admission and outgoing tails restart the sustained proof without shrinking the graph', () => {
  for (const status of [statusFor(512, { cpuLoad: 1.1, peakLoad: 1.2 }),
    statusFor(512, { voiceLimit: 500, targetVoices: 500, activeVoices: 500 }),
    statusFor(512, { activeVoices: 600 }), statusFor(512, { failure: 'audio error' })]) {
    const controller = createPreparedCapacityController();
    for (let step = 0; step < 10; step++) assert.equal(sample(controller, step / 4), 512);
    assert.equal(sample(controller, 2.5, { status }), 512);
    assert.ok(prove(controller, 2.75) > 512);
  }
});

test('missed audio deadlines and counter resets cannot validate a preparation candidate', () => {
  for (const counter of ['deadlineMisses', 'underruns', 'overruns']) {
    const controller = createPreparedCapacityController();
    for (let step = 0; step < 10; step++) assert.equal(sample(controller, step / 4), 512);
    const status = statusFor(512, { [counter]: 1 });
    assert.equal(sample(controller, 2.5, { status }), 512);
    for (let step = 11; step < 22; step++) assert.equal(sample(controller, step / 4, { status }), 512);
    assert.ok(sample(controller, 5.5, { status }) > 512);
    for (let step = 23; step < 33; step++) assert.equal(sample(controller, step / 4, { status }), 512);
    assert.equal(sample(controller, 8.25, { status: statusFor(512) }), 512);
    assert.ok(prove(controller, 8.25) > 512, 'reset counters require a fresh complete proof');
  }
});

test('pending installs, explicit edits and stale topology metrics cannot borrow previous headroom', () => {
  const controller = createPreparedCapacityController();
  for (let step = 0; step < 10; step++) assert.equal(sample(controller, step / 4), 512);
  assert.equal(sample(controller, 2.5, { settled: false }), 512);
  assert.ok(prove(controller, 2.75) > 512);
  for (let step = 24; step < 34; step++) assert.equal(sample(controller, step / 4), 512);
  controller.reset();
  assert.ok(prove(controller, 8.5) > 512, 'an edit needs an entirely new recurring proof');
  const newTopology = { topologyRevision: 5, status: statusFor(512, { topologyRevision: 5 }) };
  for (let step = 47; step < 57; step++) assert.equal(sample(controller, step / 4, newTopology), 512);
  assert.equal(sample(controller, 14.25, { topologyRevision: 5 }), 512, 'late status belongs to the old installed scene');
  assert.ok(prove(controller, 14.5, newTopology) > 512);
});

test('capacity proof follows the audio clock and budgets, not repeated or backward samples', () => {
  const controller = createPreparedCapacityController();
  for (let step = 0; step < 10; step++) assert.equal(sample(controller, step / 4), 512);
  for (let repeat = 0; repeat < 100; repeat++) assert.equal(sample(controller, 2.25), 512);
  assert.equal(sample(controller, 1), 512);
  assert.ok(prove(controller, 1) > 512);
  const larger = { current: 691, status: statusFor(691), preparedVoices: 691, eligibleVoices: 691 };
  assert.equal(sample(controller, 4.5, larger), 691);
  assert.ok(prove(controller, 4.5, larger) > 691);
});

test('quiet presets retain capacity while complete coarse tilings can prove the next larger derivation', () => {
  for (const count of [0, 14]) {
    const controller = createPreparedCapacityController();
    const tiny = { current: 4096, requested: count, preparedVoices: count, eligibleVoices: count, status: statusFor(count) };
    for (let step = 0; step < 80; step++) assert.equal(sample(controller, step / 4, tiny), 4096);
  }
  const zeroDepth = createPreparedCapacityController();
  const silent = { current: 4096, preparedVoices: 4096, eligibleVoices: 0,
    status: statusFor(4096, { voiceLimit: 0, targetVoices: 0, activeVoices: 0, calibratedVoices: 4096 }) };
  for (let step = 0; step < 80; step++) assert.equal(sample(zeroDepth, step / 4, silent), 4096);
  const controller = createPreparedCapacityController();
  const tiling = { current: 4096, preparedVoices: 3100, eligibleVoices: 3100, status: statusFor(3100) };
  assert.ok(prove(controller, 0, tiling) > 4096);
});

test('worst recurring window load limits each probe and improved device headroom remains usable', () => {
  const controller = createPreparedCapacityController();
  assert.equal(sample(controller, 0, { status: statusFor(512, { cpuLoad: .9, peakLoad: .9 }) }), 512);
  for (let step = 1; step < 12; step++) assert.equal(sample(controller, step / 4), 512);
  const cautious = sample(controller, 3);
  assert.ok(cautious > 512 && cautious < 540);
  const recovered = prove(controller, 3.25, { status: statusFor(512, { cpuLoad: .2, peakLoad: .2 }) });
  assert.ok(recovered > cautious, 'a previous expensive window is not a permanent device ceiling');
});
