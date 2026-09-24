import { expect, test } from "@playwright/test";
import { observeAutomataState } from "./helpers/automatapoeia-probe.mjs";
import { sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const layouts = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
for (const prefix of ["", "/dist-wax"]) for (const viewport of layouts) test.describe(`${prefix || "source"} ${viewport.width}x${viewport.height}`, () => {
  test.use({ viewport, hasTouch: viewport.width < 900 });
  test("black until Play, audible seed at the bottom, then upward-scrolling rows", async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await observeAutomataState(page);
    await page.addInitScript(() => {
      globalThis.__caDraws = [];
      globalThis.__seedSources = [];
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (this.canvas.id === "stage" && args.length === 9) {
          const [, , , columns, rows, x, y, width, height] = args;
          // Drawing coordinates use the existing rounded backing-store size,
          // not the fractional CSS height (e.g. 337 versus 337.09375 px).
          __caDraws.push({ columns, rows, x, y, width, height, canvasHeight: this.canvas.height / this.getTransform().d });
        }
        return draw.apply(this, args);
      };
      const create = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function (...args) {
        const node = create.apply(this, args), start = node.start.bind(node);
        node.start = (when, ...rest) => {
          const data = node.buffer.getChannelData(0);
          let peak = 0;
          for (const sample of data) peak = Math.max(peak, Math.abs(sample));
          __seedSources.push({ when, submitted: this.currentTime, peak });
          return start(when, ...rest);
        };
        return node;
      };
    });
    await page.goto(`${prefix}/automatapoeia.html`);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => __caSnapshot().rows)).toEqual([]);
    expect(await page.evaluate(() => {
      const canvas = document.querySelector("#stage");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.every((value, i) => value === [5, 6, 8, 255][i % 4]);
    })).toBe(true);
    expect(await page.evaluate(() => __caDraws.length)).toBe(0);
    await page.locator("#caRate").evaluate(control => { control.value = "1"; control.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#audioButton").click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => __caSnapshot().rows)).toEqual([]);
    expect(await page.evaluate(() => __seedSources.length)).toBe(0);
    const queued = await page.evaluate(() => {
      const now = __caSnapshot().contextTime;
      document.getElementById("playButton").click();
      return { now, state: __caSnapshot(), sources: __seedSources };
    });
    expect(queued.state.rows).toEqual([]);
    expect(queued.state.next.view.caGeneration).toBe(0);
    expect(queued.state.next.view.caRows).toEqual([queued.state.initial]);
    expect(queued.sources).toHaveLength(1);
    expect(queued.sources[0].when).toBe(queued.state.next.time);
    expect(queued.sources[0].when - queued.now).toBeGreaterThan(0);
    expect(queued.sources[0].when - queued.now).toBeLessThan(0.15);
    expect(queued.sources[0].peak).toBeGreaterThan(0.0001);
    await expect.poll(() => page.evaluate(() => __caDraws.at(-1)?.rows)).toBe(1);
    const first = await page.evaluate(() => __caDraws.at(-1));
    expect(first.height).toBeCloseTo(first.width / first.columns, 4);
    expect(first.y + first.height).toBeCloseTo(first.canvasHeight, 4);
    expect(first.y).toBeGreaterThan(0);
    await testInfo.attach("seed-at-bottom.png", { body: await page.screenshot(), contentType: "image/png" });
    const envelope = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 25, moduleUrl: `${prefix}/src/audio-output-manager.js` });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxPeak).toBeGreaterThan(0.00001);
    await expect.poll(() => page.evaluate(() => __caDraws.at(-1)?.rows)).toBe(2);
    const second = await page.evaluate(() => __caDraws.at(-1));
    expect(second.y).toBeCloseTo(first.y - first.height, 4);
    expect(second.y + second.height).toBeCloseTo(second.canvasHeight, 4);
    const rows = await page.evaluate(() => __caSnapshot().rows);
    expect(rows[0]).toEqual(queued.state.initial);
    expect(rows).toHaveLength(2);
    await page.locator("#playButton").click();
    await page.locator("#seedAutomata").click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => __caSnapshot().rows)).toEqual([]);
    await page.locator("#playButton").click();
    await expect.poll(() => page.evaluate(() => __caSnapshot().rows.length)).toBe(1);
    await page.locator("#playButton").click();
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
});
