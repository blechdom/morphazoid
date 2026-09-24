import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const layouts = [
  { name: "desktop", width: 1440, height: 900, coarse: false },
  { name: "phone portrait", width: 390, height: 844, coarse: true },
  { name: "phone landscape", width: 844, height: 390, coarse: true },
];
const performers = ["upperOne", "upperTwo", "bass", "lead", "arp", "drums"];
const lanes = ["upperOne", "upperTwo", "bass", "lead", "arp", "kick", "snare", "hats", "shaker"];

async function capture(page) {
  return page.evaluate(async () => {
    const { captureChiptuneState } = await import("./src/families/chiptune/chiptune-app.js");
    return captureChiptuneState();
  });
}

async function openPair(browser, baseURL, layout) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: layout.width, height: layout.height },
    hasTouch: layout.coarse,
    isMobile: layout.coarse,
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const pages = [];
  const diagnostics = [];
  try {
    for (const href of ["webgpu-chiptune.html", "simd-chiptune.html"]) {
      const page = await context.newPage();
      diagnostics.push(watchPageDiagnostics(page, { baseURL }));
      expect((await page.goto(href, { waitUntil: "domcontentloaded" }))?.ok()).toBe(true);
      await settlePage(page);
      await expect(page.locator("#sequenceLane-upperOne")).toBeAttached();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
      pages.push(page);
    }
    return { context, pages, diagnostics };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function controlInventory(page) {
  return page.evaluate(() => {
    // Runtime backend diagnostics are deliberately separate from musical controls.
    const musical = document.querySelectorAll(
      "#characterBayControls button, #previousPreset, #nextPreset, .panel input, .panel select, .panel button, .panel [role='slider']",
    );
    return [...musical].filter((element) => !element.closest('[data-section="output"], .midi-output-preview')).map((element) => ({
      id: element.id,
      role: element.getAttribute("role"),
      type: element.getAttribute("type"),
      min: element.getAttribute("min") ?? element.getAttribute("minlength"),
      max: element.getAttribute("max"),
      step: element.getAttribute("step"),
      param: element.dataset.paramKey ?? element.dataset.focusedParam ?? null,
      label: element.getAttribute("aria-label"),
      disabled: Boolean(element.disabled),
      options: element.options ? [...element.options].map(({ value, textContent }) => ({ value, textContent })) : null,
    }));
  });
}

async function expectStateParity(pages) {
  const [original, simd] = await Promise.all(pages.map(capture));
  expect(simd).toEqual(original);
  return original;
}

async function selectPerformer(page, performer) {
  const canvas = page.locator("#characterStage");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box.width * (performers.indexOf(performer) + 0.5) / performers.length, y: box.height * 0.38 } });
  await expect(page.locator(`[data-character-voice="${performer}"]`)).toHaveAttribute("data-active", "true");
}

async function setNumber(page, selector, value) {
  await page.locator(selector).fill(String(value));
  await page.locator(selector).press("Tab");
}

async function paintPitch(page) {
  await selectPerformer(page, "lead");
  await page.locator("#sequenceZoom").selectOption("32");
  await page.locator("#sequenceStateNote").click();
  const canvas = page.locator("#stage");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // Stay in the main note lane above its separate velocity/clock overview.
  const left = box.width <= 620 ? 45 : 66;
  const right = box.width <= 620 ? 5 : 10;
  const cell = (box.width - left - right) / 32;
  await page.mouse.move(box.x + left + cell * 2.5, box.y + 72);
  await page.mouse.down();
  await page.mouse.move(box.x + left + cell * 12.5, box.y + 110, { steps: 1 });
  await page.mouse.up();
}

