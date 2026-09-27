import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

async function instrument(page) {
  await page.addInitScript(() => {
    globalThis.__micRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      __micRequests++;
      const context = new AudioContext(), oscillator = context.createOscillator();
      oscillator.frequency.value = 220;
      const gain = context.createGain(); gain.gain.value = .12;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
      const track = destination.stream.getTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { stop(); oscillator.stop(); void context.close(); };
      return destination.stream;
    };
  });
  await page.route("**/src/instruments/l-systems/l-systems-app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      globalThis.__ls = { state, synthPool, drumAudio, micEngine, applyFullPreset,
        get clock() { return discreteClock; }, get presets() { return presetController; },
        get snapshot() { return captureLSystemsPreset(state, amplitudeControl.captureState()); } };
    ` });
  });
  await page.goto("l-systems.html");
  await page.waitForFunction(() => globalThis.__ls);
}
const capture = page => page.evaluate(() => structuredClone(__ls.snapshot));

for (const [name, viewport, hasTouch] of [["desktop", { width: 1440, height: 900 }, false], ["portrait", { width: 390, height: 844 }, true], ["landscape", { width: 844, height: 390 }, true]]) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch });
    test("top presets, Next and Random are reachable; Mic stays separate and silent until explicitly armed", async ({ page, baseURL }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await instrument(page);
      const before = await capture(page);
      expect(await page.evaluate(() => __ls.presets.bank.length)).toBe(48);
      expect(await page.locator("#mainPresets .header-preset-controls").count()).toBe(1);
      const presetBox = await page.locator("#mainPresets").boundingBox();
      const modeBox = await page.locator("#playingMode").boundingBox();
      expect(presetBox.y + presetBox.height).toBeLessThanOrEqual(modeBox.y);
      await page.locator(".header-preset-next").click();
      expect(await capture(page)).not.toEqual(before);
      const chosen = await capture(page);
      await page.locator(".header-preset-random").click();
      expect(await capture(page)).not.toEqual(chosen);
      expect(await page.evaluate(() => __ls.presets.selectedId)).toBeNull();
      await page.locator("#modeMic").click();
      expect(await page.evaluate(() => __ls.presets.bank.length)).toBe(16);
      await expect(page.locator("#presetBankLabel")).toContainText("Mic");
      await page.locator(".header-preset-next").click();
      await expect(page.locator("#geometryModel")).toHaveValue("generations");
      for (const id of ["speed", "position", "subdivisions", "micFeedback", "micInterval", "micTimeRatio", "micPitchRange", "lengthScale"]) await expect(page.locator(`#${id}`)).toBeHidden();
      for (const id of ["micIntervalMs", "micPitchScale", "micDry"]) await expect(page.locator(`#${id}`)).toBeVisible();
      await page.locator("#geometryModel").selectOption("rewrite");
      for (const id of ["speed", "position", "subdivisions", "micFeedback", "micInterval", "micTimeRatio", "micPitchRange"]) await expect(page.locator(`#${id}`)).toBeVisible();
      await page.locator("#playButton").click();
      expect(await page.evaluate(() => __micRequests)).toBe(0);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const selector of [".header-preset-next", ".header-preset-random", "#playButton", "#resetAll"]) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const b = await page.locator(selector).boundingBox();
        expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(viewport.height + 1);
        if (hasTouch && selector === "#playButton") { expect(b.height).toBeGreaterThanOrEqual(48); expect(b.width).toBeGreaterThanOrEqual(48); }
      }
      await page.locator("#mainPresets").scrollIntoViewIfNeeded();
      await testInfo.attach(`${name}.png`, { body: await page.screenshot(), contentType: "image/png" });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

