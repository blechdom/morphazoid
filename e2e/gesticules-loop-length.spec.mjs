import {test, expect} from '@playwright/test';

const snapshot = page => page.evaluate(() => window.__gesticulatingHand.snapshot());
const range = (page, id, value) => page.locator('#' + id).evaluate((input, value) => {
  input.value = String(value);input.dispatchEvent(new Event('input', {bubbles: true}));
}, value);
const ready = page => page.waitForFunction(() => window.__gesticulatingHand?.snapshot().loaded);
const choose = async (page, name) => {
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('button', {name, exact: true}).click();await ready(page);
};
async function expectLoop(page, beats, seconds) {
  await expect(page.locator('#loopBeats')).toHaveValue(String(beats));
  await expect(page.locator('#loopBeatsOut')).toHaveText(`${beats} ${beats === 1 ? 'beat' : 'beats'}`);
  await expect(page.locator('#loopBeats')).toHaveAttribute('aria-valuetext', `${beats} ${beats === 1 ? 'beat' : 'beats'}`);
  await expect(page.locator('#loopRuler')).toHaveAttribute('data-beats', String(beats));
  await expect(page.locator('#loopRuler')).toHaveAccessibleName(new RegExp(`^${beats}-beat motion loop`));
  const text = await page.locator('#loopDuration').innerText();
  expect(text).toMatch(/^\d+(?:\.\d+)? (?:ms|s)$/);
  const displayed = parseFloat(text) / (text.endsWith(' ms') ? 1000 : 1);
  expect(Math.abs(displayed - seconds)).toBeLessThanOrEqual(.00501);
  expect(text.endsWith(' ms')).toBe(seconds < 1);
}
async function drawOffset(page) {
  await page.locator('#contour-joint-1').selectOption('pip');
  const before = (await snapshot(page)).config.motion.edits;
  const canvas = page.locator('#contour-1');await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2);await page.mouse.down();
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .8, {steps: 3});await page.mouse.up();
  expect((await snapshot(page)).config.motion.edits).not.toEqual(before);
}

test.beforeEach(async ({page}) => {
  page.loopErrors = [];page.on('pageerror', error => page.loopErrors.push(error.message));
  await page.goto('gesticules.html');await ready(page);
});
test.afterEach(async ({page}) => expect(page.loopErrors).toEqual([]));