for (const layout of layouts) {
  test(`SIMD Chiptune preserves the original musical interface and editing at ${layout.name}`, async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(60_000);
    const { context, pages, diagnostics } = await openPair(browser, baseURL, layout);
    try {
      const initial = await expectStateParity(pages);
      expect(initial.performanceVersion).toBe(2);
      expect(Object.keys(initial.voicePerformance).sort()).toEqual([...performers].sort());
      expect(Object.keys(initial.sequence.lanes).sort()).toEqual([...lanes].sort());
      for (const lane of lanes) expect(initial.sequence.lanes[lane].cells).toHaveLength(32);
      expect(await controlInventory(pages[1])).toEqual(await controlInventory(pages[0]));
      for (const page of pages) {
        await expect(page.locator("[data-character-mute]")).toHaveCount(6);
        await expect(page.locator("[data-character-solo]")).toHaveCount(6);
        const layoutReport = await page.evaluate(() => {
          const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          return { overflow: document.documentElement.scrollWidth - innerWidth, play: rect("#synthPlayButton"), audio: rect("#audioButton"), characters: rect("#characterStage") };
        });
        expect(layoutReport.overflow).toBeLessThanOrEqual(1);
        for (const rect of [layoutReport.play, layoutReport.audio, layoutReport.characters]) {
          expect(rect.left).toBeGreaterThanOrEqual(-1);
          expect(rect.right).toBeLessThanOrEqual(layout.width + 1);
          expect(rect.top).toBeGreaterThanOrEqual(-1);
          expect(rect.bottom).toBeLessThanOrEqual(layout.height + 1);
        }
        if (layout.coarse) for (const rect of [layoutReport.play, layoutReport.audio]) {
          expect(rect.width).toBeGreaterThanOrEqual(48);
          expect(rect.height).toBeGreaterThanOrEqual(48);
        }
      }
      // Paused performance uses composition time zero, so the actual character art matches.
      expect(await pages[1].locator("#characterStage").screenshot()).toEqual(await pages[0].locator("#characterStage").screenshot());
      for (const page of pages) {
        await page.locator('[data-character-mute="upperOne"]').click();
        await page.locator('[data-character-solo="lead"]').click();
        await page.locator('[data-character-solo="arp"]').click();
        await selectPerformer(page, "bass");
        await page.locator("#characterStage").focus();
        await page.keyboard.press("Home");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowUp");
      }
      const performed = await expectStateParity(pages);
      expect(performed.voicePerformance.upperOne.muted).toBe(true);
      expect(performed.voicePerformance.lead.solo).toBe(true);
      expect(performed.voicePerformance.arp.solo).toBe(true);
      expect(performed.voicePerformance.bass).not.toEqual(initial.voicePerformance.bass);
      for (const page of pages) {
        await page.locator("#compositionMode").selectOption("pattern");
        for (const [index, lane] of lanes.entries()) {
          await selectPerformer(page, index < 5 ? lane : "drums");
          await page.locator(`#sequenceLane-${lane}`).click();
          await setNumber(page, "#sequenceLength", index + 7);
          await page.locator("#sequenceStepFraction").selectOption(String((index + 1) / 8));
        }
        await page.locator('[data-drum-mute="hats"]').click();
        await page.locator('[data-drum-solo="kick"]').click();
      }
      const retimed = await expectStateParity(pages);
      for (const [index, lane] of lanes.entries()) {
        expect(retimed.sequence.lanes[lane].activeLength).toBe(index + 7);
        expect(retimed.sequence.lanes[lane].stepBeats).toBe((index + 1) / 8);
      }
      for (const page of pages) await paintPitch(page);
      const painted = await expectStateParity(pages);
      expect(painted.sequence.lanes.lead.cells).not.toEqual(retimed.sequence.lanes.lead.cells);
      expect(painted.sequence.lanes.lead.cells.slice(2, 13).every((cell) => cell.state === "note")).toBe(true);
      for (const page of pages) {
        await page.locator("#compositionMode").selectOption("song");
        await setNumber(page, "#sequenceValue", 9);
      }
      await expectStateParity(pages);
      for (const page of pages) await page.locator("#compositionMode").selectOption("pattern");
      const restored = await expectStateParity(pages);
      expect(restored.sequence).toEqual(painted.sequence);
      for (const page of pages) {
        await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
      }
      await testInfo.attach(`${layout.name}-parity.json`, { body: JSON.stringify({ lanes, performers, parameters: Object.keys(restored.parameters).length }), contentType: "application/json" });
      for (const diagnostic of diagnostics) expect(pageDiagnosticMessages(diagnostic)).toEqual([]);
    } finally { await context.close(); }
  });
}

