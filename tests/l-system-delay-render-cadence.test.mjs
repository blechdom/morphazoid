import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderCadence } from '../src/instruments/micmic/native/render-cadence.js';

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
function prime(cadence, hz) {
  const step = 1000 / hz;
  for (let index = 0; index < 8; index++) cadence.record(index * step, { calibrating: true });
  cadence.rendered();
  return 7 * step;
}

test('cheap startup identifies 30, 60, 90, and 120 Hz without a draw-rate cap', () => {
  for (const hz of [30, 60, 90, 120, 144, 240]) {
    const cadence = createRenderCadence();
    prime(cadence, hz);
    near(cadence.diagnostics().baselineFrameMs, 1000 / hz, `${hz} Hz native interval`);
    near(cadence.rendered(), 1000 / hz, `${hz} Hz ungated render`);
    assert.equal(cadence.diagnostics().calibrationSamples, 7);
  }
});

test('requested 40, 50, and 55 fps follow real quantized RAF intervals without false lateness', () => {
  for (const hz of [30, 60, 90, 120]) for (const fps of [40, 50, 55]) {
    const cadence = createRenderCadence(), step = 1000 / hz;
    let lastRendered = prime(cadence, hz), skips = 0, renders = 0;
    for (let index = 1; index <= 180; index++) {
      const now = 7 * step + index * step;
      cadence.record(now);
      if (now - lastRendered + 1e-7 < 1000 / fps) { cadence.skipped(); skips++; continue; }
      const expected = cadence.rendered();
      near(expected, (skips + 1) * step, `${hz} Hz / requested ${fps} fps planned interval`);
      near(now - lastRendered, expected, `${hz} Hz / requested ${fps} fps no false overload`);
      lastRendered = now; skips = 0; renders++;
    }
    assert.ok(renders > 0);
    near(cadence.diagnostics().baselineFrameMs, step, 'gating cannot change the native baseline');
  }
});

test('missed RAF callbacks remain late even beside intentional skipped callbacks', () => {
  const cadence = createRenderCadence(), step = 1000 / 60;
  let now = prime(cadence, 60);
  cadence.record(now += step); cadence.skipped();
  cadence.record(now += 3 * step);
  const expected = cadence.rendered();
  near(expected, 2 * step, 'only one actual gated callback is counted');
  assert.ok(4 * step > expected * 1.5, 'two missing callbacks remain detectable');
  for (let index = 0; index < 60; index++) {
    cadence.record(now += 2 * step);
    near(cadence.rendered(), step, 'persistent GPU stalls do not become a slower display');
  }
});

test('a coherent faster refresh mode is learned while isolated short intervals are ignored', () => {
  const cadence = createRenderCadence();
  let now = prime(cadence, 60);
  cadence.record(now += 1000 / 120);
  cadence.record(now += 1000 / 60);
  near(cadence.diagnostics().baselineFrameMs, 1000 / 60, 'single short callback');
  for (let index = 0; index < 3; index++) cadence.record(now += 1000 / 120);
  near(cadence.rendered(), 1000 / 120, 'sustained 120 Hz');
});

test('duplicate, invalid, and idle timestamps cannot disguise stalls or accumulate planned skips', () => {
  const cadence = createRenderCadence(), step = 1000 / 60;
  let now = prime(cadence, 60);
  cadence.record(now); cadence.record(NaN); cadence.record(Infinity); cadence.record(now - 1);
  assert.equal(cadence.diagnostics().observedIntervals, 7);
  cadence.skipped();
  cadence.record(now += 2000, { continuous: false });
  cadence.record(now += 1000);
  near(cadence.rendered(), step, 'return from idle has no fabricated skipped callbacks');
  cadence.record(now += step);
  near(cadence.diagnostics().baselineFrameMs, step, 'idle intervals leave the baseline alone');
});

test('calibration ignores missed callbacks and reset permits an explicitly changed slower display', () => {
  const cadence = createRenderCadence(), step = 1000 / 90;
  let now = 0;
  cadence.record(now, { calibrating: true });
  for (const multiplier of [3, 1, 1, 2, 1, 1, 1]) cadence.record(now += step * multiplier, { calibrating: true });
  near(cadence.rendered(), step, 'fastest coherent calibration cluster');
  cadence.skipped(); cadence.reset();
  const reset = cadence.diagnostics();
  assert.equal(reset.skippedCallbacks, 0); assert.equal(reset.calibrated, false);
  prime(cadence, 30);
  near(cadence.rendered(), 1000 / 30, 'explicit 30 Hz recalibration');
});
