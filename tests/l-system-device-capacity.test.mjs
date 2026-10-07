import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { measureAudioCapacity, nextPreparedCapacity } from '../src/instruments/micmic/native/device-capacity.js';

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
    assert.ok(nextPreparedCapacity(current, { voiceLimit: current, calibratedVoices: current, cpuLoad: .2, peakLoad: .3 }, current * 10) > current);
  }
  assert.ok(nextPreparedCapacity(4096, { voiceLimit: 3100, requestedTargets: 3100, cpuLoad: .2, peakLoad: .3 }, 100000) > 4096,
    'complete tiling substitutions below the current budget can still seek larger derivations');
});

test('small presets and silent graphs never erase or inflate learned capacity', () => {
  assert.equal(nextPreparedCapacity(4096, { voiceLimit: 32, calibratedVoices: 32, cpuLoad: .1, peakLoad: .2 }, 32), 4096);
  assert.equal(nextPreparedCapacity(4096, { voiceLimit: 4096, cpuLoad: 0, peakLoad: 0 }, 100000), 4096);
  assert.equal(nextPreparedCapacity(4096, { voiceLimit: 0, cpuLoad: .3, peakLoad: .4 }, 100000), 4096);
});

test('deadline pressure reduces preparation to proved capacity and growth waits for headroom', () => {
  assert.equal(nextPreparedCapacity(4096, { voiceLimit: 512, calibratedVoices: 512, cpuLoad: .96, peakLoad: 1.1 }, 100000), 512);
  assert.ok(nextPreparedCapacity(4096, { voiceLimit: 4096, calibratedVoices: 4096, cpuLoad: .6, peakLoad: .8 }, 100000) > 4096,
    'the conservative cold probe target is not a permanent processing ceiling');
  assert.equal(nextPreparedCapacity(4096, { voiceLimit: 4096, calibratedVoices: 4096, cpuLoad: .96, peakLoad: .99 }, 100000), 4096);
  assert.ok(nextPreparedCapacity(4096, { voiceLimit: 4096, calibratedVoices: 0, cpuLoad: 1.3, peakLoad: 1.4 }, 100000) < 4096,
    'manual admission also retains the measured device safety budget');
});
