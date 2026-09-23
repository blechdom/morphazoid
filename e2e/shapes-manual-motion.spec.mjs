import { expect, test } from "@playwright/test";
import { createShapesState, SHAPES_STORAGE_KEY } from "../src/instruments/shapes/shapes-state.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

const dimensions = [
  { dimension: "2d", target: "rotation", start: 60, crossing: 62, auto: "rotationRunning" },
  { dimension: "3d", target: "rotation.y", start: 20, crossing: 26, auto: "rotationMotion.y.running" },
  { dimension: "4d", target: "rotation.xw", start: 55, crossing: 61, auto: "rotationMotion.xw.running" },
];
const cases = [
  ...["sine", "triangle", "square", "fm", "pm", "shepard"].map(engine => ({ mode: "continuous", engine, name: `Continuous ${engine}` })),
  ...["fm-kit", "rattlesnake"].map(bank => ({ mode: "triggers", bank, name: `Triggers ${bank}` })),
];

async function setup(page, { dimension, mode, engine = "sine", bank = "fm-kit", arm = true, initialRotation = 60 }) {
  const state = createShapesState({
    selection: { dimension, playingMode: mode },
    play: { running: false, continuousPhase: 0.17, divisions: 1 },
    voice: { engine },
    trigger: { soundBank: bank },
    dimension: {
      "2d": { reader: "radar", rotation: initialRotation, rotationRunning: false, rotationSpeed: 0.3 },
      "3d": { rotation: { y: 20 } },
      "4d": { rotation: { xw: 55 } },
    },
  });
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem(key, JSON.stringify(state));
    globalThis.__motionProbe = { events: [], pools: {} };
  }, { key: SHAPES_STORAGE_KEY, state });
  for (const [module, name, pool, methods] of [
    ["audio.js", "VoicePool", "synth", ["silence", "setVoiceTrajectory", "scheduleNotes", "cancelScheduledNotes"]],
    ["instruments/fm-drums/fm-drums.js", "FmDrumAudio", "fm-kit", ["silence", "trigger", "cancelScheduledHits"]],
    ["instruments/linear-drums/linear-drums.js", "LinearDrumAudio", "rattlesnake", ["silence", "trigger", "cancelScheduledHits"]],
  ]) {
    await page.route(`**/src/${module}`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}
        for (const method of ${JSON.stringify(methods)}) {
          const original = ${name}.prototype[method];
          if (!original) continue;
          ${name}.prototype[method] = function (...args) {
            globalThis.__motionProbe.pools[${JSON.stringify(pool)}] = this;
            globalThis.__motionProbe.events.push({
              pool: ${JSON.stringify(pool)}, method, at: this.context?.currentTime ?? 0,
              voiceCount: method === "setVoiceTrajectory" ? args[0].length : null,
            });
            return original.apply(this, args);
          };
        }
      ` });
    });
  }
  await page.goto("shapes.html");
  await expect(page.locator(`#playingMode [data-playing-mode="${mode}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  if (arm) {
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => { globalThis.__motionProbe.events = []; });
}

async function scrubCanvas(page, { touch = false } = {}) {
  await page.locator("#stage").scrollIntoViewIfNeeded();
  const box = await page.locator("#stage").boundingBox();
  const session = touch ? await page.context().newCDPSession(page) : null;
  const move = async (type, phase) => {
    const x = box.x + box.width * phase, y = box.y + box.height / 2;
    if (touch) {
      await session.send("Input.dispatchTouchEvent", {
        type, touchPoints: type === "touchCancel" ? [] : [{ x, y }],
      });
    } else {
      await page.mouse.move(x, y);
      if (type === "touchStart") await page.mouse.down();
      if (type === "touchCancel") await page.mouse.up();
    }
  };
  await move("touchStart", 0.4);
  for (let step = 1; step <= 10; step++) {
    await move("touchMove", 0.4 + step * 0.02);
    await page.waitForTimeout(20);
  }
  await move("touchCancel", 0.6);
  await session?.detach();
}

