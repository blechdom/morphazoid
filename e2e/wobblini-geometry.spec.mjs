import { test, expect } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

const APP = "/src/instruments/wobblini/wobblini-app.js";
const state = page => page.evaluate(async url => (await import(url)).engine.getState(), APP);
const mix = async page => (await state(page)).decks.map(({ id, pan, gain }) => ({ id, pan, gain }));
const closeButton = "#geometryDialog [data-geometry-close]";
const settings = snapshot => snapshot.decks.map(({ id, name, kind, duration, playing, rate, bpm, cuePoint, loopEnabled, loopStart, loopEnd, syncEnabled }) => ({ id, name, kind, duration, playing, rate, bpm, cuePoint, loopEnabled, loopStart, loopEnd, syncEnabled }));

async function ready(page) {
  await page.goto("/wobblini.html");
  await expect(page.locator(".wb-deck")).toHaveCount(8);
  await expect(page.locator("#audioButton")).toBeEnabled();
  await expect(page.locator("#geometryOpen")).toBeHidden();
  await page.locator("#tinyView").click();
}
async function open(page) {
  await page.locator("#geometryOpen").click();
  await expect(page.locator("#geometryDialog")).toBeVisible();
  await expect(page.locator("#geometryDialog #geometryControls")).toHaveCount(1);
  await expect(page.locator(closeButton)).toBeFocused();
}
async function range(page, selector, value) {
  await page.locator(selector).evaluate((node, value) => {
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, String(value));
}
async function undo(page, expected) {
  await expect(page.locator("#geometryUndo")).toBeEnabled();
  await page.waitForTimeout(250); // periodic app rendering must not clear the gesture snapshot
  await page.locator("#geometryUndo").click();
  await expect.poll(() => mix(page)).toEqual(expected);
  await expect(page.locator("#geometryUndo")).toBeDisabled();
}
async function drag(page, locator, dx, dy) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}
function stereoWave() {
  const sampleRate = 24000, frames = sampleRate * 8, bytes = Buffer.alloc(44 + frames * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) for (const [channel, frequency] of [421, 733].entries()) {
    bytes.writeInt16LE(Math.round(Math.sin(frame * Math.PI * 2 * frequency / sampleRate) * .18 * 32767), 44 + frame * 4 + channel * 2);
  }
  return { name: "Stereo geometry.wav", mimeType: "audio/wav", buffer: bytes };
}

