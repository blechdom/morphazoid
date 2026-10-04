import { test, expect } from '@playwright/test';

async function mount(page, study) {
  await page.route('**/sequence-surface-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/instruments/synthesis/sequence-surfaces.css"><style>body{margin:16px;background:#09111c;color:#fff;font:14px system-ui}#host{width:min(560px,100%)}</style><title>Sequence controls fixture</title><div id="host"></div></html>` }));
  await page.goto('/sequence-surface-fixture.html');
  await page.evaluate(async id => {
    const { createSequenceSurface } = await import('/src/instruments/synthesis/sequence-surfaces.js');
    const { createSequenceParameterValues } = await import('/src/instruments/synthesis/sequence-parameters.js');
    const { compileSequence } = await import('/src/instruments/synthesis/sequence-compiler.js');
    const harness = { parameters: createSequenceParameterValues(id), phases: [], compile() { return compileSequence(id, { parameters: this.parameters }); } };
    harness.surface = createSequenceSurface(document.getElementById('host'), id, harness.parameters, (parameters, metadata) => {
      harness.parameters = parameters; harness.phases.push(metadata.phase); harness.surface.setValue(parameters);
    });
    window.sequenceSurfaceHarness = harness;
  }, study);
}

test('gesture keyboard editing changes pitch, time, pressure and compiled notes', async ({ page }) => {
  await mount(page, 'captured-control-gesture');
  const original = await page.evaluate(() => window.sequenceSurfaceHarness.compile().steps);
  const pitch = page.getByRole('slider', { name: /^Gesture pitch/ });
  await pitch.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Alt+ArrowRight');
  let points = await page.evaluate(() => window.sequenceSurfaceHarness.parameters.gesturePoints);
  expect(points[1].time).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.compile().steps)).not.toEqual(original);
  const previousPressure = points[1].pressure;
  await page.getByRole('slider', { name: /^Gesture pressure/ }).focus(); await page.keyboard.press('ArrowDown');
  points = await page.evaluate(() => window.sequenceSurfaceHarness.parameters.gesturePoints);
  expect(points[1].pressure).toBeLessThan(previousPressure);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters.gesturePoints[1].pressure)).toBe(previousPressure);
});

test('gesture pointer cancellation restores its entire transaction and destruction removes controls', async ({ page }) => {
  await mount(page, 'edited-gesture-loop');
  const before = await page.evaluate(() => window.sequenceSurfaceHarness.parameters);
  const canvas = page.getByRole('slider', { name: /^Gesture pitch/ }), box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .38, box.y + box.height * .45); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .2);
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters)).not.toEqual(before);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters)).toEqual(before);
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.phases.at(-1))).toBe('cancel');
  await page.evaluate(() => window.sequenceSurfaceHarness.surface.destroy());
  await expect(page.locator('[data-sequence-surface]')).toHaveCount(0);
});

test('fast stage painting fills skipped stages and Undo restores the full drag', async ({ page }) => {
  await mount(page, 'three-row-voltage-walk');
  const before = await page.evaluate(() => window.sequenceSurfaceHarness.parameters);
  const canvas = page.getByRole('slider', { name: /^Voltage stage/ }), box = await canvas.boundingBox();
  await page.mouse.move(box.x + 16, box.y + box.height * .8); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 16, box.y + box.height * .2, { steps: 1 }); await page.mouse.up();
  const after = await page.evaluate(() => window.sequenceSurfaceHarness.parameters.stagePitches);
  expect(after.length).toBeGreaterThan(4);
  for (let index = 1; index < after.length; index++) expect(after[index]).toBeGreaterThan(after[index - 1]);
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.phases.filter(phase => phase === 'commit').length)).toBe(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters)).toEqual(before);
  const gate = page.getByRole('button', { name: 'Gate clock slot 1', exact: true });
  const gateBefore = await gate.getAttribute('aria-pressed');
  await gate.focus(); await page.keyboard.press('Space');
  await expect(gate).toHaveAttribute('aria-pressed', gateBefore === 'true' ? 'false' : 'true');
});

test('external preset recall interrupts a pointer edit without restoring obsolete state', async ({ page }) => {
  await mount(page, 'captured-control-gesture');
  const before = await page.evaluate(() => window.sequenceSurfaceHarness.parameters);
  const canvas = page.getByRole('slider', { name: /^Gesture pitch/ }), box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .2);
  const external = { ...before, transpose: 7 };
  await page.evaluate(next => {
    window.sequenceSurfaceHarness.parameters = next;
    window.sequenceSurfaceHarness.surface.setValue(next);
  }, external);
  await canvas.dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters)).toEqual(external);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Euclidean circle stays circular and edits the real rhythm at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await mount(page, 'euclidean-pulse-rotation');
    const ring = page.getByRole('slider', { name: /^Euclidean pulse/ }), box = await ring.boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    const before = await page.evaluate(() => window.sequenceSurfaceHarness.parameters);
    await ring.focus(); await page.keyboard.press('ArrowRight');
    expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters.rotation)).not.toBe(before.rotation);
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters.pulses)).toBe(before.pulses + 1);
    await page.getByRole('spinbutton', { name: 'Euclidean slots' }).fill('12');
    await page.getByRole('spinbutton', { name: 'Euclidean slots' }).press('Tab');
    expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters.euclideanSteps)).toBe(12);
    await ring.scrollIntoViewIfNeeded();
    const liveBox = await ring.boundingBox(), cx = liveBox.x + liveBox.width / 2, cy = liveBox.y + liveBox.height / 2;
    const radius = liveBox.width * .38, rotation = await page.evaluate(() => window.sequenceSurfaceHarness.parameters.rotation);
    await page.mouse.move(cx, cy - radius); await page.mouse.down();
    await page.mouse.move(cx + radius * .6, cy - radius * .8); await page.mouse.up();
    expect(await page.evaluate(() => window.sequenceSurfaceHarness.parameters.rotation)).not.toBe(rotation);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