test('loop controls show native choreography lengths and full preset recall restores them', async ({page}) => {
  const input = page.locator('.hand-voices #loopBeats');
  await expect(input).toHaveAttribute('type', 'range');await expect(input).toHaveAttribute('min', '1');
  await expect(input).toHaveAttribute('max', '64');await expect(input).toHaveAttribute('step', '1');
  await expect(input).toHaveAccessibleName(/Loop length/);
  await range(page, 'tempo', 120);
  for (const [motion, beats] of [['puppet-mouth', 2], ['count', 10], ['drawn', 4]]) {
    await page.locator('#motionPreset').selectOption(motion);await expectLoop(page, beats, beats / 2);
    expect((await snapshot(page)).config.motion.loopBeats).toBeNull();
  }
  await range(page, 'loopBeats', 8);
  await page.locator('#motionPreset').selectOption('count');await expectLoop(page, 8, 4);
  expect((await snapshot(page)).config.motion.loopBeats).toBe(8);
  for (const [name, beats] of [['Puppet mouth', 2], ['Finger loom', 4]]) {
    await choose(page, name);const native = await snapshot(page);
    await expectLoop(page, beats, beats * 60 / (native.config.motion.tempo * native.config.motion.speed));
    await range(page, 'loopBeats', 64);await choose(page, name);
    expect((await snapshot(page)).config).toEqual(native.config);
    expect((await snapshot(page)).config.motion.loopBeats).toBeNull();
  }
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

for (const armed of [false, true]) {
  test(`loop edits preserve drawn gesture phase and independent clocks with Audio ${armed ? 'on' : 'off'}`, async ({page}) => {
    await choose(page, 'Puppet mouth');await range(page, 'tempo', 120);await drawOffset(page);
    await page.locator('#rhythm').selectOption('walk');
    await range(page, 'tremorAmount', 12);await range(page, 'tremorRate', 3.7);
    await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
    if (armed) {
      await page.locator('#audioButton').click();
      await expect.poll(async () => (await snapshot(page)).audio.rms).toBeGreaterThan(.001);
    }
    await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(.2);
    for (const playing of [true, false]) {
      if (!playing) await page.locator('#motionButton').click();
      for (const beats of [1, 8, 64]) {
        const changed = await page.evaluate(async beats => {
          const {evaluateHandPose, handMotionPeriod} = await import('/src/instruments/gesticulating-hand/hand-model.js');
          const started = performance.now(), before = window.__gesticulatingHand.snapshot();
          const input = document.getElementById('loopBeats');input.value = String(beats);
          input.dispatchEvent(new Event('input', {bubbles: true}));
          const after = window.__gesticulatingHand.snapshot(), elapsed = (performance.now() - started) / 1000;
          const oldPeriod = handMotionPeriod(before.config.motion), period = handMotionPeriod(after.config.motion);
          const oldTime = after.time * oldPeriod / period;
          const values = pose => [...pose.fingers.flatMap(f => [f.mcp, f.pip, f.dip, f.spread]), ...Object.values(pose.wrist)];
          const expected = evaluateHandPose(before.config, oldTime, undefined, after.tremorTime, after.rhythmTime);
          // Isolate choreography from the deliberately independent rhythm and tremor clocks.
          const isolated = structuredClone(after.config);isolated.tremor.amount = 0;isolated.sound.rhythm = 'continuous';
          return {before, after, elapsed, oldPeriod, period, oldTime,
            actualPose: values(after.pose), expectedPose: values(expected),
            cycleStart: values(evaluateHandPose(isolated, period * .217)),
            cycleEnd: values(evaluateHandPose(isolated, period * 1.217)),
            cycleMiddle: values(evaluateHandPose(isolated, period * .717))};
        }, beats);
        const {before, after, elapsed, oldTime, oldPeriod, period} = changed;
        expect(period).toBeCloseTo(beats / 2, 9);await expectLoop(page, beats, beats / 2);
        expect(after.config).toEqual({...before.config, motion: {...before.config.motion, loopBeats: beats}});
        expect(after.config.motion.edits).toEqual(before.config.motion.edits);
        expect(after.playing).toBe(playing);expect(after.soundPlaying).toBe(true);expect(after.audioOn).toBe(armed);
        // AudioContext time advances in quanta; only gesture time scales with loop length.
        const allowance = armed ? .025 : .001;
        expect(Math.abs(oldTime - before.time)).toBeLessThanOrEqual(playing ? (elapsed + allowance) * Math.max(1, oldPeriod / period) : 1e-8);
        for (const clock of ['tremorTime', 'rhythmTime']) {
          expect(after[clock] - before[clock]).toBeGreaterThanOrEqual(-1e-8);
          expect(after[clock] - before[clock]).toBeLessThanOrEqual(playing ? elapsed + allowance : 1e-8);
        }
        for (let i = 0; i < changed.actualPose.length; i++) {
          expect(changed.actualPose[i]).toBeCloseTo(changed.expectedPose[i], 5);
          expect(changed.cycleStart[i]).toBeCloseTo(changed.cycleEnd[i], 5);
        }
        expect(Math.max(...changed.cycleStart.map((value, i) => Math.abs(value - changed.cycleMiddle[i])))).toBeGreaterThan(1);
        if (!playing) for (let i = 0; i < 5; i++) for (const key of ['mcp', 'pip', 'dip', 'spread']) {
          expect(after.pose.fingers[i][key]).toBeCloseTo(before.pose.fingers[i][key], 5);
        }
      }
    }
    const edited = (await snapshot(page)).config.motion.edits;
    for (const tempo of [240, 4400]) {
      await range(page, 'tempo', tempo);await expectLoop(page, 64, 64 * 60 / tempo);
      expect((await snapshot(page)).config.motion.edits).toEqual(edited);
    }
    await range(page, 'loopBeats', 1);await expectLoop(page, 1, 60 / 4400);
    expect((await snapshot(page)).audio.contextState).toBe(armed ? 'running' : 'uninitialized');
  });
}

test('custom loop length survives form changes and capture, and dice supplies a captured custom length', async ({page}) => {
  await page.addInitScript(() => {
    const random = Math.random;
    Math.random = () => {
      if (window.__loopDiceSeed === undefined) return random();
      window.__loopDiceSeed = (Math.imul(window.__loopDiceSeed, 1664525) + 1013904223) >>> 0;
      return window.__loopDiceSeed / 4294967296;
    };
  });
  await page.reload();await ready(page);await range(page, 'loopBeats', 8);
  await page.locator('#soundPlayButton').click();await page.locator('#motionButton').click();
  for (const form of ['foot', 'hand']) {
    await page.locator('#bodyForm').selectOption(form);await page.waitForFunction(form => window.__gesticulatingHand.snapshot().loaded && window.__gesticulatingHand.snapshot().viewer.form === form, form);
    const capture = await page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
    expect(capture.snapshot.motion.loopBeats).toBe(8);expect(capture.selectedId).toBeNull();
    expect(capture.snapshot).toEqual((await snapshot(page)).config);
  }
  const lengths = [];
  for (const seed of [1, 2, 3]) {
    await page.evaluate(seed => {
      window.__loopDiceSeed = seed;
      try { document.querySelector('.header-preset-random').click(); } finally { delete window.__loopDiceSeed; }
    }, seed);
    await ready(page);const state = await snapshot(page), beats = state.config.motion.loopBeats;
    expect(Number.isInteger(beats)).toBe(true);expect(beats).toBeGreaterThanOrEqual(1);expect(beats).toBeLessThanOrEqual(64);
    lengths.push(beats);await expectLoop(page, beats, beats * 60 / (state.config.motion.tempo * state.config.motion.speed));
    const capture = await page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState());
    expect(capture.snapshot.motion.loopBeats).toBe(beats);expect(capture.selectedId).toBeNull();
    expect(state.playing && state.soundPlaying).toBe(true);expect(state.audioOn).toBe(false);
  }
  expect(new Set(lengths).size).toBeGreaterThan(1);
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

for (const [name, viewport, touch] of [
  ['desktop', {width: 1440, height: 900}, false],
  ['phone', {width: 390, height: 844}, true],
  ['narrow phone', {width: 320, height: 568}, true],
  ['landscape', {width: 844, height: 390}, true],
]) {
  test.describe(name, () => {
    test.use({viewport, hasTouch: touch, isMobile: touch});
    test('loop ruler aligns with contours and remains reachable without moving the mobile stage', async ({page}, testInfo) => {
      for (const form of ['hand', 'foot']) {
        await page.locator('#bodyForm').selectOption(form);await page.waitForFunction(form => window.__gesticulatingHand.snapshot().loaded && window.__gesticulatingHand.snapshot().viewer.form === form, form);
        await page.evaluate(() => scrollTo(0, 0));await range(page, 'loopBeats', 8);
        const initial = await page.evaluate(() => {
          const rect = n => n.getBoundingClientRect().toJSON();
          const nodes = ['#handStage', '.instrument-preset-controls', '.hand-transports', '.hand-voices', '#voiceSound'].map(s => document.querySelector(s));
          return {stage: rect(nodes[0]), rows: [...document.querySelectorAll('.hand-voice:not([hidden])')].map(rect),
            order: nodes.every((n, i) => !i || Boolean(nodes[i - 1].compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)),
            visual: nodes.every((n, i) => !i || rect(n).top >= rect(nodes[i - 1]).bottom - 1)};
        });
        if (touch) {expect(initial.order).toBe(true);expect(initial.visual).toBe(true);}
        if (!touch && form === 'hand') {
          expect(initial.stage.height).toBeGreaterThanOrEqual(280);expect(initial.rows).toHaveLength(6);
          for (const row of initial.rows) expect(row.bottom).toBeLessThanOrEqual(viewport.height);
        }
        const input = page.locator('#loopBeats');await input.scrollIntoViewIfNeeded();await input.focus();
        await input.press('End');await expect(input).toHaveValue('64');
        await input.press('Home');await expect(input).toHaveValue('1');
        await input.press('ArrowRight');await expect(input).toHaveValue('2');
        await range(page, 'loopBeats', 64);await expect(page.locator('#loopRuler')).toHaveAttribute('data-beats', '64');
        await page.locator('#loopRuler').scrollIntoViewIfNeeded();
        const layout = await page.evaluate(() => {
          const rect = n => n.getBoundingClientRect().toJSON(), ruler = document.getElementById('loopRuler');
          return {ruler: rect(ruler), input: rect(document.getElementById('loopBeats')), stage: rect(document.getElementById('handStage')),
            curves: [...document.querySelectorAll('.hand-voice:not([hidden]) .hand-contour')].map(rect),
            ticks: [...ruler.querySelectorAll('.hand-loop-tick')].map(n => ({number: Number(n.textContent), rect: rect(n)})),
            width: innerWidth, scrollWidth: document.documentElement.scrollWidth};
        });
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
        expect(layout.ruler.width).toBeGreaterThan(100);expect(layout.ticks.length).toBeGreaterThanOrEqual(2);
        expect(layout.ticks[0].number).toBe(0);expect(layout.ticks.at(-1).number).toBe(64);
        for (const curve of layout.curves) {
          expect(layout.ruler.left).toBeCloseTo(curve.left, 0);expect(layout.ruler.right).toBeCloseTo(curve.right, 0);
        }
        for (let i = 0; i < layout.ticks.length; i++) {
          const tick = layout.ticks[i];expect(tick.rect.left).toBeGreaterThanOrEqual(layout.ruler.left - 1);
          expect(tick.rect.right).toBeLessThanOrEqual(layout.ruler.right + 1);
          if (i) {expect(tick.number).toBeGreaterThan(layout.ticks[i - 1].number);expect(tick.rect.left).toBeGreaterThanOrEqual(layout.ticks[i - 1].rect.right);}
        }
        expect(layout.ruler.bottom).toBeLessThanOrEqual(viewport.height);
        if (touch) {expect(layout.ruler.top).toBeGreaterThanOrEqual(layout.stage.bottom);expect(layout.stage.top).toBeCloseTo(initial.stage.top, 0);}
        await page.screenshot({path: testInfo.outputPath(`${form}-loop-ruler.png`)});
        expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
      }
    });
  });
}
