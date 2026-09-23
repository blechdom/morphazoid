import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createShapesState, SHAPES_STORAGE_KEY } from "../src/instruments/shapes/shapes-state.js";
import { percussionEnvelopeEditorX } from "../src/audio.js";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

async function mount(page, { mode = "continuous", engine = "sine", bank = "fm-kit", moving = false, audio = false } = {}) {
  const state = createShapesState({
    selection: { dimension: "4d", playingMode: mode },
    play: { running: moving, continuousPhase: .17, divisions: 1 },
    voice: { engine }, trigger: { soundBank: bank },
    notes: { swell: true, envelopePoints: [0, 120, 240, 900, 1400].map((ms, i) => ({ x: percussionEnvelopeEditorX(ms), y: [0, 1, .7, .7, 0][i] })) },
    synthesis: { percussionAttack: 12, percussionDecay: 900 },
    dimension: {
      "2d": { rotation: 60 },
      "4d": { rotation: { xw: 55, yw: -18, zw: 12 }, rotationMotion: {
        xw: { running: moving, speed: .04 }, yw: { running: moving, speed: .03 }, zw: { running: moving, speed: -.02 },
      } },
    },
  });
  await page.addInitScript(({ state, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(state));
    globalThis.__fourDragSilences = [];
  }, { state, key: SHAPES_STORAGE_KEY });
  for (const [module, name] of [
    ["audio.js", "VoicePool"],
    ["instruments/fm-drums/fm-drums.js", "FmDrumAudio"],
    ["instruments/linear-drums/linear-drums.js", "LinearDrumAudio"],
  ]) {
    await page.route(`**/src/${module}`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}
        const originalSilence = ${name}.prototype.silence;
        ${name}.prototype.silence = function (...args) {
          __fourDragSilences.push(${JSON.stringify(name)});
          return originalSilence.apply(this, args);
        };
      ` });
    });
  }
  await page.goto("shapes.html");
  await expect(page.locator("#dimensionSelect")).toHaveValue("4d");
  await expect(page.locator("#canvasDrag")).toHaveValue("reader");
  if (audio) {
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => { __fourDragSilences = []; });
  return state;
}

async function saved(page) {
  await page.waitForTimeout(180);
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), SHAPES_STORAGE_KEY);
}
const wrap = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;

async function swipe(page, { fraction = .1, touch = false, cancel = false, meter = false } = {}) {
  await page.locator("#stage").scrollIntoViewIfNeeded();
  const box = await page.locator("#stage").boundingBox();
  const x = box.x + box.width * .35, y = box.y + box.height * .5;
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const samples = [];
  if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  else { await page.mouse.move(x, y); await page.mouse.down(); }
  await expect(page.locator("#stageWrap")).toHaveClass(/is-spinning/);
  for (let step = 1; step <= 10; step++) {
    const nextX = x + box.width * fraction * step / 10;
    if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: nextX, y }] });
    else await page.mouse.move(nextX, y);
    await page.waitForTimeout(25);
    if (meter) samples.push(await readAudioStatus(page));
  }
  if (touch) await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  else await page.mouse.up();
  await cdp?.detach();
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-spinning/);
  return samples;
}

for (const plane of ["xw", "yw", "zw"]) {
  test(`Shapes 4D: mouse drag rotates only ${plane}, without moving the reader or arming Audio`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const before = await mount(page);
    await page.locator("#canvasDrag").selectOption(plane);
    await swipe(page);
    const after = await saved(page);
    for (const axis of ["xw", "yw", "zw"]) {
      // Browser pointer coordinates have subpixel rounding, unlike pure DSP references.
      if (axis === plane) expect(after.dimension["4d"].rotation[axis]).toBeCloseTo(wrap(before.dimension["4d"].rotation[axis] + 24), 4);
      else expect(after.dimension["4d"].rotation[axis]).toBe(before.dimension["4d"].rotation[axis]);
    }
    expect(after.play.continuousPhase).toBe(before.play.continuousPhase);
    expect(after.dimension["2d"].rotation).toBe(60);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

test("Shapes 4D: keyboard rotation wraps, Reader mode keeps its arrows, and UI choice stays outside presets", async ({ page }) => {
  const before = await mount(page);
  const capture = () => page.evaluate(async () => (await import("/src/site/header-presets.js")).captureHeaderPresetState());
  const preset = await capture();
  await page.locator("#canvasDrag").selectOption("zw");
  expect(await capture()).toEqual(preset);
  await page.locator("#rotationBankTab").click();
  await page.locator('[data-rotation-target="rotation.zw"]').fill("179");
  await page.locator("#stage").press("Shift+ArrowRight");
  let state = await saved(page);
  expect(state.dimension["4d"].rotation.zw).toBe(-171);
  expect(state.play.continuousPhase).toBe(before.play.continuousPhase);
  await page.locator("#canvasDrag").selectOption("reader");
  await page.locator("#stage").press("ArrowRight");
  state = await saved(page);
  expect(state.play.continuousPhase).toBeCloseTo(before.play.continuousPhase + .005, 8);
  expect(state.dimension["4d"].rotation.zw).toBe(-171);
});

test("Shapes 4D: grabbing one plane pauses only that automatic plane and leaves the playhead running", async ({ page }) => {
  await mount(page, { moving: true });
  await page.locator("#canvasDrag").selectOption("yw");
  await swipe(page);
  const state = await saved(page);
  expect(state.dimension["4d"].rotationMotion.yw.running).toBe(false);
  expect(state.dimension["4d"].rotationMotion.xw.running).toBe(true);
  expect(state.dimension["4d"].rotationMotion.zw.running).toBe(true);
  expect(state.play.running).toBe(true);
  await expect(page.locator('[data-rotation-motion="rotationMotion.yw.running"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

for (const scene of [
  { mode: "continuous", engine: "sine" },
  { mode: "notes", engine: "sine" },
  { mode: "notes", engine: "percussion" },
  { mode: "triggers", bank: "fm-kit" },
  { mode: "triggers", bank: "rattlesnake" },
]) test(`Shapes 4D: direct rotation keeps ${scene.mode}/${scene.engine ?? scene.bank} audio alive`, async ({ page, baseURL }, testInfo) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await mount(page, { ...scene, audio: true });
  await page.locator("#canvasDrag").selectOption("xw");
  const samples = await swipe(page, { meter: true });
  expect(Math.max(...samples.map(sample => sample.rms))).toBeGreaterThan(.0001);
  expect(samples.every(sample => Number.isFinite(sample.rms) && !sample.clipped)).toBe(true);
  expect(await page.evaluate(() => __fourDragSilences)).toEqual([]);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#audioButton").click();
  await page.waitForTimeout(350);
  expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
  await testInfo.attach("4d-drag-audio.json", { body: JSON.stringify(samples), contentType: "application/json" });
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const interruption of ["plane", "dimension", "blur", "capture"]) {
  test(`Shapes 4D: ${interruption} change clears the drag and prevents stale movement`, async ({ page }) => {
    await mount(page);
    await page.locator("#canvasDrag").selectOption("xw");
    const box = await page.locator("#stage").boundingBox();
    const x = box.x + box.width * .4, y = box.y + box.height * .5;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y);
    await expect(page.locator("#stageWrap")).toHaveClass(/is-spinning/);
    if (interruption === "plane") await page.locator("#canvasDrag").selectOption("yw");
    else if (interruption === "dimension") await page.locator("#dimensionSelect").selectOption("3d");
    else if (interruption === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else await page.evaluate(() => document.querySelector("#stage").releasePointerCapture(1));
    await expect(page.locator("#stageWrap")).not.toHaveClass(/is-spinning/);
    const state = await saved(page);
    await page.mouse.move(x + 90, y); await page.mouse.up();
    expect((await saved(page)).dimension["4d"].rotation).toEqual(state.dimension["4d"].rotation);
  });
}

test("Shapes 4D: preset recall ends a held drag but retains the chosen input plane", async ({ page }) => {
  await mount(page);
  await page.locator("#canvasDrag").selectOption("yw");
  const box = await page.locator("#stage").boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .5);
  await expect(page.locator("#stageWrap")).toHaveClass(/is-spinning/);
  await page.evaluate(() => document.querySelector('.header-preset-picker button[data-preset-id="hyper-original-tesseract"]').click());
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-spinning/);
  await page.mouse.up();
  await expect(page.locator("#canvasDrag")).toHaveValue("yw");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("Shapes 4D: live rotation is saved, but the drag-mode UI defaults back to Reader after reload", async ({ page }) => {
  await mount(page);
  await page.locator("#canvasDrag").selectOption("xw");
  await swipe(page);
  const before = await saved(page);
  await page.reload();
  await expect(page.locator("#canvasDrag")).toHaveValue("reader");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(Number(await page.locator('[data-rotation-target="rotation.xw"]').inputValue())).toBeCloseTo(before.dimension["4d"].rotation.xw, 0);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`4D drag ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 1000 });
    test("drag selector stays reachable and touch cancellation releases rotation", async ({ page, baseURL }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      const before = await mount(page);
      const control = page.locator("#canvasDrag");
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      if (viewport.width < 1000) expect(box.height).toBeGreaterThanOrEqual(48);
      await control.selectOption("zw");
      await swipe(page, { touch: viewport.width < 1000, cancel: true });
      const state = await saved(page);
      expect(state.dimension["4d"].rotation.zw).toBeCloseTo(before.dimension["4d"].rotation.zw + 24, 4);
      expect(state.play.continuousPhase).toBe(before.play.continuousPhase);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await testInfo.attach("4d-drag-layout.png", { body: await page.screenshot({ path: testInfo.outputPath("4d-drag-layout.png") }), contentType: "image/png" });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      // Run instrumentation last: axe's stylesheet probing makes its own
      // incorrectly rebased @import requests. Real page/gesture errors are
      // checked above, before the audit, with no app interactions afterward.
      const accessibility = await new AxeBuilder({ page }).include("#canvasDragControl").analyze();
      expect(accessibility.violations).toEqual([]);
      await testInfo.attach("4d-drag-accessibility.json", {
        body: JSON.stringify({ violations: accessibility.violations, auditDiagnostics: pageDiagnosticMessages(diagnostics) }),
        contentType: "application/json",
      });
    });
  });
}
