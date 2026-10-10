import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';
import { readAudioStatus, waitForAudioState, waitForStableAudioState } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(() => __graphDelayRust.snapshot());

async function open(page) {
  await installAudioInputFixture(page);
  await page.goto('/graph-delay-rust.html?renderer=webgl2');
  await page.waitForFunction(() => Boolean(globalThis.__graphDelayRust));
}

async function native(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function exact(page, id, value) {
  await page.locator(`#${id}Exact`).fill(String(value));
  await page.locator(`#${id}Exact`).press('Enter');
  await expect(page.locator(`#${id}`)).toHaveValue(String(value));
}

async function capacityControls(page) {
  await page.locator('#liveData').evaluate(disclosure => { disclosure.open = true; });
  await page.locator('#capacityTests').evaluate(disclosure => { disclosure.open = true; });
}

async function smallGraph(page, nodes = 3) {
  await page.locator('#topology').evaluate(input => { input.closest('details').open = true; });
  await page.locator('#topology').selectOption('chain');
  await native(page, 'nodeCount', nodes);
  await native(page, 'baseDelay', 20);
  await native(page, 'timeScale', 0);
  await native(page, 'pitchScale', 0);
  await expect.poll(async () => (await snapshot(page)).graph.nodes.length).toBe(nodes);
}

async function start(page, { input = false } = {}) {
  if (input) {
    await page.locator('.mz-input-toggle').click();
    await expect(page.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  await expect.poll(async () => (await snapshot(page)).metrics?.currentActiveRoutes ?? 0).toBeGreaterThan(0);
}

async function settled(page) {
  await expect.poll(async () => {
    const m = (await snapshot(page)).metrics;
    return Boolean(m && !m.preparing && m.retiringActiveRoutes === 0 && m.currentActiveRoutes === m.currentTargetRoutes);
  }, { timeout: 15000 }).toBe(true);
  return snapshot(page);
}

test('Live cap reduces real processing and zero restores the prepared graph without restarting Audio', async ({ page }) => {
  await open(page);
  await smallGraph(page, 8);
  await capacityControls(page);
  await page.locator('#automatic').uncheck();
  await start(page, { input: true });
  await waitForAudioState(page, true);
  const before = await settled(page);
  expect(before.metrics.currentActiveRoutes).toBeGreaterThan(2);
  await exact(page, 'voiceCeiling', 2);
  await expect.poll(async () => (await snapshot(page)).metrics?.currentTargetRoutes).toBe(2);
  const capped = await settled(page);
  expect(capped.metrics.currentActiveRoutes).toBe(2);
  expect(capped.metrics.activeRoutes).toBe(2);
  expect(capped.metrics.preparedRoutes).toBe(before.metrics.preparedRoutes);
  expect(capped.metrics.currentEligibleRoutes).toBe(before.metrics.currentEligibleRoutes);
  expect(capped.graph).toEqual(before.graph);
  expect(capped.performance.voiceCeiling).toBe(2);
  expect(capped.metrics.voiceCeiling).toBe(2);
  expect(capped.metrics.elapsedSeconds).toBeGreaterThan(before.metrics.elapsedSeconds);
  await native(page, 'voiceCeiling', 0);
  await expect(page.locator('#voiceCeilingExact')).toHaveValue('0');
  await expect.poll(async () => (await snapshot(page)).metrics?.currentActiveRoutes).toBe(before.metrics.currentEligibleRoutes);
  const restored = await settled(page);
  expect(restored.metrics.preparedRoutes).toBe(before.metrics.preparedRoutes);
  expect(restored.metrics.elapsedSeconds).toBeGreaterThan(capped.metrics.elapsedSeconds);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#panicButton').click();
  await waitForStableAudioState(page, false);
});

test('preset recall preserves Live cap and Protect audio in both controls and the worklet', async ({ page }) => {
  await open(page);
  await capacityControls(page);
  await page.locator('#automatic').uncheck();
  await exact(page, 'voiceCeiling', 2);
  await start(page);
  for (const id of ['clearSteps', 'branchChoir']) {
    await page.locator('.header-preset-picker summary').click();
    await page.locator(`button[data-preset-id="${id}"]`).click();
    await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
    const recalled = await settled(page);
    expect(recalled.performance).toMatchObject({ voiceCeiling: 2, automatic: false });
    expect(recalled.metrics).toMatchObject({ voiceCeiling: 2, automatic: false, currentTargetRoutes: 2, currentActiveRoutes: 2 });
    await expect(page.locator('#voiceCeilingExact')).toHaveValue('2');
    await expect(page.locator('#automatic')).not.toBeChecked();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#automatic').check();
  await expect.poll(async () => (await snapshot(page)).metrics?.automatic).toBe(true);
  await page.locator('#panicButton').click();
});

// Deterministic driver timing covers both panel states on CI GPUs that do not
// expose EXT_disjoint_timer_query_webgl2. Graph drawing still uses real WebGL2;
// this fixture's 3.5 ms is test input, never a hardware benchmark.
async function gpuTimingFixture(page, supported) {
  await page.addInitScript(({ supported }) => {
    const prototype = globalThis.WebGL2RenderingContext?.prototype;
    if (!prototype) return;
    const extension = { TIME_ELAPSED_EXT: 35007, GPU_DISJOINT_EXT: 36795 };
    const originalExtension = prototype.getExtension, originalParameter = prototype.getParameter;
    prototype.getExtension = function (name) {
      return name === 'EXT_disjoint_timer_query_webgl2' ? (supported ? extension : null) : originalExtension.call(this, name);
    };
    if (!supported) return;
    prototype.getParameter = function (name) { return name === extension.GPU_DISJOINT_EXT ? false : originalParameter.call(this, name); };
    prototype.createQuery = () => ({});
    prototype.beginQuery = () => {};
    prototype.endQuery = () => {};
    prototype.deleteQuery = () => {};
    prototype.getQueryParameter = function (_query, name) { return name === this.QUERY_RESULT_AVAILABLE ? true : 3500000; };
  }, { supported });
}

for (const supported of [false, true]) {
  test(`GPU monitor reports ${supported ? 'available measured milliseconds' : 'unsupported timing honestly'}`, async ({ page }) => {
    await gpuTimingFixture(page, supported);
    await open(page);
    await expect.poll(async () => (await snapshot(page)).renderer).toBe('webgl2');
    await expect.poll(async () => (await snapshot(page)).graphics.gpuTimingSupported).toBe(supported);
    if (supported) {
      await expect.poll(async () => (await snapshot(page)).graphics.gpuTimingSamples).toBeGreaterThan(0);
      expect((await snapshot(page)).graphics.gpuTimeMs).toBe(3.5);
      await expect(page.locator('#performanceGpuTime')).toHaveText('3.50 ms');
    } else {
      expect((await snapshot(page)).graphics.gpuTimeMs).toBeNull();
      await expect(page.locator('#performanceGpuTime')).toHaveText('Unavailable');
    }
    await expect(page.locator('#performanceGpuTime')).not.toContainText('%');
    await expect(page.locator('#performanceAudioLoad')).toHaveText('Audio off');
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => __familyInput.requests)).toBe(0);
  });
}

test('Live data reports actual worklet counts, deadline misses and callback load', async ({ page }) => {
  await open(page);
  await smallGraph(page, 6);
  await capacityControls(page);
  await page.locator('#automatic').uncheck();
  await exact(page, 'voiceCeiling', 2);
  await start(page);
  await settled(page);
  await expect.poll(() => page.evaluate(() => {
    const { metrics: m } = __graphDelayRust.snapshot();
    const text = id => document.getElementById(id).textContent;
    return {
      prepared: Number(text('performancePrepared')) === m.preparedRoutes,
      eligible: Number(text('performanceEligible')) === m.currentEligibleRoutes,
      processing: Number(text('performanceProcessing')) === m.activeRoutes,
      limit: Number(text('performanceLimit')) === m.liveLimit,
      misses: text('performanceMisses') === `${m.deadlineMisses} deadlines missed`,
      load: text('performanceAudioLoad') === `${Math.round(m.cpuLoad * 100)}% · ${Math.round(m.peakLoad * 100)}% peak`,
      meter: Math.abs(document.getElementById('performanceAudioMeter').value - Math.min(1, Math.max(0, m.cpuLoad))) < .000001,
    };
  })).toEqual({ prepared: true, eligible: true, processing: true, limit: true, misses: true, load: true, meter: true });
  const current = await snapshot(page);
  expect(Number.isFinite(current.metrics.cpuLoad)).toBe(true);
  expect(current.metrics.cpuLoad).toBeGreaterThan(0);
  expect(current.metrics.activeRoutes).toBe(current.metrics.currentActiveRoutes + current.metrics.retiringActiveRoutes);
  await expect(page.locator('#performanceFrameTime')).toHaveText(/^\d+(\.\d+)? ms · \d+ fps$/);
  await expect(page.locator('#performanceMeasured')).toHaveText('Untested');
  await page.locator('#panicButton').click();
  await expect(page.locator('#performanceProcessing')).toHaveText('0');
  await expect(page.locator('#performanceAudioLoad')).toHaveText('Audio off');
});

test('a small real capacity trial measures every eligible route independently of Live cap', async ({ page }, info) => {
  test.setTimeout(45000);
  await open(page);
  await smallGraph(page);
  await exact(page, 'voiceCeiling', 1);
  await start(page);
  const before = await settled(page);
  expect(before.metrics.currentActiveRoutes).toBe(1);
  expect(before.metrics.currentEligibleRoutes).toBeGreaterThan(1);
  await capacityControls(page);
  await exact(page, 'capacityBudget', 16);
  expect((await snapshot(page)).performance.preparationBudget).toBe(before.performance.preparationBudget);
  await page.locator('#testCapacity').click();
  await expect.poll(async () => {
    const state = await snapshot(page);
    return !state.capacity.testing && Boolean(state.capacity.measurement);
  }, { timeout: 30000 }).toBe(true);
  const after = await settled(page), measured = after.capacity.measurement;
  expect(measured.voices).toBe(before.metrics.currentEligibleRoutes);
  expect(measured.preparedRoutes).toBe(before.metrics.preparedRoutes);
  expect(measured.eligibleRoutes).toBe(measured.voices);
  expect(measured.pitchedStress).toBe(true);
  expect(measured.proved).toBe(true);
  expect(measured.load).toBeGreaterThan(0);
  expect(measured.load).toBeLessThanOrEqual(measured.targetLoad);
  expect(measured.measurements).toHaveLength(3);
  for (const trial of measured.measurements) {
    expect(trial.voices).toBe(measured.voices);
    expect(trial.blocks).toBeGreaterThan(0);
    expect(Number.isFinite(trial.load)).toBe(true);
    expect(trial.load).toBeGreaterThan(0);
  }
  expect(after.performance).toMatchObject({ voiceCeiling: 1, automatic: true, preparationBudget: 16 });
  expect(after.metrics.currentActiveRoutes).toBe(1);
  expect(after.metrics.elapsedSeconds).toBeGreaterThan(before.metrics.elapsedSeconds);
  expect(after.audio).toBe(true);
  expect(after.graph.nodes).toEqual(before.graph.nodes);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await expect(page.locator('#performanceMeasured')).toHaveText(`${measured.voices} · ${Math.round(measured.load * 100)}%`);
  await expect(page.locator('#performanceCapacityStatus')).toContainText('16-voice preparation budget applied');
  await info.attach('graph-small-capacity-measurement.json', { body: JSON.stringify({ before: before.metrics, measured, after: after.metrics }), contentType: 'application/json' });
  await page.locator('#panicButton').click();
});

test('Panic cancels a pending capacity worker and its late response cannot change the next session', async ({ page }) => {
  let release, reached = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/graph-delay-capacity-worker.js', async route => {
    reached = true;
    await gate;
    await route.continue().catch(() => {}); // Cancellation may already have destroyed this request.
  });
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__capacityWorkers = [];
    globalThis.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('/graph-delay-capacity-worker.js')) {
          this.capacityRecord = { terminated: false };
          __capacityWorkers.push(this.capacityRecord);
        }
      }
      terminate() { if (this.capacityRecord) this.capacityRecord.terminated = true; return super.terminate(); }
    };
  });
  try {
    await open(page);
    await smallGraph(page);
    await start(page);
    await capacityControls(page);
    await exact(page, 'capacityBudget', 16);
    const before = await snapshot(page);
    await page.locator('#testCapacity').click();
    await expect.poll(() => reached).toBe(true);
    await expect.poll(async () => (await snapshot(page)).capacity.testing).toBe(true);
    await page.locator('#panicButton').click();
    await expect.poll(async () => (await snapshot(page)).capacity.testing).toBe(false);
    await expect.poll(() => page.evaluate(() => __capacityWorkers.length === 1 && __capacityWorkers[0].terminated)).toBe(true);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#performanceCapacityStatus')).toContainText('cancelled');
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    release();
    await start(page);
    const restarted = await settled(page);
    expect(restarted.capacity.measurement).toBeNull();
    expect(restarted.capacity.testing).toBe(false);
    expect(restarted.performance).toEqual(before.performance);
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
    await page.locator('#panicButton').click();
  } finally { release(); }
});
