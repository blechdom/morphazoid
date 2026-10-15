import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSimdResonatorConfiguration } from '../src/simd-resonator.js';
import { SIMD_RESONATOR_FULL_PRESETS } from '../src/families/simd-resonator/simd-resonator-presets.js';

const scalarBytes = await readFile(new URL('../assets/wasm/simd-resonator-scalar.wasm', import.meta.url));
const base = { fftSize: 2048, fftWindow: 1, fftHopRatio: .125, fftBandCount: 32,
  fftResponseMs: 210, fftDetail: .08, fftMix: 1, fftInputGain: 1.6,
  fftGateDb: -84, fftLowFrequency: 70, fftHighFrequency: 6000 };
let importId = 0;

async function withProcessor(rate, run) {
  const saved = new Map(['sampleRate', 'AudioWorkletProcessor', 'registerProcessor'].map(key => [key, globalThis[key]]));
  let Processor;
  globalThis.sampleRate = rate;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
  try {
    await import(`../src/simd-resonator-processor.js?transitions=${++importId}`);
    const make = (settings = base) => {
      const processor = new Processor();
      processor.install({ scalarBytes, requestedBackend: 'scalar', configuration: createSimdResonatorConfiguration(settings, rate) });
      assert.equal(processor.ready, true);
      processor.handleMessage({ type: 'mic', active: true });
      return processor;
    };
    await run(make, settings => createSimdResonatorConfiguration(settings, rate));
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

const tone = (frame, rate) => .12 * Math.sin(2 * Math.PI * 220 * frame / rate + .37)
  + .065 * Math.sin(2 * Math.PI * 1760 * frame / rate + .1);
function render(processor, start, blocks, rate, source = tone, beforeBlock = () => {}) {
  const rendered = new Float32Array(blocks * 128);
  const input = new Float32Array(128), left = new Float32Array(128), right = new Float32Array(128);
  for (let block = 0; block < blocks; block += 1) {
    beforeBlock(block, processor);
    for (let frame = 0; frame < 128; frame += 1) input[frame] = source(start + block * 128 + frame, rate);
    assert.equal(processor.process([[input]], [[left, right]]), true);
    rendered.set(left, block * 128);
    assert.ok(right.every(Number.isFinite));
  }
  return rendered;
}
function metrics(samples, previous = samples[0]) {
  let peak = 0, delta = 0, power = 0, silence = 0, longestSilence = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample));
    peak = Math.max(peak, Math.abs(sample));
    delta = Math.max(delta, Math.abs(sample - previous)); previous = sample;
    power += sample * sample;
    silence = Math.abs(sample) < 1e-7 ? silence + 1 : 0;
    longestSilence = Math.max(longestSilence, silence);
  }
  return { peak, delta, rms: Math.sqrt(power / samples.length), longestSilence };
}

for (const rate of [44_100, 48_000]) {
  test(`FFT startup and structural edits have no reset gap or normalization burst at ${rate} Hz`, async () => {
    await withProcessor(rate, (make, config) => {
      const cases = [
        { fftSize: 4096 }, { fftSize: 256 }, { fftWindow: 0 }, { fftWindow: 2 }, { fftWindow: 3 },
        { fftHopRatio: .25 }, { fftBandCount: 64 }, { fftLowFrequency: 250 }, { fftHighFrequency: 2250 },
      ];
      for (const patch of cases) {
        const processor = make();
        const before = render(processor, 0, 192, rate);
        const startup = metrics(before);
        assert.ok(startup.peak < .5 && startup.delta < .08, `initial overlap is bounded: ${JSON.stringify(startup)}`);
        const steady = metrics(before.subarray(before.length - 2048));
        processor.handleMessage({ type: 'configure', configuration: config({ ...base, ...patch }) });
        const after = render(processor, before.length, 128, rate);
        const transition = metrics(after, before.at(-1));
        assert.ok(transition.longestSilence < 32, `${JSON.stringify(patch)}: no FFT-sized hole ${JSON.stringify(transition)}`);
        assert.ok(transition.peak < .4, `${JSON.stringify(patch)}: no overlap edge amplification ${JSON.stringify(transition)}`);
        assert.ok(transition.delta < Math.max(.055, steady.delta * 3), `${JSON.stringify(patch)}: bounded transition derivative ${JSON.stringify(transition)}`);
      }
    });
  });
}

