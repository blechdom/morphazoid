import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, "Run with playwright.wobblini-mobile.config.mjs for touch-capable phone projects.");
});

const APP = "/src/instruments/wobblini/wobblini-app.js";
const state = (page) => page.evaluate(async (url) => (await import(url)).engine.getState(), APP);

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}

async function unlockFiles(page) {
  if (await page.locator("#fileAccess").getAttribute("aria-pressed") !== "true") await page.locator("#fileAccess").tap();
}

async function openSettings(page, deck = 0) {
  const button = page.locator(`#d${deck}Edit`);
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  await button.tap({ position: { x: box.width * 0.7, y: box.height * 0.3 } });
  await expect(page.locator("#deckSettings")).toBeVisible();
  await expect(page.locator("#deckSettingsTitle")).toHaveText(`Deck ${deck + 1}`);
}

function diagnostics(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function ready(page) {
  await page.goto("/wobblini.html");
  await expect(page.locator(".wb-deck")).toHaveCount(8);
  await expect(page.locator("#audioButton")).toBeEnabled();
  await expect(page.locator(".wb-shell")).toHaveClass(/is-records/);
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((node, next) => {
    node.value = String(next);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function arm(page) {
  await page.locator("#audioButton").tap();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
}

async function audible(page) {
  const { summary } = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 30 });
  expect(summary.finite).toBe(true);
  expect(summary.maxRms).toBeGreaterThan(0.001);
  expect(summary.maxPeak).toBeLessThanOrEqual(1);
  expect(summary.clippedSamples).toBe(0);
}

async function silent(page) {
  await expect.poll(async () => (await readAudioStatus(page)).rms).toBeLessThan(0.0001);
}

function wave({ seconds = 8, sampleRate = 24000 } = {}) {
  const frames = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 997 / sampleRate) * 0.24 * 32767), 44 + i * 2);
  return buffer;
}

async function loadTone(page) {
  await unlockFiles(page);
  await page.locator("#d0File").setInputFiles({ name: "Mobile QA tone.wav", mimeType: "audio/wav", buffer: wave() });
  await expect.poll(async () => (await state(page)).decks[0].kind).toBe("file");
  await expect.poll(async () => (await state(page)).decks[0].loading).toBe(false);
}

