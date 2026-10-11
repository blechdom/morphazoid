import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const diagnostics = new WeakMap();
const sections = ["modulation", "rotary"];
const stopLabels = ["16′", "5⅓′", "8′", "4′", "2⅔′", "2′", "1⅗′", "1⅓′", "1′"];
const registrations = {
  tonewheel: ["tonewheel-clear", "tonewheel-night", "tonewheel-gospel", "tonewheel-rock"],
  pipe: ["pipe-flute", "pipe-stopped", "pipe-principal", "pipe-string", "pipe-reed", "pipe-ripple"],
};
test.beforeEach(async ({ page, baseURL }) => {
  diagnostics.set(page, watchPageDiagnostics(page, { baseURL }));
  if (process.env.E2E_AUDIO_SILENT_SINK === "1") await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(options = {}) { super({ ...options, sinkId: { type: "none" } }); }
    };
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const messages = pageDiagnosticMessages(diagnostics.get(page));
  await testInfo.attach("spartial-organ-diagnostics.json", { body: JSON.stringify(messages, null, 2), contentType: "application/json" });
  expect(messages).toEqual([]);
});

async function open(page) {
  expect((await page.goto("spartial.html"))?.ok()).toBe(true);
  await settlePage(page);
  await expectBank(page, "partials", 16);
}
async function expand(page, section) {
  const details = page.locator(`details[data-section="${section}"]`);
  if (!await details.evaluate(node => node.open)) await details.locator(":scope > summary").click();
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function values(page) {
  return page.locator("#partialSliders input[type=range]").evaluateAll(inputs => inputs.map(input => Number(input.value)));
}
async function expectBank(page, mode, count = 9) {
  await expect(page.locator(".spectrum-panel #partialSliders")).toHaveCount(1);
  await expect(page.locator(".spectrum-panel #organMode")).toHaveValue(mode);
  await expect(page.locator('#organDrawbars, #organPreset, #nextOrganPreset, #randomOrganPreset, [data-section="organ"]')).toHaveCount(0);
  await expect(page.locator("#partialSliders input[type=range]")).toHaveCount(count);
  if (mode === "partials") {
    await expect(page.getByRole("slider", { name: /^Partial \d+ level$/ })).toHaveCount(count);
    await expect(page.getByRole("slider", { name: / drawbar$/ })).toHaveCount(0);
  } else {
    await expect(page.getByRole("slider", { name: /^Partial \d+ level$/ })).toHaveCount(0);
    for (const [index, name] of stopLabels.entries()) {
      const input = page.locator(`#partialSliders #organStop${index}`);
      await expect(input).toHaveAccessibleName(`${name} drawbar`);
      await expect(input).toHaveAttribute("min", "0");
      await expect(input).toHaveAttribute("max", "8");
    }
    expect(await page.locator('#spectrumPreset option:not([value="custom"])').evaluateAll(options => options.map(option => option.value))).toEqual(registrations[mode]);
  }
}
async function hold(page) {
  for (const [id, value] of Object.entries({ cascade: 0, cascadeStart: 0, attack: .01, release: .06 })) await setRange(page, id, value);
  await page.locator("#audioButton").click();
  await page.locator("#holdButton").click();
  await waitForStableAudioState(page, true);
}
async function sounding(page, testInfo, name) {
  await waitForStableAudioState(page, true, { stableMs: 200, timeout: 6000 });
  const envelope = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 35 });
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(envelope, null, 2), contentType: "application/json" });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.001);
  expect(envelope.summary.maxPeak).toBeLessThan(1);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(envelope.summary.activeSamples).toBeGreaterThanOrEqual(envelope.summary.sampleCount * .8);
  return envelope;
}
const span = values => Math.max(...values) - Math.min(...values);
const stereoBalance = envelope => envelope.samples.map(sample => (sample.leftPeak - sample.rightPeak) / Math.max(1e-9, sample.leftPeak + sample.rightPeak));

