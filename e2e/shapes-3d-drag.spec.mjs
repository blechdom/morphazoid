import { expect, test } from "@playwright/test";
import { createShapesState, SHAPES_STORAGE_KEY } from "../src/instruments/shapes/shapes-state.js";
import { percussionEnvelopeEditorX } from "../src/audio.js";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

async function mount(page, { mode = "continuous", engine = "sine", bank = "fm-kit", moving = false, audio = false } = {}) {
  const state = createShapesState({
    selection: { dimension: "3d", playingMode: mode },
    play: { running: moving, continuousPhase: .17, divisions: 1 },
    voice: { engine }, trigger: { soundBank: bank },
    notes: { envelopePoints: [0, 80, 200, 600, 1000].map((ms, i) => ({ x: percussionEnvelopeEditorX(ms), y: [0, 1, .6, .6, 0][i] })) },
    synthesis: { percussionAttack: 12, percussionDecay: 900 },
    dimension: {
      "2d": { rotation: 60 },
      "3d": { rotation: { x: -24, y: 20, z: 8 }, rotationMotion: Object.fromEntries(
        ["x", "y", "z", "readerYaw", "readerPitch"].map(axis => [axis, { running: moving, speed: .03 }]),
      ) },
    },
  });
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
    globalThis.__threeDragSilences = [];
  }, { key: SHAPES_STORAGE_KEY, state });
  for (const [module, name] of [
    ["audio.js", "VoicePool"], ["instruments/fm-drums/fm-drums.js", "FmDrumAudio"],
    ["instruments/linear-drums/linear-drums.js", "LinearDrumAudio"],
  ]) await page.route(`**/src/${module}`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const originalSilence = ${name}.prototype.silence;
      ${name}.prototype.silence = function (...args) {
        __threeDragSilences.push(${JSON.stringify(name)});
        return originalSilence.apply(this, args);
      };
    ` });
  });
  await page.goto("shapes.html");
  await expect(page.locator("#dimensionSelect")).toHaveValue("3d");
  if (audio) {
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => { __threeDragSilences = []; });
  return state;
}
async function saved(page) {
  await page.waitForTimeout(180);
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), SHAPES_STORAGE_KEY);
}
const wrap = n => ((n + 180) % 360 + 360) % 360 - 180;

async function drag(page, target, { dx = .2, dy = .1, touch = false, cancel = false, meter = false } = {}) {
  await page.locator("#stage").scrollIntoViewIfNeeded();
  const box = await page.locator("#stage").boundingBox();
  const x = box.x + box.width * (target === "reader" ? .5 : .07);
  const y = box.y + box.height * (target === "reader" ? .5 : .08);
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const samples = [];
  if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  else { await page.mouse.move(x, y); await page.mouse.down(); }
  await expect(page.locator("#stageWrap")).toHaveAttribute("data-drag-target", target);
  await expect(page.locator("#stageWrap")).toHaveClass(/is-spinning/);
  for (let i = 1; i <= 12; i++) {
    const point = { x: x + box.width * dx * i / 12, y: y + box.height * dy * i / 12 };
    if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
    else await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(25);
    await expect(page.locator("#stageWrap")).toHaveAttribute("data-drag-target", target);
    if (meter) samples.push(await readAudioStatus(page));
  }
  await expect(page.locator("#stageReadout")).toContainText(target === "reader" ? "ROTATING SURFACE" : "ROTATING SHAPE");
  if (touch) await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  else await page.mouse.up();
  await cdp?.detach();
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-spinning/);
  await expect(page.locator("#stageWrap")).not.toHaveAttribute("data-drag-target", /.+/);
  return samples;
}

function expectPose(before, after, target, dx = .2, dy = .1) {
  const original = before.dimension["3d"], current = after.dimension["3d"];
  if (target === "reader") {
    expect(current.readerYaw).toBeCloseTo(wrap(original.readerYaw + dx * 240), 4);
    expect(current.readerPitch).toBeCloseTo(wrap(original.readerPitch - dy * 240), 4);
    expect(current.rotation).toEqual(original.rotation);
  } else {
    expect(current.rotation.y).toBeCloseTo(wrap(original.rotation.y + dx * 240), 4);
    expect(current.rotation.x).toBeCloseTo(wrap(original.rotation.x - dy * 240), 4);
    expect(current.rotation.z).toBe(original.rotation.z);
    expect(current.readerYaw).toBe(original.readerYaw);
    expect(current.readerPitch).toBe(original.readerPitch);
  }
  expect(after.play.continuousPhase).toBe(before.play.continuousPhase);
  expect(after.dimension["2d"]).toEqual(before.dimension["2d"]);
  expect(after.dimension["4d"]).toEqual(before.dimension["4d"]);
}

for (const target of ["shape", "reader"]) {
  test(`Shapes 3D: ${target === "shape" ? "outside" : "inside"} drag rotates only the ${target}`, async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const before = await mount(page);
    await drag(page, target);
    expectPose(before, await saved(page), target);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test(`Shapes 3D: ${target} drag does not switch target when crossing the outline`, async ({ page }) => {
    const before = await mount(page), dx = target === "reader" ? .43 : .55;
    await drag(page, target, { dx, dy: target === "reader" ? 0 : .42 });
    expectPose(before, await saved(page), target, dx, target === "reader" ? 0 : .42);
  });

  test(`Shapes 3D: ${target} takeover pauses only its automatic axes`, async ({ page }) => {
    await mount(page, { moving: true });
    await drag(page, target);
    const state = await saved(page), paused = target === "reader" ? ["readerYaw", "readerPitch"] : ["x", "y"];
    for (const axis of ["x", "y", "z", "readerYaw", "readerPitch"]) {
      expect(state.dimension["3d"].rotationMotion[axis].running).toBe(!paused.includes(axis));
    }
    expect(state.play.running).toBe(true);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  });

  for (const scene of [
    { mode: "continuous" }, { mode: "notes" }, { mode: "notes", engine: "percussion" },
    { mode: "triggers", bank: "fm-kit" }, { mode: "triggers", bank: "rattlesnake" },
  ]) test(`Shapes 3D: ${target} drag preserves ${scene.mode}/${scene.engine ?? scene.bank ?? "sine"} sound`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await mount(page, { ...scene, audio: true });
    const samples = await drag(page, target, { meter: true });
    expect(Math.max(...samples.map(sample => sample.rms))).toBeGreaterThan(.0001);
    expect(samples.every(sample => Number.isFinite(sample.rms) && !sample.clipped)).toBe(true);
    expect(await page.evaluate(() => __threeDragSilences)).toEqual([]);
    await page.locator("#audioButton").click();
    await page.waitForTimeout(350);
    expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
    await testInfo.attach("3d-drag-audio.json", { body: JSON.stringify(samples), contentType: "application/json" });
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}

test("Shapes 3D: arrow keys and the position slider still move the reader; rotation controls remain keyboard accessible", async ({ page }) => {
  const before = await mount(page);
  await page.locator("#stage").press("ArrowRight");
  let state = await saved(page);
  expect(state.play.continuousPhase).toBeCloseTo(before.play.continuousPhase + .005, 8);
  expect(state.dimension["3d"].rotation).toEqual(before.dimension["3d"].rotation);
  await page.locator("#position").fill("0.4");
  await page.locator("#rotationBankTab").click();
  const yaw = page.locator('[data-rotation-target="readerYaw"]');
  await yaw.fill("50"); await yaw.press("ArrowRight");
  state = await saved(page);
  expect(state.play.continuousPhase).toBe(.4);
  expect(state.dimension["3d"].readerYaw).toBe(51);
});

test("Shapes 3D: dimension changes release the old target before later pointer motion", async ({ page }) => {
  await mount(page);
  const box = await page.locator("#stage").boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 30, y);
  await expect(page.locator("#stageWrap")).toHaveAttribute("data-drag-target", "reader");
  await page.locator("#dimensionSelect").selectOption("4d");
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-spinning/);
  const before = await saved(page);
  await page.mouse.move(x + 100, y); await page.mouse.up();
  expect((await saved(page)).dimension["3d"]).toEqual(before.dimension["3d"]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`3D drag ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });
    test("inside/outside touch gestures and cancellation preserve their target", async ({ page, baseURL }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      for (const target of ["shape", "reader"]) {
        const before = await mount(page);
        await drag(page, target, { touch: true, cancel: true });
        expectPose(before, await saved(page), target);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await testInfo.attach("3d-drag-layout.png", { body: await page.screenshot(), contentType: "image/png" });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}