test("opening and selecting the geometric mixer preserves the mix; native keys edit only the selected track", async ({ page }) => {
  await ready(page);
  const before = await state(page), initial = await mix(page);
  for (const view of ["full", "tiny"]) {
    await page.locator(`#${view}View`).click(); await open(page);
    expect(await mix(page)).toEqual(initial);
    await page.locator("#geometryTrack").selectOption({ value: "7" });
    expect(await mix(page)).toEqual(initial);
    await page.keyboard.press("Escape");
    await expect(page.locator("#geometryDialog")).toBeHidden();
    await expect(page.locator("#geometryOpen")).toBeFocused();
    await expect(page.locator("#geometryMixer #geometryControls")).toHaveCount(1);
  }
  await open(page); await page.locator("#geometryTrack").selectOption({ value: "7" });
  await page.locator("#geometryPan").focus(); await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await mix(page))[7].pan).toBeCloseTo(.01, 5);
  await page.locator("#geometryVolume").focus(); await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await mix(page))[7].gain).toBeCloseTo(.69, 5);
  expect((await mix(page)).slice(0, 7)).toEqual(initial.slice(0, 7));
  await page.locator("#geometryPoint7").focus(); await page.keyboard.press("ArrowUp");
  await expect.poll(async () => (await mix(page))[7].gain).toBeCloseTo(.715, 5);
  await page.keyboard.press("Shift+ArrowLeft");
  await expect.poll(async () => (await mix(page))[7].pan).toBeCloseTo(0, 5);
  await page.locator(closeButton).click();
  expect(settings(await state(page))).toEqual(settings(before));
  expect((await state(page)).armed).toBe(false); expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("shape gestures and native transforms have stable undo and preserve transport settings", async ({ page }) => {
  await ready(page); await open(page);
  const before = await state(page), initial = await mix(page);
  await page.locator("#geometryArrange").click();
  const arranged = await mix(page);
  expect(new Set(arranged.map(deck => deck.pan.toFixed(3))).size).toBeGreaterThan(3);
  expect(new Set(arranged.map(deck => deck.gain.toFixed(3))).size).toBeGreaterThan(3);
  await undo(page, initial);
  await page.locator("#geometryArrange").click();
  await drag(page, page.locator("#geometryPoint2"), -25, -18);
  const moved = await mix(page);
  expect(moved[2].pan).toBeLessThan(arranged[2].pan); expect(moved[2].gain).toBeGreaterThan(arranged[2].gain);
  expect(moved.filter(deck => deck.id !== 2)).toEqual(arranged.filter(deck => deck.id !== 2));
  await undo(page, arranged);
  await page.locator("#geometryCenter").click();
  expect((await mix(page)).every(deck => deck.pan === 0)).toBe(true);
  expect((await mix(page)).map(deck => deck.gain)).toEqual(arranged.map(deck => deck.gain));
  await undo(page, arranged);
  for (const [mode, dx, dy] of [["Rotate", 35, 25], ["Stretch", 30, -25]]) {
    await page.locator(`#geometry${mode}`).click();
    await drag(page, page.locator("#geometryPoint2"), dx, dy);
    const transformed = await mix(page);
    expect(transformed).not.toEqual(arranged);
    expect(transformed.every(deck => Number.isFinite(deck.pan) && deck.pan >= -1 && deck.pan <= 1 && deck.gain >= 0 && deck.gain <= 1)).toBe(true);
    await undo(page, arranged);
  }
  await page.locator("#geometryMove").click();
  await page.locator("#geometryStage").scrollIntoViewIfNeeded();
  const stage = await page.locator("#geometryStage").boundingBox();
  await page.mouse.move(stage.x + 6, stage.y + 6); await page.mouse.down();
  await page.mouse.move(stage.x + 21, stage.y + 21, { steps: 6 }); await page.mouse.up();
  const shifted = await mix(page);
  expect(shifted.every((deck, i) => deck.pan > arranged[i].pan && deck.gain < arranged[i].gain)).toBe(true);
  await undo(page, arranged);
  await page.locator(".wb-geometry-keyboard summary").click();
  for (const [id, value] of [["geometryTurn", 45], ["geometryWidth", 2], ["geometryHeight", .5]]) {
    await range(page, `#${id}`, value); expect(await mix(page)).not.toEqual(arranged);
    await undo(page, arranged);
  }
  expect(settings(await state(page))).toEqual(settings(before)); expect((await state(page)).armed).toBe(false);
});

