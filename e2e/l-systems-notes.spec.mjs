import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

async function instrument(page) {
  await page.addInitScript(() => {
    globalThis.__lsEvents = [];
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(function paint(time) {
      if (globalThis.__pausePaint) raf(paint); else callback(time);
    });
  });
  await page.route("**/src/audio.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      for (const method of ["scheduleNotes", "strike", "cancelScheduledNotes", "releaseNotes"]) {
        const original = VoicePool.prototype[method];
        VoicePool.prototype[method] = function (...args) {
          globalThis.__lsPool = this;
          globalThis.__lsEvents.push({ method, at: this.context?.currentTime ?? 0, voices: args[0], options: args[1] });
          return original.apply(this, args);
        };
      }` });
  });
  await page.route("**/src/instruments/l-systems/discrete-audio.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const read = LSystemEventClock.prototype.read;
      LSystemEventClock.prototype.read = function (now) {
        const entries = read.call(this, now);
        globalThis.__lsClockCount ??= 0;
        this.__probeClockId ??= ++globalThis.__lsClockCount;
        globalThis.__lsEvents.push({ method: "clock", at: now, entries, clockId: this.__probeClockId });
        return entries;
      };` });
  });
  await page.goto("l-systems.html");
}
async function arm(page, { iterations = 3, subdivisions = 4, engine = "sine", speed = 0.7 } = {}) {
  await page.locator("#modeNotes").click();
  await page.locator("#iterations").fill(String(iterations));
  await page.locator("#subdivisions").fill(String(subdivisions));
  await page.locator("#speed").fill(String(speed));
  await page.locator("#soundMode").selectOption(engine);
  await page.locator("#audioButton").click();
  await page.waitForFunction(() => globalThis.__lsPool?.enabled && globalThis.__lsPool?.context?.state === "running");
  await page.waitForTimeout(100);
  await page.locator("#playButton").click();
}
const noteEvents = page => page.evaluate(() => __lsEvents.filter(event => event.method === "scheduleNotes"));