test("SIMD Chiptune cycles through the exact original complete preset bank", async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const { context, pages, diagnostics } = await openPair(browser, baseURL, layouts[0]);
  try {
    const ids = await pages[0].locator("#presetButtons [data-preset-id]").evaluateAll((buttons) => buttons.map((button) => button.dataset.presetId));
    expect(ids.length).toBeGreaterThan(1);
    expect(await pages[1].locator("#presetButtons [data-preset-id]").evaluateAll((buttons) => buttons.map((button) => button.dataset.presetId))).toEqual(ids);
    const first = await expectStateParity(pages);
    const seen = new Set([first.activePresetId]);
    for (let index = 0; index < ids.length; index += 1) {
      for (const page of pages) await page.locator("#nextPreset").click();
      const state = await expectStateParity(pages);
      if (state.activePresetId === first.activePresetId) {
        expect(index + 1).toBe(ids.length);
        break;
      }
      expect(seen.has(state.activePresetId)).toBe(false);
      seen.add(state.activePresetId);
    }
    expect([...seen].sort()).toEqual([...ids].sort());
    expect((await capture(pages[1])).activePresetId).toBe(first.activePresetId);
    for (const diagnostic of diagnostics) expect(pageDiagnosticMessages(diagnostic)).toEqual([]);
  } finally { await context.close(); }
});

for (const gpuMode of ["missing", "throwing adapter"]) {
  test(`SIMD Chiptune plays and cleans up with WebGPU ${gpuMode}`, async ({ page, browserName, baseURL }, testInfo) => {
    test.skip(browserName !== "chromium", "Initial real-time worklet probes run in Chromium.");
    test.setTimeout(30_000);
    await page.addInitScript((mode) => {
      globalThis.__chiptuneGpuRequests = 0;
      Object.defineProperty(navigator, "gpu", { configurable: true, get: () => mode === "missing" ? undefined : {
        requestAdapter() { globalThis.__chiptuneGpuRequests += 1; throw new Error("WebGPU must not be used by SIMD Chiptune"); },
      } });
    }, gpuMode);
    const diagnostic = watchPageDiagnostics(page, { baseURL });
    await page.goto("simd-chiptune.html", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const audio = page.locator("#audioButton"), play = page.locator("#synthPlayButton");
    await expect(audio).toBeEnabled();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "true");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await expect.poll(async () => (await readAudioStatus(page)).peak, { timeout: 10_000 }).toBeGreaterThan(0.001);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 1100, intervalMs: 50 });
    await testInfo.attach(`${gpuMode}-audio.json`, { body: JSON.stringify(envelope, null, 2), contentType: "application/json" });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.activeSamples).toBeGreaterThan(0);
    expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
    expect(envelope.summary.maxPeak).toBeLessThan(1);
    expect(envelope.summary.clippedSamples).toBe(0);
    const connections = (await readAudioStatus(page)).connectionCount;
    expect(connections).toBeGreaterThan(0);
    await play.click();
    await expect(play).toHaveAttribute("aria-pressed", "false");
    await expect(audio).toHaveAttribute("aria-pressed", "true");
    await waitForStableAudioState(page, false, { stableMs: 500, timeout: 7000 });
    expect((await readAudioStatus(page)).connectionCount).toBe(connections);
    await audio.click();
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(await page.evaluate(() => globalThis.__chiptuneGpuRequests)).toBe(0);
    expect(pageDiagnosticMessages(diagnostic)).toEqual([]);
  });
}