for (const geometry of dimensions) {
  for (const scene of cases) {
    test(`Shapes ${geometry.dimension} ${scene.name}: manual rotation preserves voices and tails`, async ({ page, baseURL }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await setup(page, { ...geometry, ...scene });
      await page.locator("#rotationBankTab").click();
      const slider = page.locator(`[data-rotation-target="${geometry.target}"]`);
      const samples = [];
      for (let angle = geometry.start + 1; angle <= geometry.start + 10; angle++) {
        await slider.fill(String(angle));
        await page.waitForTimeout(25);
        samples.push(await readAudioStatus(page));
      }
      const events = await page.evaluate(() => globalThis.__motionProbe.events);
      expect(events.filter(event => event.method === "silence")).toEqual([]);
      expect(events.filter(event => event.method.startsWith("cancelScheduled"))).toEqual([]);
      if (scene.mode === "continuous") {
        expect(events.filter(event => event.method === "setVoiceTrajectory" && event.voiceCount > 0).length).toBeGreaterThan(1);
      } else {
        expect(events.some(event => event.pool === scene.bank && event.method === "trigger")).toBe(true);
      }
      expect(samples.every(sample => Number.isFinite(sample.rms) && !sample.clipped)).toBe(true);
      expect(Math.max(...samples.map(sample => sample.rms))).toBeGreaterThan(0.0001);
      await testInfo.attach("manual-motion.json", { body: JSON.stringify({ events, samples }), contentType: "application/json" });
      if (scene.mode === "continuous") {
        await page.waitForTimeout(500);
        expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
      }
      await page.locator("#audioButton").click();
      await page.waitForTimeout(350);
      expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  }

  for (const scene of [cases[0], ...cases.filter(scene => scene.mode === "triggers")]) {
    test(`Shapes ${geometry.dimension} ${scene.name}: automatic/manual handoff preserves active sound`, async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      // Start well before the first crossing; an 18 ms startup crossing may
      // legitimately be skipped as stale and is not a useful handoff fixture.
      await setup(page, { ...geometry, ...scene, initialRotation: 30 });
      await page.locator(`[data-rotation-motion="${geometry.auto}"]`).click();
      expect((await sampleAudioEnvelope(page, { durationMs: 800 })).summary.maxRms).toBeGreaterThan(0.0001);
      await page.locator("#rotationBankTab").click();
      await page.evaluate(() => { globalThis.__motionProbe.events = []; });
      const slider = page.locator(`[data-rotation-target="${geometry.target}"]`);
      for (let step = 0; step < 3; step++) {
        await slider.fill(String(Math.round(Number(await slider.inputValue())) + 1));
        await page.waitForTimeout(15);
      }
      const events = await page.evaluate(() => globalThis.__motionProbe.events);
      expect(events.filter(event => event.method === "silence")).toEqual([]);
      const cancellations = events.filter(event => event.method === "cancelScheduledHits");
      expect(cancellations).toHaveLength(scene.mode === "triggers" ? 1 : 0);
      if (scene.mode === "triggers") expect(cancellations[0].pool).toBe(scene.bank);
      await page.locator("#mainBankTab").click();
      await page.locator(`[data-rotation-motion="${geometry.auto}"]`).click();
      await page.locator("#audioButton").click();
      await page.waitForTimeout(350);
      expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  }

  for (const mode of ["continuous", "notes", "triggers"]) {
    test(`Shapes ${geometry.dimension} ${mode}: ${geometry.dimension === "3d" ? "position slider" : "canvas"} moves the active reader, preserves Audio off and does not choke playback`, async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await setup(page, { ...geometry, mode, arm: false });
      const moveReader = async () => {
        if (geometry.dimension !== "3d") return scrubCanvas(page);
        for (let step = 0; step <= 10; step++) {
          await page.locator("#position").fill(String((40 + step * 2) / 100));
          await page.waitForTimeout(20);
        }
      };
      await moveReader();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(Number(await page.locator("#position").inputValue())).toBeCloseTo(0.6, 2);
      await page.waitForTimeout(150);
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), SHAPES_STORAGE_KEY);
      expect(saved.dimension["2d"].rotation).toBe(60);
      await page.locator("#audioButton").click();
      await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
      await page.waitForTimeout(150);
      await page.evaluate(() => { globalThis.__motionProbe.events = []; });
      await moveReader();
      const events = await page.evaluate(() => globalThis.__motionProbe.events);
      expect(events.some(event => event.method === "silence")).toBe(false);
      const method = mode === "continuous" ? "setVoiceTrajectory" : mode === "notes" ? "scheduleNotes" : "trigger";
      expect(events.some(event => event.method === method)).toBe(true);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  }
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`manual motion ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });
    test("Continuous and both Trigger banks retain sound through touch movement and cancel cleanly", async ({ page, baseURL }) => {
      for (const scene of [cases[0], ...cases.filter(scene => scene.mode === "triggers")]) {
        const diagnostics = watchPageDiagnostics(page, { baseURL });
        await setup(page, { ...dimensions[0], ...scene });
        await scrubCanvas(page, { touch: true });
        const events = await page.evaluate(() => globalThis.__motionProbe.events);
        expect(events.some(event => event.method === "silence")).toBe(false);
        expect(events.some(event => event.method === (scene.mode === "continuous" ? "setVoiceTrajectory" : "trigger"))).toBe(true);
        await expect(page.locator("#stageWrap")).not.toHaveClass(/is-spinning/);
        await page.locator("#audioButton").click();
        await page.waitForTimeout(350);
        expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      }
    });
  });
}
