import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

const APP = "/src/instruments/wobblini/wobblini-app.js";
const state = (page) => page.evaluate(async (url) => (await import(url)).engine.getState(), APP);

function diagnostics(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  return errors;
}

async function ready(page) {
  await page.goto("/wobblini.html");
  await expect(page.locator(".wb-deck")).toHaveCount(8);
  await expect(page.locator("#audioButton")).toBeEnabled();
  await expect(page.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", "wobblini");
}

async function demos(page) {
  await ready(page);
  await page.locator("#loadDemos").click();
  await expect.poll(async () => (await state(page)).decks.filter((deck) => deck.duration > 0 && !deck.loading).length).toBe(8);
}

async function slider(page, selector, value) {
  await page.locator(selector).evaluate((field, value) => {
    field.value = String(value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function arm(page) {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
}

async function audible(page, durationMs = 650) {
  const { summary } = await sampleAudioEnvelope(page, { durationMs, intervalMs: 35 });
  expect(summary.finite).toBe(true);
  expect(summary.maxRms).toBeGreaterThan(0.001);
  expect(summary.maxPeak).toBeLessThanOrEqual(1);
  expect(summary.clippedSamples).toBe(0);
  return summary;
}

async function silent(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeLessThan(0.0001);
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 180, intervalMs: 35 });
  expect(summary.maxRms).toBeLessThan(0.0001);
}

function wave({ seconds = 8, frequency = 997, level = 0.24 } = {}) {
  const sampleRate = 24000, frames = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * frequency / sampleRate) * level * 32767), 44 + i * 2);
  return buffer;
}

async function loadTone(page, deck = 0) {
  await page.locator(`#d${deck}File`).setInputFiles({ name: `QA tone ${deck + 1}.wav`, mimeType: "audio/wav", buffer: wave() });
  await expect.poll(async () => (await state(page)).decks[deck].kind).toBe("file");
  await expect.poll(async () => (await state(page)).decks[deck].loading).toBe(false);
  await expect(page.locator(`#deck${deck}`)).toContainText(`QA tone ${deck + 1}.wav`);
}

test("eight decks play silently until Audio is armed; Audio off and mixer reset preserve the running session", async ({ page }) => {
  const errors = diagnostics(page);
  await demos(page);
  expect((await state(page)).armed).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await expect(page.locator(".output-recording-button")).toBeVisible();
  await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).decks.every((deck) => deck.playing)).toBe(true);
  await expect.poll(async () => (await state(page)).decks[0].position).toBeGreaterThan(0.1);
  expect((await state(page)).armed).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await arm(page);
  await audible(page, 1000);
  await slider(page, "#crossfader", 0.3);
  await slider(page, "#d0Gain", 0.2);
  const before = await state(page);
  await page.locator("#resetMix").click();
  const after = await state(page);
  expect(after.decks.every((deck) => deck.playing)).toBe(true);
  expect(after.decks.map((deck) => [deck.name, deck.duration])).toEqual(before.decks.map((deck) => [deck.name, deck.duration]));
  expect(after.master.gain).toBe(before.master.gain);
  expect(after.master.crossfader).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await state(page)).decks.every((deck) => deck.playing)).toBe(true);
  await silent(page);
  await arm(page); await audible(page);
  await page.locator("#stopButton").click();
  expect((await state(page)).decks.every((deck) => !deck.playing && deck.position < 0.001)).toBe(true);
  await silent(page);
  expect(errors).toEqual([]);
});

test("a local WAV loads without Audio, and keyboard seek, cue, loop and tempo retain explicit transport ownership", async ({ page }) => {
  const errors = diagnostics(page);
  await demos(page); await loadTone(page);
  expect((await state(page)).armed).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect((await state(page)).decks[0].duration).toBeCloseTo(8, 2);
  await page.locator("#d0Seek").focus();
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
  expect((await state(page)).decks[0].position).toBeGreaterThan(0);
  await slider(page, "#d0Seek", 2);
  await page.locator("#d0SetCue").click();
  const cue = (await state(page)).decks[0].cuePoint;
  expect(cue).toBeCloseTo(2, 1);
  await page.locator("#d0Play").click();
  await expect.poll(async () => (await state(page)).decks[0].position).toBeGreaterThan(cue + 0.1);
  await page.locator("#d0Cue").click();
  const cued = (await state(page)).decks[0];
  expect(cued.playing).toBe(false); expect(cued.position).toBeCloseTo(cue, 3);
  await slider(page, "#d0Bpm", 120);
  await page.locator("#d0Loop").selectOption("4");
  const loop = (await state(page)).decks[0];
  expect(loop.loopEnabled).toBe(true); expect(loop.loopEnd - loop.loopStart).toBeCloseTo(2, 3);
  await slider(page, "#d0Rate", 1.5);
  expect((await state(page)).decks[0].rate).toBe(1.5);
  await page.locator("#d0Play").click(); await arm(page); await audible(page);
  const running = (await state(page)).decks[0];
  expect(running.position).toBeGreaterThanOrEqual(running.loopStart);
  expect(running.position).toBeLessThan(running.loopEnd);
  expect(running.effectiveBpm).toBeCloseTo(180, 2);
  expect(errors).toEqual([]);
});

