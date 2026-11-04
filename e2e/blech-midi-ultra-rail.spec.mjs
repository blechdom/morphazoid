import { expect, test } from '@playwright/test';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

test('left rail previews every third, fourth and fifth key before releasing one-shot rows', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/blech-midi-ultra.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  const rail = page.locator('[data-comb-surface]');
  const status = page.locator('[data-spigot-status]');
  const created = new Set();

  // Give each row its own time position: tapping an existing marker removes it.
  for (const [stride, notes, holdMs, position] of [[3, 43, 900, .6], [4, 32, 1450, .45], [5, 26, 2000, .3]]) {
    // The title font and the falling stage can settle between gestures. Use
    // current geometry, not the rail's first paint, and avoid occupied marks.
    const box = await rail.boundingBox(), corner = await page.locator('[data-rail-crossing]').boundingBox();
    const x = box.x + box.width / 2, minY = box.y + corner.height + 22;
    const marks = await rail.locator('.blech-comb-marker').evaluateAll(nodes =>
      nodes.map(node => { const rect = node.getBoundingClientRect(); return (rect.top + rect.bottom) / 2; }));
    const preferred = box.y + Math.max(corner.height + 24, box.height * position);
    const candidates = [preferred, ...[1, 2, 3, 4].flatMap(step => [preferred - step * 27, preferred + step * 27])];
    const y = candidates.find(candidate => candidate >= minY && candidate < box.y + box.height - 16
      && marks.every(mark => Math.abs(mark - candidate) >= 22));
    expect(y).toBeDefined();
    await page.mouse.move(x, y);
    await page.mouse.down();
    let preview;
    try {
      await page.waitForTimeout(holdMs);
      preview = await rail.evaluate(node => {
        const canvas = document.querySelector('.blech-spigot-preview');
        return {
          stride: node.dataset.stride, holding: node.dataset.holding,
          label: node.getAttribute('aria-label'), value: node.querySelector('[data-comb-status]').value,
          hasInk: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
            .some((value, index) => index % 4 === 3 && value > 0),
        };
      });
    } finally {
      await page.mouse.up();
    }
    expect(preview).toMatchObject({
      stride: String(stride), holding: 'true', value: `1/${stride}`, hasInk: true,
    });
    expect(preview.label).toContain(`Every ${stride}${stride === 3 ? 'rd' : 'th'} key`);
    await expect(status).toContainText(`Every ${stride}${stride === 3 ? 'rd' : 'th'} key · 1 row · ${notes} notes · plays once`);
    await expect(rail).toHaveAttribute('data-holding', 'false');
    const ids = await rail.locator('.blech-comb-marker').evaluateAll(marks => marks.map(mark => mark.dataset.railId));
    const fresh = ids.filter(id => !created.has(id));
    expect(fresh).toHaveLength(1);
    created.add(fresh[0]);
  }

  await expect(page.locator('[data-rail-crossing]')).toHaveAttribute('aria-label', /Every 5th key/);
  expect(created.size).toBe(3); // Earlier one-shot markers may expire during the longer holds.
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(0);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('left-rail hold spacing remains reachable on portrait and short landscape phones', async ({ browser, baseURL }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage(), diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto('/blech-midi-ultra.html');
      await expect(page.locator('#blechDropSend')).toBeEnabled();
      const rail = page.locator('[data-comb-surface]');
      const box = await rail.boundingBox(), corner = await page.locator('[data-rail-crossing]').boundingBox();
      const x = box.x + box.width / 2, y = box.y + Math.max(corner.height + 24, box.height * .5);
      expect(y).toBeLessThan(box.y + box.height);
      await page.mouse.move(x, y);
      await page.mouse.down();
      let preview;
      try {
        await page.waitForTimeout(900);
        preview = await rail.locator('[data-comb-status]').evaluate(node => node.value);
      } finally {
        await page.mouse.up();
      }
      expect(preview).toBe('1/3');
      await expect(page.locator('[data-spigot-status]')).toContainText('Every 3rd key · 1 row · 43 notes · plays once');
      const ends = await page.evaluate(() => ({
        rail: document.querySelector('[data-comb-surface]').getBoundingClientRect().bottom,
        keyboard: document.querySelector('.blech-playable-keyboard').getBoundingClientRect().top,
      }));
      expect(ends.rail).toBeLessThanOrEqual(ends.keyboard + 1);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test('top rail makes immediate outlined sustains and a dragged chord without borrowing Layers', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/blech-midi-ultra.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  const rail = page.locator('.blech-note-rail'), markers = rail.locator('.blech-note-rail-marker');
  const display = page.locator('.midiphoria-black-stage');
  const bounds = await rail.boundingBox(), y = bounds.y + bounds.height / 2;
  const x = bounds.x + bounds.width * .35;
  await page.mouse.dblclick(x, y, { delay: 70 });
  await expect(markers).toHaveCount(1);
  await expect(markers.first()).toHaveAttribute('data-held', 'true');
  await expect(display).toHaveAttribute('data-rail-held', '1');
  await expect.poll(async () => Number(await display.getAttribute('data-held-outline-extent')))
    .toBeGreaterThan(40);
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(0);

  await page.mouse.move(bounds.x + bounds.width * .45, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .55, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => markers.count()).toBeGreaterThan(5);
  const count = await markers.count();
  await expect(display).toHaveAttribute('data-rail-held', String(count));
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(0);
  await page.locator('#blechMasterPlay').click();
  await expect(display).toHaveAttribute('data-rail-held', '0');
  await expect(markers.first()).toHaveAttribute('data-playing', 'false');
  await page.locator('#blechMasterPlay').click();
  await expect(display).toHaveAttribute('data-rail-held', String(count));
  await page.locator('#blechToolClear').click();
  await expect(markers).toHaveCount(0);
  await expect(display).toHaveAttribute('data-rail-held', '0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('left rail positions one-shots and paints time; only the corner loops and removal is local', async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/blech-midi-ultra.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  const rail = page.locator('[data-comb-surface]'), marks = rail.locator('.blech-comb-marker');
  const corner = page.locator('[data-rail-crossing]'), box = await rail.boundingBox();
  const cross = await corner.boundingBox(), x = box.x + box.width / 2;
  const upper = box.y + cross.height + 30, lower = box.y + box.height * .67;
  expect(lower).toBeGreaterThan(upper + 30);
  await page.mouse.click(x, upper);
  await expect(marks).toHaveCount(1);
  const firstTop = Number(await marks.first().evaluate(node => parseFloat(node.style.top)));
  await page.mouse.click(x, lower);
  await expect(marks).toHaveCount(2);
  const secondTop = Number(await marks.nth(1).evaluate(node => parseFloat(node.style.top)));
  expect(firstTop).toBeLessThan(secondTop - 20);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(x, upper + 10);
  await page.mouse.down();
  await page.mouse.move(x, lower - 20, { steps: 7 });
  await page.mouse.up();
  await expect(marks).toHaveCount(3);
  expect(Number(await marks.nth(2).evaluate(node => parseFloat(node.style.height)))).toBeGreaterThan(12);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(0);
  const last = await marks.nth(2).boundingBox();
  await page.mouse.click(x, last.y + last.height / 2);
  await expect(marks).toHaveCount(2);

  // These rows are one-shots and can expire at any time. Inspect the ids
  // before and after activating the corner in one browser task: no rendering
  // interval can expire a row between the two snapshots.
  const cornerRows = await page.evaluate(() => {
    const ids = () => [...document.querySelectorAll('.blech-comb-marker')].map(mark => mark.dataset.railId);
    const before = ids();
    document.querySelector('[data-rail-crossing]').click();
    return { before, after: ids() };
  });
  expect(cornerRows.after).toEqual(cornerRows.before);
  await expect(corner).toHaveAttribute('aria-pressed', 'true');
  await expect(corner).toHaveAttribute('data-period', '0.125');
  await page.locator('#blechMasterPlay').click();
  await expect(corner).toHaveAttribute('data-playing', 'false');
  await page.locator('#blechMasterPlay').click();
  await expect(corner).toHaveAttribute('data-playing', 'true');
  await page.mouse.click(cross.x + cross.width / 2, cross.y + cross.height / 2);
  await expect(corner).toHaveAttribute('aria-pressed', 'false');
  // Unlike the corner, one-shot rows can finish and disappear while transport
  // is playing; the earlier assertions cover that toggling the corner leaves
  // them alone at the moment it is activated.
  await page.locator('#blechToolClear').click();
  await expect(marks).toHaveCount(0);
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test('the top rail sounds 128 sustained pitches without occupying a layer and resumes without recounting', async ({ page, baseURL }) => {
  test.setTimeout(70_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/blech-midi-ultra.html');
  await expect(page.locator('#blechDropSend')).toBeEnabled();
  await page.locator('#blechDropChannelButton').click();
  await page.locator('#blechDropProgram').selectOption('16'); // A sustained organ, not a decaying piano.
  const rail = page.locator('.blech-note-rail'), markers = rail.locator('.blech-note-rail-marker');
  const bounds = await rail.boundingBox(), y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 2, y, { steps: 4 });
  await page.mouse.up();
  await expect(markers).toHaveCount(128);
  await expect(page.locator('.midiphoria-black-stage')).toHaveAttribute('data-rail-held', '128');
  await expect(page.locator('#blechLiveLayers .blech-live-layer')).toHaveCount(0);
  await expect(page.locator('#blechMidi')).toHaveAttribute('data-samples', '0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');

  // Arm sound separately. The audio worklet joins existing holds at its
  // current beat instead of replaying 128 stale UI events or using clip slots.
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
  await expect.poll(async () => (await readAudioStatus(page)).rms, { timeout: 12_000 }).toBeGreaterThan(.0005);
  const sounding = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 35 });
  expect(sounding.summary.finite).toBe(true);
  expect(sounding.summary.maxPeak).toBeLessThan(1);
  expect(sounding.summary.maxRms).toBeGreaterThan(.0005);
  const count = Number((await page.locator('#blechNotesPlayed').textContent()).replaceAll(',', ''));
  await page.locator('#blechMasterPlay').click();
  await expect(page.locator('.midiphoria-black-stage')).toHaveAttribute('data-rail-held', '0');
  await expect.poll(async () => Number((await page.locator('#blechNotesPlayed').textContent()).replaceAll(',', ''))).toBe(count);
  await page.locator('#blechMasterPlay').click();
  await expect(page.locator('.midiphoria-black-stage')).toHaveAttribute('data-rail-held', '128');
  expect(Number((await page.locator('#blechNotesPlayed').textContent()).replaceAll(',', ''))).toBe(count);
  await page.locator('#blechToolClear').click();
  await expect(markers).toHaveCount(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
