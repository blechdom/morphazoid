import { expect, test } from "@playwright/test";

import {
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

test("Throat Singer keeps named styles, anatomy, and harmonic selection in one model", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("throat-singing.html", { waitUntil: "load" });

  await expect(page.locator("#styleSelect option")).toHaveCount(8);
  await expect(page.locator("#styleSelect")).toHaveValue("open-drone");
  await expect(page.locator("#harmonicButtons, #styleButtons, .throat-model-hud, #styleDescription")).toHaveCount(0);
  await expect(page.locator("#noteButtons button")).toHaveCount(24);
  await expect(page.locator("#harmonicNumber")).toBeVisible();
  await expect(page.locator("#stageOvertoneOut")).toContainText("H8");
  await expect(page.locator("#periodDivision")).toHaveAttribute("max", "7");
  await expect(page.locator("#vocalFryOut")).toHaveText("0%");
  await expect(page.locator("#growlRoughnessOut")).toHaveText("8%");
  await expect(page.locator("#focusAmountOut")).toHaveText("22%");
  await expect(page.locator("#oralConstrictionOut")).toHaveText("30%");

  await page.locator("#styleSelect").selectOption("sygyt");
  await expect(page.locator("#stageOvertoneOut")).toContainText("H12");
  await expect(page.locator("#oralConstrictionOut")).toHaveText("98%");
  await page.locator("#styleSelect").selectOption("kargyraa");
  await expect(page.locator("#periodDivisionOut")).toHaveText("1:2");
  await expect(page.locator("#ventricularCouplingOut")).toHaveText("92%");
  await page.locator("#harmonicNumber").fill("8");
  await expect(page.locator("#harmonicNumberOut")).toHaveText("H8");
  await expect(page.locator("#resetButton")).toHaveAttribute("data-reset-in-place", "");

  await page.locator("#harmonicNumber").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#stage").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});

test("Throat Singer produces bounded source and layered-voice output and releases it", async ({ page }) => {
  await page.goto("throat-singing.html", { waitUntil: "load" });
  const audioButton = page.locator("#audioButton");
  const singButton = page.locator("#singButton");
  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  await singButton.click();
  await expect(singButton).toHaveAttribute("aria-pressed", "true");
  await waitForAudioState(page, true, 5_000);

  await page.evaluate(() => { globalThis.__throatSingingResetProbe = "still-here"; });
  await page.locator("#harmonicNumber").fill("12");
  await page.locator("#resetButton").click();
  await expect(page.locator("#harmonicNumberOut")).toHaveText("H8");
  await expect(page.locator("#levelOut")).toHaveText("28%");
  await expect(page.locator("#styleSelect")).toHaveValue("open-drone");
  await expect(singButton).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => globalThis.__throatSingingResetProbe)).toBe("still-here");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 50 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.activeSamples).toBeGreaterThan(0);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
  expect(envelope.summary.clippedSamples).toBe(0);

  await page.locator("#vocalFry").fill("0.88");
  await page.locator("#growlRoughness").fill("0.82");
  await expect(page.locator("#vocalFryOut")).toHaveText("88%");
  await expect(page.locator("#growlRoughnessOut")).toHaveText("82%");
  const textureEnvelope = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 50 });
  expect(textureEnvelope.summary.finite).toBe(true);
  expect(textureEnvelope.summary.activeSamples).toBeGreaterThan(0);
  expect(textureEnvelope.summary.clippedSamples).toBe(0);
  await page.locator("#styleSelect").selectOption("low-chant");
  await expect(page.locator("#styleSelect")).toHaveValue("low-chant");
  const presetEnvelope = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 45 });
  expect(presetEnvelope.summary.finite).toBe(true);
  expect(presetEnvelope.summary.activeSamples).toBeGreaterThan(0);
  expect(presetEnvelope.summary.clippedSamples).toBe(0);

  await page.locator("#periodDivision").fill("7");
  await page.locator("#ventricularCoupling").fill("1");
  await page.locator("#pitchVoices").fill("4");
  await page.locator("#overtoneVoices").fill("4");
  await page.locator("#sourceInstability").fill("1");
  await expect(page.locator("#periodDivisionOut")).toHaveText("1:7");
  await expect(page.locator("#stage")).toHaveAttribute("data-pitch-voices", "4");
  await expect(page.locator("#stage")).toHaveAttribute("data-overtone-voices", "4");
  const extendedEnvelope = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 50 });
  expect(extendedEnvelope.summary.finite).toBe(true);
  expect(extendedEnvelope.summary.activeSamples).toBeGreaterThan(0);
  expect(extendedEnvelope.summary.clippedSamples).toBe(0);
  await singButton.click();
  await expect(singButton).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
});

