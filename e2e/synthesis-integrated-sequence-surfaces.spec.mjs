import { test, expect } from '@playwright/test';

async function ready(page, query = '') {
  await page.goto(`/synthesis.html${query}`);
  await page.waitForFunction(() => window.MorphazoidSynthesis);
}
async function selectSequence(page, id) {
  await page.locator('#sequenceSelect').evaluate((select, value) => {
    select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
  }, id);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`integrated mechanism views and optional output fit all methods at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport); await ready(page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const failures = await page.evaluate(async () => {
      const { SEQUENCE_STUDIES } = await import('/src/instruments/synthesis/sequence-catalog.js');
      const problems = [];
      for (const study of SEQUENCE_STUDIES) {
        const select = document.getElementById('sequenceSelect');
        select.value = study.id; select.dispatchEvent(new Event('change', { bubbles: true }));
        const surface = document.querySelector('#sequenceSurface > section');
        if (!surface?.textContent.trim()) problems.push(`${study.id}: missing mechanism`);
        if (document.getElementById('sequenceOutput').open) problems.push(`${study.id}: generic output unexpectedly expanded`);
        if (document.documentElement.scrollWidth > innerWidth) problems.push(`${study.id}: document overflow`);
        if (surface && surface.getBoundingClientRect().right > innerWidth + 1) problems.push(`${study.id}: clipped mechanism`);
        if (surface?.dataset.sequenceMechanism && surface.querySelector('button,input,select,[role="slider"]')) problems.push(`${study.id}: fake editing controls`);
        const owned = { gesture: ['gesturePoints'], 'cv-rows': ['stagePitches', 'stageGates'], euclidean: ['pulses', 'euclideanSteps', 'rotation'] }[study.archetype] || [];
        for (const id of owned) if (document.getElementById(`sequence-param-${id}`)) problems.push(`${study.id}: duplicate ${id}`);
      }
      return problems;
    });
    expect(failures).toEqual([]); expect(errors).toEqual([]);
    await page.locator('#sequenceOutput > summary').click();
    await expect(page.locator('#sequenceStrip')).toBeVisible();
    await expect(page.locator('.synthesis-sequence-note').first()).toBeVisible();
  });
}

test('mechanism scheduled output stays synchronized after method, traversal and tuning changes', async ({ page }) => {
  await ready(page, '?sequence=tracker-effect-memory');
  await selectSequence(page, 'rising-latched-chord');
  async function compareOutput() {
    const discrepancy = await page.evaluate(async () => {
      const state = window.MorphazoidSynthesis.getSequenceState();
      const { buildSequenceMechanismModel } = await import('/src/instruments/synthesis/sequence-mechanism-view.js');
      const expected = buildSequenceMechanismModel(state.id, state.parameters, state.cycle).blocks.find(block => block.type === 'path');
      const actual = [...document.querySelectorAll('#sequenceSurface [data-output-step]')].map(cell => cell.textContent);
      return { actual, expected: expected.cells.map(cell => cell.text) };
    });
    expect(discrepancy.actual).toEqual(discrepancy.expected);
  }
  await compareOutput();
  await page.locator('#sequence-param-order').evaluate(select => {
    select.value = 'down'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await compareOutput();
  await page.locator('#tuningSelect').evaluate(select => {
    select.value = 'edo-19'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await compareOutput();
});

test('integrated gesture keyboard edits, pointer cancellation and undo retain active transport', async ({ page }) => {
  await ready(page, '?method=fm&sequence=captured-control-gesture');
  await page.locator('#audioButton').click();
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().armed)).toBe(true);
  await page.locator('#playButton').click();
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().sequence.audio.playing)).toBe(true);
  const before = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
  const pitch = page.getByRole('slider', { name: /^Gesture pitch/ });
  await pitch.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Alt+ArrowRight');
  const edited = await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState());
  expect(edited.parameters).not.toEqual(before.parameters);
  expect(edited.cycle.steps).not.toEqual(before.cycle.steps);
  await pitch.scrollIntoViewIfNeeded();
  const box = await pitch.boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .2);
  await pitch.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().parameters)).toEqual(edited.parameters);
  const status = await page.evaluate(() => window.MorphazoidSynthesis.getStatus());
  expect(status.armed).toBe(true); expect(status.playing).toBe(true); expect(status.sequence.running).toBe(true); expect(status.heldNotes).toBe(0);
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().sequence.audio.playing)).toBe(true);
  const startBeat = status.sequence.transportBeat;
  await expect.poll(() => page.evaluate(() => window.MorphazoidSynthesis.getStatus().sequence.transportBeat)).toBeGreaterThan(startBeat);
  await page.getByRole('slider', { name: /^Gesture pressure/ }).focus(); await page.keyboard.press('ArrowDown');
  await page.locator('#sequenceSurface').getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getSequenceState().parameters)).toEqual(edited.parameters);
  await page.locator('#playButton').click();
  expect(await page.evaluate(() => window.MorphazoidSynthesis.getStatus().playing)).toBe(false);
});
