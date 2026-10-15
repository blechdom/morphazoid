import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

const map = { white: 11, yellow: 7, green: 2, blue: 10, red: 0, orange: 14 };
const names = { white: "Glass Bell", yellow: "Closed Hat", green: "Snap Snare", blue: "Cowbell", red: "Sub Kick", orange: "Laser Zap" };
const snapshot = page => page.evaluate(async () => (await import("/src/instruments/rubix/rubix-app.js")).rubixPlaybackSnapshot());
async function preset(page) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator('.header-preset-picker [data-preset-id="color-kit"]').click();
}

for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
  test(`Color kit native legend and controls remain reachable at ${width}×${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/rubix.html");
    await page.evaluate(async () => (await import("/src/instruments/rubix/rubix-app.js")).rubixoidsNative.applySettings({ output: .17, drumLevel: .31, acidLevel: .22 }));
    const levels = (await snapshot(page)).levels;
    await preset(page);
    await expect(page.locator("#soundBank")).toHaveValue("color-kit");
    await expect(page.locator("#rubixSize")).toHaveValue("3");
    expect((await snapshot(page)).levels).toEqual(levels);
    expect((await snapshot(page)).events.every(event => event.value === map[event.color])).toBe(true);
    const key = page.locator("#colorKey");
    await key.scrollIntoViewIfNeeded(); await expect(key).toBeInViewport();
    await expect(key.locator("span")).toHaveCount(6);
    for (const [color, index] of Object.entries(map)) {
      const item = key.locator(`[data-color="${color}"]`);
      await expect(item).toHaveAttribute("data-voice-index", String(index));
      await expect(item).toHaveText(`${color} · ${names[color]}`);
      expect(await item.evaluate(node => node.scrollWidth > node.clientWidth + 1)).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.locator("#bank-pan").scrollIntoViewIfNeeded(); await expect(page.locator("#bank-pan")).toBeInViewport();
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.screenshot({ path: info.outputPath("color-kit-controls.png") });
    await page.locator("#soundBank").selectOption("soft-fm"); await expect(key).toBeHidden();
    await page.locator("#soundBank").selectOption("color-kit"); await expect(key).toBeVisible();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });
}

test("Color kit prepares six distinct bounded native sounds and retains their identities through live turns and bank edits", async ({ page }, info) => {
  test.setTimeout(90000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/rubix.html"); await preset(page);
  await page.evaluate(async () => {
    const { RubixAudioEngine } = await import("/src/instruments/rubix/rubix-app.js");
    const probe = window.__colorKitProbe = { notes: [] };
    const build = RubixAudioEngine.prototype.buildGraph;
    RubixAudioEngine.prototype.buildGraph = function (...args) { probe.engine = this; return build.apply(this, args); };
    const schedule = RubixAudioEngine.prototype.scheduleDrum;
    RubixAudioEngine.prototype.scheduleDrum = function (index, when, gain, bank, sticker) {
      probe.notes.push({ index, when, bank, color: sticker.color, id: sticker.id, prepared: Boolean(this.kitBuffers.get(bank)?.[index]) });
      return schedule.apply(this, arguments);
    };
  });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const kit = await page.evaluate(() => {
    const buffers = window.__colorKitProbe.engine.kitBuffers.get("color-kit");
    const entries = buffers.flatMap((buffer, index) => {
      if (!buffer) return [];
      const pcm = buffer.getChannelData(0);
      let peak = 0, energy = 0, finite = true;
      const frames = Math.min(pcm.length, Math.round(buffer.sampleRate * .12));
      for (let i = 0; i < pcm.length; i++) {
        finite &&= Number.isFinite(pcm[i]); peak = Math.max(peak, Math.abs(pcm[i]));
        if (i < frames) energy += pcm[i] ** 2;
      }
      return [{ index, duration: buffer.duration, peak, rms: Math.sqrt(energy / frames), finite }];
    });
    const correlations = [];
    for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) {
      const x = buffers[entries[a].index].getChannelData(0), y = buffers[entries[b].index].getChannelData(0);
      let dot = 0, xx = 0, yy = 0;
      for (let i = 0; i < Math.min(x.length, y.length); i++) { dot += x[i] * y[i]; xx += x[i] ** 2; yy += y[i] ** 2; }
      correlations.push(Math.abs(dot / Math.sqrt(xx * yy)));
    }
    return { entries, correlations };
  });
  expect(kit.entries.map(entry => entry.index).sort((a, b) => a - b)).toEqual(Object.values(map).sort((a, b) => a - b));
  for (const entry of kit.entries) {
    expect(entry.finite).toBe(true); expect(entry.rms).toBeGreaterThan(.02);
    expect(entry.peak).toBeLessThanOrEqual(.651); expect(entry.duration).toBeLessThan(.6);
  }
  expect(Math.max(...kit.correlations)).toBeLessThan(.85);
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  const levels = (await snapshot(page)).levels;
  await page.waitForTimeout(1400);
  const before = await snapshot(page);
  await page.locator("#stage").press("ArrowRight");
  await expect.poll(async () => (await snapshot(page)).scoreIds).not.toEqual(before.scoreIds);
  await page.locator("#bank-fmDepth").evaluate(input => { input.value = "1.2"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(1000);
  const after = await snapshot(page);
  expect(after.playing).toBe(true); expect(after.levels).toEqual(levels);
  expect(after.events.every(event => event.value === map[event.color])).toBe(true);
  const notes = await page.evaluate(() => window.__colorKitProbe.notes);
  expect(new Set(notes.map(note => note.color)).size).toBe(6);
  expect(notes.every(note => note.prepared && note.index === map[note.color])).toBe(true);
  const starts = [...new Set(notes.map(note => note.when))].sort((a, b) => a - b);
  expect(Math.max(...starts.slice(1).map((time, index) => time - starts[index]))).toBeLessThan(.2);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 650 });
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.clippedSamples).toBe(0); expect(envelope.summary.maxPeak).toBeGreaterThan(.005);
  await page.locator("#soundBank").selectOption("soft-fm"); await expect(page.locator("#colorKey")).toBeHidden();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#soundBank").selectOption("color-kit");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect((await snapshot(page)).levels).toEqual(levels);
  await page.locator("#playButton").click(); await page.locator("#audioButton").click();
  expect((await readAudioStatus(page)).connectionCount).toBe(0); expect(errors).toEqual([]);
  await info.attach("color-kit-audio.json", { body: JSON.stringify({ kit, notes, envelope: envelope.summary }), contentType: "application/json" });
});