// A public recording tap measures a held single sine without reaching into the
// synthesis worklet. Interpolated zero crossings avoid FFT-bin quantization.
async function measuredPitch(page) {
  return page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager();
    const context = manager.recordingContext();
    if (!context) throw new Error("The instrument audio clock is not running");
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.channelCount = 1;
    analyser.channelCountMode = "explicit";
    const release = manager.tapInto(context, analyser);
    const samples = new Float32Array(analyser.fftSize);
    const frequencies = [];
    let finite = true;
    try {
      await new Promise(resolve => setTimeout(resolve, 120));
      for (let window = 0; window < 32; window += 1) {
        analyser.getFloatTimeDomainData(samples);
        const crossings = [];
        for (let index = 1; index < samples.length; index += 1) {
          finite &&= Number.isFinite(samples[index]);
          if (samples[index - 1] <= 0 && samples[index] > 0) {
            crossings.push(index - 1 - samples[index - 1] / (samples[index] - samples[index - 1]));
          }
        }
        if (crossings.length > 2) frequencies.push(context.sampleRate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]));
        await new Promise(resolve => setTimeout(resolve, 35));
      }
      return { finite, frequencies };
    } finally { release(); analyser.disconnect(); }
  });
}

test("SPARTIAL opens with organ effects off and section edits do not arm Audio", async ({ page }) => {
  await open(page);
  for (const section of sections) await expect(page.locator(`details[data-section="${section}"]`)).not.toHaveAttribute("open", "");
  for (const [id, value] of Object.entries({ organMode: "partials", pitchDepth: "0", amplitudeDepth: "0", rotaryMode: "off", drive: "0", keyClick: "0", pipeChiff: "0", organPercussion: "off" })) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }
  for (const section of sections) await expand(page, section);
  await expect(page.locator('.spectrum-panel .organ-detail > summary')).toHaveCount(1);
  await expect(page.locator(".grain-detail > summary")).toHaveCount(1);
  await setRange(page, "pitchDepth", 42);
  await setRange(page, "amplitudeDepth", .4);
  await page.locator("#organMode").selectOption("tonewheel");
  await expectBank(page, "tonewheel");
  await page.locator("#spectrumPreset").selectOption("tonewheel-clear");
  await page.locator("#nextSpectrum").click();
  await page.locator("#randomSpectrum").click();
  await page.locator("#rotaryMode").selectOption("fast");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("SPARTIAL shared bank registrations, Next and dice stay in their mode and preserve held sound", async ({ page }, testInfo) => {
  await open(page);
  await setRange(page, "level", .41);
  await setRange(page, "granularMix", .37);
  await hold(page);
  await page.locator("#playButton").click();
  await page.locator("#organMode").selectOption("tonewheel");
  await expectBank(page, "tonewheel");
  await page.locator("#spectrumPreset").selectOption("tonewheel-clear");
  expect(await values(page)).toEqual([7, 0, 8, 2, 0, 0, 0, 0, 1]);
  await expect(page.locator("#organMode")).toHaveValue("tonewheel");
  await page.locator("#nextSpectrum").click();
  await expect(page.locator("#spectrumPreset")).toHaveValue("tonewheel-night");
  expect(await values(page)).toEqual([7, 5, 8, 1, 0, 2, 0, 0, 1]);
  await page.locator("#spectrumPreset").selectOption("tonewheel-rock");
  await page.locator("#nextSpectrum").click();
  await expect(page.locator("#spectrumPreset")).toHaveValue("tonewheel-clear");
  await page.locator("#randomSpectrum").click();
  await expectBank(page, "tonewheel");
  await page.locator("#organMode").selectOption("pipe");
  await expectBank(page, "pipe");
  await page.locator("#spectrumPreset").selectOption("pipe-flute");
  await expect(page.locator("#organMode")).toHaveValue("pipe");
  await expect(page.locator("#pipeControls")).toBeVisible();
  expect(await values(page)).toEqual([0, 0, 8, 2, 0, 0, 0, 0, 0]);
  await page.locator("#spectrumPreset").selectOption("pipe-ripple");
  await page.locator("#nextSpectrum").click();
  await expect(page.locator("#spectrumPreset")).toHaveValue("pipe-flute");
  for (const [index, value] of [8, 7, 6, 5, 4, 3, 2, 1, 8].entries()) {
    const input = page.locator("#partialSliders input[type=range]").nth(index);
    await expect(input).toHaveAttribute("min", "0");
    await expect(input).toHaveAttribute("max", "8");
    await input.evaluate((node, next) => { node.value = String(next); node.dispatchEvent(new Event("input", { bubbles: true })); }, value);
  }
  expect(await values(page)).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 8]);
  await expect(page.locator("#spectrumPreset")).toHaveValue("custom");
  await sounding(page, testInfo, "edited-drawbars-held");
  await page.locator("#randomSpectrum").click();
  await expectBank(page, "pipe");
  const randomized = await values(page);
  expect(randomized.some(Boolean)).toBe(true);
  expect(randomized.every(value => Number.isInteger(value) && value >= 0 && value <= 8)).toBe(true);
  expect(randomized).not.toEqual([8, 7, 6, 5, 4, 3, 2, 1, 8]);
  await expect(page.locator("#spectrumPreset")).toHaveValue("custom");
  await expect(page.locator("#level")).toHaveValue("0.41");
  await expect(page.locator("#granularMix")).toHaveValue("0.37");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await sounding(page, testInfo, "random-organ-held");
});

