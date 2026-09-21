import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";

const snapshot = (page) => page.evaluate(async () => (await import("/src/instruments/rubix/rubix-app.js")).rubixPlaybackSnapshot());
async function selectPerformancePreset(page, id) {
  await page.locator(".header-preset-picker > summary").click();
  await page.locator(`.header-preset-picker button[data-preset-id="${id}"]`).click();
}
const setRange = (page, id, value) => page.locator(`#${id}`).evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, value);

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Random Twists shows play/pause for mouse, keyboard and presets at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/rubix.html");
    const button = page.locator("#randomTwists");
    const assertTwistState = async (running) => {
      const action = running ? "Pause random twists" : "Start random twists";
      await expect(button).toHaveAttribute("aria-pressed", String(running));
      await expect(button).toHaveAccessibleName(action);
      await expect(button).toHaveAttribute("title", action);
      await expect(button.locator(running ? ".transport-pause" : ".transport-play")).toBeVisible();
      await expect(button.locator(running ? ".transport-play" : ".transport-pause")).toBeHidden();
    };
    await button.scrollIntoViewIfNeeded();
    await assertTwistState(false);
    await setRange(page, "randomTwistSpeed", 100);
    const before = (await snapshot(page)).scoreIds;
    await button.click();
    await assertTwistState(true);
    await expect.poll(async () => (await snapshot(page)).scoreIds).not.toEqual(before);
    await button.screenshot({ path: info.outputPath("random-twists-pause.png") });
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");

    await button.press("Space");
    await assertTwistState(false);
    await page.waitForTimeout(350); // Let a turn already in progress finish.
    const stopped = (await snapshot(page)).scoreIds;
    await page.waitForTimeout(250);
    expect((await snapshot(page)).scoreIds).toEqual(stopped);
    await button.screenshot({ path: info.outputPath("random-twists-play.png") });
    await button.press("Enter");
    await assertTwistState(true);
    await button.click();
    await assertTwistState(false);

    await selectPerformancePreset(page, "pocket-funk");
    await button.scrollIntoViewIfNeeded();
    await assertTwistState(true);
    await page.locator("#solveCube").click();
    await assertTwistState(false);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  });
}

