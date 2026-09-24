import { expect, test } from "@playwright/test";
import { createShapesState, SHAPES_STORAGE_KEY, SHAPES_TRIGGER_SOUND_BANKS } from "../src/instruments/shapes/shapes-state.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) test(`conditional controls retain settings at ${viewport.width}×${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto("shapes.html");
  await page.locator("#formBankTab").click();
  await page.locator("#profileKind").selectOption("star");
  await page.locator("#starDepth").fill("0.71");
  for (const dimension of ["3d", "4d"]) {
    await page.locator("#dimensionSelect").selectOption(dimension);
    await expect(page.locator("#profileKind")).toBeHidden();
    await expect(page.locator("#profileSides")).toBeHidden();
    await expect(page.locator("#starDepth")).toBeHidden();
    const select = page.locator(dimension === "3d" ? "#solidRepresentation" : "#hyperRepresentation");
    await select.selectOption("profile");
    await expect(page.locator("#profileKind")).toBeVisible();
    await expect(page.locator("#starDepth")).toHaveValue("0.71");
    await expect(page.locator("#starDepth")).toBeVisible();
  }
  await page.locator("#dimensionSelect").selectOption("2d");
  await page.locator("#mappingBankTab").click();
  await page.locator("#shapesSoundModel").selectOption("geometry");
  for (const engine of ["fm", "pm", "fm"]) {
    await page.locator("#mainBankTab").click(); await page.locator("#voiceEngine").selectOption(engine);
    await page.locator("#mappingBankTab").click();
    await expect(page.locator(`[data-tone="${engine === "fm" ? "pmIndex" : "fmIndex"}"]`)).toBeHidden();
    await expect(page.locator(`[data-tone="${engine}Index"]`)).toBeVisible();
    await page.locator(`[data-tone="${engine}Index"]`).fill(engine === "fm" ? "7.5" : "3.5");
  }
  await expect(page.locator('[data-tone="pmIndex"]')).toHaveValue("3.5");
  await page.locator("#dimensionSelect").selectOption("3d");
  await page.locator("#mainBankTab").click(); await page.locator("#voiceEngine").selectOption("pm");
  await page.locator("#mappingBankTab").click();
  await expect(page.locator('[data-tone="fmIndex"]')).toBeVisible();
  await expect(page.locator('[data-tone="fmIndex"]')).toHaveValue("7.5");
  await expect(page.locator('[data-tone="pmIndex"]')).toBeHidden();
  await page.locator("#shapesSoundModel").selectOption("shapes");
  for (const engine of ["sine", "triangle", "square", "saw", "fm", "pm", "shepard"]) {
    await page.locator("#mainBankTab").click(); await page.locator("#voiceEngine").selectOption(engine);
    await page.locator("#mappingBankTab").click();
    expect(await page.locator("#voiceCharacter").isVisible()).toBe(["fm", "pm", "shepard"].includes(engine));
  }
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const [dimension, viewport] of [["2d", {width: 1440, height: 900}], ["3d", {width: 390, height: 844}], ["4d", {width: 844, height: 390}]]) test(`${dimension}: all trigger banks prepare before playing and stay audible, bounded and armed`, async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize(viewport);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  const state = createShapesState({ selection: { dimension, playingMode: "triggers" }, play: { running: true, rateCyclesPerSecond: 0.7, divisions: 4 }, trigger: { hitCap: 2, strength: 0.65 } });
  await page.addInitScript(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: SHAPES_STORAGE_KEY, state });
  await page.route("**/src/instruments/shapes/kit-audio.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nconst start = ShapesKitAudio.prototype.start; ShapesKitAudio.prototype.start = function(...args) { globalThis.__shapesKit = this; return start.apply(this, args); };` });
  });
  await page.goto("shapes.html");
  // Selecting a prepared bank alone must not create a context or arm Audio.
  await page.locator("#triggerSoundBank").selectOption("fm-kit");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on", {timeout: 15000});
  const results = [];
  for (const {id} of SHAPES_TRIGGER_SOUND_BANKS) {
    await page.locator("#triggerSoundBank").selectOption(id);
    if (id !== "rattlesnake") await page.waitForFunction(bank => globalThis.__shapesKit?.isReady(bank), id);
    const signal = await sampleAudioEnvelope(page, { durationMs: 1800 });
    expect(signal.summary.finite).toBe(true); expect(signal.summary.clippedSamples).toBe(0);
    expect(signal.summary.maxRms).toBeGreaterThan(0.001);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    results.push({bank: id, ...signal.summary});
    if (id !== "rattlesnake") {
      const prepared = await page.evaluate(() => ({banks: __shapesKit.buffers.size, hits: __shapesKit.activeHits.size, voices: __shapesKit.buffers.get(__shapesKit.readyBank).length}));
      expect(prepared.banks).toBeLessThanOrEqual(2); expect(prepared.hits).toBeLessThanOrEqual(64); expect(prepared.voices).toBe(16);
    }
  }
  // Rapid selection must not let obsolete preparation mute the latest choice.
  await page.evaluate(() => { const s = document.querySelector("#triggerSoundBank"); for (const bank of ["analog", "noise", "fm-kit"]) { s.value = bank; s.dispatchEvent(new Event("change", {bubbles:true})); } });
  await page.waitForFunction(() => globalThis.__shapesKit?.isReady("fm-kit"));
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#audioButton").click(); await page.waitForTimeout(600);
  expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  await testInfo.attach("bank-signals.json", {body:JSON.stringify(results,null,2),contentType:"application/json"});
});

