import { expect, test } from '@playwright/test';
import { installAudioInputFixture } from './helpers/audio-input-fixture.mjs';

test.setTimeout(60_000);
const LIVE = ['pitchScale', 'baseDelay', 'feedback', 'timeScale', 'wet', 'dry'];
const STRUCTURE = new Set(['topology', 'nodeCount', 'density', 'seed', 'graphPatch']);
const coordinates = graph => graph.nodes.map(({ x, y }) => [x, y]);
const sound = snapshot => Object.fromEntries(Object.entries(snapshot.parameters).filter(([key]) => !STRUCTURE.has(key)));

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installAudioInputFixture(page);
  await page.addInitScript(() => {
    const qa = globalThis.__graphLiveQa = { worklets: 0, plans: 0, plan: null, sources: [] };
    const Worklet = AudioWorkletNode;
    globalThis.AudioWorkletNode = new Proxy(Worklet, { construct(Target, args) {
      const node = new Target(...args);
      if (args[1] === 'morphazoid-graph-delay-rust') {
        qa.worklets++;
        const post = node.port.postMessage.bind(node.port);
        node.port.postMessage = (message, ...rest) => {
          if (message.type === 'configure') {
            qa.plans++; qa.plan = Array.from(new Float64Array(message.plan));
          }
          return post(message, ...rest);
        };
      }
      return node;
    } });
    const create = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function (...args) {
      const node = create.apply(this, args), record = { started: false, stopped: false, ended: false, duration: 0 };
      const start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...values) => {
        const result = start(...values);
        record.started = true; record.duration = node.buffer?.duration ?? 0;
        return result;
      };
      node.stop = (...values) => { record.stopped = true; return stop(...values); };
      node.addEventListener('ended', () => { record.ended = true; });
      qa.sources.push(record); return node;
    };
  });
  await page.goto('/graph-delay-rust.html?renderer=canvas');
  await page.waitForFunction(() => Boolean(globalThis.__graphDelayRust));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  return errors;
}

const snapshot = page => page.evaluate(() => {
  const qa = __graphLiveQa, plan = qa.plan;
  const offset = plan ? 16 + plan[1] * 2 + plan[2] * 6 + plan[3] * 3 : 0;
  return { ...__graphDelayRust.snapshot(),
    qa: { worklets: qa.worklets, plans: qa.plans,
      pitches: plan ? Array.from({ length: plan[4] }, (_, index) => plan[offset + index * 4 + 2]) : [],
      sources: qa.sources.filter(source => source.duration > .01), requests: __familyInput.requests,
      inputTrim: Number(document.getElementById('inputTrim').value), level: Number(document.getElementById('level').value),
    },
  };
});

async function native(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function settled(page) {
  await expect.poll(async () => {
    const metrics = (await snapshot(page)).metrics;
    return Boolean(metrics && !metrics.preparing && !metrics.retiringActiveRoutes);
  }, { timeout: 25000 }).toBe(true);
  return snapshot(page);
}

async function playSample(page) {
  await native(page, 'source', 'samples'); await native(page, 'inputSample', 'music-bass');
  await native(page, 'baseDelay', 35); await native(page, 'timeScale', 45);
  await native(page, 'pitchScale', .23); await native(page, 'wet', .6); await native(page, 'dry', .3);
  await native(page, 'inputTrim', .43); await native(page, 'level', .27); await native(page, 'voiceCeiling', 7);
  await page.locator('#audioButton').click();
  await expect.poll(async () => {
    const d = await snapshot(page);
    return d.audio && d.inputSource.playing && d.metrics?.inputPeak > 1e-5 && d.metrics.voiceCeiling === 7;
  }, { timeout: 15000 }).toBe(true);
  return settled(page);
}

async function preset(page, id) {
  await page.locator('.header-preset-picker summary').click();
  await page.locator(`button[data-preset-id="${id}"]`).click();
}

async function reveal(page, id) {
  await page.locator(`#${id}`).evaluate(node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  });
}

function expectContinuous(before, after, { parameters = true } = {}) {
  expect(after.audio).toBe(true);
  expect(after.inputSource).toEqual(before.inputSource);
  expect(after.performance).toEqual(before.performance);
  expect(after.qa.sources).toEqual(before.qa.sources);
  expect(after.qa.worklets).toBe(before.qa.worklets);
  expect(after.qa.requests).toBe(0);
  expect(after.qa.inputTrim).toBe(before.qa.inputTrim); expect(after.qa.level).toBe(before.qa.level);
  expect(after.metrics.elapsedSeconds).toBeGreaterThan(before.metrics.elapsedSeconds);
  if (parameters) expect(sound(after)).toEqual(sound(before));
}

