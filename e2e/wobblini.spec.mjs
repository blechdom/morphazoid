import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { collectControlInventory, exerciseRangeMathematics } from "./helpers/control-inventory.mjs";

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

async function ready(page, { view = "full" } = {}) {
  await page.goto("/wobblini.html");
  await expect(page.locator(".wb-deck")).toHaveCount(8);
  await expect(page.locator("#audioButton")).toBeEnabled();
  await expect(page.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", "wobblini");
  if (view === "full") await page.locator("#fullView").click();
  else await expect(page.locator(".wb-shell")).toHaveClass(/is-records/);
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
  await expect.poll(async () => (await state(page)).decks[deck].name).toBe(`QA tone ${deck + 1}.wav`);
  await expect(page.locator(`#d${deck}Platter`)).toHaveAttribute("title", `QA tone ${deck + 1}.wav`);
}

async function ring(page, deck = 0) {
  const platter = page.locator(`#d${deck}Platter`);
  await platter.scrollIntoViewIfNeeded();
  const box = await platter.boundingBox();
  const point = (angle) => ({ x: box.x + box.width * (0.5 + Math.cos(angle) * 0.37), y: box.y + box.height * (0.5 + Math.sin(angle) * 0.37) });
  return { platter, point };
}

test("records open as eight isolated circular decks with compact named icons and no implicit Audio", async ({ page }) => {
  const errors = diagnostics(page);
  await ready(page, { view: "records" });
  await expect(page.locator(".wb-mixer")).toBeHidden();
  for (let i = 0; i < 8; i++) {
    const platter = page.locator(`#d${i}Platter`);
    await expect(platter).toBeVisible();
    const box = await platter.boundingBox();
    expect(Math.abs(box.width - box.height), `Deck ${i + 1} is circular`).toBeLessThan(2);
    await expect(page.locator(`#d${i}Play`)).toBeVisible();
    for (const control of ["Gain", "Loop", "Assign", "Rate", "Seek"]) await expect(page.locator(`#d${i}${control}`)).toBeHidden();
  }
  for (const view of ["records", "full", "records"]) {
    await page.locator(`#${view}View`).click();
    const buttons = page.locator(".wb-shell button:visible");
    for (const button of await buttons.all()) {
      await expect(button).toHaveAccessibleName(/\S/);
      expect((await button.innerText()).trim(), "instrument buttons display icons, with words retained in their accessible names").not.toMatch(/[a-z]{2,}/i);
    }
  }
  const { point } = await ring(page);
  const start = point(0); await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { const p = point(i * Math.PI / 8); await page.mouse.move(p.x, p.y); }
  await page.mouse.up();
  const scratched = (await state(page)).decks[0];
  expect(scratched.position).toBeGreaterThan(0.5);
  expect(scratched.scratching).toBe(false); expect(scratched.playing).toBe(false);
  expect((await state(page)).armed).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#d0Platter").focus();
  const before = (await state(page)).decks[0].position;
  await page.keyboard.press("ArrowRight");
  expect((await state(page)).decks[0].position).toBeGreaterThan(before);
  await page.keyboard.press("ArrowLeft");
  expect((await state(page)).decks[0].position).toBeCloseTo(before, 2);
  expect((await state(page)).armed).toBe(false);
  expect(errors).toEqual([]);
});

test("records retain compact master controls and paint source waveforms with live progress", async ({ page }) => {
  const errors = diagnostics(page);
  await ready(page, { view: "records" });
  await expect(page.locator("#playButton")).toBeVisible();
  await expect(page.locator("#stopButton")).toBeVisible();
  await expect(page.locator("#master-bpm")).toBeVisible();
  await expect(page.locator("#recordCrossfader")).toBeVisible();
  for (let i = 0; i < 8; i++) {
    const canvas = page.locator(`#d${i}RecordWave`);
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("aria-hidden", "true");
    await expect.poll(() => canvas.evaluate((node) => {
      const pixels = node.getContext("2d").getImageData(0, 0, node.width, node.height).data;
      let painted = 0;
      for (let j = 3; j < pixels.length; j += 4) if (pixels[j] > 0) painted++;
      return painted;
    })).toBeGreaterThan(100);
  }
  const wave = page.locator("#d0RecordWave");
  const demoImage = await wave.evaluate((canvas) => canvas.toDataURL());
  await loadTone(page);
  await expect.poll(() => wave.evaluate((canvas) => canvas.toDataURL())).not.toBe(demoImage);
  await slider(page, "#recordCrossfader", 0.65);
  expect((await state(page)).master.crossfader).toBeCloseTo(0.65, 2);
  await expect(page.locator("#crossfader")).toHaveValue("0.65");
  await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).decks.filter((deck) => deck.playing).length).toBe(8);
  const runningImage = await wave.evaluate((canvas) => canvas.toDataURL());
  await expect.poll(() => wave.evaluate((canvas) => canvas.toDataURL())).not.toBe(runningImage);
  await expect.poll(async () => (await state(page)).decks[0].position).toBeGreaterThan(0.1);
  expect((await state(page)).armed).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#stopButton").click();
  const stopped = await state(page);
  expect(stopped.decks.some((deck) => deck.playing)).toBe(false);
  expect(stopped.decks.every((deck) => deck.position === 0)).toBe(true);
  expect(stopped.armed).toBe(false);
  expect(errors).toEqual([]);
});