test("forced scalar audio preserves live edits, level response, and worklet progress through a UI stall", async ({ page, browserName, baseURL }, testInfo) => {
  test.skip(browserName !== "chromium", "Initial real-time worklet probes run in Chromium.");
  test.setTimeout(30_000);
  const diagnostic = watchPageDiagnostics(page, { baseURL });
  await page.goto("simd-chiptune.html?scalar", { waitUntil: "domcontentloaded" });
  await settlePage(page);
  await page.evaluate(async () => {
    const { SimdChiptuneAudio } = await import("./src/instruments/simd-chiptune/audio.js");
    const probe = globalThis.__scalarChiptuneProbe = { starts: 0, restarts: 0, messages: [] };
    const start = SimdChiptuneAudio.prototype.start;
    const restart = SimdChiptuneAudio.prototype.restart;
    SimdChiptuneAudio.prototype.start = async function (...args) {
      probe.starts += 1;
      const result = await start.apply(this, args);
      probe.engine = this;
      probe.firstContext ??= this.context;
      this.node.port.addEventListener("message", ({ data }) => {
        if (data.type !== "telemetry") return;
        probe.messages.push({ seconds: data.seconds, audioTime: data.audioTime, backend: data.backend });
        if (probe.messages.length > 300) probe.messages.shift();
      });
      return result;
    };
    SimdChiptuneAudio.prototype.restart = function (...args) {
      probe.restarts += 1;
      return restart.apply(this, args);
    };
  });
  const probeStatus = () => page.evaluate(() => {
    const p = globalThis.__scalarChiptuneProbe;
    return { starts: p.starts, restarts: p.restarts, backend: p.engine?.backend,
      contextRetained: p.engine?.context === p.firstContext, running: p.engine?.running,
      playbackTime: p.engine?.currentPlaybackTime(), telemetry: p.engine?.workletTelemetry };
  });
  const setRange = (selector, value) => page.locator(selector).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  const audio = page.locator("#audioButton"), play = page.locator("#synthPlayButton");
  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await play.click();
  await expect.poll(async () => (await probeStatus()).telemetry?.backend).toBe("scalar");
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.001);
  const started = await probeStatus();
  const connections = (await readAudioStatus(page)).connectionCount;
  const originalPreset = (await capture(page)).activePresetId;

  await page.locator("#nextPreset").click();
  const selected = await capture(page);
  expect(selected.activePresetId).not.toBe(originalPreset);
  const originalTone = selected.parameters.upperOneTone;
  await setRange("#focused-upperOneTone", 0.17);
  await setNumber(page, "#sequenceLength", 11);
  await page.locator("#sequenceStepFraction").selectOption("0.375");
  const edited = await capture(page);
  expect(edited.parameters.upperOneTone).not.toBe(originalTone);
  expect(edited.sequence.lanes.upperOne.activeLength).toBe(11);
  expect(edited.sequence.lanes.upperOne.stepBeats).toBe(0.375);
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "true");
  const afterEdits = await probeStatus();
  expect(afterEdits.backend).toBe("scalar");
  expect(afterEdits.contextRetained).toBe(true);
  expect(afterEdits.starts).toBe(1);
  expect(afterEdits.restarts).toBe(started.restarts);
  expect(afterEdits.playbackTime).toBeGreaterThan(started.playbackTime);
  expect((await readAudioStatus(page)).connectionCount).toBe(connections);

  await setRange("#output", 0);
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeLessThan(0.0001);
  const quiet = await sampleAudioEnvelope(page, { durationMs: 300, intervalMs: 50 });
  await setRange("#output", 0.65);
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.001);
  const loud = await sampleAudioEnvelope(page, { durationMs: 900, intervalMs: 50 });
  expect(quiet.summary.maxPeak).toBeLessThan(0.0001);
  expect(loud.summary.maxPeak).toBeGreaterThan(0.001);
  expect(loud.summary.maxRms).toBeGreaterThan(quiet.summary.maxRms + 0.0001);
  expect(loud.summary.finite).toBe(true);
  expect(loud.summary.clippedSamples).toBe(0);

  const stall = await page.evaluate(() => {
    const p = globalThis.__scalarChiptuneProbe;
    p.messages = [];
    const before = { ...p.engine.workletTelemetry };
    const audioStart = p.engine.context.currentTime;
    const wallStart = performance.now();
    while (performance.now() - wallStart < 300) { /* Deliberate main-thread contention. */ }
    return { before, audioStart, audioEnd: p.engine.context.currentTime, elapsedMs: performance.now() - wallStart };
  });
  await expect.poll(async () => (await probeStatus()).telemetry?.audioTime ?? 0).toBeGreaterThanOrEqual(stall.audioEnd);
  const progress = await page.evaluate(({ audioStart, audioEnd }) => {
    const p = globalThis.__scalarChiptuneProbe;
    return { during: p.messages.filter(({ audioTime }) => audioTime > audioStart + 0.03 && audioTime < audioEnd - 0.015), after: p.engine.workletTelemetry };
  }, stall);
  expect(stall.elapsedMs).toBeGreaterThanOrEqual(280);
  expect(stall.audioEnd - stall.audioStart).toBeGreaterThan(0.2);
  expect(progress.during.length, "worklet messages must describe blocks rendered while the UI was blocked").toBeGreaterThanOrEqual(3);
  expect(progress.after.seconds - stall.before.seconds).toBeGreaterThan(0.2);
  for (let index = 1; index < progress.during.length; index += 1) {
    expect(progress.during[index].audioTime).toBeGreaterThan(progress.during[index - 1].audioTime);
    expect(progress.during[index].audioTime - progress.during[index - 1].audioTime).toBeLessThan(0.12);
  }
  expect((await probeStatus()).restarts).toBe(started.restarts);
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await testInfo.attach("scalar-continuity.json", { body: JSON.stringify({ started, afterEdits, quiet: quiet.summary, loud: loud.summary, stall, progress }, null, 2), contentType: "application/json" });
  await audio.click();
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostic)).toEqual([]);
});