test("SPARTIAL mode changes restore custom partials and the only drawbar bank controls actual sound", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await open(page);
  const partialSettings = { partials: 19, rolloff: 2.35, stretch: 1.3, inharmonicity: .55 };
  for (const [id, value] of Object.entries(partialSettings)) await setRange(page, id, value);
  // The future 8′ slot has zero painted gain. A hidden second trim bank would
  // wrongly mute that drawbar when switching away from these custom partials.
  const painted = Array.from({ length: 19 }, (_, index) => index === 0 ? .35 : index === 18 ? .73 : 0);
  await page.locator("#partialSliders input").evaluateAll((inputs, next) => {
    for (const [index, input] of inputs.entries()) {
      input.value = String(next[index]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, painted);
  await expectBank(page, "partials", 19);
  expect(await values(page)).toEqual(painted);
  await setRange(page, "level", .42);
  await hold(page);
  await page.locator("#playButton").click();
  await page.locator("#organMode").selectOption("tonewheel");
  await expectBank(page, "tonewheel");
  for (const [id, value] of Object.entries({ partials: "32", rolloff: "0", stretch: "1", inharmonicity: "0" })) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }
  await page.locator('.spectrum-panel .organ-detail > summary').click();
  await expand(page, "rotary");
  for (const [id, value] of Object.entries({ granularMix: 0, keyClick: 0, pipeChiff: 0, pitchDepth: 0, amplitudeDepth: 0, drive: 0 })) await setRange(page, id, value);
  await page.locator("#organPercussion").selectOption("off");
  await page.locator("#rotaryMode").selectOption("off");
  for (let index = 0; index < 9; index += 1) await setRange(page, `organStop${index}`, index === 2 ? 8 : 0);
  await sounding(page, testInfo, "isolated-eight-foot-drawbar");
  const pitch = await measuredPitch(page);
  const note = Number(await page.locator("#root").inputValue());
  const expectedHz = 440 * 2 ** ((note - 69) / 12);
  expect(pitch.finite).toBe(true); expect(pitch.frequencies.length).toBe(32);
  expect(Math.max(...pitch.frequencies.map(frequency => Math.abs(frequency - expectedHz)))).toBeLessThan(1);
  await setRange(page, "organStop2", 0);
  await waitForStableAudioState(page, false);
  await page.waitForTimeout(700);
  const silent = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 35 });
  expect(silent.summary.maxPeak).toBeLessThan(1e-7);
  expect(silent.summary.maxRms).toBeLessThan(1e-7);
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await setRange(page, "organStop2", 8);
  await sounding(page, testInfo, "same-held-note-drawbar-restored");
  await page.locator("#organMode").selectOption("pipe");
  await expectBank(page, "pipe");
  await page.locator("#organMode").selectOption("partials");
  await expectBank(page, "partials", 19);
  expect(await values(page)).toEqual(painted);
  for (const [id, value] of Object.entries(partialSettings)) await expect(page.locator(`#${id}`)).toHaveValue(String(value));
  await expect(page.locator("#spectrumPreset")).toHaveValue("custom");
  await expect(page.locator("#level")).toHaveValue("0.42");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await sounding(page, testInfo, "restored-custom-partials-held");
});

