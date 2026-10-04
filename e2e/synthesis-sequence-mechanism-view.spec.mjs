import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.route('**/sequence-mechanism-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/instruments/synthesis/sequence-surfaces.css"><style>body{margin:16px;background:#09111c;color:#fff;font:14px system-ui}#host{width:min(560px,100%)}</style><title>Sequence mechanism readout fixture</title><div id="host"></div></html>` }));
  await page.goto('/sequence-mechanism-fixture.html');
  await page.evaluate(async () => {
    const { createSequenceMechanismView } = await import('/src/instruments/synthesis/sequence-mechanism-view.js');
    const { SEQUENCE_STUDIES } = await import('/src/instruments/synthesis/sequence-catalog.js');
    const { sequenceSurfaceKind } = await import('/src/instruments/synthesis/sequence-surfaces.js');
    window.mechanismHarness = { ids: SEQUENCE_STUDIES.filter(study => !sequenceSurfaceKind(study)).map(study => study.id), mount(id, parameters = {}) {
      this.view?.destroy(); this.view = createSequenceMechanismView(document.getElementById('host'), id, parameters);
    } };
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`all passive mechanism views fit at ${viewport.width}×${viewport.height} without fake controls`, async ({ page }) => {
    await page.setViewportSize(viewport); await mount(page);
    const problems = await page.evaluate(() => {
      const failures = [];
      for (const id of window.mechanismHarness.ids) {
        window.mechanismHarness.mount(id);
        const node = document.querySelector('[data-sequence-mechanism]');
        if (!node || !node.textContent.trim()) failures.push(`${id}: empty view`);
        if (node?.querySelector('button,input,select,[role="slider"],[role="button"]')) failures.push(`${id}: misleading control`);
        if (document.documentElement.scrollWidth > innerWidth) failures.push(`${id}: document overflow`);
        if (node && node.getBoundingClientRect().right > innerWidth) failures.push(`${id}: clipped view`);
        if (node?.querySelectorAll('table').length && [...node.querySelectorAll('table')].some(table => !table.getAttribute('aria-label'))) failures.push(`${id}: unnamed table`);
      }
      return failures;
    });
    expect(problems).toEqual([]);
  });
}

test('tracker, Markov, phrase and drawn views show different meaningful structures', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.mechanismHarness.mount('tracker-effect-memory'));
  await expect(page.getByRole('columnheader', { name: 'Velocity', exact: true })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('carry');
  await page.evaluate(() => window.mechanismHarness.mount('bounded-random-walk'));
  await expect(page.getByRole('table', { name: 'Next-state probabilities' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  await page.evaluate(() => window.mechanismHarness.mount('phrase-bank-switching', { chainRotation: 1 }));
  await expect(page.locator('.synthesis-mechanism-chain li')).toHaveCount(4);
  await page.evaluate(() => window.mechanismHarness.mount('drawn-density-bands'));
  await expect(page.locator('svg[role="img"]')).toHaveCount(2);
  await expect(page.locator('[data-sequence-mechanism]')).toContainText('Cutouts:');
});

test('real output cursor is passive and disposal removes the view', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.mechanismHarness.mount('rising-latched-chord');
    window.mechanismHarness.view.setCursor(3);
  });
  await expect(page.locator('[data-output-step="3"]')).toHaveClass(/is-current/);
  await expect(page.locator('.is-current')).toHaveCount(1);
  await page.evaluate(() => window.mechanismHarness.view.setValue({ order: 'down', octaves: 1 }));
  await expect(page.locator('[data-sequence-mechanism]')).toContainText('High → low');
  await page.evaluate(() => window.mechanismHarness.view.destroy());
  await expect(page.locator('[data-sequence-mechanism]')).toHaveCount(0);
});