test("Rubix keeps all faces running and mixes ringing/queued voices while orbiting", async ({ page }, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/rubix.html");
  await page.locator("#playButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playButton").click();
  await page.waitForTimeout(450);
  const before = await snapshot(page);
  expect(before.events).toHaveLength(6);
  expect(before.events.filter((event) => event.gain > 0)).toHaveLength(3);
  expect(new Set(before.events.map((event) => event.face)).size).toBe(6);
  const canvas = await page.locator("#stage").boundingBox();
  const x = canvas.x + 20;
  const y = canvas.y + canvas.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + canvas.width * 0.6, y + 35, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(70);
  const after = await snapshot(page);
  expect(after.playing).toBe(true);
  expect(after.camera).not.toEqual(before.camera);
  const hiddenGates = after.gates.filter(({ id }) => !(after.visibility[id] > 0));
  expect(hiddenGates.length).toBeGreaterThan(0);
  await info.attach("orbit-gates.json", { body: JSON.stringify({ before, after, hiddenGates }), contentType: "application/json" });
  expect(hiddenGates.every(({ target }) => target === 0)).toBe(true);
  // Only gates with live inputs are evidence of audible output. Inactive gates
  // may retain a stale sampled .value; the offline test measures the waveform.
  expect(hiddenGates.filter(({ gain, active }) => active && Math.abs(gain) >= 0.00001)).toEqual([]);
  await page.locator("#resetView").click();
  await page.waitForTimeout(80);
  const reset = await snapshot(page);
  expect(reset.camera).toEqual(before.camera);
  const envelope = await sampleAudioEnvelope(page);
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.01);
  expect(envelope.summary.clippedSamples).toBe(0);
  await info.attach("orbit-mix.json", { body: JSON.stringify({ before, after, envelope }), contentType: "application/json" });
  await page.locator("#playButton").click();
  await waitForStableAudioState(page, false);
  await page.locator("#audioButton").click();
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test("every Rubix kit and acid stays bounded; drum-bank changes preserve transport", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto("/rubix.html");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await setRange(page, "tempo", 300);
  await page.locator("#playButton").click();
  await page.evaluate(() => {
    window.rubixTransportStops = 0;
    new MutationObserver(() => {
      if (document.querySelector("#playButton").getAttribute("aria-pressed") === "false") window.rubixTransportStops += 1;
    }).observe(document.querySelector("#playButton"), { attributes: true, attributeFilter: ["aria-pressed"] });
  });
  const summaries = {};
  for (const bank of ["soft-fm", "analog", "modal", "noise", "rattlesnake", "pitched-morph", "karplus-strong", "acid-303"]) {
    await page.locator("#soundBank").selectOption(bank);
    await expect.poll(async () => (await snapshot(page)).soundBank, { timeout: 15_000 }).toBe(bank);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(200);
    const envelope = await sampleAudioEnvelope(page, { durationMs: 700 });
    expect(envelope.summary.finite, bank).toBe(true);
    expect(envelope.summary.maxPeak, bank).toBeGreaterThan(0.005);
    expect(envelope.summary.clippedSamples, bank).toBe(0);
    expect(envelope.summary.maxPeak, bank).toBeLessThan(0.85);
    summaries[bank] = envelope.summary;
  }
  expect(await page.evaluate(() => window.rubixTransportStops)).toBe(0);
  await info.attach("kit-levels.json", { body: JSON.stringify(summaries, null, 2), contentType: "application/json" });
  await page.locator("#audioButton").click();
  await waitForStableAudioState(page, false);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Rubix shapes share the exact uncovered-area mix at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/rubix.html");
    for (const shape of ["cube", "orb", "diamond", "morphix", "stella"]) {
      await page.locator("#shape").selectOption(shape);
      await setRange(page, "rubixSize", 6);
      await page.waitForTimeout(100);
      const evidence = await page.evaluate(async () => {
        const s = (await import("/src/instruments/rubix/rubix-app.js")).rubixPlaybackSnapshot();
        const { createRubixVisibilityProfile } = await import("/src/rubix-visibility.js");
        return { ...s, expected: createRubixVisibilityProfile(s.geometry, s.viewport), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      expect(evidence.visibility).toEqual(evidence.expected);
      expect(evidence.events).toHaveLength(6);
      expect(Object.values(evidence.visibility).every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(evidence.overflow).toBe(false);
      await expect(page.locator("#stageReadout")).not.toContainText("VISIBLE NONE");
    }
    await page.locator("#playButton").scrollIntoViewIfNeeded();
    await expect(page.locator("#playButton")).toBeInViewport();
    await page.screenshot({ path: info.outputPath("rubix-layout.png"), fullPage: true });
  });
}

test("live gain fades a sustained note to the new area, then exact hidden silence", async ({ page }, info) => {
  await page.goto("/rubix.html");
  const result = await page.evaluate(async () => {
    const { RubixStickerMixer } = await import("/src/rubix-mix.js");
    const context = new OfflineAudioContext(1, 48000, 48000);
    const mixer = new RubixStickerMixer(context);
    mixer.update({ test: 1 });
    const source = context.createOscillator();
    source.frequency.value = 220;
    source.connect(mixer.destination("test", context.destination));
    source.start(0);
    source.stop(1);
    const half = context.suspend(0.25).then(() => { mixer.update({ test: 0.25 }); return context.resume(); });
    const hidden = context.suspend(0.6).then(() => { mixer.update({}); return context.resume(); });
    const buffer = await context.startRendering();
    await Promise.all([half, hidden]);
    const samples = buffer.getChannelData(0);
    const rms = (from, to) => {
      let energy = 0;
      for (let i = from; i < to; i += 1) energy += samples[i] ** 2;
      return Math.sqrt(energy / (to - from));
    };
    mixer.dispose();
    return { full: rms(4800, 9600), quarter: rms(18000, 24000), hidden: rms(33600, 43200), finite: samples.every(Number.isFinite) };
  });
  expect(result.finite).toBe(true);
  expect(result.quarter / result.full).toBeCloseTo(0.25, 2);
  expect(result.hidden).toBe(0);
  await info.attach("sustained-area-gain.json", { body: JSON.stringify(result), contentType: "application/json" });
});

test("uncovered polygon areas agree with an independent Canvas ID render", async ({ page }, info) => {
  await page.goto("/rubix.html");
  const measurements = [];
  for (const shape of ["cube", "orb", "diamond", "morphix", "stella"]) {
    await page.locator("#shape").selectOption(shape);
    await setRange(page, "rubixSize", 6);
    await page.waitForTimeout(60);
    const evidence = await page.evaluate(async () => {
      const s = (await import("/src/instruments/rubix/rubix-app.js")).rubixPlaybackSnapshot();
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(s.viewport.width * 2);
      canvas.height = Math.round(s.viewport.height * 2);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.scale(2, 2);
      const paint = (points, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath();
        ctx.fill();
      };
      for (const [index, item] of s.geometry.entries()) {
        for (const triangle of item.baseSurface.triangles) {
          if (triangle.visible) paint(triangle.points, "rgb(0,0,0)");
        }
        for (const triangle of item.projectedTriangles) paint(triangle, `rgb(${index + 1},255,128)`);
      }
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = Array(s.geometry.length).fill(0);
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 128
          && pixels[i] > 0 && pixels[i] <= counts.length) counts[pixels[i] - 1] += 1;
      }
      const max = Math.max(...counts);
      const differences = s.geometry.map((item, i) => Math.abs((s.visibility[item.sticker.id] ?? 0) - counts[i] / max));
      return { maxError: Math.max(...differences), visible: counts.filter((n) => n > 0).length };
    });
    // Raster antialiasing removes a thin boundary; analytic areas retain it.
    expect(evidence.maxError, shape).toBeLessThan(0.045);
    measurements.push({ shape, ...evidence });
  }
  await info.attach("raster-area-oracle.json", { body: JSON.stringify(measurements), contentType: "application/json" });
});

test("Rubix SIMD runs six audio-clock face voices without WebGPU or chunk priming", async ({ page }, info) => {
  test.setTimeout(60_000);
  // GPU must not be consulted by the replacement, even on machines with one.
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", {
    configurable: true, get() { throw new Error("Rubix must not request WebGPU"); },
  }));
  await page.goto("/rubix.html");
  await expect(page.locator("#acidEngine")).toHaveValue("simd-303");
  await page.locator("#soundBank").selectOption("acid-303");
  await page.locator("#acidEngine").selectOption("simd-303");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  await expect.poll(async () => (await snapshot(page)).simdVoices).toBe(6);
  expect((await snapshot(page)).simdBackend).toBe("simd");
  await page.evaluate(async () => {
    const { rubixPlaybackSnapshot } = await import("/src/instruments/rubix/rubix-app.js");
    document.querySelector("#playButton").addEventListener("click", () => {
      window.rubixPlayClickTime = rubixPlaybackSnapshot().audioTime;
    }, { capture: true, once: true });
  });
  await page.locator("#playButton").click();
  const beforePlay = await page.evaluate(() => window.rubixPlayClickTime);
  const running = await snapshot(page);
  expect(running.simdTimelineStart - beforePlay).toBeGreaterThanOrEqual(0);
  expect(running.simdTimelineStart - beforePlay).toBeLessThan(0.025);
  expect(running.simdTimelineStart - running.audioTime).toBeLessThan(0.025);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 1500 });
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  const originalStart = (await snapshot(page)).simdTimelineStart;
  await page.locator('[data-read-mode="face"]').click();
  await setRange(page, "swing", 0.3);
  await setRange(page, "tempo", 180);
  expect((await snapshot(page)).simdTimelineStart).toBe(originalStart);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(250);
  const paired = await sampleAudioEnvelope(page);
  expect(paired.summary.maxPeak).toBeGreaterThan(0.001);
  expect(paired.summary.clippedSamples).toBe(0);
  const beforeStall = await snapshot(page);
  await page.evaluate(() => {
    const until = performance.now() + 220;
    while (performance.now() < until) { /* simulate a rendering/UI stall */ }
  });
  await page.waitForTimeout(70);
  const afterStall = await snapshot(page);
  expect(afterStall.simdStatus.beat - beforeStall.simdStatus.beat).toBeGreaterThan(2);
  expect(afterStall.simdTimelineStart).toBe(originalStart);
  const canvas = await page.locator("#stage").boundingBox();
  await page.mouse.move(canvas.x + 15, canvas.y + canvas.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.65, canvas.y + canvas.height * 0.7, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const rotated = await snapshot(page);
  expect(rotated.simdStatus.gates.every(({ id, target }) => target === (rotated.visibility[id] ?? 0))).toBe(true);
  expect(rotated.simdStatus.gates.filter(({ id }) => !rotated.visibility[id]).every(({ gain }) => gain === 0)).toBe(true);
  await info.attach("simd-six-face-levels.json", {
    body: JSON.stringify({ envelope, paired, beforePlay, running, beforeStall, afterStall, rotated }),
    contentType: "application/json",
  });
  await page.locator("#audioButton").click();
  await waitForStableAudioState(page, false);
  expect((await snapshot(page)).simdVoices).toBe(0);
});