test("vinyl pointer rotation produces forward and backward scratch audio and restores prior playback on release", async ({ page }) => {
  const errors = diagnostics(page);
  await ready(page); await loadTone(page);
  await slider(page, "#d0Seek", 2);
  await page.locator("#recordsView").click();
  await arm(page);
  await expect.poll(async () => (await state(page)).scratchReady).toBe(true);
  const { platter, point } = await ring(page);
  await platter.evaluate(async (node, url) => {
    const { engine } = await import(url);
    node.scratchVelocities = [];
    // Inspect at delivery time: held scratch velocity intentionally decays to zero
    // after 100 ms, so a later browser round trip cannot prove gesture direction.
    node.addEventListener("pointermove", () => {
      const deck = engine.getDeckState(0);
      if (deck.scratching) node.scratchVelocities.push(deck.scratchVelocity);
    });
  }, APP);
  const start = point(0); await page.mouse.move(start.x, start.y); await page.mouse.down();
  await expect.poll(async () => (await state(page)).decks[0].scratching).toBe(true);
  let peak = 0;
  for (let i = 1; i <= 8; i++) {
    const p = point(i * Math.PI / 8); await page.mouse.move(p.x, p.y); await page.waitForTimeout(45);
    peak = Math.max(peak, (await readAudioStatus(page)).rms);
  }
  const forward = (await state(page)).decks[0];
  expect(forward.position).toBeGreaterThan(2.5);
  expect(await platter.evaluate((node) => node.scratchVelocities.some((velocity) => velocity > 0))).toBe(true);
  await platter.evaluate((node) => { node.scratchVelocities = []; });
  expect(peak).toBeGreaterThan(0.0001);
  peak = 0;
  for (let i = 7; i >= 0; i--) {
    const p = point(i * Math.PI / 8); await page.mouse.move(p.x, p.y); await page.waitForTimeout(45);
    peak = Math.max(peak, (await readAudioStatus(page)).rms);
  }
  const backward = (await state(page)).decks[0];
  expect(backward.position).toBeLessThan(forward.position - 0.5);
  expect(await platter.evaluate((node) => node.scratchVelocities.some((velocity) => velocity < 0))).toBe(true);
  expect(peak).toBeGreaterThan(0.0001);
  await page.mouse.up();
  expect((await state(page)).decks[0].scratching).toBe(false);
  expect((await state(page)).decks[0].playing).toBe(false);
  await silent(page);
  await page.locator("#d0Play").click();
  await audible(page, 200);
  const next = point(0); await page.mouse.move(next.x, next.y); await page.mouse.down();
  const drag = point(-Math.PI / 3); await page.mouse.move(drag.x, drag.y, { steps: 5 });
  await platter.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  expect((await state(page)).decks[0].scratching).toBe(false);
  expect((await state(page)).decks[0].playing).toBe(true);
  await audible(page, 250);
  expect(errors).toEqual([]);
});

