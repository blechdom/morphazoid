import { test, expect } from '@playwright/test';

const knobIds = ['tempo', 'suspensionBeats', 'stride', 'momentum', 'gravity', 'pitchSemitones', 'lopsided', 'spring', 'groundResonance', 'grain', 'cavern'];
const nextFields = { animalSelect: 'animalId', behaviorSelect: 'behaviorId', soundSkinSelect: 'soundSkinId', visualSkinSelect: 'visualSkinId', terrain: 'surfaceId', groundProfile: 'groundProfileId' };
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
const audioStatus = page => page.evaluate(async () => (await import('/src/audio-output-manager.js')).getSharedAudioOutputManager().getStatus());
const valueIn = (snapshot, id) => ['grain', 'cavern'].includes(id) ? snapshot.world[id] : snapshot.actors[snapshot.selectedActor][id === 'tempo' ? 'tempoBpm' : id];
const choiceIn = async (page, field) => {
  if (field === 'visualSkinId') return page.locator('#stage').getAttribute('data-visual-skin');
  const snapshot = await capture(page);
  return field === 'soundSkinId' ? snapshot[field] : snapshot.actors[snapshot.selectedActor][field];
};

async function openInstrument(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/quadruped.html');
  await expect(page.locator('.quadruped-console .mz-range-knob')).toHaveCount(11);
  await expect(page.locator('.mz-tap-tempo[data-tap-control="#tempo"]')).toBeVisible();
  return errors;
}
async function expectLiveState(page, playing = false, audio = false) {
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', String(playing));
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', String(audio));
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((node, value) => {
    node.value = String(value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function expectKnob(page, id) {
  const input = page.locator(`#${id}`);
  const value = Number(await input.inputValue());
  expect(valueIn(await capture(page), id), `${id} reaches its model field`).toBeCloseTo(value, 8);
  const expectedOutput = id === 'tempo' ? `${Math.round(value)} BPM · global`
    : id === 'suspensionBeats' ? `Rest · ${value}b`
    : id === 'stride' ? `${value.toFixed(2)}×`
    : id === 'pitchSemitones' ? `${value > 0 ? '+' : ''}${Number(value.toFixed(1))} st`
    : id === 'lopsided' ? `${value > 0 ? '+' : ''}${Math.round(value * 100)}%`
    : `${Math.round(value * 100)}%`;
  await expect(page.locator(`#${id === 'suspensionBeats' ? 'suspension' : id}Out`)).toHaveText(expectedOutput);
  const dial = await input.evaluate(node => ({ min: Number(node.min), max: Number(node.max), logarithmic: node.dataset.knobScale === 'log', rotation: Number(node.parentElement.querySelector('.mz-range-knob__dial i').style.transform.match(/rotate\(([-.\d]+)deg\)/)[1]) }));
  const fraction = dial.logarithmic ? Math.log1p(value - dial.min) / Math.log1p(dial.max - dial.min) : (value - dial.min) / (dial.max - dial.min);
  expect(dial.rotation, `${id} needle follows its native value`).toBeCloseTo(-135 + fraction * 270, 2);
}

test('six Next controls wrap through native change events and retain Audio and Play', async ({ page }) => {
  const errors = await openInstrument(page);
  await expect(page.locator('[data-next-select]')).toHaveCount(6);
  await expect(page.getByText('Playing notes', { exact: true })).toHaveCount(0);
  await expect(page.locator('#gestureHelp')).toHaveClass(/sr-only/);
  await page.evaluate(() => {
    globalThis.__nextChanges = [];
    document.addEventListener('change', event => {
      if (event.target.matches('select')) globalThis.__nextChanges.push({ id: event.target.id, value: event.target.value });
    });
  });
  for (const [id, field] of Object.entries(nextFields)) {
    const select = page.locator(`#${id}`);
    const values = await select.locator('option').evaluateAll(options => options.filter(option => !option.disabled && !option.hidden).map(option => option.value));
    expect(values.length).toBeGreaterThan(1);
    await select.selectOption(values.at(-1));
    expect(await choiceIn(page, field)).toBe(values.at(-1));
    await page.evaluate(() => { globalThis.__nextChanges = []; });
    for (const value of values.slice(0, 2)) {
      await page.locator(`[data-next-select="${id}"]`).click();
      await expect(select).toHaveValue(value);
      expect(await choiceIn(page, field)).toBe(value);
      await expectLiveState(page);
    }
    expect(await page.evaluate(() => globalThis.__nextChanges)).toEqual(values.slice(0, 2).map(value => ({ id, value })));
  }
  expect((await audioStatus(page)).connectionCount).toBe(0);
  await page.locator('#playButton').click();
  for (const id of Object.keys(nextFields)) {
    await page.locator(`[data-next-select="${id}"]`).click();
    await expectLiveState(page, true, false);
  }
  await page.locator('#audioButton').click();
  await expectLiveState(page, true, true);
  for (const id of Object.keys(nextFields)) {
    await page.locator(`[data-next-select="${id}"]`).click();
    await expectLiveState(page, true, true);
  }
  expect((await audioStatus(page)).connectionCount).toBe(1);
  expect(errors).toEqual([]);
});

test('eleven native knobs support keys, vertical drag, cancel, synchronized readouts and physical Tap', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await openInstrument(page);
  await page.locator('#behaviorSelect').selectOption('walk-leap');
  await expect(page.locator('#suspensionBeats')).toBeEnabled();
  for (const id of knobIds) {
    const input = page.locator(`#${id}`);
    await input.scrollIntoViewIfNeeded();
    await input.focus();
    await page.keyboard.press('Home');
    expect(Number(await input.inputValue())).toBe(Number(await input.getAttribute('min')));
    await expectKnob(page, id);
    await page.keyboard.press('End');
    expect(Number(await input.inputValue())).toBe(Number(await input.getAttribute('max')));
    await expectKnob(page, id);
    await page.keyboard.press('ArrowLeft');
    const keyValue = Number(await input.inputValue());
    expect(keyValue).toBeCloseTo(Number(await input.getAttribute('max')) - Number(await input.getAttribute('step')), 8);
    await expectKnob(page, id);
    await input.evaluate(node => {
      globalThis.__knobEvents = [];
      for (const type of ['input', 'change']) node.addEventListener(type, event => globalThis.__knobEvents.push(event.type));
      node.addEventListener('pointerdown', event => { globalThis.__knobPointerId = event.pointerId; }, { once: true });
    });
    const box = await input.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(Number(await input.inputValue()), 'taking hold does not jump the hidden range').toBe(keyValue);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 30, { steps: 5 });
    expect(Number(await input.inputValue())).toBeLessThan(keyValue);
    await expectKnob(page, id);
    const pointerId = await page.evaluate(() => globalThis.__knobPointerId);
    await input.dispatchEvent('pointercancel', { pointerId, pointerType: 'mouse', isPrimary: true });
    expect(await input.evaluate((node, pointerId) => node.hasPointerCapture(pointerId), pointerId)).toBe(false);
    const canceledValue = await input.inputValue();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 3 });
    await page.mouse.up();
    await expect(input).toHaveValue(canceledValue);
    const events = await page.evaluate(() => globalThis.__knobEvents);
    expect(events.filter(type => type === 'input').length).toBeGreaterThan(0);
    expect(events.filter(type => type === 'change')).toHaveLength(1);
    await expectLiveState(page);
  }
  const tap = page.locator('.mz-tap-tempo[data-tap-control="#tempo"]');
  await tap.scrollIntoViewIfNeeded();
  await tap.evaluate(node => { globalThis.__tapTimes = []; node.addEventListener('pointerdown', event => globalThis.__tapTimes.push(event.timeStamp)); });
  const initial = Number(await page.locator('#tempo').inputValue());
  await tap.click();
  expect(Number(await page.locator('#tempo').inputValue())).toBe(initial);
  await page.waitForTimeout(500);
  await tap.click();
  const times = await page.evaluate(() => globalThis.__tapTimes);
  const expected = Math.round(60000 / (times[1] - times[0]));
  expect(Number(await page.locator('#tempo').inputValue())).toBe(expected);
  await expectKnob(page, 'tempo');
  // Exercise the native Tap adapter at both new endpoints without a six-second
  // wall-clock wait. Its actual physical pointer path was exercised above.
  for (const [interval, bpm] of [[6000, 10], [60, 1000]]) {
    await tap.evaluate((node, interval) => { node.reset(); node.tap(0); node.tap(interval); }, interval);
    await expect(page.locator('#tempo')).toHaveValue(String(bpm));
    await expectKnob(page, 'tempo');
  }
  await expectLiveState(page);
  expect((await audioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

async function installResetProbe(page) {
  // Observe the clock at retime and after the reset handler. Its synchronous audio
  // scheduler can already advance retained playback before the click completes.
  // These response-only observations never change production state.
  await page.route('**/src/instruments/quadruped/quadruped-app.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const retimeAnchor = 'motor = createQuadrupedMotorState(scoreForActor(selectedActor), options);\n  motorPerformance = now;';
    expect(source).toContain(retimeAnchor);
    const observedSource = source.replace(retimeAnchor, retimeAnchor + `
      globalThis.__quadrupedClockOrigin = { position: motor.position, stoppedPosition, at: now };
    `);
    await route.fulfill({ response, body: observedSource + `
      globalThis.__quadrupedResetProbe = () => ({
        musical: capturePreset(), position: motor.position, stoppedPosition, selectedStep,
        courseOriginX, transportPlaying, audioOn: isAudioOn(), outputLevel: state.outputLevel,
        clockOrigin: globalThis.__quadrupedClockOrigin,
        sinceOriginMs: performance.now() - (globalThis.__quadrupedClockOrigin?.at ?? performance.now()),
        activeGesture: Boolean(activeGesture), gestureKey,
        actors: actors.map(actor => ({ position: actor.motor.position, offset: actor.offset,
          motion: Boolean(performances.get(actor)?.motion), travel: Boolean(performances.get(actor)?.travel),
          call: Boolean(performances.get(actor)?.call) })),
      });
      document.getElementById('resetButton').addEventListener('click', () => {
        globalThis.__quadrupedImmediatelyAfterReset = globalThis.__quadrupedResetProbe();
      });
    ` });
  });
}

async function editTrio(page) {
  await page.locator('[data-group-mode="trio"]').click();
  for (const [actor, animal] of [[0, 'cat'], [1, 'frog'], [2, 'goat']]) {
    await page.locator(`button[data-actor-index="${actor}"]`).click();
    await page.locator('#animalSelect').selectOption(animal);
    await page.locator('#clearButton').click();
    await page.locator('#callPhraseButton').click();
  }
  await page.locator('#behaviorSelect').selectOption('walk-leap');
  await page.locator('[data-pace-ratio="3"]').click();
  for (const [id, value] of Object.entries({ tempo: 173, suspensionBeats: 5, stride: 1.3, momentum: 1.2, gravity: .65, pitchSemitones: -24.5, lopsided: -.87, spring: 2.4, groundResonance: .15, grain: .14, cavern: .93, level: .23 })) await setRange(page, id, value);
  await page.locator('#terrain').selectOption('metal');
  await page.locator('#groundProfile').selectOption('stairs-down');
  for (const id of ['soundSkinSelect', 'visualSkinSelect']) {
    const value = await page.locator(`#${id} option`).last().getAttribute('value');
    await page.locator(`#${id}`).selectOption(value);
  }
  await page.locator('#newGrainButton').click();
  await page.locator('#scatterButton').click();
}

test('Reset all restores the complete startup scene and zero clock from edited Trio while retaining live state', async ({ page }) => {
  test.setTimeout(60_000);
  await installResetProbe(page);
  const errors = await openInstrument(page);
  const startup = await capture(page);
  await page.evaluate(() => { globalThis.__resetDocumentIdentity = 'same-document'; });
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  for (const playing of [false, true]) {
    await editTrio(page);
    const edited = await capture(page);
    expect(edited.groupMode).toBe('trio');
    expect(edited.selectedActor).toBe(2);
    expect(edited.actors).toHaveLength(3);
    expect(edited).not.toEqual(startup);
    expect(edited.world).not.toEqual(startup.world);
    expect(edited.actors[0].pattern).not.toEqual(startup.actors[0].pattern);
    if (playing) {
      await page.locator('#audioButton').click();
      await page.locator('#playButton').click();
      await expectLiveState(page, true, true);
    }
    const handle = page.locator('.quadruped-animal-handle[data-gesture-actor="2"]');
    // The hit area follows the running animal every frame. Scroll its static
    // stage into view instead of waiting for the animation to become still.
    await page.locator('#stage').scrollIntoViewIfNeeded();
    const startPosition = (await page.evaluate(() => globalThis.__quadrupedResetProbe())).position;
    if (playing) {
      const origin = await handle.evaluate(node => {
        const stage = document.querySelector('#stage').getBoundingClientRect();
        return { x: stage.x + Number(node.dataset.bodyX), y: stage.y + Number(node.dataset.bodyY) };
      });
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      await page.mouse.move(origin.x - 65, origin.y, { steps: 6 });
    } else {
      await handle.focus();
      await page.keyboard.down('b');
    }
    await expect.poll(async () => (await page.evaluate(() => globalThis.__quadrupedResetProbe())).position).toBeGreaterThan(startPosition + .5);
    const before = await page.evaluate(() => globalThis.__quadrupedResetProbe());
    expect(playing ? before.activeGesture : Boolean(before.gestureKey)).toBe(true);
    expect(before.actors[2].motion).toBe(true);
    const connections = (await audioStatus(page)).connectionCount;
    if (playing) {
      // Keyboard activation permits reset while the real mouse drag is captured.
      await page.locator('#resetButton').focus();
      await page.keyboard.press('Enter');
    } else await page.locator('#resetButton').click();
    const reset = await page.evaluate(() => globalThis.__quadrupedImmediatelyAfterReset);
    expect(reset.musical).toEqual(startup);
    expect(reset).toMatchObject({ clockOrigin: { position: 0, stoppedPosition: 0 }, selectedStep: 0, courseOriginX: 0, transportPlaying: playing, audioOn: playing, outputLevel: .23, activeGesture: false, gestureKey: null });
    if (playing) {
      // Default Walk advances 16 frames per beat; allow its one fixed integration
      // tick of quantization, not an arbitrary tolerance on the reset position.
      const frameRate = startup.actors[0].tempoBpm * 16 / 60;
      expect(reset.position).toBeGreaterThanOrEqual(0);
      expect(reset.position).toBeLessThanOrEqual((reset.sinceOriginMs / 1000 + 1 / 480) * frameRate);
    } else expect(reset.position).toBe(0);
    expect(reset.stoppedPosition).toBe(reset.position);
    expect(reset.actors).toEqual([{ position: reset.position, offset: 0, motion: false, travel: false, call: false }]);
    if (playing) await page.mouse.up();
    else await page.keyboard.up('b');
    await expectLiveState(page, playing, playing);
    await expect(page.locator('#level')).toHaveValue('0.23');
    expect((await audioStatus(page)).connectionCount).toBe(connections);
    expect(await capture(page)).toEqual(startup);
    await expect(page.locator('#visualSkinSelect')).toHaveValue('constellation');
    await expect(page.locator('#stage')).toHaveAttribute('data-visual-skin', 'constellation');
    expect(await page.evaluate(() => globalThis.__resetDocumentIdentity)).toBe('same-document');
    if (playing) {
      await expect.poll(async () => (await page.evaluate(() => globalThis.__quadrupedResetProbe())).position).toBeGreaterThan(1);
    } else {
      await page.waitForTimeout(150);
      expect((await page.evaluate(() => globalThis.__quadrupedResetProbe())).position).toBe(0);
    }
  }
  expect(navigations).toBe(0);
  expect(errors).toEqual([]);
});