test("crossfader assignment, mute, solo and level change actual sound without stopping a deck", async ({ page }) => {
  await demos(page); await loadTone(page);
  await page.locator("#d0Assign").selectOption("A");
  await page.locator("#d0Loop").selectOption("4");
  await slider(page, "#crossfader", -1);
  await page.locator("#d0Play").click(); await arm(page);
  const full = await audible(page);
  await slider(page, "#crossfader", 1); await silent(page);
  expect((await state(page)).decks[0].playing).toBe(true);
  await page.locator("#d0Assign").selectOption("THRU"); await audible(page);
  await page.locator("#d0Mute").click(); await silent(page);
  await page.locator("#d0Mute").click(); await audible(page);
  await page.locator("#d1Solo").click(); await silent(page);
  expect((await state(page)).decks[0].playing).toBe(true);
  await page.locator("#d1Solo").click();
  await slider(page, "#d0Gain", 0.1);
  const quiet = await sampleAudioEnvelope(page, { durationMs: 450 });
  expect(quiet.summary.meanRms).toBeLessThan(full.meanRms * 0.4);
  expect((await state(page)).decks[0].playing).toBe(true);
});

test("EQ, pan and the wobble pad have measurable audio consequences", async ({ page }) => {
  await demos(page); await loadTone(page);
  await page.locator("#d0Assign").selectOption("THRU");
  await page.locator("#d0Loop").selectOption("4");
  await page.locator("#d0Play").click(); await arm(page);
  const flat = await audible(page);
  for (const band of ["Low", "Mid", "High"]) await slider(page, `#d0${band}`, -24);
  const cut = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(cut.summary.meanRms).toBeLessThan(flat.meanRms * 0.5);
  for (const band of ["Low", "Mid", "High"]) await slider(page, `#d0${band}`, 0);
  await slider(page, "#d0Pan", -1);
  await expect.poll(async () => (await readAudioStatus(page)).rightPeak).toBeLessThan(0.0001);
  expect((await readAudioStatus(page)).leftPeak).toBeGreaterThan(0.001);
  await slider(page, "#d0Pan", 0);
  const pad = page.locator("#wobble-pad");
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.15, { steps: 6 });
  await page.mouse.up();
  expect((await state(page)).master.wobbleAmount).toBeGreaterThan(0.5);
  await slider(page, "#wobbleRate", 2);
  await slider(page, "#wobbleAmount", 1);
  const wobbling = await sampleAudioEnvelope(page, { durationMs: 1100, intervalMs: 35 });
  expect(wobbling.summary.finite).toBe(true);
  expect(wobbling.summary.maxPeak).toBeLessThanOrEqual(1);
  const values = wobbling.samples.map((sample) => sample.rms);
  expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(flat.meanRms * 0.1);
  expect((await state(page)).decks[0].playing).toBe(true);
});

test("failed file decode preserves a playable track and teardown releases the output", async ({ page }) => {
  await demos(page); await loadTone(page);
  const before = (await state(page)).decks[0];
  await page.locator("#d0File").setInputFiles({ name: "broken.wav", mimeType: "audio/wav", buffer: Buffer.from("not a wave") });
  await expect(page.getByRole("alert")).toBeVisible();
  const after = (await state(page)).decks[0];
  expect(after.name).toBe(before.name); expect(after.duration).toBe(before.duration);
  await page.locator("#d0Play").click(); await arm(page); await audible(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await silent(page);
});

test("the shared recorder downloads a nonempty stereo mix without changing deck transport", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(globalThis, "showSaveFilePicker", { configurable: true, value: undefined }));
  await demos(page);
  await expect(page.locator(".output-recording-button")).toBeDisabled();
  expect((await state(page)).armed).toBe(false);
  await page.locator("#playButton").click(); await arm(page);
  await page.locator(".output-recording-button").click();
  await expect(page.locator(".output-recording-button")).toHaveAccessibleName("Stop recording");
  await audible(page, 550);
  await page.locator(".output-recording-button").click();
  await expect(page.locator(".output-recording-dialog")).toBeVisible();
  expect((await state(page)).decks.every((deck) => deck.playing)).toBe(true);
  await page.locator(".output-recording-name").fill("wobblini-eight-deck-qa");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("wobblini-eight-deck-qa.wav");
  const bytes = await readFile(await download.path());
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
  let channels = 0, data = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ") channels = bytes.readUInt16LE(offset + 10);
    if (id === "data") data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + length % 2;
  }
  expect(channels).toBe(2);
  expect(data?.length).toBeGreaterThan(10000);
  expect(data.some((byte) => byte !== 0)).toBe(true);
  expect((await state(page)).armed).toBe(true);
});

