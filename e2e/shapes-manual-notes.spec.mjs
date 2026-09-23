import { expect, test } from "@playwright/test";
import { percussionEnvelopeEditorX } from "../src/audio.js";
import { createShapesState, SHAPES_STORAGE_KEY } from "../src/instruments/shapes/shapes-state.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

const envelopePoints = [0, 120, 240, 900, 1400].map((ms, index) => ({
  x: percussionEnvelopeEditorX(ms), y: [0, 1, 0.7, 0.7, 0][index],
}));

async function setup(page, { engine = "sine", swell = false, dimension = "2d", arm = true } = {}) {
  const state = createShapesState({
    selection: { dimension, playingMode: "notes" },
    play: { running: false, continuousPhase: 0.17, divisions: 1 },
    voice: { engine },
    notes: { swell, envelopePoints },
    synthesis: { tone: { percussionEnvelopePoints: envelopePoints } },
    dimension: {
      "2d": { reader: "radar", rotation: 60, rotationRunning: false, rotationSpeed: 0.3 },
      "3d": { rotation: { y: 20 } },
      "4d": { rotation: { xw: 55 } },
    },
  });
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
  }, { key: SHAPES_STORAGE_KEY, state });
  // Observe the real pool without replacing synthesis or exposing a production
  // debug API. The audio meter below independently verifies the surviving tail.
  await page.route("**/src/audio.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      globalThis.__shapesAudioEvents = [];
      for (const method of ["scheduleNotes", "strike", "silence", "cancelScheduledNotes"]) {
        const original = VoicePool.prototype[method];
        if (!original) continue;
        VoicePool.prototype[method] = function (...args) {
          globalThis.__shapesAudioEvents.push({
            method, at: this.context?.currentTime ?? 0, options: args[1] ?? null,
          });
          return original.apply(this, args);
        };
      }
    ` });
  });
  await page.goto("shapes.html");
  await expect(page.locator("#voiceEngine")).toHaveValue(engine);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  if (dimension === "2d") await expect(page.locator("#rotateButton")).toHaveAttribute("aria-pressed", "false");
  if (!arm) return;
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
  await page.waitForTimeout(150);
  await page.evaluate(() => { globalThis.__shapesAudioEvents = []; });
}

async function canvasRotation(page, { touch = false, cancel = false } = {}) {
  await page.locator("#stage").scrollIntoViewIfNeeded();
  const box = await page.locator("#stage").boundingBox();
  const touchSession = touch ? await page.context().newCDPSession(page) : null;
  const radius = Math.min(box.width, box.height) * 0.47;
  const point = degrees => ({
    x: box.x + box.width / 2 + radius * Math.cos(degrees * Math.PI / 180),
    y: box.y + box.height / 2 + radius * Math.sin(degrees * Math.PI / 180),
  });
  const dispatch = async (type, degrees) => {
    const { x, y } = point(degrees);
    if (touch) {
      await touchSession.send("Input.dispatchTouchEvent", {
        type: { pointerdown: "touchStart", pointermove: "touchMove", pointerup: "touchEnd", pointercancel: "touchCancel" }[type],
        touchPoints: type === "pointerup" || type === "pointercancel" ? [] : [{ x, y }],
      });
    } else if (type === "pointerdown") {
      await page.mouse.move(x, y);
      await page.mouse.down();
    } else if (type === "pointerup") await page.mouse.up();
    else await page.mouse.move(x, y);
  };
  await dispatch("pointerdown", 0);
  // Cross the marker at 62°, then keep moving within the same note region.
  // The later movement must not choke the note that just began.
  for (let angle = 1; angle <= 10; angle++) {
    await dispatch("pointermove", angle);
    await page.waitForTimeout(35);
  }
  await dispatch(cancel ? "pointercancel" : "pointerup", 10);
  await touchSession?.detach();
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-spinning/);
}

for (const engine of ["sine", "triangle", "square", "fm", "pm", "shepard", "percussion"]) {
  for (const swell of [false, true]) {
    test(`Shapes manual rotation: ${engine}, swell ${swell} keeps the full note envelope`, async ({ page, baseURL }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await setup(page, { engine, swell });
      await canvasRotation(page);
      const events = await page.evaluate(() => globalThis.__shapesAudioEvents);
      const notes = events.filter(event => event.method === (engine === "percussion" ? "strike" : "scheduleNotes"));
      expect(notes.length).toBeGreaterThan(0);
      expect(events.filter(event => event.method === "silence")).toEqual([]);
      expect(events.filter(event => event.method === "cancelScheduledNotes")).toEqual([]);
      for (const note of notes) {
        expect(note.options.startAt).toBeGreaterThanOrEqual(note.at - 0.01);
        if (engine !== "percussion") expect(note.options.joinInProgress).toBe(false);
      }
      const tail = await sampleAudioEnvelope(page, { durationMs: 300 });
      expect(tail.summary.maxRms).toBeGreaterThan(0.002);
      expect(tail.summary.finite).toBe(true);
      expect(tail.summary.clippedSamples).toBe(0);
      await page.waitForTimeout(1600);
      expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await testInfo.attach("manual-note.json", { body: JSON.stringify({ events, tail }), contentType: "application/json" });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  }
}

for (const { dimension, target, start } of [
  { dimension: "2d", target: "rotation", start: 60 },
  { dimension: "3d", target: "rotation.y", start: 20 },
  { dimension: "4d", target: "rotation.xw", start: 55 },
]) {
  test(`Shapes ${dimension}: rotation slider preserves note tails during successive edits`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await setup(page, { dimension, swell: true });
    await page.locator("#rotationBankTab").click();
    const slider = page.locator(`[data-rotation-target="${target}"]`);
    for (let value = start + 1; value <= start + 10; value++) {
      await slider.fill(String(value));
      await page.waitForTimeout(30);
    }
    const events = await page.evaluate(() => globalThis.__shapesAudioEvents);
    expect(events.some(event => event.method === "scheduleNotes")).toBe(true);
    expect(events.some(event => event.method === "silence")).toBe(false);
    expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeGreaterThan(0.002);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

test("Shapes: keyboard rotation lets notes finish and manual gestures never arm Audio", async ({ page }) => {
  await setup(page, { swell: true, arm: false });
  await canvasRotation(page);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#rotationBankTab").click();
  await page.locator('[data-rotation-target="rotation"]').fill("60");
  await page.locator("#mainBankTab").click();
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
  await page.waitForTimeout(150);
  await page.evaluate(() => { globalThis.__shapesAudioEvents = []; });
  for (let step = 0; step < 10; step++) {
    await page.locator("#liveKnobA").press("ArrowUp");
    await page.waitForTimeout(30);
  }
  const events = await page.evaluate(() => globalThis.__shapesAudioEvents);
  expect(events.some(event => event.method === "scheduleNotes")).toBe(true);
  expect(events.some(event => event.method === "silence")).toBe(false);
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeGreaterThan(0.002);
});

test("Shapes: automatic swell survives pause/manual/resume, and direct takeover cancels only its forecast", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await setup(page, { swell: true });
  const waitForAutomaticNote = () => expect.poll(() => page.evaluate(() => (
    globalThis.__shapesAudioEvents.some(event => event.method === "scheduleNotes" && event.options.joinInProgress)
  ))).toBe(true);
  await page.locator("#rotateButton").click();
  await waitForAutomaticNote();
  await page.locator("#rotateButton").click();
  await page.locator("#rotationBankTab").click();
  await page.locator('[data-rotation-target="rotation"]').fill("60");
  await page.locator("#mainBankTab").click();
  await page.waitForTimeout(150);
  await page.evaluate(() => { globalThis.__shapesAudioEvents = []; });
  await canvasRotation(page);
  let events = await page.evaluate(() => globalThis.__shapesAudioEvents);
  expect(events.some(event => event.method === "scheduleNotes")).toBe(true);
  expect(events.some(event => event.method === "silence")).toBe(false);
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeGreaterThan(0.002);

  await page.evaluate(() => { globalThis.__shapesAudioEvents = []; });
  await page.locator("#rotateButton").click();
  await waitForAutomaticNote();
  await page.evaluate(() => { globalThis.__shapesAudioEvents = []; });
  await canvasRotation(page);
  events = await page.evaluate(() => globalThis.__shapesAudioEvents);
  expect(events.filter(event => event.method === "cancelScheduledNotes")).toHaveLength(1);
  expect(events.some(event => event.method === "silence")).toBe(false);
  await expect(page.locator("#rotateButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
  await page.waitForTimeout(300);
  expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`manual rotation ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });
    test("touch movement and pointer cancellation preserve the release tail", async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await setup(page, { swell: true });
      await canvasRotation(page, { touch: true, cancel: true });
      expect(await page.evaluate(() => globalThis.__shapesAudioEvents.some(event => event.method === "silence"))).toBe(false);
      expect((await sampleAudioEnvelope(page, { durationMs: 300 })).summary.maxRms).toBeGreaterThan(0.002);
      await page.locator("#audioButton").click();
      await page.waitForTimeout(300);
      expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}