test("Rubix SIMD falls back to scalar Wasm and can switch to Classic without losing audio", async ({ page }) => {
  await page.goto("/rubix.html?scalar=1");
  await page.locator("#soundBank").selectOption("acid-303");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  expect((await snapshot(page)).simdBackend).toBe("scalar");
  await page.locator("#playButton").click();
  expect((await sampleAudioEnvelope(page)).summary.maxPeak).toBeGreaterThan(0.005);
  await page.locator("#acidEngine").selectOption("web-audio");
  await expect.poll(async () => (await snapshot(page)).simdVoices).toBe(0);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect((await sampleAudioEnvelope(page)).summary.maxPeak).toBeGreaterThan(0.005);
  await page.locator("#acidEngine").selectOption("simd-303");
  await expect.poll(async () => (await snapshot(page)).simdVoices).toBe(6);
  await page.locator("#playButton").click();
  await waitForStableAudioState(page, false);
  await page.locator("#audioButton").click();
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("Rubix keeps its Classic fallback playable when Wasm cannot load", async ({ page }) => {
  await page.route("**/assets/wasm/simd-303-*.wasm", (route) => route.abort());
  await page.goto("/rubix.html");
  await page.locator("#soundBank").selectOption("acid-303");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#acidEngine")).toHaveValue("web-audio");
  expect((await snapshot(page)).simdVoices).toBe(0);
  await page.locator("#playButton").click();
  expect((await sampleAudioEnvelope(page)).summary.maxPeak).toBeGreaterThan(0.005);
  await page.locator("#audioButton").click();
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("master dynamics reduce dense-versus-sparse level swings without clipping", async ({ page }, info) => {
  await page.goto("/rubix.html");
  const measurements = await page.evaluate(async () => {
    const { createRubixDynamics } = await import("/src/rubix-mix.js");
    const results = [];
    for (const count of [1, 3, 6]) {
      const context = new OfflineAudioContext(1, 48000, 48000);
      const { compressor, output } = createRubixDynamics(context);
      output.connect(context.destination);
      for (let index = 0; index < count; index += 1) {
        const source = context.createOscillator();
        const level = context.createGain();
        level.gain.value = 0.15;
        source.frequency.value = 110;
        source.connect(level).connect(compressor);
        source.start(0);
        source.stop(1);
      }
      const samples = (await context.startRendering()).getChannelData(0);
      let energy = 0;
      let peak = 0;
      for (let i = 24000; i < 43200; i += 1) {
        energy += samples[i] ** 2;
        peak = Math.max(peak, Math.abs(samples[i]));
      }
      results.push({ count, rms: Math.sqrt(energy / 19200), peak, finite: samples.every(Number.isFinite) });
    }
    return results;
  });
  expect(measurements.every(({ finite, peak }) => finite && peak < 0.85)).toBe(true);
  const ratio = measurements[2].rms / measurements[0].rms;
  expect(ratio).toBeGreaterThan(1);
  expect(ratio).toBeLessThan(3); // Uncompressed identical sources have a 6:1 ratio.
  await info.attach("density-compression.json", { body: JSON.stringify(measurements), contentType: "application/json" });
});

test("touch orbit changes the live mix and keeps phone transport targets reachable", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await page.goto(`${test.info().project.use.baseURL}/rubix.html`);
    for (const selector of ["#audioButton", "#playButton"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    const before = await snapshot(page);
    const box = await page.locator("#stage").boundingBox();
    const cdp = await context.newCDPSession(page);
    const x = Math.round(box.x + 15);
    const y = Math.round(box.y + box.height * 0.65);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 110, y: y - 30 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(70);
    const after = await snapshot(page);
    expect(after.camera).not.toEqual(before.camera);
    expect(after.visibility).not.toEqual(before.visibility);
    expect(after.audioOn).toBe(false);
  } finally {
    await context.close();
  }
});

test("performance preset recall preserves performer volumes and Morphix Drift has a usable level", async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto("/rubix.html");
  await setRange(page, "output", 0.61);
  await setRange(page, "acidLevel", 0.63);
  await setRange(page, "drumLevel", 0.59);
  const levels = (await snapshot(page)).levels;
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playButton").click();
  const measurements = {};
  for (const id of ["classic", "pocket-funk", "modal-sphere", "noise-grid", "pyramid-drift"]) {
    await selectPerformancePreset(page, id);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    if (await page.locator("#randomTwists").getAttribute("aria-pressed") === "true") await page.locator("#randomTwists").click();
    expect((await snapshot(page)).levels, id).toEqual(levels);
    await page.waitForTimeout(250);
    measurements[id] = (await sampleAudioEnvelope(page, { durationMs: 1400 })).summary;
    expect(measurements[id].clippedSamples, id).toBe(0);
    expect(measurements[id].meanRms, id).toBeGreaterThan(0.045);
  }
  expect((await snapshot(page)).acidEngine).toBe("simd-303");
  expect((await snapshot(page)).simdPreset).toBe("morphix-bloom");
  expect(measurements["pyramid-drift"].meanRms / measurements.classic.meanRms).toBeGreaterThan(0.5);
  await info.attach("performance-preset-levels.json", { body: JSON.stringify(measurements), contentType: "application/json" });
  await setRange(page, "output", 0);
  for (const id of ["pocket-funk", "pyramid-drift", "classic"]) {
    await selectPerformancePreset(page, id);
    expect((await snapshot(page)).levels.output).toBe(0);
  }
  await waitForStableAudioState(page, false);
  await page.locator("#audioButton").click();
});

test("SIMD sound presets preserve cube, levels and clock and remain audibly distinct", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto("/rubix.html");
  await page.locator("#soundBank").selectOption("acid-303");
  await page.locator("#shape").selectOption("morphix");
  await setRange(page, "rubixSize", 4);
  await setRange(page, "tempo", 142);
  await setRange(page, "output", 0.54);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playButton").click();
  const before = await snapshot(page);
  const ids = await page.locator("#simdPreset option").evaluateAll((options) => options.map((o) => o.value).filter(Boolean));
  expect(ids).toHaveLength(9);
  const measurements = {};
  for (const id of ids) {
    await page.locator("#simdPreset").selectOption(id);
    const state = await snapshot(page);
    expect(state.levels).toEqual(before.levels);
    expect(state.scoreIds).toEqual(before.scoreIds);
    expect(state.camera).toEqual(before.camera);
    expect(state.shape).toBe(before.shape);
    expect(state.size).toBe(before.size);
    expect(state.simdTimelineStart).toBe(before.simdTimelineStart);
    expect(state.playing).toBe(true);
    await expect(page.locator("#tempo")).toHaveValue("142");
    await page.waitForTimeout(150);
    measurements[id] = (await sampleAudioEnvelope(page, { durationMs: 1000 })).summary;
    expect(measurements[id].finite).toBe(true);
    expect(measurements[id].clippedSamples).toBe(0);
    expect(measurements[id].meanRms, id).toBeGreaterThan(0.02);
  }
  await info.attach("simd-preset-levels.json", { body: JSON.stringify(measurements), contentType: "application/json" });
  await setRange(page, "cutoff", 2100);
  await expect(page.locator("#simdPreset")).toHaveValue("");
  await expect(page.locator("#simdPresetState")).toHaveText("Custom");
  await setRange(page, "output", 0);
  await page.locator("#simdPreset").selectOption("morphix-bloom");
  expect((await snapshot(page)).levels.output).toBe(0);
  await waitForStableAudioState(page, false);
  await page.locator("#audioButton").click();
});

test("SIMD tone follows actual warped geometry, orbit and visibility while the clock keeps running", async ({ page }, info) => {
  await page.goto("/rubix.html");
  await page.locator("#soundBank").selectOption("acid-303");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playButton").click();
  await page.waitForTimeout(200);
  const before = await snapshot(page);
  await page.locator("#shape").selectOption("stella");
  await page.waitForTimeout(200);
  const shape = await snapshot(page);
  expect(shape.simdTimelineStart).toBe(before.simdTimelineStart);
  expect(shape.scoreIds).toEqual(before.scoreIds);
  expect(shape.simdStatus.gates.map(({ filter, pan }) => [filter, pan]))
    .not.toEqual(before.simdStatus.gates.map(({ filter, pan }) => [filter, pan]));
  const box = await page.locator("#stage").boundingBox();
  await page.mouse.move(box.x + 12, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.7, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await snapshot(page);
  expect(after.simdTimelineStart).toBe(before.simdTimelineStart);
  expect(after.simdStatus.gates.every(({ id, target }) => target === (after.visibility[id] ?? 0))).toBe(true);
  expect(after.simdStatus.gates.filter(({ id }) => !after.visibility[id]).every(({ gain }) => gain === 0)).toBe(true);
  await info.attach("surface-tone.json", { body: JSON.stringify({ before, shape, after }), contentType: "application/json" });
  await page.locator("#audioButton").click();
});

test("SIMD level remains usable across all cube sizes and protects maximum settings", async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto("/rubix.html");
  await page.locator("#soundBank").selectOption("acid-303");
  await page.locator("#simdPreset").selectOption("morphix-bloom");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playButton").click();
  const results = {};
  for (const size of [2, 3, 4, 5, 6]) {
    await setRange(page, "rubixSize", size);
    await page.waitForTimeout(160);
    results[size] = (await sampleAudioEnvelope(page, { durationMs: 1200 })).summary;
    expect(results[size].meanRms).toBeGreaterThan(0.055);
    expect(results[size].clippedSamples).toBe(0);
  }
  const levels = Object.values(results).map(({ meanRms }) => meanRms);
  expect(Math.max(...levels) / Math.min(...levels)).toBeLessThan(2);
  await setRange(page, "acidLevel", 1);
  await setRange(page, "output", 0.9);
  await setRange(page, "resonance", 18);
  await setRange(page, "drive", 6);
  await setRange(page, "tempo", 300);
  const loud = (await sampleAudioEnvelope(page)).summary;
  expect(loud.clippedSamples).toBe(0);
  expect(loud.maxPeak).toBeLessThan(0.98);
  await info.attach("size-levels.json", { body: JSON.stringify({ results, loud }), contentType: "application/json" });
  await page.locator("#audioButton").click();
});
