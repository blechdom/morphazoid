import { expect, test } from "@playwright/test";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

async function observeClock(page) {
  await page.addInitScript(() => {
    globalThis.__rowStarts = [];
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function (...args) {
      globalThis.__rowContext = this;
      const node = create.apply(this, args), start = node.start.bind(node);
      node.start = (when, ...rest) => {
        __rowStarts.push({ when, submitted: this.currentTime, frames: node.buffer.length });
        return start(when, ...rest);
      };
      return node;
    };
    const raf = requestAnimationFrame.bind(globalThis);
    globalThis.requestAnimationFrame = callback => raf(function frame(time) {
      if (globalThis.__freezeGraphics) raf(frame);
      else callback(time);
    });
  });
}

async function straightPulse(page) {
  await page.evaluate(() => {
    for (const [id, value] of Object.entries({ caRate: 12, caSwing: 0, caTimeSpread: 0, caRule: 255 })) {
      const control = document.getElementById(id);
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await page.locator("#playButton").click();
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => __rowStarts.length)).toBeGreaterThan(8);
}

for (const prefix of ["", "/dist-wax"]) {
  test(`${prefix || "source"}: sample-timed rows survive stopped graphics and a 240ms UI stall`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await observeClock(page);
    await page.goto(`${prefix}/automatapoeia.html`);
    await straightPulse(page);
    const startCount = await page.evaluate(() => {
      globalThis.__freezeGraphics = true;
      return __rowStarts.length;
    });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => __rowStarts.length)).toBeGreaterThan(startCount + 14);
    await page.evaluate(() => {
      globalThis.__freezeGraphics = false;
      const until = performance.now() + 240;
      while (performance.now() < until) { /* intentional UI/render-thread stall */ }
    });
    await page.waitForTimeout(800);
    const report = await page.evaluate(() => ({
      sampleRate: __rowContext.sampleRate, starts: __rowStarts,
      intervals: __rowStarts.slice(1).map((event, index) => event.when - __rowStarts[index].when),
    }));
    await testInfo.attach("row-clock.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    for (const interval of report.intervals) expect(Math.abs(interval - 1 / 12)).toBeLessThan(0.5 / report.sampleRate);
    for (const event of report.starts) expect(event.when - event.submitted).toBeGreaterThan(0);
    await page.locator("#audioButton").click();
    const stoppedCount = await page.evaluate(() => __rowStarts.length);
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => __rowStarts.length)).toBe(stoppedCount);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

test("live tempo changes preserve the running audio session and settle onto the new row interval", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await observeClock(page);
  await page.goto("/automatapoeia.html");
  await straightPulse(page);
  const generation = await page.locator("#stageReadout").textContent();
  await page.locator("#caRate").evaluate(control => {
    control.value = "8";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(1000);
  const intervals = await page.evaluate(() => __rowStarts.slice(-5).slice(1).map((event, index) => event.when - __rowStarts.slice(-5)[index].when));
  for (const interval of intervals) expect(Math.abs(interval - 1 / 8)).toBeLessThan(1e-10);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stageReadout")).not.toHaveText(generation);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
