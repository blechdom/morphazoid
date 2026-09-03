import { expect, test } from "@playwright/test";

import {
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

test("Throat Singing keeps named styles, anatomy, and harmonic selection in one model", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("throat-singing.html", { waitUntil: "load" });

  await expect(page.locator("#styleButtons button")).toHaveCount(8);
  await expect(page.locator("#harmonicButtons")).toHaveCount(0);
  await expect(page.locator(".throat-stage-title, .throat-harmonic-dock")).toHaveCount(0);
  await expect(page.locator("#noteButtons button")).toHaveCount(8);
  await expect(page.locator("#harmonicNumber")).toBeVisible();
  await expect(page.locator("#traditionOut")).toContainText("Synthetic exploration");
  await expect(page.locator("#stageOvertoneOut")).toContainText("H8");
  await expect(page.locator("#periodDivision")).toHaveAttribute("max", "7");
  await expect(page.locator("#vocalFryOut")).toHaveText("0%");
  await expect(page.locator("#growlRoughnessOut")).toHaveText("8%");
  await expect(page.locator("#focusAmountOut")).toHaveText("22%");
  await expect(page.locator("#oralConstrictionOut")).toHaveText("30%");
  await expect(page.getByRole("button", { name: /^Open drone/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Speculative sound lab.")).toHaveCount(1);

  await page.getByRole("button", { name: /^Sygyt/ }).click();
  await expect(page.locator("#stageOvertoneOut")).toContainText("H12");
  await expect(page.locator("#oralConstrictionOut")).toHaveText("98%");

  await page.getByRole("button", { name: /^Kargyraa/ }).click();
  await expect(page.locator("#periodDivisionOut")).toContainText("2 fold cycles");
  await expect(page.locator("#ventricularReadout")).toContainText("2:1");

  await page.locator("#harmonicNumber").fill("8");
  await expect(page.locator("#harmonicNumberOut")).toHaveText("H8");
  await expect(page.locator("#styleDescription")).not.toContainText("authentic");
  await expect(page.locator("#resetButton")).toHaveAttribute("data-reset-in-place", "");

  await page.locator("#harmonicNumber").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#stage").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(page.locator("#singButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});

test("Throat Singing produces bounded output and releases it", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: /^Open drone/ })).toHaveAttribute("aria-pressed", "true");
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

  await page.getByRole("button", { name: /^Low chant/ }).click();
  await expect(page.getByRole("button", { name: /^Low chant/ })).toHaveAttribute("aria-pressed", "true");
  const presetEnvelope = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 45 });
  expect(presetEnvelope.summary.finite).toBe(true);
  expect(presetEnvelope.summary.activeSamples).toBeGreaterThan(0);
  expect(presetEnvelope.summary.clippedSamples).toBe(0);

  await page.locator("#periodDivision").fill("7");
  await page.locator("#ventricularCoupling").fill("1");
  await page.locator(".throat-anatomy-section > summary").click();
  await page.locator("#phantomAirways").fill("4");
  await page.locator("#impossibleFocus").fill("1");
  await page.locator("#sourceInstability").fill("1");
  await expect(page.locator("#ventricularReadout")).toContainText("7:1");
  await expect(page.locator("#anatomySummary")).toContainText("4 impossible airways");
  const extendedEnvelope = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 50 });
  expect(extendedEnvelope.summary.finite).toBe(true);
  expect(extendedEnvelope.summary.activeSamples).toBeGreaterThan(0);
  expect(extendedEnvelope.summary.clippedSamples).toBe(0);

  await singButton.click();
  await expect(singButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#singState")).toContainText("ready");
  await waitForStableAudioState(page, false);

  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
});

test("Throat Singing de-clicks a live Sygyt to Low Chant preset switch", async ({ page }) => {
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
  await page.getByRole("button", { name: /^Sygyt/ }).click();
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
    const lowChantButton = document.querySelector('[data-style-id="low-chant"]');
    if (!(lowChantButton instanceof HTMLButtonElement)) {
      throw new Error("Low Chant preset button is unavailable");
    }
    lowChantButton.click();
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
  await expect(page.getByRole("button", { name: /^Low chant/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Throat Singing remains operable without horizontal page overflow on a phone", async ({ page }) => {
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