test('focused graph actions preserve live source, sound, gates, cap and Rust clock', async ({ page }) => {
  const errors = await open(page); await playSample(page);
  await page.locator('#stage').focus(); await page.keyboard.press(']'); await page.keyboard.press('Enter');
  const before = await settled(page), positions = coordinates(before.graph);
  expect(Object.values(before.edgeSwitches)).toContain(false);
  await page.locator('#randomizeNodePositionsButton').click();
  await expect.poll(async () => coordinates((await snapshot(page)).graph)).not.toEqual(positions);
  await expect.poll(async () => (await snapshot(page)).metrics.elapsedSeconds).toBeGreaterThan(before.metrics.elapsedSeconds);
  const moved = await settled(page);
  expectContinuous(before, moved);
  expect(moved.graph.edges).toEqual(before.graph.edges); expect(moved.edgeSwitches).toEqual(before.edgeSwitches);
  await reveal(page, 'restoreNodePositionsButton'); await page.locator('#restoreNodePositionsButton').click();
  await expect.poll(async () => coordinates((await snapshot(page)).graph)).toEqual(positions);
  await expect.poll(async () => (await snapshot(page)).metrics.elapsedSeconds).toBeGreaterThan(moved.metrics.elapsedSeconds);
  const arranged = await settled(page);
  expectContinuous(moved, arranged);
  expect(arranged.graph.edges).toEqual(before.graph.edges); expect(arranged.edgeSwitches).toEqual(before.edgeSwitches);

  await page.locator('#randomGraphButton').click();
  await expect.poll(async () => (await snapshot(page)).parameters.seed).not.toBe(arranged.parameters.seed);
  const randomized = await settled(page);
  expectContinuous(arranged, randomized);
  expect(randomized.graph).not.toEqual(arranged.graph);
  expect(randomized.graph.nodes.length).toBeGreaterThanOrEqual(3); expect(randomized.graph.nodes.length).toBeLessThanOrEqual(64);
  expect(randomized.graph.edges.length).toBeLessThanOrEqual(256);
  expect(randomized.metrics.preparedRoutes).toBeLessThanOrEqual(randomized.performance.preparationBudget);
  expect(randomized.graph.nodes.every(node => node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1)).toBe(true);
  const canonical = await page.evaluate(async () => {
    const d = __graphDelayRust.snapshot(), { generateGraph } = await import('/src/instruments/graph-delay/graph-delay.js');
    return generateGraph({ ...d.parameters, type: d.parameters.topology, maxNodes: 64 }).nodes.map(({ x, y }) => [x, y]);
  });
  expect(coordinates(randomized.graph)).not.toEqual(canonical);
  await page.locator('#panicButton').click(); expect(errors).toEqual([]);
});

test('the latest geometry action queued during a preset edits the accepted graph and retains gate edits', async ({ page }) => {
  const errors = await open(page), before = await playSample(page);
  const expected = await page.evaluate(async () => (await import('/src/instruments/graph-delay-rust/graph-delay-presets.js'))
    .GRAPH_DELAY_RUST_PRESETS.find(preset => preset.id === 'clearSteps').snapshot);
  await page.evaluate(async nodes => {
    const { GraphDelayRustEngine } = await import('/src/instruments/graph-delay-rust/graph-delay-engine.js');
    const update = GraphDelayRustEngine.prototype.update;
    const gate = new Promise(resolve => { __graphLiveQa.releaseRecall = resolve; });
    let held = false;
    GraphDelayRustEngine.prototype.update = async function (...args) {
      const result = await update.apply(this, args);
      if (!held && args[0].nodes.length === nodes) { held = __graphLiveQa.recallReady = true; await gate; }
      return result;
    };
  }, expected.graph.nodes.length);
  await preset(page, 'clearSteps');
  await page.waitForFunction(() => __graphLiveQa.recallReady);
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'true');
  await page.locator('#stage').focus(); await page.keyboard.press(']'); await page.keyboard.press('Enter');
  await reveal(page, 'restoreNodePositionsButton'); await page.locator('#restoreNodePositionsButton').click();
  await page.locator('#randomizeNodePositionsButton').click();
  await page.evaluate(() => __graphLiveQa.releaseRecall());
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await expect.poll(async () => (await snapshot(page)).graph.nodes.length).toBe(expected.graph.nodes.length);
  const after = await settled(page);
  expect(after.graph.edges).toEqual(expected.graph.edges);
  expect(coordinates(after.graph)).not.toEqual(coordinates(expected.graph));
  expect(after.edgeSwitches['0>1']).toBe(false);
  expect(after.parameters.pitchScale).toBe(expected.parameters.pitchScale);
  expect(after.parameters.baseDelay).toBe(expected.parameters.baseDelay);
  expectContinuous(before, after, { parameters: false });
  await page.locator('#panicButton').click(); expect(errors).toEqual([]);
});