test("prepared FM uses Rubix's gentler recipe; renders stay finite and bounded", async ({ page }, testInfo) => {
  await page.goto("shapes.html");
  const metrics = await page.evaluate(async () => {
    const { ShapesKitAudio, shapesKitVoice } = await import("/src/instruments/shapes/kit-audio.js");
    const { FmDrumAudio } = await import("/src/instruments/fm-drums/fm-drums.js");
    const { MorphazoidDrumRenderer } = await import("/src/families/percussion/drum-renderer.js");
    const { normalizeRubixDrumBuffer } = await import("/src/instruments/rubix/rubix-percussion.js");
    const results = [];
    const metric = buffer => {
      const samples = buffer.getChannelData(0); let energy = 0, delta = 0, peak = 0;
      for (let i = 0; i < samples.length; i++) { energy += samples[i] ** 2; if(i) delta += (samples[i] - samples[i-1]) ** 2; peak = Math.max(peak, Math.abs(samples[i])); }
      return {finite: samples.every(Number.isFinite), peak, rms: Math.sqrt(energy/samples.length), relativeStep: Math.sqrt(delta/Math.max(1e-12,energy))};
    };
    for (const index of [9, 15]) {
      const voice = {...shapesKitVoice("fm-kit", index), noise: 0};
      const dry = new OfflineAudioContext(1, 48000, 48000);
      const old = new FmDrumAudio({}); old.context = dry; old.input = dry.destination; old.start = async () => dry;
      await old.trigger(voice, {startAt:0});
      const reference = metric(await dry.startRendering());
      const softContext = new OfflineAudioContext(1, 48000, 48000);
      new MorphazoidDrumRenderer(softContext, null).scheduleFmDrum(voice, 0, 1, softContext.destination);
      const rendered = await softContext.startRendering();
      const soft = metric(rendered), normalized = metric(normalizeRubixDrumBuffer(rendered));
      results.push({voice: voice.id, reference, soft, normalized});
    }
    return results;
  });
  for (const {reference, soft, normalized} of metrics) {
    expect(reference.finite && soft.finite && normalized.finite).toBe(true);
    expect(soft.rms).toBeLessThan(reference.rms);
    expect(soft.relativeStep).toBeLessThan(reference.relativeStep);
    expect(normalized.peak).toBeLessThanOrEqual(0.650001);
    expect(normalized.rms).toBeGreaterThan(0.001);
  }
  await testInfo.attach("soft-fm-comparison.json", {body:JSON.stringify(metrics,null,2),contentType:"application/json"});
});

test("cold kit preparation can be cancelled without rearming Audio or resetting motion", async ({ page }) => {
  const state = createShapesState({selection:{playingMode:"triggers"},trigger:{soundBank:"karplus-strong"},play:{running:true,rateCyclesPerSecond:0.3}});
  await page.addInitScript(({key,state}) => {
    localStorage.setItem(key,JSON.stringify(state));
    const Offline = globalThis.OfflineAudioContext;
    globalThis.OfflineAudioContext = class extends Offline {
      async startRendering() {
        const result = await super.startRendering();
        globalThis.__preparedCount = (globalThis.__preparedCount ?? 0) + 1;
        if (!globalThis.__releaseKit) await new Promise(resolve => { globalThis.__releaseKit = resolve; });
        return result;
      }
    };
  }, {key:SHAPES_STORAGE_KEY,state});
  await page.goto("shapes.html");
  await page.locator("#audioButton").click();
  await page.waitForFunction(() => globalThis.__preparedCount === 1);
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state","starting");
  await page.locator("#audioButton").click();
  await page.evaluate(() => globalThis.__releaseKit());
  await page.waitForTimeout(350);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed","false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed","true");
  expect(await page.evaluate(() => globalThis.__preparedCount)).toBe(1);
  expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state","on",{timeout:15000});
  expect((await sampleAudioEnvelope(page,{durationMs:1800})).summary.maxRms).toBeGreaterThan(0.001);
});