for (const [name, width, height] of [["desktop", 1440, 900], ["portrait", 390, 844], ["landscape", 844, 390]]) {
  test(`${name}: integer subdivisions are beside Speed, shared and reachable without arming Audio`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await instrument(page);
    await expect(page.locator("#subdivisions")).toBeHidden();
    for (const mode of ["notes", "triggers"]) {
      await page.locator(`#mode${mode === "notes" ? "Notes" : "Triggers"}`).click();
      await expect(page.locator("#subdivisions")).toBeVisible();
      for (let value = 1; value <= 16; value++) {
        await page.locator("#subdivisions").fill(String(value));
        await expect(page.locator("#subdivisionsOut")).toHaveText(String(value));
      }
      expect(await page.locator(".l-systems-play-rack #subdivisions").count()).toBe(1);
      await page.locator("#subdivisions").scrollIntoViewIfNeeded();
      const box = await page.locator("#subdivisions").boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    await page.locator("#modeNotes").click();
    await expect(page.locator("#subdivisions")).toHaveValue("16");
    await page.locator("#playButton").click(); await page.waitForTimeout(150);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
  test(`${name}: dense Notes use bounded full envelopes and survive paint pauses, edits and stop`, async ({ page, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height });
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await instrument(page);
    await arm(page, { iterations: 10, subdivisions: 16, speed: 1.4 });
    const initial = await sampleAudioEnvelope(page, { durationMs: 1500 });
    expect(initial.summary.maxRms).toBeGreaterThan(0.001);
    expect(initial.summary.clippedSamples).toBe(0);
    await page.evaluate(() => { __pausePaint = true; __lsEvents = []; });
    const unpainted = await sampleAudioEnvelope(page, { durationMs: 450 });
    const scheduled = await noteEvents(page);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(unpainted.summary.maxRms).toBeGreaterThan(0.001);
    expect(scheduled.every(event => event.options.startAt >= event.at - 0.015)).toBe(true);
    expect(scheduled.length).toBeLessThanOrEqual(16 + 128 * 0.6);
    await page.evaluate(() => { __pausePaint = false; });
    for (const value of [3, 5, 1, 9]) await page.locator("#subdivisions").fill(String(value));
    await page.locator("#traversalDirection").click();
    await page.locator("#pingPongMotion").click();
    await page.waitForTimeout(500);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => __lsEvents.filter(event => event.method === "strike").length)).toBe(0);
    await page.locator("#playButton").click(); await page.waitForTimeout(250);
    const stopped = (await noteEvents(page)).length;
    await page.waitForTimeout(180);
    expect((await noteEvents(page)).length).toBe(stopped);
    expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await testInfo.attach("dense-notes.json", { body: JSON.stringify({ initial, unpainted, scheduled }), contentType: "application/json" });
  });
}
for (const engine of ["sine", "fm", "pm", "shepard"]) test(`${engine}: subdivision 1 has audible first hits and uses the selected synthesis engine`, async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await instrument(page); await arm(page, { subdivisions: 1, engine });
  const signal = await sampleAudioEnvelope(page, { durationMs: 1600 });
  expect(signal.summary.maxRms).toBeGreaterThan(0.001);
  expect(signal.summary.clippedSamples).toBe(0);
  const notes = await noteEvents(page);
  expect(notes.length).toBeGreaterThan(3);
  expect(notes.every(entry => entry.voices[0].gain > 0.01)).toBe(true);
  expect(notes.every(entry => entry.voices[0].mode === engine)).toBe(true);
  expect(notes.every(entry => entry.options.joinInProgress === false)).toBe(true);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
test("Notes and Triggers use the same subdivision clock; stalls do not replay overdue events", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await instrument(page); await arm(page, { subdivisions: 3, speed: 0.5 });
  await page.waitForTimeout(900);
  const first = await page.evaluate(() => __lsEvents.filter(event => event.method === "clock").flatMap(event => event.entries).map(entry => entry.event.key));
  await page.locator("#playButton").click();
  await page.locator("#position").fill("0");
  await page.locator("#modeTriggers").click();
  await page.waitForTimeout(200);
  await page.evaluate(() => { __lsEvents = []; });
  await page.locator("#playButton").click(); await page.waitForTimeout(900);
  const second = await page.evaluate(() => __lsEvents.filter(event => event.method === "clock").flatMap(event => event.entries).map(entry => entry.event.key));
  expect(first.slice(0, 3)).toEqual(second.slice(0, 3));
  expect(second.length).toBeGreaterThan(3);
  await page.locator("#modeNotes").click(); await page.waitForTimeout(100);
  await page.evaluate(() => { __lsEvents = []; const start = performance.now(); while (performance.now() - start < 180) {} });
  await page.waitForTimeout(450);
  const notes = await noteEvents(page);
  expect(notes.every(entry => entry.options.startAt >= entry.at - 0.015)).toBe(true);
  await page.locator("#audioButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(350);
  expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("rounded note attacks reduce the old exponential-onset transient in the native fallback", async ({ page }, testInfo) => {
  await page.goto("l-systems.html");
  const comparisons = await page.evaluate(async () => {
    const { VoicePool } = await import("/src/audio.js");
    const { lSystemNoteEnvelope } = await import("/src/instruments/l-systems/discrete-audio.js");
    const results = [];
    for (const frequency of [123, 220, 330]) {
      const versions = [];
      for (const version of ["old-exponential-strike", "full-rounded-note"]) {
        const context = new OfflineAudioContext(1, 48000 * 0.4, 48000);
        const pool = new VoicePool(8);
        pool.context = context; pool.enabled = true;
        pool.master = context.createGain(); pool.master.connect(context.destination);
        const voice = { key: "onset", mode: "sine", waveform: "sine", frequency, gain: 0.25, pan: 0 };
        if (version === "old-exponential-strike") pool.strike(voice, { startAt: 0.05, attackSeconds: 0.004, decaySeconds: 0.18, retriggerMode: "crossfade" });
        else pool.scheduleNotes([voice], { startAt: 0.05, voiceLimit: 8, envelopePoints: lSystemNoteEnvelope(0.184), mode: "sine" });
        const samples = (await context.startRendering()).getChannelData(0);
        const peak = Math.max(...samples.map(Math.abs));
        const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        // Remove the steady sinusoidal carrier. Residual energy around onset
        // exposes envelope discontinuities/slope, not the legitimate pitch.
        const residual = (start, end) => {
          let energy = 0;
          const a = Math.floor(start * 48000), b = Math.floor(end * 48000);
          for (let i = a; i < b; i++) {
            const value = samples[i] - 2 * Math.cos(2 * Math.PI * frequency / 48000) * samples[i - 1] + samples[i - 2];
            energy += value * value;
          }
          return Math.sqrt(energy / (b - a)) / rms;
        };
        versions.push({ version, peak, rms, onsetResidual: residual(0.049, 0.077), steadyResidual: residual(0.09, 0.118), finite: samples.every(Number.isFinite) });
      }
      results.push({ frequency, versions });
    }
    return results;
  });
  for (const { versions: [old, current] } of comparisons) {
    expect(old.finite && current.finite).toBe(true);
    expect(current.peak).toBeLessThan(0.5);
    expect(current.rms).toBeGreaterThan(0.01);
    expect(current.onsetResidual).toBeLessThan(old.onsetResidual);
    expect(current.onsetResidual - current.steadyResidual).toBeLessThan(old.onsetResidual - old.steadyResidual);
  }
  await testInfo.attach("onset-comparison.json", { body: JSON.stringify(comparisons, null, 2), contentType: "application/json" });
});

for (const [name, viewport] of [["portrait", { width: 390, height: 844 }], ["landscape", { width: 844, height: 390 }]]) {
  test.describe(`touch ${name}`, () => {
    test.use({ hasTouch: true, viewport });
    test("subdivision taps stay reachable and do not arm audio; transport targets remain finger-sized", async ({ page }) => {
      await page.goto("l-systems.html");
      await page.locator("#modeNotes").tap();
      await page.locator("#subdivisions").scrollIntoViewIfNeeded();
      const slider = await page.locator("#subdivisions").boundingBox();
      await page.touchscreen.tap(slider.x + slider.width * 0.52, slider.y + slider.height / 2);
      expect(Number(await page.locator("#subdivisions").inputValue())).toBeGreaterThan(4);
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      for (const selector of ["#audioButton", "#playButton"]) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const target = await page.locator(selector).boundingBox();
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "coarse-pointer emulation").toBe(true);
        expect(target.width, `${selector} touch width`).toBeGreaterThanOrEqual(48);
        expect(target.height, `${selector} touch height`).toBeGreaterThanOrEqual(48);
      }
      await page.locator("#audioButton").tap();
      await page.waitForTimeout(200);
      await page.locator("#playButton").tap();
      expect((await sampleAudioEnvelope(page, { durationMs: 650 })).summary.maxRms).toBeGreaterThan(0.001);
      await page.locator("#playButton").tap(); await page.waitForTimeout(300);
      expect((await readAudioStatus(page)).rms).toBeLessThan(0.0001);
    });
  });
}


test("continuous parameter gestures keep the same clock and audible notes before pointer release", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(60000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await instrument(page);
  await arm(page, { iterations: 6, subdivisions: 8, speed: 0.8 });
  await page.waitForTimeout(300);
  const results = [];
  for (const parameter of ["ADSR", "baseFrequency", "pitchRange", "depthAmount", "subdivisions", "speed"]) {
    const node = parameter === "ADSR" ? page.locator('#amplitudeControl [data-node="1"]') : page.locator(`#${parameter}`);
    await node.scrollIntoViewIfNeeded();
    const box = await node.boundingBox();
    const editor = parameter === "ADSR" ? await page.locator('#amplitudeControl [data-editor]').boundingBox() : box;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => { __lsEvents = []; });
    await page.mouse.down();
    const meters = [];
    for (let step = 0; step < 50; step++) {
      const amount = 0.35 + 0.15 * Math.sin(step * Math.PI / 12);
      await page.mouse.move(editor.x + editor.width * (parameter === "ADSR" ? amount * 0.5 : amount),
        parameter === "ADSR" ? editor.y + 2 : box.y + box.height / 2);
      await page.waitForTimeout(16);
      if (step > 20 && step % 7 === 0) meters.push(await readAudioStatus(page));
    }
    // Observe while the pointer is still held, not after a single fill/change.
    const during = await page.evaluate(() => __lsEvents);
    await page.mouse.up();
    const notes = during.filter(event => event.method === "scheduleNotes");
    const clocks = during.filter(event => event.method === "clock");
    results.push({ parameter, notes: notes.length, meters, clocks: [...new Set(clocks.map(event => event.clockId))] });
    expect(during.filter(event => event.method === "cancelScheduledNotes"), parameter).toEqual([]);
    expect(new Set(clocks.map(event => event.clockId)).size, parameter).toBe(1);
    expect(notes.length, parameter).toBeGreaterThan(5);
    expect(meters.some(meter => meter.rms > 0.001), parameter).toBe(true);
    expect(meters.every(meter => !meter.clipped), parameter).toBe(true);
    if (parameter === "ADSR") expect(new Set(notes.map(event => JSON.stringify(event.options.envelopePoints))).size).toBeGreaterThan(2);
    if (parameter === "baseFrequency") expect(new Set(notes.map(event => event.voices[0].frequency)).size).toBeGreaterThan(2);
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  }
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  await testInfo.attach("held-parameter-gestures.json", { body: JSON.stringify(results), contentType: "application/json" });
});