test('live knobs preserve native input, keyboard, preset and DSP synchronization without arming Audio', async ({ page }) => {
  const errors = await open(page);
  // Explicit capture prepares the real engine while the output stays unarmed.
  await page.locator('.mz-input-toggle').click();
  await expect(page.locator('.mz-input-toggle')).toHaveAttribute('aria-pressed', 'true');
  const control = page.locator('#pitchScale'), before = await snapshot(page);
  expect(await control.evaluate(input => input.parentElement.classList.contains('mz-range-knob'))).toBe(true);
  await control.scrollIntoViewIfNeeded(); const box = await control.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 20, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).parameters.pitchScale).toBeGreaterThan(before.parameters.pitchScale);
  await expect.poll(async () => (await snapshot(page)).qa.pitches).not.toEqual(before.qa.pitches);
  const dragged = await snapshot(page);
  await control.press('ArrowUp');
  await expect.poll(async () => (await snapshot(page)).parameters.pitchScale).toBeCloseTo(dragged.parameters.pitchScale + .01, 6);
  await expect.poll(async () => (await snapshot(page)).qa.pitches).not.toEqual(dragged.qa.pitches);
  await preset(page, 'clearSteps');
  await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy', 'false', { timeout: 15000 });
  await expect(control).toHaveValue('0');
  await expect.poll(() => control.evaluate(input => Number(input.parentElement.querySelector('.mz-range-knob__dial > i')
    .style.transform.match(/rotate\(([-\d.]+)deg\)/)?.[1]))).toBeCloseTo(-135, 6);
  await expect.poll(async () => (await snapshot(page)).qa.pitches.every(pitch => Math.abs(pitch) < 1e-9)).toBe(true);
  const after = await snapshot(page);
  expect(after.audio).toBe(false); expect(after.qa.worklets).toBe(before.qa.worklets);
  expect(after.metrics.elapsedSeconds).toBeGreaterThan(before.metrics.elapsedSeconds);
  await page.locator('#panicButton').click(); expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`Graph Rust live controls ${viewport.width}×${viewport.height}`, () => {
    const touch = viewport.width !== 1440;
    test.use({ viewport, hasTouch: touch, isMobile: touch });
    test('live controls lead the panel, keep readable outputs and remain reachable', async ({ page }, info) => {
      const errors = await open(page);
      await expect(page.locator('#playSection')).toHaveJSProperty('open', true);
      expect(await page.locator('.panel > details.control-section').first().getAttribute('id')).toBe('playSection');
      expect(await page.locator('.panel > details.control-section:not(#playSection)').evaluateAll(nodes => nodes.every(node => !node.open))).toBe(true);
      expect(await page.locator('.panel input[type="range"]:not(#inputTrim)').evaluateAll(nodes => nodes.every(node => node.parentElement.classList.contains('mz-range-knob')))).toBe(true);
      for (const id of [...LIVE, 'nodeMotionPlayButton', 'micMotionPlayButton', 'randomGraphButton', 'randomizeNodePositionsButton']) {
        const control = page.locator(`#${id}`);
        expect(await control.evaluate(node => Boolean(node.closest('#playSection'))), `${id} stays in the live section`).toBe(true);
        await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(-1); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
        if (touch) { expect(box.width, `${id} touch width`).toBeGreaterThanOrEqual(48); expect(box.height, `${id} touch height`).toBeGreaterThanOrEqual(48); }
      }
      const layout = await page.evaluate(ids => ids.map(id => {
        const input = document.getElementById(id), field = input.parentElement, output = document.getElementById(`${id}Out`);
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        return { id, field: rect(field), output: rect(output), dial: rect(field.querySelector('.mz-range-knob__dial')) };
      }), LIVE);
      for (const { id, field, output, dial } of layout) {
        expect(output.width, `${id} readout width`).toBeGreaterThan(0);
        expect(output.height, `${id} readout height`).toBeGreaterThan(0);
        expect(output.x, `${id} readout left`).toBeGreaterThanOrEqual(field.x - 1);
        expect(output.right, `${id} readout right`).toBeLessThanOrEqual(field.right + 1);
        expect(output.bottom, `${id} readout fits its control`).toBeLessThanOrEqual(field.bottom + 1);
        expect(output.y, `${id} readout clears its dial`).toBeGreaterThanOrEqual(dial.bottom - 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect(await page.locator('.panel').evaluate(panel => panel.scrollWidth - panel.clientWidth)).toBeLessThanOrEqual(1);
      await page.locator('#randomizeNodePositionsButton').click();
      expect((await snapshot(page)).audio).toBe(false); expect((await snapshot(page)).qa.requests).toBe(0);
      await info.attach(`graph-live-${viewport.width}x${viewport.height}`, { contentType: 'image/png', body: await page.screenshot() });
      expect(errors).toEqual([]);
    });
  });
}