test("two real touch contacts retain separate platter ownership and release on cancellation or master Stop", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const errors = diagnostics(page);
    await ready(page, { view: "records" });
    const first = await ring(page, 0), second = await ring(page, 1);
    for (const { platter } of [first, second]) await platter.evaluate((node) => {
      node.addEventListener("pointerdown", (event) => { node.dataset.testPointer = String(event.pointerId); });
    });
    const session = await context.newCDPSession(page);
    const contact = (ring, angle, id) => ({ ...ring.point(angle), id });
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact(first, 0, 1)] });
    await expect.poll(async () => (await state(page)).decks[0].scratching).toBe(true);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact(first, 0, 1), contact(second, 0, 2)] });
    expect((await state(page)).decks.slice(0, 2).map((deck) => deck.scratching)).toEqual([true, true]);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [contact(first, Math.PI / 2, 1), contact(second, -Math.PI / 2, 2)] });
    const moved = await state(page);
    expect(moved.decks[0].position).toBeCloseTo(0.45, 1);
    expect(moved.decks[1].position).toBeCloseTo(moved.decks[1].duration - 0.45, 1);
    expect(moved.decks.slice(0, 2).map((deck) => deck.scratching)).toEqual([true, true]);
    for (const { platter } of [first, second]) expect(await platter.evaluate((node) => node.hasPointerCapture(Number(node.dataset.testPointer)))).toBe(true);
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    expect((await state(page)).decks.some((deck) => deck.scratching)).toBe(false);
    for (const { platter } of [first, second]) expect(await platter.evaluate((node) => node.hasPointerCapture(Number(node.dataset.testPointer)))).toBe(false);
    expect((await state(page)).armed).toBe(false);
    expect((await state(page)).decks.some((deck) => deck.playing)).toBe(false);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.locator("#playButton").click();
    await arm(page);
    await audible(page, 200);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [contact(first, 0, 1), contact(second, 0, 2)] });
    expect((await state(page)).decks.slice(0, 2).map((deck) => deck.scratching)).toEqual([true, true]);
    // Activate the same master button with the keyboard while both physical
    // touch contacts remain down; moving focus must not itself release them.
    await page.locator("#stopButton").focus();
    expect((await state(page)).decks.slice(0, 2).map((deck) => deck.scratching)).toEqual([true, true]);
    await page.keyboard.press("Enter");
    const stopped = await state(page);
    expect(stopped.decks.every((deck) => !deck.playing && !deck.scratching && deck.position === 0)).toBe(true);
    for (const { platter } of [first, second]) expect(await platter.evaluate((node) => node.hasPointerCapture(Number(node.dataset.testPointer)))).toBe(false);
    await silent(page);
    const visuals = () => page.locator(".wb-disc-needle").evaluateAll((nodes) => nodes.map((node) => node.style.getPropertyValue("--disc-angle")));
    const stoppedVisuals = await visuals();
    expect(stoppedVisuals.every((angle) => angle.endsWith("deg"))).toBe(true);
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [contact(first, Math.PI / 2, 1), contact(second, -Math.PI / 2, 2)] });
    await page.waitForTimeout(100);
    expect((await state(page)).decks.every((deck) => !deck.playing && !deck.scratching && deck.position === 0)).toBe(true);
    expect(await visuals()).toEqual(stoppedVisuals);
    await silent(page);
    expect((await state(page)).armed).toBe(true);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(errors).toEqual([]);
    await session.detach();
  } finally { await context.close(); }
});

test("a non-looping file reverses immediately after the hand reaches its end", async ({ page }) => {
  const errors = diagnostics(page);
  await ready(page); await loadTone(page);
  await page.locator("#d0Loop").selectOption("off");
  await slider(page, "#d0Seek", 7.8);
  await page.locator("#recordsView").click();
  const { point } = await ring(page);
  let p = point(0); await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (const angle of [Math.PI / 2, Math.PI]) { p = point(angle); await page.mouse.move(p.x, p.y); }
  expect((await state(page)).decks[0].position).toBeCloseTo(8, 2);
  p = point(Math.PI * 7 / 8); await page.mouse.move(p.x, p.y);
  const reversed = (await state(page)).decks[0];
  expect(reversed.position).toBeGreaterThan(7.8);
  expect(reversed.position).toBeLessThan(7.95);
  await page.mouse.up();
  expect((await state(page)).decks[0].scratching).toBe(false);
  expect((await state(page)).decks[0].playing).toBe(false);
  expect((await state(page)).armed).toBe(false);
  expect(errors).toEqual([]);
});