test("geometric pan and volume change genuine stereo output while eight synced decks keep their phase", async ({ page }) => {
  await ready(page); await page.locator("#fileAccess").click();
  await page.locator("#d0File").setInputFiles(stereoWave());
  await expect.poll(async () => (await state(page)).decks[0].kind).toBe("file");
  await page.locator("#fullView").click();
  await page.locator("#d0Loop").selectOption("4"); await page.locator("#d0Assign").selectOption("THRU");
  await page.locator("#d0Solo").click(); await page.locator("#playButton").click(); await page.locator("#syncAll").click();
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await state(page)).decks.slice(1).every(deck => deck.syncActive)).toBe(true);
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  await open(page); await page.locator("#geometryTrack").selectOption({ value: "0" });
  await expect.poll(async () => (await readAudioStatus(page)).leftPeak).toBeGreaterThan(.001);
  await expect.poll(async () => (await readAudioStatus(page)).rightPeak).toBeGreaterThan(.001);
  const loud = (await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 30 })).summary;
  await range(page, "#geometryVolume", .175); await page.waitForTimeout(120);
  const quiet = (await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 30 })).summary;
  expect(quiet.meanRms / loud.meanRms).toBeGreaterThan(.15); expect(quiet.meanRms / loud.meanRms).toBeLessThan(.35);
  await range(page, "#geometryPan", -1);
  await expect.poll(async () => (await readAudioStatus(page)).rightPeak).toBeLessThan(.0001);
  expect((await readAudioStatus(page)).leftPeak).toBeGreaterThan(.001);
  await range(page, "#geometryPan", 1);
  await expect.poll(async () => (await readAudioStatus(page)).leftPeak).toBeLessThan(.0001);
  expect((await readAudioStatus(page)).rightPeak).toBeGreaterThan(.001);
  const snapshot = () => page.evaluate(async url => { const { engine } = await import(url); return { clock: engine.context.currentTime, state: engine.getState() }; }, APP);
  const before = await snapshot();
  await page.locator("#geometryArrange").click(); await page.locator(".wb-geometry-keyboard summary").click();
  await range(page, "#geometryTurn", 30); await range(page, "#geometryWidth", 1.3);
  await page.locator(closeButton).click(); await page.locator("#tinyView").click();
  const after = await snapshot(), elapsed = after.clock - before.clock;
  expect(settings(after.state)).toEqual(settings(before.state)); expect(after.state.armed).toBe(true);
  for (let i = 0; i < 8; i++) {
    const deck = after.state.decks[i], old = before.state.decks[i], length = deck.loopEnd - deck.loopStart;
    const expected = deck.loopStart + ((old.position - deck.loopStart + elapsed * deck.rate) % length + length) % length;
    const error = Math.abs(deck.position - expected); expect(Math.min(error, length - error)).toBeLessThan(.04);
    if (i) { expect(deck.syncActive).toBe(true); const delta = Math.abs(deck.beatPhase - after.state.decks[0].beatPhase); expect(Math.min(delta, 1 - delta)).toBeLessThan(.025); }
  }
  const result = (await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 30 })).summary;
  expect(result.finite).toBe(true); expect(result.maxPeak).toBeLessThanOrEqual(1); expect(result.clippedSamples).toBe(0);
});

test("boundary gestures undo their first real edit and concurrent deck changes cancel stale shape writes", async ({ page }) => {
  await ready(page); await open(page); await page.locator("#geometryArrange").click();
  await page.locator("#geometryTrack").selectOption({ value: "0" });
  await range(page, "#geometryPan", 1); const boundary = await mix(page);
  const point = page.locator("#geometryPoint0"); await point.scrollIntoViewIfNeeded();
  const b = await point.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 3 });
  expect((await mix(page))[0].pan).toBe(1);
  await page.mouse.move(x - 20, y, { steps: 3 }); await page.mouse.up();
  expect((await mix(page))[0].pan).toBeLessThan(1); await undo(page, boundary);
  await page.locator("#geometryArrange").click();
  const stage = page.locator("#geometryStage");
  await stage.evaluate(node => node.addEventListener("pointerdown", event => { node.dataset.testPointer = event.pointerId; }));
  await point.scrollIntoViewIfNeeded(); const start = await point.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 - 10, start.y + start.height / 2 + 10);
  // Deliver another movement and an external fader edit in one task so a
  // queued mixer flush cannot overwrite a newer MIDI/native-control value.
  await stage.evaluate(node => {
    const r = document.querySelector("#geometryPoint0").getBoundingClientRect();
    node.dispatchEvent(new PointerEvent("pointermove", { pointerId: Number(node.dataset.testPointer), pointerType: "mouse", clientX: r.x + r.width / 2 + 3, clientY: r.y + r.height / 2 + 3, buttons: 1, bubbles: true }));
    const gain = document.querySelector("#d2Gain"); gain.value = ".12"; gain.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(async () => (await mix(page))[2].gain).toBeCloseTo(.12, 5);
  await expect.poll(() => stage.evaluate(node => node.hasPointerCapture(Number(node.dataset.testPointer)))).toBe(false);
  const external = await mix(page);
  await page.mouse.move(start.x + start.width / 2 + 35, start.y + start.height / 2 - 20); await page.mouse.up();
  await page.waitForTimeout(160);
  expect(await mix(page)).toEqual(external); await expect(page.locator("#geometryUndo")).toBeDisabled();
  expect((await state(page)).armed).toBe(false);
});