for (const [name, viewport] of [["portrait", { width: 390, height: 844 }], ["landscape", { width: 844, height: 390 }]]) {
  test.describe(`live touch ${name}`, () => {
    test.use({ hasTouch: true, viewport });
    test("held ADSR touch drag keeps scheduling before touchend or touchcancel", async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await instrument(page); await arm(page, { iterations: 6, subdivisions: 8, speed: 0.8 });
      await page.waitForTimeout(300);
      await page.locator('#amplitudeControl [data-node="1"]').scrollIntoViewIfNeeded();
      const node = await page.locator('#amplitudeControl [data-node="1"]').boundingBox();
      const editor = await page.locator('#amplitudeControl [data-editor]').boundingBox();
      const session = await page.context().newCDPSession(page);
      await page.evaluate(() => { __lsEvents = []; });
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: node.x + node.width / 2, y: node.y + node.height / 2 }] });
      for (let step = 0; step < 45; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: editor.x + editor.width * (0.1 + 0.1 * Math.sin(step / 9) ** 2), y: editor.y + 2 }] });
        await page.waitForTimeout(20);
      }
      const during = await page.evaluate(() => __lsEvents);
      const signal = await readAudioStatus(page);
      await session.send("Input.dispatchTouchEvent", { type: name === "portrait" ? "touchEnd" : "touchCancel", touchPoints: [] });
      await session.detach();
      expect(during.filter(event => event.method === "cancelScheduledNotes")).toEqual([]);
      expect(during.filter(event => event.method === "scheduleNotes").length).toBeGreaterThan(5);
      expect(new Set(during.filter(event => event.method === "clock").map(event => event.clockId)).size).toBe(1);
      expect(signal.rms).toBeGreaterThan(0.001);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

for (const mode of ["Notes", "Triggers"]) test(`${mode}: rapid geometry and timing edits never replace the playing clock`, async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await instrument(page); await arm(page, { iterations: 6, subdivisions: 8, speed: 0.8 });
  if (mode === "Triggers") await page.locator("#modeTriggers").click();
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    __lsEvents = [];
    for (let step = 0; step < 65; step++) {
      for (const [id, value] of [["speed", 0.9 + 0.15 * Math.sin(step / 7)], ["subdivisions", 6 + step % 4], ["angle", 40 + 5 * Math.sin(step / 9)]]) {
        const input = document.getElementById(id);
        input.value = String(value); input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  });
  const during = await page.evaluate(() => __lsEvents);
  const clocks = during.filter(event => event.method === "clock");
  expect(during.filter(event => event.method === "cancelScheduledNotes")).toEqual([]);
  expect(new Set(clocks.map(event => event.clockId)).size).toBe(1);
  expect(clocks.flatMap(event => event.entries).length).toBeGreaterThan(5);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect((await sampleAudioEnvelope(page, { durationMs: 350 })).summary.maxRms).toBeGreaterThan(0.001);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});