test("small phone gears open usable track controls while records retain center play and touch scratching", async ({ page }, testInfo) => {
  const errors = diagnostics(page); await ready(page);
  const capabilities = await page.evaluate(() => ({
    userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight },
    coarse: matchMedia("(pointer: coarse)").matches, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    audioWorklet: typeof AudioWorkletNode === "function", dialog: typeof HTMLDialogElement.prototype.showModal === "function",
  }));
  await attachJSON(testInfo, "mobile-capabilities.json", capabilities);
  expect(capabilities.coarse).toBe(true); expect(capabilities.reducedMotion).toBe(true);
  // A rotated square has its widest bounds at 45 degrees, even when its
  // visible artwork is circular. Exercise that angle while transport is idle.
  const rotated = await page.locator(".wb-record-surface").evaluateAll((surfaces) => {
    const original = surfaces.map((node) => node.getAttribute("style"));
    try {
      for (const node of surfaces) {
        // The shared reduced-motion rule still leaves a tiny transition.
        node.style.setProperty("transition", "none", "important");
        node.style.setProperty("--record-angle", "45deg");
      }
      return {
        viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        cosines: surfaces.map((node) => new DOMMatrix(getComputedStyle(node).transform).a),
      };
    } finally {
      surfaces.forEach((node, i) => original[i] === null ? node.removeAttribute("style") : node.setAttribute("style", original[i]));
    }
  });
  expect(rotated.cosines).toHaveLength(8);
  for (const cosine of rotated.cosines) expect(cosine).toBeCloseTo(Math.SQRT1_2, 3);
  expect(rotated.scrollWidth, "rotating records must not widen the phone page").toBeLessThanOrEqual(rotated.viewportWidth);
  await expect(page.locator("#master-bpm")).toHaveAccessibleName("Master BPM");
  for (const selector of ["#audioButton", "#playButton"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
  }
  for (let i = 0; i < 8; i++) {
    const platter = page.locator(`#d${i}Platter`); await page.locator(`#deck${i}`).scrollIntoViewIfNeeded();
    const box = await platter.boundingBox(); expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    await expect(platter).toHaveAccessibleName(`Scratch deck ${i + 1}`);
    const geometry = await page.locator(`#deck${i}`).evaluate((tile) => {
      const disc = tile.querySelector(".wb-disc"), circle = disc.getBoundingClientRect();
      return {
        controls: ["Edit", "Play"].map((action) => {
          const button = document.getElementById(`d${tile.dataset.deck}${action}`), box = button.getBoundingClientRect();
          const x = action === "Edit" ? 0.7 : 0.5, y = action === "Edit" ? 0.3 : 0.5;
          return { action, width: box.width, height: box.height, hit: button.contains(document.elementFromPoint(box.left + box.width * x, box.top + box.height * y)) };
        }),
        circleHits: Array.from({ length: 8 }, (_, j) => {
          const angle = j / 8 * Math.PI * 2;
          return disc.contains(document.elementFromPoint(circle.left + circle.width * (0.5 + 0.49 * Math.cos(angle)), circle.top + circle.height * (0.5 + 0.49 * Math.sin(angle))));
        }),
      };
    });
    expect(geometry.circleHits, "gear does not steal the scratch circumference").toEqual(Array(8).fill(true));
    for (const control of geometry.controls) {
      expect(control.width, control.action).toBeGreaterThanOrEqual(48); expect(control.height, control.action).toBeGreaterThanOrEqual(48);
      expect(control.hit, `${control.action} owns its visible target`).toBe(true);
    }
    await expect(page.locator(`#deck${i} .wb-deck-number`)).toHaveText(String(i + 1));
    await expect(page.locator(`#d${i}Edit`)).toHaveAttribute("aria-haspopup", "dialog");
  }
  const platter = page.locator("#d0Platter"); await platter.scrollIntoViewIfNeeded();
  await platter.evaluate((node) => node.addEventListener("pointerdown", (event) => { node.dataset.testPointerType = event.pointerType; }, { once: true }));
  const touchBox = await platter.boundingBox();
  await platter.tap({ position: { x: touchBox.width * 0.85, y: touchBox.height * 0.5 } });
  await expect(platter).toBeFocused(); await expect(platter).toHaveAttribute("data-test-pointer-type", "touch");
  expect((await state(page)).decks.some((deck) => deck.scratching || deck.playing)).toBe(false);
  await openSettings(page);
  await expect(page.locator("#settingsLoad")).toBeDisabled(); await expect(page.locator("#settingsSync")).toBeDisabled();
  await expect(page.locator("#closeDeckSettings")).toBeFocused();
  const layout = await page.locator("#deckSettings").evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
  });
  expect(layout.x).toBeGreaterThanOrEqual(0); expect(layout.y).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.width); expect(layout.bottom).toBeLessThanOrEqual(layout.height);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  for (const id of ["settingsSpeed", "settingsVolume"]) {
    const box = await page.locator(`#${id}Knob`).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(88); expect(box.height).toBeGreaterThanOrEqual(88);
  }
  await page.screenshot({ path: testInfo.outputPath("phone-popup.png") });
  await page.keyboard.press("Escape"); await expect(page.locator("#deckSettings")).toBeHidden();
  await expect(page.locator("#d0Edit")).toBeFocused();
  await unlockFiles(page); await openSettings(page);
  const chooserEvent = page.waitForEvent("filechooser"); await page.locator("#settingsLoad").tap();
  await (await chooserEvent).setFiles({ name: "Phone popup.wav", mimeType: "audio/wav", buffer: wave() });
  await expect.poll(async () => (await state(page)).decks[0].kind).toBe("file");
  await setRange(page, "#settingsVolume", 0.4); await setRange(page, "#settingsSpeed", 1.2);
  expect((await state(page)).decks[0].gain).toBe(0.4); expect((await state(page)).decks[0].rate).toBe(1.2);
  await page.locator("#settingsSpeedReset").tap(); expect((await state(page)).decks[0].rate).toBe(1);
  await page.locator("#settingsLoopLength").selectOption("4"); await page.locator("#closeDeckSettings").tap();
  await expect(page.locator("#d0LoopLength")).toHaveText("4 beats");
  await expect(page.locator("#d0LoopIn")).toBeVisible(); await expect(page.locator("#d0LoopOut")).toBeVisible();
  await page.locator("#d0Play").tap(); await expect.poll(async () => (await state(page)).decks[0].position).toBeGreaterThan(0.1);
  await openSettings(page); await page.locator(".wb-settings-grid summary").tap(); await page.locator("#settingsCue").tap();
  expect((await state(page)).decks[0].playing).toBe(false); expect((await state(page)).decks[0].position).toBe(0);
  await page.locator("#closeDeckSettings").tap(); await openSettings(page, 1);
  await expect(page.locator("#settingsSync")).toBeEnabled(); await expect(page.locator("#deckSettings")).toHaveCount(1);
  const dialog = await page.locator("#deckSettings").boundingBox(); await page.touchscreen.tap(dialog.x - 5, dialog.y + 10);
  await expect(page.locator("#deckSettings")).toBeHidden();
  expect((await state(page)).armed).toBe(false); expect((await readAudioStatus(page)).connectionCount).toBe(0);
  for (const view of ["records", "tiny", "full"]) {
    await page.locator(`#${view}View`).tap();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`phone-${view}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("phone canvases cap resolution, reuse paused drawings, and skip offscreen decks", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.testCanvasPaints = {};
    const clearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (/^d[0-7]RecordWave$/.test(this.canvas.id)) window.testCanvasPaints[this.canvas.id] = (window.testCanvasPaints[this.canvas.id] || 0) + 1;
      return clearRect.apply(this, args);
    };
  });
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.testCanvasPaints.d0RecordWave || 0)).toBeGreaterThan(0);
  const profile = await state(page);
  expect(profile.resourceProfile).toBe("constrained");
  expect(profile.limits).toEqual({ fileBytes: 16 * 1024 * 1024, deckBytes: 16 * 1024 * 1024, bufferBytes: 64 * 1024 * 1024, decodeSampleRate: 32000 });
  const resolution = await page.locator("#d0RecordWave").evaluate((canvas) => ({ backing: canvas.width, css: canvas.clientWidth, dpr: devicePixelRatio }));
  expect(resolution.dpr).toBe(2);
  expect(Math.abs(resolution.backing - resolution.css)).toBeLessThanOrEqual(1);
  await page.waitForTimeout(250);
  const paused = await page.evaluate(() => ({ ...window.testCanvasPaints }));
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.testCanvasPaints)).toEqual(paused);
  await page.locator("#playButton").tap();
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => ({ ...window.testCanvasPaints }));
  const needle = await page.locator("#deck0 .wb-disc-needle").evaluate((node) => getComputedStyle(node).transform);
  const surface = await page.locator("#deck0 .wb-record-surface").evaluate((node) => node.style.getPropertyValue("--record-angle"));
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ ...window.testCanvasPaints }));
  expect(after.d0RecordWave).toBeGreaterThan(before.d0RecordWave);
  expect(after.d7RecordWave || 0).toBe(before.d7RecordWave || 0);
  expect(after.d0RecordWave - before.d0RecordWave).toBeLessThanOrEqual(28); // two clears per painted frame, 20 Hz budget
  expect(await page.locator("#deck0 .wb-disc-needle").evaluate((node) => getComputedStyle(node).transform)).toBe(needle);
  expect(await page.locator("#deck0 .wb-record-surface").evaluate((node) => node.style.getPropertyValue("--record-angle"))).toBe(surface);
  await page.locator("#d7Platter").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.testCanvasPaints.d7RecordWave || 0)).toBeGreaterThan(after.d7RecordWave || 0);
  expect((await state(page)).armed).toBe(false);
  await attachJSON(testInfo, "mobile-render-budget.json", { resolution, profile: profile.resourceProfile, limits: profile.limits, paused, before, after });
});

test("eight phone decks arm by tap and recover their phase after a suspended context", async ({ page }) => {
  const errors = diagnostics(page);
  await ready(page);
  await page.locator("#playButton").tap();
  expect((await state(page)).decks.filter((deck) => deck.playing)).toHaveLength(8);
  expect((await state(page)).armed).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await arm(page); await audible(page);
  await page.evaluate(async (url) => (await import(url)).engine.context.suspend(), APP);
  await expect.poll(() => page.evaluate(async (url) => {
    const { engine } = await import(url);
    return { contextState: engine.context.state, armed: engine.armed, requested: engine.requestedAudio,
      button: document.querySelector("#audioButton").getAttribute("aria-pressed"), hidden: document.hidden };
  }, APP)).toEqual({ contextState: "suspended", armed: false, requested: false, button: "false", hidden: false });
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  const before = await state(page);
  await page.waitForTimeout(120);
  await arm(page); await audible(page);
  const after = await state(page);
  expect(after.decks.every((deck) => deck.playing)).toBe(true);
  after.decks.forEach((deck, i) => expect((deck.position - before.decks[i].position + deck.duration) % deck.duration).toBeGreaterThan(0.1));
  await page.locator("#stopButton").tap(); await silent(page);
  expect((await state(page)).decks.every((deck) => !deck.playing && deck.position === 0)).toBe(true);
  expect(errors).toEqual([]);
});

test("phone WAV import, native tempo focus, and crossfade change real output", async ({ page }) => {
  const errors = diagnostics(page);
  await ready(page);
  await page.evaluate(() => {
    window.testDecodeCount = 0;
    const decode = OfflineAudioContext.prototype.decodeAudioData;
    OfflineAudioContext.prototype.decodeAudioData = function (...args) { window.testDecodeCount++; return decode.apply(this, args); };
  });
  await unlockFiles(page);
  await page.locator("#d0File").setInputFiles({ name: "Long mobile clip.wav", mimeType: "audio/wav", buffer: wave({ seconds: 132, sampleRate: 8000 }) });
  await expect(page.locator("#errorMessage")).toContainText("too long for the current import budget", { timeout: 15000 });
  expect((await state(page)).decks[0].kind).toBe("demo");
  expect((await state(page)).decks[0].duration).toBe(8);
  expect(await page.evaluate(() => window.testDecodeCount)).toBe(0);
  expect((await state(page)).armed).toBe(false);
  await loadTone(page);
  expect(await page.evaluate(() => window.testDecodeCount)).toBe(1);
  expect((await state(page)).armed).toBe(false);
  await page.locator("#master-bpm").tap();
  await expect(page.locator("#master-bpm")).toBeFocused();
  await page.locator("#master-bpm").fill("135");
  await page.locator("#master-bpm").press("Tab");
  await page.locator("#d0Play").tap();
  await arm(page); await audible(page);
  await setRange(page, "#recordCrossfader", 1);
  expect((await state(page)).master.crossfader).toBe(1);
  await silent(page);
  expect((await state(page)).decks[0].playing).toBe(true);
  await setRange(page, "#recordCrossfader", -1); await audible(page);
  await page.locator("#audioButton").tap();
  expect((await state(page)).decks[0].playing).toBe(true);
  await silent(page);
  expect(errors).toEqual([]);
});

test("phone platter pointer and keyboard scratching produce signed audio and release on cancellation", async ({ page }) => {
  const errors = diagnostics(page);
  await ready(page); await loadTone(page);
  await setRange(page, "#d0Seek", 2);
  await arm(page);
  await expect.poll(async () => (await state(page)).scratchReady).toBe(true);
  const platter = page.locator("#d0Platter");
  await platter.scrollIntoViewIfNeeded();
  const box = await platter.boundingBox();
  const point = (angle) => ({ x: box.x + box.width * (0.5 + Math.cos(angle) * 0.37), y: box.y + box.height * (0.5 + Math.sin(angle) * 0.37) });
  await platter.evaluate(async (node, url) => {
    const { engine } = await import(url);
    node.signedMoves = [];
    node.addEventListener("pointerdown", (event) => { node.dataset.testPointer = String(event.pointerId); });
    node.addEventListener("pointermove", () => { if (engine.getDeckState(0).scratching) node.signedMoves.push(engine.getDeckState(0).scratchVelocity); });
  }, APP);
  let p = point(0); await page.mouse.move(p.x, p.y); await page.mouse.down();
  let forwardRms = 0, reverseRms = 0;
  for (let i = 1; i <= 8; i++) {
    p = point(i * Math.PI / 8); await page.mouse.move(p.x, p.y); await page.waitForTimeout(35);
    forwardRms = Math.max(forwardRms, (await readAudioStatus(page)).rms);
  }
  const forward = (await state(page)).decks[0].position;
  for (let i = 7; i >= 0; i--) {
    p = point(i * Math.PI / 8); await page.mouse.move(p.x, p.y); await page.waitForTimeout(35);
    reverseRms = Math.max(reverseRms, (await readAudioStatus(page)).rms);
  }
  const moved = await platter.evaluate((node) => node.signedMoves);
  expect(moved.some((velocity) => velocity > 0)).toBe(true);
  expect(moved.some((velocity) => velocity < 0)).toBe(true);
  expect((await state(page)).decks[0].position).toBeLessThan(forward - 0.5);
  expect(forwardRms).toBeGreaterThan(0.0001); expect(reverseRms).toBeGreaterThan(0.0001);
  await platter.evaluate((node) => node.dispatchEvent(new PointerEvent("pointercancel", { pointerId: Number(node.dataset.testPointer), pointerType: "mouse", bubbles: true })));
  await page.mouse.up();
  expect((await state(page)).decks[0].scratching).toBe(false);
  expect(await platter.evaluate((node) => node.hasPointerCapture(Number(node.dataset.testPointer)))).toBe(false);
  await silent(page);
  const before = (await state(page)).decks[0].position;
  await platter.focus(); await page.keyboard.press("ArrowRight");
  expect((await state(page)).decks[0].position).toBeGreaterThan(before);
  await page.keyboard.press("ArrowLeft");
  expect((await state(page)).decks[0].position).toBeCloseTo(before, 2);
  expect((await state(page)).decks[0].playing).toBe(false);
  expect(errors).toEqual([]);
});