test("Throat Singer de-clicks a live Sygyt to Low Chant preset switch", async ({ page }) => {
  await page.addInitScript(() => {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContextClass?.prototype?.createAnalyser) return;
    const createAnalyser = AudioContextClass.prototype.createAnalyser;
    globalThis.__throatSingingProbeAnalysers = [];
    AudioContextClass.prototype.createAnalyser = function createProbeAnalyser(...args) {
      const analyser = Reflect.apply(createAnalyser, this, args);
      globalThis.__throatSingingProbeAnalysers.push(analyser);
      return analyser;
    };
  });

  await page.goto("throat-singing.html", { waitUntil: "load" });
  await page.locator("#styleSelect").selectOption("sygyt");
  await page.locator("#audioButton").click();
  await page.locator("#singButton").click();
  await waitForAudioState(page, true, 5_000);
  await page.waitForTimeout(350);

  const probeReady = await page.evaluate(async () => {
    const analyser = globalThis.__throatSingingProbeAnalysers?.at(-1);
    const context = analyser?.context;
    if (!analyser || !context?.audioWorklet?.addModule || !globalThis.AudioWorkletNode) {
      return false;
    }
    const processorSource = `
      class ThroatSingingTransitionProbe extends AudioWorkletProcessor {
        constructor() {
          super();
          this.armed = false;
          this.reset();
          this.port.onmessage = ({ data }) => {
            if (data?.type === "arm") {
              this.reset();
              this.armed = true;
              this.port.postMessage({ type: "armed" });
            } else if (data?.type === "report") {
              this.armed = false;
              this.port.postMessage({ type: "report", metrics: this.metrics });
            }
          };
        }

        reset() {
          this.lastSample = null;
          this.metrics = {
            sampleCount: 0,
            activeSampleCount: 0,
            finite: true,
            peak: 0,
            squareSum: 0,
            maxAdjacentDelta: 0,
          };
        }

        process(inputs) {
          const samples = inputs[0]?.[0];
          if (!this.armed || !samples) return true;
          for (const sample of samples) {
            if (!Number.isFinite(sample)) {
              this.metrics.finite = false;
              continue;
            }
            const magnitude = Math.abs(sample);
            this.metrics.peak = Math.max(this.metrics.peak, magnitude);
            this.metrics.squareSum += sample * sample;
            if (magnitude > 0.001) this.metrics.activeSampleCount += 1;
            if (this.lastSample !== null) {
              this.metrics.maxAdjacentDelta = Math.max(
                this.metrics.maxAdjacentDelta,
                Math.abs(sample - this.lastSample),
              );
            }
            this.lastSample = sample;
            this.metrics.sampleCount += 1;
          }
          return true;
        }
      }
      registerProcessor("throat-singing-transition-probe", ThroatSingingTransitionProbe);
    `;
    const moduleUrl = URL.createObjectURL(new Blob([processorSource], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const processor = new AudioWorkletNode(context, "throat-singing-transition-probe");
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    analyser.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(context.destination);

    globalThis.__throatSingingTransitionProbe = {
      processor,
      silentOutput,
      analyser,
    };
    return true;
  });
  expect(probeReady).toBe(true);

  await page.evaluate(async () => {
    const { processor } = globalThis.__throatSingingTransitionProbe;
    await new Promise((resolve) => {
      const onMessage = (event) => {
        if (event.data?.type !== "armed") return;
        processor.port.removeEventListener("message", onMessage);
        resolve();
      };
      processor.port.addEventListener("message", onMessage);
      processor.port.start();
      processor.port.postMessage({ type: "arm" });
    });
    const styleSelect = document.querySelector("#styleSelect");
    if (!(styleSelect instanceof HTMLSelectElement)) {
      throw new Error("Singing approach select is unavailable");
    }
    styleSelect.value = "low-chant";
    styleSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(550);

  const transition = await page.evaluate(async () => {
    const probe = globalThis.__throatSingingTransitionProbe;
    const metrics = await new Promise((resolve) => {
      const onMessage = (event) => {
        if (event.data?.type !== "report") return;
        probe.processor.port.removeEventListener("message", onMessage);
        resolve(event.data.metrics);
      };
      probe.processor.port.addEventListener("message", onMessage);
      probe.processor.port.start();
      probe.processor.port.postMessage({ type: "report" });
    });
    probe.analyser.disconnect(probe.processor);
    probe.processor.disconnect();
    probe.silentOutput.disconnect();
    return {
      ...metrics,
      rms: metrics.sampleCount > 0
        ? Math.sqrt(metrics.squareSum / metrics.sampleCount)
        : 0,
      activeFraction: metrics.sampleCount > 0
        ? metrics.activeSampleCount / metrics.sampleCount
        : 0,
    };
  });

  expect(transition.sampleCount).toBeGreaterThan(12_000);
  expect(transition.finite).toBe(true);
  // Steady output measured below 0.05/sample; the former hard swap reached
  // roughly 0.20, leaving deliberate headroom for browser/audio-device jitter.
  expect(transition.maxAdjacentDelta).toBeLessThan(0.08);
  expect(transition.peak).toBeLessThan(1);
  expect(transition.rms).toBeGreaterThan(0.005);
  expect(transition.activeFraction).toBeGreaterThan(0.5);
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#styleSelect")).toHaveValue("low-chant");
});

test("Throat Singer remains operable without horizontal page overflow on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("throat-singing.html", { waitUntil: "load" });

  const layout = await page.evaluate(() => ({
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    canvasWidth: document.querySelector("#stage")?.getBoundingClientRect().width ?? 0,
    singVisible: Boolean(document.querySelector("#singButton")?.getClientRects().length),
  }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.canvasWidth).toBeGreaterThan(300);
  expect(layout.singVisible).toBe(true);
});
