import { expect, test } from '@playwright/test';

async function instrumentContext(page, failResume = false) {
  await page.addInitScript(({ failResume }) => {
    // Separate the two clock origins substantially so accidental subtraction
    // across domains fails immediately instead of depending on page uptime.
    const nativeNow = performance.now.bind(performance);
    Object.defineProperty(performance, 'now', { value: () => nativeNow() + 600000 });
    const Native = window.AudioContext;
    const nativeState = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state').get;
    window.__dominoFailResume = failResume;
    window.__dominoInterrupted = false;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args); window.__dominoClockContext = this;
        Object.defineProperty(this, 'state', { configurable: true, get: () => {
          const state = nativeState.call(this);
          return state === 'closed' ? state : window.__dominoFailResume ? 'suspended' : window.__dominoInterrupted ? 'interrupted' : state;
        } });
        const resume = this.resume.bind(this);
        this.resume = () => window.__dominoFailResume
          ? new Promise((_, reject) => setTimeout(() => reject(new Error('Simulated Audio startup failure')), 180))
          : resume();
      }
    };
  }, { failResume });
}
const time = page => page.evaluate(() => window.dominoRun.time);
async function open(page, autoStand = true) {
  await page.goto('domino-run.html');
  await page.waitForFunction(() => Boolean(window.dominoRun));
  await page.locator('#autoStand').setChecked(autoStand);
  await page.waitForTimeout(100);
}

test('actual suspension and interruption preserve the recurrence clock and queued history', async ({ page }) => {
  await instrumentContext(page); await open(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#playButton').click();
  await expect.poll(() => time(page)).toBeGreaterThan(.2);
  for (const interrupted of [false, true]) {
    const before = await time(page);
    await page.evaluate(async interrupted => {
      await window.__dominoClockContext.suspend();
      window.__dominoInterrupted = interrupted;
    }, interrupted);
    const suspended = await time(page);
    expect(suspended).toBeGreaterThanOrEqual(before - .02);
    expect(suspended - before).toBeLessThan(.15);
    await page.waitForTimeout(180);
    const snapshot = await page.evaluate(() => ({ time: window.dominoRun.time,
      falls: window.dominoRun.timeline.falls.map(f => [f.id, f.occurrenceId, f.start]) }));
    await page.waitForTimeout(180);
    expect(await time(page)).toBeCloseTo(snapshot.time, 5);
    expect(await page.evaluate(() => window.dominoRun.timeline.falls.map(f => [f.id, f.occurrenceId, f.start]))).toEqual(snapshot.falls);
    const played = await page.evaluate(() => window.dominoRun.audio.played);
    await page.evaluate(async () => { window.__dominoInterrupted = false; await window.__dominoClockContext.resume(); });
    await expect.poll(() => time(page)).toBeGreaterThan(suspended + .15);
    expect(await time(page)).toBeLessThan(suspended + 1.2);
    await expect.poll(() => page.evaluate(() => window.dominoRun.audio.played)).toBeGreaterThan(played);
    expect(await page.evaluate(() => window.dominoRun.audio.dropped)).toBe(0);
  }
});

test('explicit Audio off keeps silent visual time advancing even if its context suspends', async ({ page }) => {
  await instrumentContext(page); await open(page);
  await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await expect.poll(() => time(page)).toBeGreaterThan(.2);
  const beforeOff = await time(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => window.__dominoClockContext.suspend());
  await page.waitForTimeout(250);
  const silent = await time(page);
  expect(silent).toBeGreaterThan(beforeOff + .15);
  expect(silent - beforeOff).toBeLessThan(1);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  const rearmed = await time(page);
  expect(rearmed).toBeGreaterThanOrEqual(silent - .02);
  expect(rearmed - silent).toBeLessThan(.5);
  await expect.poll(() => time(page)).toBeGreaterThan(rearmed + .15);
});

test('failed startup retains silent visual time and a successful retry rebases once', async ({ page }) => {
  await instrumentContext(page, true); await open(page);
  await page.locator('#playButton').click();
  await expect.poll(() => time(page)).toBeGreaterThan(.2);
  const before = await time(page);
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioError')).toContainText('Simulated Audio startup failure');
  const failed = await time(page);
  expect(failed).toBeGreaterThan(before + .12);
  expect(failed - before).toBeLessThan(1);
  await page.waitForTimeout(220);
  const continuing = await time(page);
  expect(continuing).toBeGreaterThan(failed + .15);
  expect(await page.evaluate(() => window.dominoRun.audio.armed)).toBe(false);
  await page.evaluate(() => { window.__dominoFailResume = false; });
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  const retried = await time(page);
  expect(retried).toBeGreaterThanOrEqual(continuing - .02);
  expect(retried - continuing).toBeLessThan(.5);
  await expect.poll(() => time(page)).toBeGreaterThan(retried + .15);
});


test('a sound edit during suspension restores the current one-shot queue on resume', async ({ page }) => {
  await instrumentContext(page); await open(page, false);
  await page.locator('#loop').uncheck();
  await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await expect.poll(() => time(page)).toBeGreaterThan(.2);
  await page.evaluate(() => window.__dominoClockContext.suspend());
  const frozen = await time(page);
  await page.locator('#ring').fill('0.35');
  await page.locator('#ring').dispatchEvent('input');
  await page.waitForTimeout(160);
  expect(await time(page)).toBeCloseTo(frozen, 5);
  await page.evaluate(() => window.__dominoClockContext.resume());
  await page.waitForTimeout(120);
  await expect.poll(() => page.evaluate(() => window.dominoRun.audio.queued)).toBeGreaterThan(0);
  const played = await page.evaluate(() => window.dominoRun.audio.played);
  await expect.poll(() => page.evaluate(() => window.dominoRun.audio.played)).toBeGreaterThan(played);
  expect(await time(page)).toBeLessThan(frozen + 1.2);
  expect(await page.evaluate(() => window.dominoRun.audio.dropped)).toBe(0);
});
