import { expect, test } from "@playwright/test";
import { readAudioStatus, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const diagnostics = new WeakMap();
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
  await testInfo.attach("spartial-drive-diagnostics.json", { body: JSON.stringify(messages, null, 2), contentType: "application/json" });
  expect(messages).toEqual([]);
});

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

// Observe the public final stereo recording mix on its running audio clock.
// Exact-frequency, Hann-window projections avoid FFT-bin/phase artifacts;
// ratios to the fundamental distinguish saturation from a volume change.
async function measureHarmonics(page, fundamentalHz) {
  return page.evaluate(async (frequency) => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager();
    const context = manager.recordingContext();
    if (!context) throw new Error("The instrument audio clock is not running");
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.channelCount = 1;
    analyser.channelCountMode = "explicit";
    analyser.channelInterpretation = "speakers";
    analyser.smoothingTimeConstant = 0;
    const release = manager.tapInto(context, analyser);
    const length = analyser.fftSize;
    const samples = new Float32Array(length);
    const weights = Float64Array.from({ length }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / (length - 1)));
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    const basis = Array.from({ length: 7 }, (_, harmonic) => ({
      real: Float64Array.from(weights, (weight, index) => weight * Math.cos(2 * Math.PI * (harmonic + 1) * frequency * index / context.sampleRate)),
      imaginary: Float64Array.from(weights, (weight, index) => weight * Math.sin(2 * Math.PI * (harmonic + 1) * frequency * index / context.sampleRate)),
    }));
    const windowMs = Math.ceil(1000 * length / context.sampleRate) + 25;
    const windows = [];
    try {
      for (let window = 0; window < 6; window += 1) {
        // Fill the analyser once, then sample separate complete windows.
        await new Promise(resolve => setTimeout(resolve, windowMs));
        analyser.getFloatTimeDomainData(samples);
        let finite = true, peak = 0, squareSum = 0;
        for (const sample of samples) {
          finite &&= Number.isFinite(sample);
          peak = Math.max(peak, Math.abs(sample)); squareSum += sample * sample;
        }
        const harmonics = basis.map(({ real, imaginary }) => {
          let r = 0, i = 0;
          for (let frame = 0; frame < length; frame += 1) { r += samples[frame] * real[frame]; i += samples[frame] * imaginary[frame]; }
          return 2 * Math.hypot(r, i) / weightSum;
        });
        windows.push({ finite, peak, rms: Math.sqrt(squareSum / length), harmonics,
          ratios: harmonics.map(value => value / Math.max(1e-12, harmonics[0])) });
      }
      const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      return { frequency, sampleRate: context.sampleRate, fftSize: length, windows,
        summary: {
          finite: windows.every(window => window.finite && window.ratios.every(Number.isFinite)),
          peak: Math.max(...windows.map(window => window.peak)),
          rms: median(windows.map(window => window.rms)),
          fundamental: median(windows.map(window => window.harmonics[0])),
          thirdRatio: median(windows.map(window => window.ratios[2])),
          fifthRatio: median(windows.map(window => window.ratios[4])),
        } };
    } finally { release(); analyser.disconnect(); }
  }, fundamentalHz);
}

test("SPARTIAL Drive changes harmonics of a quiet distributed drawbar with Rotary off", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  expect((await page.goto("spartial.html"))?.ok()).toBe(true);
  await settlePage(page);
  await page.locator('[data-section="rotary"] > summary').click();
  await expect(page.locator('#drive')).toBeVisible();
  await expect(page.locator("#rotaryMode")).toHaveValue("off");
  for (const value of [.5, 1, 0]) await setRange(page, "drive", value);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  await page.locator("#organMode").selectOption("tonewheel");
  await expect(page.locator("#partialSliders input")).toHaveCount(9);
  for (let index = 0; index < 9; index += 1) await setRange(page, `organStop${index}`, index === 2 ? 2 : 0);
  await page.locator("#root").selectOption("57");
  for (const [id, value] of Object.entries({ level: .41, granularMix: 0, attack: .01, release: .06,
    cascade: 0, cascadeStart: 0, cycles: 0, offset: .065, keyClick: 0, pipeChiff: 0, pitchDepth: 0, amplitudeDepth: 0 })) {
    await setRange(page, id, value);
  }
  await expect(page.locator("#organPercussion")).toHaveValue("off");
  await expect(page.locator("#routingMode")).toHaveValue("spread");
  // The 2/8 drawbar straddles two speakers, exercising the low per-channel
  // levels at which the original drive mainly changed loudness.
  await page.locator("#audioButton").click();
  await page.locator("#holdButton").click();
  await waitForStableAudioState(page, true);

  const measurements = [];
  for (const [name, drive] of [["dry", 0], ["half", .5], ["full", 1], ["returned", 0]]) {
    await setRange(page, "drive", drive);
    await page.waitForTimeout(500);
    const measurement = await measureHarmonics(page, 220);
    measurements.push(measurement);
    await testInfo.attach(`drive-${name}-harmonics.json`, { body: JSON.stringify(measurement, null, 2), contentType: "application/json" });
    expect(measurement.summary.finite).toBe(true);
    expect(measurement.summary.rms).toBeGreaterThan(.005);
    expect(measurement.summary.rms).toBeLessThan(.5);
    expect(measurement.summary.peak).toBeLessThan(1);
    expect(measurement.summary.fundamental).toBeGreaterThan(.005);
    await expect(page.locator("#level")).toHaveValue("0.41");
    await expect(page.locator("#organStop2")).toHaveValue("2");
    await expect(page.locator("#rotaryMode")).toHaveValue("off");
    await expect(page.locator("#rotaryStatus")).toHaveText("Rotary off");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    const status = await readAudioStatus(page);
    expect(status.active).toBe(true); expect(status.clipped).toBe(false);
  }
  const [dry, half, full, returned] = measurements.map(measurement => measurement.summary);
  expect(dry.thirdRatio).toBeLessThan(.001);
  // Broad audible-color floors, not exact waveform snapshots. The previous
  // curve measured only ~0.77% / 3.71% H3 at these two Drive positions.
  expect(half.thirdRatio).toBeGreaterThan(.025);
  expect(full.thirdRatio).toBeGreaterThan(.08);
  expect(full.thirdRatio).toBeGreaterThan(half.thirdRatio * 1.4);
  expect(full.fifthRatio).toBeGreaterThan(half.fifthRatio);
  expect(returned.thirdRatio).toBeLessThan(.001);
  expect(Math.abs(returned.fundamental / dry.fundamental - 1)).toBeLessThan(.03);
  expect(Math.abs(returned.rms / dry.rms - 1)).toBeLessThan(.03);
});