test("SPARTIAL pitch, amplitude and rotary controls change actual held audio independently of Rotation", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await open(page);
  for (const section of ["modulation", "rotary"]) await expand(page, section);
  await setRange(page, "partials", 1);
  await hold(page);
  const dry = await sounding(page, testInfo, "single-partial-dry");
  const steady = await measuredPitch(page);
  expect(steady.finite).toBe(true); expect(steady.frequencies.length).toBe(32);
  expect(span(steady.frequencies)).toBeLessThan(1);
  await setRange(page, "modulationRate", 3);
  await setRange(page, "pitchDepth", 200);
  const moving = await measuredPitch(page);
  await testInfo.attach("pitch-modulation-measurement.json", { body: JSON.stringify({ steady, moving }, null, 2), contentType: "application/json" });
  expect(moving.finite).toBe(true); expect(moving.frequencies.length).toBe(32);
  expect(span(moving.frequencies)).toBeGreaterThan(10);
  await setRange(page, "pitchDepth", 0);
  await setRange(page, "amplitudeDepth", 1);
  const amplitude = await sounding(page, testInfo, "amplitude-modulation");
  expect(amplitude.summary.meanRms).toBeLessThan(dry.summary.meanRms * .8);
  expect(span(amplitude.samples.map(sample => sample.rms))).toBeGreaterThan(dry.summary.meanRms * .25);
  await setRange(page, "amplitudeDepth", 0);
  await setRange(page, "rotaryMix", 1);
  await setRange(page, "rotarySpread", 1);
  await setRange(page, "rotaryRamp", .2);
  await page.locator("#rotaryMode").selectOption("slow");
  await page.waitForTimeout(400);
  // The shared stereo meters cover a whole audio window. A slow rotor and
  // two full drum revolutions expose movement without averaging a fast pass.
  const rotary = await sampleAudioEnvelope(page, { durationMs: 3400, intervalMs: 35 });
  await testInfo.attach("rotary-movement.json", { body: JSON.stringify(rotary, null, 2), contentType: "application/json" });
  expect(rotary.summary.finite).toBe(true);
  expect(rotary.summary.maxRms).toBeGreaterThan(.001);
  expect(rotary.summary.clippedSamples).toBe(0);
  expect(span(stereoBalance(rotary))).toBeGreaterThan(span(stereoBalance(dry)) + .15);
  await page.locator("#rotaryMode").selectOption("fast");
  // This status comes back from the running worklet, so the selector must
  // actually accelerate both rotors independently of the Rotation transport.
  await expect(page.locator("#rotaryStatus")).toHaveText("Horn 6.60 Hz · drum 5.70 Hz", { timeout: 6000 });
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#level")).toHaveValue("0.65");
});