test("all 64 scenes round-trip through Next without changing transport, master or the other bank's sounds", async ({ page, baseURL }) => {
  test.setTimeout(90000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await instrument(page);
  await page.locator("#level").evaluate(el => { el.value = "0.34"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const mic = await page.evaluate(() => structuredClone(__ls.state.mic));
  for (let i = 0; i < 48; i++) {
    await page.locator(".header-preset-next").click();
    expect(await capture(page)).toEqual(await page.evaluate(i => __ls.presets.bank[i].snapshot, i));
    expect(await page.evaluate(() => __ls.state.mic)).toEqual(mic);
  }
  const synth = await page.evaluate(() => structuredClone(__ls.state.synth));
  const drums = await page.evaluate(() => structuredClone(__ls.state.drums));
  await page.locator("#modeMic").click();
  for (let i = 0; i < 16; i++) {
    await page.locator(".header-preset-next").click();
    expect(await capture(page)).toEqual(await page.evaluate(i => __ls.presets.bank[i].snapshot, i));
    expect(await page.evaluate(() => __ls.state.synth)).toEqual(synth);
    expect(await page.evaluate(() => __ls.state.drums)).toEqual(drums);
  }
  expect(await page.evaluate(() => [__ls.state.level, __ls.state.playing, __ls.state.audio, __micRequests])).toEqual([.34, false, false, 0]);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("same-mode live recall and new sound controls preserve the note clock, queued tails and master", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL }); await instrument(page);
  await page.evaluate(() => __ls.presets.view.select("notes-2"));
  await page.locator("#audioButton").click(); await page.waitForFunction(() => __ls.synthPool.enabled);
  await page.locator("#playButton").click(); await page.waitForFunction(() => __ls.clock);
  await page.evaluate(() => { __ls.savedClock = __ls.clock; __ls.savedBudget = __ls.clock.budget; __ls.savedContext = __ls.synthPool.context; __ls.cancelCount = 0; const cancel = __ls.synthPool.cancelScheduledNotes.bind(__ls.synthPool); __ls.synthPool.cancelScheduledNotes = (...args) => { __ls.cancelCount++; return cancel(...args); }; });
  for (const id of ["notes-3", "notes-6", "notes-8"]) {
    await page.evaluate(id => __ls.presets.view.select(id), id); await page.waitForTimeout(90);
    expect(await page.evaluate(() => __ls.clock === __ls.savedClock && __ls.clock.budget === __ls.savedBudget && __ls.synthPool.context === __ls.savedContext)).toBe(true);
  }
  for (const [id, values] of [["modulationRatio", [1.2, 2.7, .5]], ["cutoff", [900, 3500, 1800]], ["resonance", [.4, 1.2, .7]], ["noteDuration", [.2, .5, .3]]]) for (const v of values) await page.locator(`#${id}`).fill(String(v));
  expect(await page.evaluate(() => __ls.cancelCount)).toBe(0);
  const signal = await sampleAudioEnvelope(page, { durationMs: 1200 });
  expect(signal.summary.maxRms).toBeGreaterThan(.0005); expect(signal.summary.clippedSamples).toBe(0);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const mode of ["triangle", "square", "saw"]) test(`${mode} notes and continuous are audible and bounded`, async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL }); await instrument(page);
  await page.locator("#soundMode").selectOption(mode);
  await page.locator("#audioButton").click(); await page.waitForFunction(() => __ls.synthPool.enabled);
  await page.locator("#playButton").click();
  for (const id of ["modeContinuous", "modeNotes"]) {
    await page.locator(`#${id}`).click(); const signal = await sampleAudioEnvelope(page, { durationMs: 1000 });
    expect(signal.summary.maxRms).toBeGreaterThan(.001); expect(signal.summary.clippedSamples).toBe(0);
  }
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Mic recall and delay sliders keep one input, one context and the same history", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL }); await instrument(page);
  await page.locator("#modeMic").click(); await page.locator(".header-preset-next").click();
  await page.locator("#audioButton").click(); await page.waitForFunction(() => __ls.micEngine.enabled);
  await page.locator("#playButton").click();
  await page.evaluate(() => { __ls.stream = __ls.micEngine.stream; __ls.processor = __ls.micEngine.generationProcessor; __ls.context = __ls.micEngine.context; });
  const initial = await sampleAudioEnvelope(page, { durationMs: 1600 }); expect(initial.summary.maxRms).toBeGreaterThan(.0005);
  await page.locator(".header-preset-next").click();
  for (const [id, values] of [["micIntervalMs", [120, 280, 500]], ["micPitchScale", [.2, .7, 1]], ["childTimeRatio", [.65, .85, 1.1]], ["mutation", [.1, .2, .05]], ["pruningBias", [-.5, .5, 0]]]) for (const v of values) await page.locator(`#${id}`).fill(String(v));
  expect(await page.evaluate(() => __ls.micEngine.stream === __ls.stream && __ls.micEngine.context === __ls.context && __ls.micEngine.generationProcessor === __ls.processor)).toBe(true);
  expect(await page.evaluate(() => __micRequests)).toBe(1);
  await page.locator("#geometryModel").selectOption("rewrite"); await page.waitForTimeout(100);
  await page.locator("#geometryModel").selectOption("generations"); expect(await page.evaluate(() => __micRequests)).toBe(1);
  const live = await sampleAudioEnvelope(page, { durationMs: 1200 });
  expect(live.summary.maxRms).toBeGreaterThan(.0005); expect(live.summary.clippedSamples).toBe(0);
  await page.locator("#playButton").click(); await page.waitForTimeout(700); expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
  expect(await page.evaluate(() => __ls.stream.getTracks()[0].readyState)).toBe("live");
  await page.locator("#audioButton").click(); expect(await page.evaluate(() => __ls.stream.getTracks()[0].readyState)).toBe("ended");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("cancelled microphone permission cannot revive audio or disrupt a newer explicit start", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL }); await instrument(page);
  await page.evaluate(() => {
    const get = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await get(...args);
      globalThis.__lateStream = stream;
      await new Promise(resolve => globalThis.__grant = resolve);
      return stream;
    };
    globalThis.__resumeMicFactory = () => navigator.mediaDevices.getUserMedia = get;
  });
  await page.locator("#modeMic").click(); await page.locator(".header-preset-next").click();
  await page.locator("#audioButton").click(); await page.waitForFunction(() => globalThis.__grant);
  await page.locator("#audioButton").click();
  await page.evaluate(() => __resumeMicFactory());
  await page.locator("#audioButton").click(); await page.waitForFunction(() => __ls.micEngine.enabled);
  await page.evaluate(() => __grant());
  await expect.poll(() => page.evaluate(() => __lateStream.getTracks()[0].readyState)).toBe("ended");
  expect(await page.evaluate(() => __ls.micEngine.stream.getTracks()[0].readyState)).toBe("live");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioError")).toBeHidden();
  await page.locator("#modeNotes").click();
  expect(await page.evaluate(() => __ls.micEngine.stream)).toBeNull();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const style of ["drum-bank", "rattlesnake-physical", "karplus-strong", "karplus-tines", "karplus-objects"]) test(`${style}: bounded trigger bank sounds, stops and tears down`, async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL }); await instrument(page);
  await page.locator("#modeTriggers").click(); await page.locator("#percussionStyle").selectOption(style);
  await page.locator("#audioButton").click(); await page.waitForFunction(() => __ls.drumAudio.context?.state === "running");
  await page.locator("#playButton").click(); const signal = await sampleAudioEnvelope(page, { durationMs: 1600 });
  expect(signal.summary.maxRms).toBeGreaterThan(.0005); expect(signal.summary.clippedSamples).toBe(0);
  await page.locator("#playButton").click(); await page.waitForTimeout(600);
  expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a failed Mic processor releases input and can be explicitly restarted", async ({ page }) => {
  await instrument(page); await page.locator("#modeMic").click(); await page.locator(".header-preset-next").click();
  await page.locator("#audioButton").click(); await page.waitForFunction(() => __ls.micEngine.enabled);
  await page.evaluate(() => {
    __ls.failedStream = __ls.micEngine.stream;
    __ls.failedProcessor = __ls.micEngine.generationProcessor;
    __ls.failedProcessor.onprocessorerror();
  });
  expect(await page.evaluate(() => __ls.failedStream.getTracks()[0].readyState)).toBe("ended");
  await expect(page.locator("#audioError")).toBeVisible();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click(); await page.waitForFunction(() => __ls.micEngine.enabled);
  expect(await page.evaluate(() => __ls.micEngine.generationProcessor !== __ls.failedProcessor)).toBe(true);
  await expect(page.locator("#audioError")).toBeHidden();
  await page.locator("#audioButton").click();
});