test("Wobblini exposes named controls and finite, reversible native ranges", async ({ page }, testInfo) => {
  await ready(page);
  const inventory = await collectControlInventory(page);
  const ranges = await exerciseRangeMathematics(page);
  await testInfo.attach("wobblini-controls.json", { body: JSON.stringify({ inventory, ranges }, null, 2), contentType: "application/json" });
  expect(inventory.duplicateIds).toEqual([]);
  expect(inventory.controls.filter(({ numericValid }) => !numericValid)).toEqual([]);
  expect(inventory.controls.filter(({ options }) => options && options.length === 0)).toEqual([]);
  expect(inventory.summary.unlabeledVisible).toBe(0);
  expect(ranges.filter(({ skipped, finite, bounded, restored }) => !skipped && (!finite || !bounded || !restored))).toEqual([]);
  expect((await state(page)).armed).toBe(false);
  expect((await state(page)).decks.some((deck) => deck.playing)).toBe(false);
});

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

test("an interrupted audio context reports Audio off and explicitly rejoins all eight current playheads", async ({ page }) => {
  await demos(page);
  await page.locator("#playButton").click(); await arm(page); await audible(page, 300);
  await page.evaluate(async (url) => (await import(url)).engine.context.suspend(), APP);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect((await state(page)).decks.every((deck) => deck.playing)).toBe(true);
  await silent(page);
  const clocked = () => page.evaluate(async (url) => ({ state: (await import(url)).engine.getState(), time: performance.now() / 1000 }), APP);
  const before = await clocked();
  await arm(page);
  const after = await clocked();
  after.state.decks.forEach((deck, index) => {
    const previous = before.state.decks[index];
    const travel = (deck.position - previous.position + deck.duration) % deck.duration;
    const expected = ((after.time - before.time) * deck.rate) % deck.duration;
    expect(deck.playing).toBe(true);
    expect(Math.abs(travel - expected), `Deck ${index + 1} rejoined its current phase`).toBeLessThan(0.12);
  });
  await expect(page.locator("#errorMessage")).toBeHidden();
  await audible(page, 400);
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
  await page.locator("#d0Edit").click();
  const sourceTap = page.locator('#d0Details .wb-source-tempo .mz-tap-tempo');
  await expect(sourceTap).toBeVisible();
  await sourceTap.evaluate((button) => {
    button.reset();
    const start = performance.now();
    button.tap(start); button.tap(start + 400); button.tap(start + 800);
  });
  expect((await state(page)).decks[0].bpm).toBe(150);
  expect((await state(page)).decks[0].rate).toBe(1);
  expect((await state(page)).decks[0].playing).toBe(false);
  expect((await state(page)).armed).toBe(false);
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

test("touch cancellation releases the wobble pad without arming Audio or accepting stale movement", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const errors = diagnostics(page);
    await ready(page);
    await page.locator("#tinyView").click();
    const pad = page.locator("#wobble-pad");
    await pad.scrollIntoViewIfNeeded();
    await pad.evaluate((node) => {
      node.addEventListener("pointerdown", (event) => { node.dataset.testPointer = String(event.pointerId); }, { once: true });
    });
    const box = await pad.boundingBox(), session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width * 0.2, y: box.y + box.height * 0.8 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * 0.8, y: box.y + box.height * 0.2 }] });
    await expect.poll(async () => (await state(page)).master.wobbleAmount).toBeGreaterThan(0.7);
    const before = (await state(page)).master;
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    expect(await pad.evaluate((node) => node.hasPointerCapture(Number(node.dataset.testPointer)))).toBe(false);
    await pad.evaluate((node) => node.dispatchEvent(new PointerEvent("pointermove", {
      pointerId: Number(node.dataset.testPointer), pointerType: "touch", bubbles: true, clientX: 0, clientY: 0,
    })));
    expect((await state(page)).master).toEqual(before);
    expect((await state(page)).armed).toBe(false);
    expect((await state(page)).decks.some((deck) => deck.playing)).toBe(false);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(errors).toEqual([]);
    await session.detach();
  } finally { await context.close(); }
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
      await page.locator("#recordsView").click();
      await expect(page.locator(".wb-shell")).toHaveClass(/is-records/);
      await expect(page.locator(".wb-mixer")).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (let id = 0; id < 8; id++) {
        const platter = page.locator(`#d${id}Platter`);
        await expect(platter).toBeVisible();
        const box = await platter.boundingBox();
        expect(Math.abs(box.width - box.height)).toBeLessThan(2);
      }
      await captureView("records");
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