test("phone geometry controls keep touch targets and dialog focus through portrait and landscape", async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, "Phone layouts use the opt-in mobile projects.");
  await ready(page); const before = await mix(page); await open(page);
  const portrait = page.viewportSize();
  for (const viewport of [portrait, { width: portrait.height, height: portrait.width }, portrait]) {
    await page.setViewportSize(viewport);
    const dialog = page.locator("#geometryDialog");
    await expect.poll(() => dialog.evaluate(node => {
      const r = node.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        && node.scrollWidth <= node.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1;
    })).toBe(true);
    const canvas = page.locator("#geometryCanvas");
    await expect.poll(() => canvas.evaluate(node => Math.abs(node.width - node.clientWidth))).toBeLessThanOrEqual(1);
    expect(await mix(page)).toEqual(before);
  }
  for (let i = 0; i < 8; i++) {
    const point = page.locator(`#geometryPoint${i}`); await point.scrollIntoViewIfNeeded();
    const b = await point.boundingBox(); expect(b.width).toBeGreaterThanOrEqual(48); expect(b.height).toBeGreaterThanOrEqual(48);
    await expect(point).toHaveAccessibleName(new RegExp(`Track ${i + 1}, pan`));
    await point.evaluate(node => node.addEventListener("pointerdown", event => { node.dataset.testPointerType = event.pointerType; }, { once: true }));
    await point.tap(); await expect(point).toHaveAttribute("data-test-pointer-type", "touch");
    await expect(page.locator("#geometryTrack")).toHaveValue(String(i));
    expect(await mix(page)).toEqual(before);
  }
  await page.locator("#geometryArrange").tap();
  await page.locator("#geometryStage").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("geometry-phone-dialog.png") });
  await page.locator(closeButton).tap(); await expect(page.locator("#geometryOpen")).toBeFocused();
  await open(page); const r = await page.locator("#geometryDialog").boundingBox();
  await page.touchscreen.tap(r.x - 5, r.y + 10);
  await expect(page.locator("#geometryDialog")).toBeHidden(); await expect(page.locator("#geometryOpen")).toBeFocused();
  expect((await state(page)).armed).toBe(false);
});

test("real touch dragging updates both mix axes and cancellation or dialog close releases capture", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Chromium CDP provides native touch move/cancel contacts.");
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page); await open(page); await page.locator("#geometryArrange").click();
  const stage = page.locator("#geometryStage");
  await stage.evaluate(node => node.addEventListener("pointerdown", event => { node.dataset.testPointer = event.pointerId; node.dataset.testPointerType = event.pointerType; }));
  const cdp = await page.context().newCDPSession(page);
  for (const action of ["cancel", "close"]) {
    const point = page.locator("#geometryPoint2"); await point.scrollIntoViewIfNeeded();
    const b = await point.boundingBox(), before = await mix(page);
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 41, x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 41, x: x - 25, y: y - 20 }] });
    await expect.poll(async () => (await mix(page))[2].pan).toBeLessThan(before[2].pan);
    expect((await mix(page))[2].gain).toBeGreaterThan(before[2].gain);
    await expect(stage).toHaveAttribute("data-test-pointer-type", "touch");
    if (action === "cancel") await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    else await page.locator(closeButton).evaluate(node => node.click());
    await expect.poll(() => stage.evaluate(node => node.hasPointerCapture(Number(node.dataset.testPointer)))).toBe(false);
    const released = await mix(page);
    await stage.evaluate(node => node.dispatchEvent(new PointerEvent("pointermove", { pointerId: Number(node.dataset.testPointer), pointerType: "touch", clientX: 1, clientY: 1, buttons: 1, bubbles: true })));
    expect(await mix(page)).toEqual(released);
    if (action === "cancel") await undo(page, before);
    else { await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); await expect(page.locator("#geometryDialog")).toBeHidden(); }
  }
  await cdp.detach(); expect((await state(page)).armed).toBe(false);
});