test("tiny decks and the focused editor preserve all eight live playheads and mixer settings", async ({ page }) => {
  await demos(page);
  await slider(page, "#d7Gain", 0.43);
  await slider(page, "#crossfader", 0.2);
  await page.locator("#playButton").click(); await arm(page);
  await audible(page, 200);
  const clocked = () => page.evaluate(async (url) => {
    const { engine } = await import(url);
    return { state: engine.getState(), time: engine.context.currentTime };
  }, APP);
  const before = await clocked();
  await page.locator("#tinyView").click();
  await expect(page.locator(".wb-shell")).toHaveClass(/is-tiny/);
  await expect(page.locator(".wb-deck")).toHaveCount(8);
  await page.locator("#d7Edit").click();
  await expect(page.locator("#deck7")).toHaveClass(/is-selected/);
  await expect(page.locator("#d7Rate")).toBeVisible();
  await expect(page.locator("#d7Loop")).toBeVisible();
  await page.locator("#fullView").click();
  await expect(page.locator(".wb-shell")).not.toHaveClass(/is-tiny/);
  const after = await clocked();
  expect(after.state.armed).toBe(true);
  expect(after.state.master).toEqual(before.state.master);
  expect(after.state.decks[7].gain).toBe(0.43);
  after.state.decks.forEach((deck, index) => {
    const previous = before.state.decks[index];
    expect(deck.playing).toBe(true);
    expect([deck.name, deck.duration, deck.loopEnabled, deck.rate]).toEqual([previous.name, previous.duration, previous.loopEnabled, previous.rate]);
    const travel = (deck.position - previous.position + deck.duration) % deck.duration;
    const expected = ((after.time - before.time) * deck.rate) % deck.duration;
    expect(Math.abs(travel - expected), `Deck ${index + 1} retained its audio-clock phase`).toBeLessThan(0.1);
  });
  await audible(page, 250);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`all eight decks and recovery controls stay reachable at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
    const mobile = viewport.width !== 1440;
    const context = await browser.newContext({ baseURL, viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = diagnostics(page);
    try {
      await demos(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const selector of ["#audioButton", "#playButton", ...Array.from({ length: 8 }, (_, id) => `#d${id}Play`), "#resetMix"]) {
        const field = page.locator(selector);
        await field.scrollIntoViewIfNeeded();
        await expect(field).toBeVisible();
        const box = await field.boundingBox();
        expect(box.x, selector).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width + 1);
        expect(await field.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }), `${selector} is not occluded`).toBe(true);
        if (mobile && ["#audioButton", "#playButton"].includes(selector)) {
          expect(box.width, selector).toBeGreaterThanOrEqual(48);
          expect(box.height, selector).toBeGreaterThanOrEqual(48);
        }
      }
      await page.locator("#d7Play").click();
      expect((await state(page)).decks[7].playing).toBe(true);
      expect((await state(page)).armed).toBe(false);
      await page.locator("#stopButton").click();
      expect((await state(page)).decks.every((deck) => !deck.playing)).toBe(true);
      const captureView = async (view) => {
        await page.evaluate(() => scrollTo(0, 0));
        const path = testInfo.outputPath(`wobblini-${view}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path, fullPage: true });
        await testInfo.attach(`wobblini-${view}-${viewport.width}x${viewport.height}`, { path, contentType: "image/png" });
      };
      await captureView("full");
      await page.locator("#tinyView").click();
      await expect(page.locator(".wb-shell")).toHaveClass(/is-tiny/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await captureView("tiny");
      await page.locator("#d7Edit").click();
      await expect(page.locator("#d7Rate")).toBeVisible();
      await captureView("editor");
      // Check actual page requests before Axe's separate stylesheet XHR audit:
      // its nested relative @import fetches resolve against the document URL.
      expect(errors).toEqual([]);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(axe.violations).toEqual([]);
    } finally { await context.close(); }
  });
}