test("SPARTIAL organ and rotary remain audible at full live-granular mix and master zero is exact silence", async ({ page }, testInfo) => {
  await open(page); await expand(page, "rotary");
  await page.locator("#organMode").selectOption("tonewheel");
  await page.locator("#spectrumPreset").selectOption("tonewheel-clear");
  for (const [id, value] of Object.entries({ granularMix: 1, grainSize: 200, grainDensity: 30, grainLookback: 0, grainScatter: 0, grainJitter: 0 })) await setRange(page, id, value);
  await hold(page);
  await expect(page.locator("#granularSource")).toHaveValue("additive");
  await sounding(page, testInfo, "organ-full-granular");
  await page.locator("#organMode").selectOption("pipe");
  await page.locator("#spectrumPreset").selectOption("pipe-principal");
  await page.locator("#rotaryMode").selectOption("fast");
  await setRange(page, "drive", .3);
  await expect(page.locator("#granularMix")).toHaveValue("1");
  await sounding(page, testInfo, "pipe-grains-rotary-drive");
  await setRange(page, "level", 0);
  await waitForStableAudioState(page, false);
  await page.waitForTimeout(700);
  const muted = await sampleAudioEnvelope(page, { durationMs: 350, intervalMs: 35 });
  expect(muted.summary.maxPeak).toBe(0);
  expect(muted.summary.maxRms).toBe(0);
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await setRange(page, "level", .65);
  await sounding(page, testInfo, "organ-grains-unmuted");
});

test.describe("SPARTIAL organ controls on phones", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`${viewport.width}x${viewport.height} organ controls are reachable while the stage stays pinned`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport); await open(page);
      const graphic = page.locator("#stageWrap");
      const initial = await graphic.boundingBox();
      const pinned = async () => {
        const actual = await graphic.boundingBox();
        for (const key of ["x", "y", "width", "height"]) expect(Math.abs(actual[key] - initial[key])).toBeLessThan(1);
        expect(await page.evaluate(() => scrollY)).toBe(0);
      };
      for (const section of sections) { await expand(page, section); await pinned(); }
      await page.locator("#organMode").selectOption("pipe");
      await expectBank(page, "pipe");
      await page.locator('.spectrum-panel .organ-detail > summary').click();
      const ids = ["pitchDepth", "amplitudeDepth", "modulationRate", "modulationRipple", "modulationShape", "spectrumPreset", "nextSpectrum", "randomSpectrum", "organMode", "pipeTone", "pipeBrightness", "pipeChiff", "keyClick", "organPercussion", "percussionLevel", "percussionDecay", "rotaryMode", "rotaryMix", "rotarySpread", "rotaryRamp", "drive"];
      const controls = [...ids.map(id => page.locator(`#${id}`)), ...await page.locator("#partialSliders input[type=range]").all()];
      for (const control of controls) {
        await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
        expect(await control.evaluate(node => {
          const box = node.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
          const hit = document.elementFromPoint(x, y);
          return box.left >= -1 && box.right <= innerWidth + 1 && (hit === node || node.contains(hit));
        }), "control can be scrolled into view and hit").toBe(true);
        await pinned();
      }
      // The shared bank replaces its drawbars with the restored partials in
      // place; both shapes of the bank must fit the same scrolling region.
      await page.locator("#organMode").selectOption("partials");
      await expectBank(page, "partials", 16);
      await page.locator("#partialSliders input").last().scrollIntoViewIfNeeded();
      await expect(page.locator("#partialSliders input").last()).toBeVisible();
      await pinned();
      await page.locator("#drive").scrollIntoViewIfNeeded();
      const pane = page.locator("#spartialControls");
      const before = await pane.evaluate(node => node.scrollTop), box = await pane.boundingBox();
      await page.mouse.move(box.x + 8, box.y + box.height / 2); await page.mouse.wheel(0, -160);
      await expect.poll(() => pane.evaluate(node => node.scrollTop)).toBeLessThan(before);
      await pinned();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      await testInfo.attach(`organ-phone-${viewport.width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