test('no-op configuration is transparent; Memory and Detail preserve input history', async () => {
  await withProcessor(48_000, (make, config) => {
    const control = make(), edited = make();
    const before = render(control, 0, 192, 48_000);
    assert.deepEqual(render(edited, 0, 192, 48_000), before);
    edited.configure(config(base));
    assert.deepEqual(render(edited, before.length, 32, 48_000), render(control, before.length, 32, 48_000));
    const bank = edited.fftCurrent;
    const after = render(edited, before.length + 4096, 160, 48_000, tone, block => {
      edited.configure(config({ ...base, fftDetail: (block % 30) / 30, fftResponseMs: 4 + (block % 40) * 19 }));
    });
    assert.equal(edited.fftCurrent, bank, 'continuous controls never rebuild the bank');
    assert.equal(edited.fftTransition, false);
    const result = metrics(after);
    assert.ok(result.longestSilence < 32 && result.peak < .5 && result.delta < .06, JSON.stringify(result));
  });
});

test('configuration bursts and rapid presets use two bounded banks and settle on the newest state', async () => {
  await withProcessor(48_000, (make, config) => {
    const processor = make();
    const before = render(processor, 0, 192, 48_000);
    const banks = new Set([processor.fftCurrent, processor.fftSpare]);
    const settings = SIMD_RESONATOR_FULL_PRESETS.map(preset => ({ ...preset.snapshot, fftMix: 1, fftInputGain: 1 }));
    assert.ok(settings.some(preset => preset.fftSize === 4096));
    const after = render(processor, before.length, 240, 48_000, tone, block => {
      if (block < 160) {
        for (let update = 0; update < 4; update += 1) {
          processor.configure(config(settings[(block + update) % settings.length]));
        }
      }
      assert.ok(banks.has(processor.fftCurrent) && banks.has(processor.fftSpare));
    });
    const result = metrics(after, before.at(-1));
    assert.ok(result.longestSilence < 32 && result.peak < .6 && result.delta < .15, JSON.stringify(result));
    const final = settings[(159 + 3) % settings.length];
    assert.equal(processor.fftCurrent.fftSize, final.fftSize);
    assert.equal(processor.fftCurrent.fftWindow, final.fftWindow);
    assert.equal(processor.fftCurrent.fftBandCount, final.fftBandCount);
    assert.equal(processor.fftTransition, false);
    assert.equal(processor.fftQueuedConfiguration, null);
  });
});

test('source replacement preserves FFT tails; input Stop and manual pluck retain their routing', async () => {
  await withProcessor(48_000, (make, config) => {
    const processor = make({ ...base, fftSize: 4096 });
    const before = render(processor, 0, 192, 48_000);
    const bank = processor.fftCurrent;
    processor.handleMessage({ type: 'mic', active: false });
    const gap = render(processor, before.length, 11, 48_000, () => 0); // 29.3 ms decode gap.
    assert.equal(processor.fftCurrent, bank);
    assert.ok(metrics(gap).rms > .025, 'old overlap remains audible during a short loading gap');
    assert.ok(processor.fftCurrentMix > .999, 'source loading does not reveal hidden modal energy');
    processor.handleMessage({ type: 'mic', active: true });
    const changed = render(processor, before.length + gap.length, 96, 48_000,
      (frame, rate) => .1 * Math.sin(2 * Math.PI * 330 * frame / rate + .8));
    const result = metrics(changed, gap.at(-1));
    assert.ok(result.peak < .5 && result.delta < .065, JSON.stringify(result));
    processor.trigger(.8, 'resonator');
    render(processor, 0, 8, 48_000);
    assert.ok(processor.fftCurrentMix > .999, 'pluck with a live input preserves FFT Mix');
    processor.handleMessage({ type: 'mic', active: false });
    const stopped = render(processor, 0, 160, 48_000, () => 0);
    assert.ok(metrics(stopped.subarray(-2048)).rms < 1e-5, 'stopped input drains without exposing body tails');
    processor.trigger(.8, 'resonator');
    const pluck = render(processor, 0, 48, 48_000, () => 0);
    assert.ok(metrics(pluck).rms > .001, 'manual pluck returns to the resonator when input is stopped');
    assert.ok(processor.fftCurrentMix < .001);
    processor.configure(config(base));
    processor.reset();
    assert.equal(processor.resonatorConfiguration, null, 'reset cancels pending edits');
    assert.equal(processor.fftHistoryFill, 0);
  });
});
