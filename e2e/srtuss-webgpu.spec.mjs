import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

// Captured from the preserved pre-layer direct renderer at 44.1 kHz. The new
// neutral one-voice path matched every compared sample exactly when established.
const SRTUSS_NEUTRAL_GOLDENS = Object.freeze({
  MljSRt: { rms: 0.15985438328514043, meanAbs: 0.12142661003618929, weightedMean: -0.07301220038504806 },
  XdSGz1: { rms: 0.17024703642310135, meanAbs: 0.14484825741051, weightedMean: 0.0018414412821118756 },
  Xd2GW3: { rms: 0.31992668780379796, meanAbs: 0.23869081736116876, weightedMean: -0.018076770924136336 },
  "4tsGD8": { rms: 0.5185866602217861, meanAbs: 0.4887102276279689, weightedMean: 0.033577013060377345 },
  ldlfRS: { rms: 0.35333573695928494, meanAbs: 0.29612350957191963, weightedMean: -0.04489943901180437 },
  lldGDM: { rms: 0.18843854089944356, meanAbs: 0.15974661078830604, weightedMean: -0.007402605762196957 },
  ltKSRc: { rms: 0.12338311400448673, meanAbs: 0.10701989873455263, weightedMean: 0.005924306194131656 },
  "4tdSDB": { rms: 0.3300676467303584, meanAbs: 0.22251916645860273, weightedMean: 0.0032914829137849462 },
  MslBR4: { rms: 0.13628176733961683, meanAbs: 0.10873362628474711, weightedMean: -0.01600369171100175 },
  ldfSW2: { rms: 0.20761321818945422, meanAbs: 0.1308214378263973, weightedMean: -0.05080947622982442 },
});

const SRTUSS_RACK_GLOBAL_IDS = Object.freeze([
  "globalClock",
  "globalTune",
  "globalWidth",
  "globalSpace",
  "globalDrive",
]);

test.describe("srtuss sound-only WebGPU archive", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "WebGPU QA runs in Chromium");

  test("every available Sound pass compiles, dispatches, and returns bounded samples", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto("srtuss.html", { waitUntil: "load" });

    const report = await page.evaluate(async () => {
      if (!navigator.gpu) throw new Error("WebGPU is unavailable in this Chromium run.");
      const { SRTUSS_SOUND_PROJECTS, SrtussAudio } = await import("./src/srtuss.js");
      const gainParam = () => ({
        value: 0,
        cancelAndHoldAtTime() {},
        cancelScheduledValues() {},
        linearRampToValueAtTime() {},
        setTargetAtTime() {},
        setValueAtTime() {},
      });
      const context = {
        currentTime: 0,
        destination: null,
        sampleRate: 44_100,
        state: "running",
        createGain() {
          return { gain: gainParam(), connect() {}, disconnect() {} };
        },
      };
      const audio = new SrtussAudio(globalThis, {
        chunkDuration: 0.03,
        pipelineCacheSize: 10,
        workgroupSize: 256,
      });
      const offsets = [3.5, 11.25, 29.75, 47.5].map((seconds) => (
        Math.round(seconds * context.sampleRate)
      ));
      const projects = [];
      const seamReports = [];
      let neutralMaxDiff = 0;
      let layeredFinite = true;
      let layeredMaxAbs = 0;
      let mutedMaxAbs = 0;
      const controlEffects = {};
      try {
        await audio.start({ autoStart: false, context });
        for (const project of SRTUSS_SOUND_PROJECTS) {
          const startedAt = performance.now();
          let finite = true;
          let maxAbs = 0;
          let squareSum = 0;
          let absoluteSum = 0;
          let weightedSum = 0;
          let sampleCount = 0;
          for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex += 1) {
            const offset = offsets[offsetIndex];
            const chunk = await audio.renderProjectChunk(project.id, offset);
            for (let index = 0; index < chunk.length; index += 1) {
              const sample = chunk[index];
              if (!Number.isFinite(sample)) finite = false;
              const magnitude = Math.abs(sample);
              maxAbs = Math.max(maxAbs, magnitude);
              squareSum += sample * sample;
              absoluteSum += magnitude;
              weightedSum += sample * ((((index + 1) * (offsetIndex + 3)) % 101) - 50);
              sampleCount += 1;
            }
          }
          projects.push({
            id: project.id,
            finite,
            maxAbs,
            rms: Math.sqrt(squareSum / Math.max(1, sampleCount)),
            meanAbs: absoluteSum / Math.max(1, sampleCount),
            weightedMean: weightedSum / Math.max(1, sampleCount),
            elapsedMs: performance.now() - startedAt,
          });
        }
        const comparisonOffset = 12_345;
        const original = await audio.renderProjectChunk("MljSRt", comparisonOffset);
        const neutral = await audio.renderVoicesChunk([{
          id: "neutral",
          projectId: "MljSRt",
          enabled: true,
          timeRate: 1,
          level: 1,
          pan: 0,
        }], comparisonOffset);
        for (let index = 0; index < original.length; index += 1) {
          neutralMaxDiff = Math.max(neutralMaxDiff, Math.abs(original[index] - neutral[index]));
        }
        const controlBase = await audio.renderVoicesChunk([{
          id: "control",
          projectId: "MljSRt",
          enabled: true,
          timeRate: 1,
          level: 1,
          pan: 0,
        }], comparisonOffset);
        const slower = await audio.renderVoicesChunk([{
          id: "control",
          projectId: "MljSRt",
          timeRate: 0.5,
          level: 1,
          pan: 0,
        }], comparisonOffset);
        const quieter = await audio.renderVoicesChunk([{
          id: "control",
          projectId: "MljSRt",
          timeRate: 1,
          level: 0.25,
          pan: 0,
        }], comparisonOffset);
        const hardRight = await audio.renderVoicesChunk([{
          id: "control",
          projectId: "MljSRt",
          timeRate: 1,
          level: 1,
          pan: 1,
        }], comparisonOffset);
        const withSecondLayer = await audio.renderVoicesChunk([
          { id: "control", projectId: "MljSRt", level: 0.5, pan: 0 },
          { id: "second", projectId: "XdSGz1", level: 0.5, pan: 0 },
        ], comparisonOffset);
        let rateMaxDiff = 0;
        let levelMaxError = 0;
        let panLeftMaxAbs = 0;
        let panRightMaxDiff = 0;
        let secondLayerMaxDiff = 0;
        for (let index = 0; index < controlBase.length; index += 1) {
          rateMaxDiff = Math.max(rateMaxDiff, Math.abs(controlBase[index] - slower[index]));
          levelMaxError = Math.max(
            levelMaxError,
            Math.abs(quieter[index] - controlBase[index] * 0.25),
          );
          secondLayerMaxDiff = Math.max(
            secondLayerMaxDiff,
            Math.abs(withSecondLayer[index] - controlBase[index]),
          );
          if (index % 2 === 0) {
            panLeftMaxAbs = Math.max(panLeftMaxAbs, Math.abs(hardRight[index]));
          } else {
            panRightMaxDiff = Math.max(
              panRightMaxDiff,
              Math.abs(hardRight[index] - controlBase[index]),
            );
          }
        }
        Object.assign(controlEffects, {
          rateMaxDiff,
          levelMaxError,
          panLeftMaxAbs,
          panRightMaxDiff,
          secondLayerMaxDiff,
        });
        const layered = await audio.renderVoicesChunk([
          { id: "a", projectId: "MljSRt", level: 0.7, pan: -0.4 },
          { id: "b", projectId: "XdSGz1", timeRate: 0.75, level: 0.7, pan: 0.4 },
          { id: "c", projectId: "Xd2GW3", timeRate: 1.25, level: 0.6, pan: -0.2 },
          { id: "d", projectId: "4tsGD8", timeRate: 1.5, level: 0.6, pan: 0.2 },
        ], comparisonOffset);
        for (const sample of layered) {
          if (!Number.isFinite(sample)) layeredFinite = false;
          layeredMaxAbs = Math.max(layeredMaxAbs, Math.abs(sample));
        }
        const muted = await audio.renderVoicesChunk([
          { id: "a", projectId: "MljSRt", enabled: false },
          { id: "b", projectId: "XdSGz1", enabled: false },
        ], comparisonOffset);
        for (const sample of muted) mutedMaxAbs = Math.max(mutedMaxAbs, Math.abs(sample));

        const sourceDurationSamples = context.sampleRate * 60;
        for (const timeRate of [0.5, 2]) {
          const seamTransportSample = Math.round(sourceDurationSamples / timeRate);
          const seam = await audio.renderVoicesChunk([{
            id: "seam",
            projectId: "MljSRt",
            enabled: true,
            timeRate,
            level: 1,
            pan: 0,
          }], seamTransportSample - 32);
          let finite = true;
          let maxAbs = 0;
          for (const sample of seam) {
            if (!Number.isFinite(sample)) finite = false;
            maxAbs = Math.max(maxAbs, Math.abs(sample));
          }
          seamReports.push({ timeRate, finite, maxAbs, seamTransportSample });
        }
      } finally {
        await audio.stop({ fade: false });
      }
      return {
        projects,
        neutralMaxDiff,
        layeredFinite,
        layeredMaxAbs,
        mutedMaxAbs,
        controlEffects,
        seamReports,
      };
    });

    await testInfo.attach("srtuss-webgpu-dispatch.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    expect(report.projects).toHaveLength(10);
    for (const project of report.projects) {
      expect(project.finite, project.id + " must return only finite samples").toBe(true);
      expect(project.maxAbs, project.id + " must stay under the engine safety ceiling").toBeLessThanOrEqual(0.880_001);
      expect(project.maxAbs, project.id + " must produce signal across representative offsets").toBeGreaterThan(0.000_1);
      expect(project.rms, project.id + " must produce non-silent energy").toBeGreaterThan(0.000_01);
      const golden = SRTUSS_NEUTRAL_GOLDENS[project.id];
      expect(golden, project.id + " must have a pre-layer neutral golden").toBeTruthy();
      for (const metric of ["rms", "meanAbs", "weightedMean"]) {
        const tolerance = Math.max(0.000_02, Math.abs(golden[metric]) * 0.002);
        expect(
          Math.abs(project[metric] - golden[metric]),
          project.id + " neutral " + metric + " must remain faithful to the pre-layer renderer",
        ).toBeLessThanOrEqual(tolerance);
      }
    }
    expect(report.neutralMaxDiff).toBeLessThanOrEqual(0.000_000_1);
    expect(report.controlEffects.rateMaxDiff).toBeGreaterThan(0.000_1);
    expect(report.controlEffects.levelMaxError).toBeLessThanOrEqual(0.000_001);
    expect(report.controlEffects.panLeftMaxAbs).toBeLessThanOrEqual(0.000_001);
    expect(report.controlEffects.panRightMaxDiff).toBeLessThanOrEqual(0.000_001);
    expect(report.controlEffects.secondLayerMaxDiff).toBeGreaterThan(0.000_1);
    expect(report.layeredFinite).toBe(true);
    expect(report.layeredMaxAbs).toBeGreaterThan(0.000_1);
    expect(report.layeredMaxAbs).toBeLessThanOrEqual(0.880_001);
    expect(report.mutedMaxAbs).toBe(0);
    expect(report.seamReports).toHaveLength(2);
    for (const seam of report.seamReports) {
      expect(seam.finite, seam.timeRate + "x source seam must stay finite").toBe(true);
      expect(seam.maxAbs, seam.timeRate + "x source seam must render signal").toBeGreaterThan(0.000_1);
      expect(seam.maxAbs, seam.timeRate + "x source seam must remain bounded").toBeLessThanOrEqual(0.880_001);
    }
  });

  test("every decomposed source part compiles and produces bounded independent signal", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.goto("srtuss.html", { waitUntil: "load" });

    const report = await page.evaluate(async () => {
      if (!navigator.gpu) throw new Error("WebGPU is unavailable in this Chromium run.");
      const appVersion = new URL(
        document.querySelector('script[src^="srtuss-app.js"]')?.src ?? location.href,
      ).search;
      const [
        { SrtussAudio },
        {
          SRTUSS_MASTER_FAMILIES,
          SRTUSS_MASTER_PARAM_DEFAULTS,
          SRTUSS_MASTER_STEM_DEFAULTS,
        },
      ] = await Promise.all([
        import("./src/srtuss.js" + appVersion),
        import("./src/srtuss-master.js" + appVersion),
      ]);
      const gainParam = () => ({
        value: 0,
        cancelAndHoldAtTime() {},
        cancelScheduledValues() {},
        linearRampToValueAtTime() {},
        setTargetAtTime() {},
        setValueAtTime() {},
      });
      const context = {
        currentTime: 0,
        destination: null,
        sampleRate: 44_100,
        state: "running",
        createGain() {
          return { gain: gainParam(), connect() {}, disconnect() {} };
        },
      };
      const audio = new SrtussAudio(globalThis, {
        chunkDuration: 0.03,
        pipelineCacheSize: 10,
        workgroupSize: 256,
      });
      const scanSeconds = [
        0.05, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.75, 3.5, 4.5, 5,
        5.5, 7, 8.5, 10, 12, 14, 15, 16, 20, 24, 25, 28, 32,
        35, 36, 40, 44, 45, 48, 52, 55, 56, 59,
      ];
      const inspect = (samples) => {
        let finite = true;
        let maxAbs = 0;
        let squareSum = 0;
        for (const sample of samples) {
          if (!Number.isFinite(sample)) finite = false;
          maxAbs = Math.max(maxAbs, Math.abs(sample));
          squareSum += sample * sample;
        }
        return {
          finite,
          maxAbs,
          rms: Math.sqrt(squareSum / Math.max(1, samples.length)),
        };
      };
      const parts = [];
      try {
        await audio.start({ autoStart: false, context });
        for (const family of SRTUSS_MASTER_FAMILIES) {
          for (const part of family.parts) {
            const result = {
              projectId: family.projectId,
              partId: part.id,
              label: part.label,
              finite: true,
              maxAbs: 0,
              rms: 0,
              mixDifference: 0,
              firstSignalSeconds: null,
            };
            for (const seconds of scanSeconds) {
              const offset = Math.round(seconds * context.sampleRate);
              const voice = {
                id: "part-probe",
                groupId: "part-probe",
                projectId: family.projectId,
                mode: "master",
                partId: part.id,
                enabled: true,
                timeRate: 1,
                level: 1,
                pan: 0,
                width: 1,
                params: SRTUSS_MASTER_PARAM_DEFAULTS,
                stems: SRTUSS_MASTER_STEM_DEFAULTS,
              };
              const samples = await audio.renderVoicesChunk([voice], offset);
              const metrics = inspect(samples);
              result.finite = result.finite && metrics.finite;
              result.maxAbs = Math.max(result.maxAbs, metrics.maxAbs);
              result.rms = Math.max(result.rms, metrics.rms);
              if (metrics.maxAbs > 0.000_01) {
                result.firstSignalSeconds = seconds;
                const mix = await audio.renderVoicesChunk([{
                  ...voice,
                  partId: "mix",
                }], offset);
                for (let index = 0; index < samples.length; index += 1) {
                  result.mixDifference = Math.max(
                    result.mixDifference,
                    Math.abs(samples[index] - mix[index]),
                  );
                }
                break;
              }
            }
            parts.push(result);
          }
        }
      } finally {
        await audio.stop({ fade: false });
      }
      return {
        expectedCount: SRTUSS_MASTER_FAMILIES.reduce(
          (total, family) => total + family.parts.length,
          0,
        ),
        parts,
      };
    });

    await testInfo.attach("srtuss-decomposed-parts.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    expect(report.parts).toHaveLength(report.expectedCount);
    expect(report.parts).toHaveLength(48);
    for (const part of report.parts) {
      const description = part.projectId + "/" + part.partId;
      expect(part.finite, description + " must remain finite").toBe(true);
      expect(part.maxAbs, description + " must produce isolated signal").toBeGreaterThan(0.000_01);
      expect(part.maxAbs, description + " must remain bounded").toBeLessThanOrEqual(0.880_001);
      expect(part.rms, description + " must have non-silent energy").toBeGreaterThan(0.000_001);
      expect(part.mixDifference, description + " must differ from the complete mix").toBeGreaterThan(0.000_001);
      expect(part.firstSignalSeconds, description + " must be reachable in the source timeline").not.toBeNull();
    }
  });

  test("composed rate endpoints render safely and change live without resetting transport", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.name + ": " + error.message));
    await page.goto("srtuss.html", { waitUntil: "load" });
    await expect(page.locator("body")).toHaveAttribute("data-runtime-ready", "true");

    const endpointReport = await page.evaluate(async () => {
      if (!navigator.gpu) throw new Error("WebGPU is unavailable in this Chromium run.");
      const appVersion = new URL(
        document.querySelector('script[src^="srtuss-app.js"]')?.src ?? location.href,
      ).search;
      const [{ SRTUSS_DURATION_SECONDS, SrtussAudio }, { SRTUSS_MASTER_PARAM_DEFAULTS }] =
        await Promise.all([
          import("./src/srtuss.js" + appVersion),
          import("./src/srtuss-master.js" + appVersion),
        ]);
      const gainParam = () => ({
        value: 0,
        cancelAndHoldAtTime() {},
        cancelScheduledValues() {},
        linearRampToValueAtTime() {},
        setTargetAtTime() {},
        setValueAtTime() {},
      });
      const context = {
        currentTime: 0,
        destination: null,
        sampleRate: 44_100,
        state: "running",
        createGain() {
          return { gain: gainParam(), connect() {}, disconnect() {} };
        },
      };
      const audio = new SrtussAudio(globalThis, {
        chunkDuration: 0.03,
        pipelineCacheSize: 2,
        workgroupSize: 256,
      });
      const inspectBuffer = (samples) => {
        let finite = true;
        let maxAbs = 0;
        let squareSum = 0;
        for (const sample of samples) {
          if (!Number.isFinite(sample)) finite = false;
          maxAbs = Math.max(maxAbs, Math.abs(sample));
          squareSum += sample * sample;
        }
        return {
          finite,
          length: samples.length,
          maxAbs,
          rms: Math.sqrt(squareSum / Math.max(1, samples.length)),
        };
      };
      const endpoints = [];
      try {
        await audio.start({ autoStart: false, context });
        for (const factors of [
          { name: "minimum", tape: 0.5, localClock: 0.5, rackClock: 0.5 },
          { name: "maximum", tape: 2, localClock: 2, rackClock: 2 },
        ]) {
          const composedRate = factors.tape * factors.localClock * factors.rackClock;
          const voice = [{
            id: "endpoint-noir",
            projectId: "XdSGz1",
            mode: "master",
            enabled: true,
            timeRate: composedRate,
            level: 1,
            pan: 0,
            width: 1,
            params: { ...SRTUSS_MASTER_PARAM_DEFAULTS, clock: 1 },
          }];
          const durationSamples = context.sampleRate * SRTUSS_DURATION_SECONDS;
          const loopBoundarySample = Math.round(durationSamples / composedRate);
          const boundaryLeadFrames = Math.floor(audio.chunkNumSamplesPerChannel / 2);
          const boundaryOffset = loopBoundarySample - boundaryLeadFrames;
          const sourceStart = (boundaryOffset * composedRate) % durationSamples;
          const crossesLoopBoundary = sourceStart
            + audio.chunkNumSamplesPerChannel * composedRate >= durationSamples;
          const windows = [];
          for (const [name, offset] of [
            ["representative", Math.round(context.sampleRate * 13.25)],
            ["near-loop-boundary", boundaryOffset],
          ]) {
            windows.push({
              name,
              offset,
              ...inspectBuffer(await audio.renderVoicesChunk(voice, offset)),
            });
          }
          endpoints.push({
            ...factors,
            composedRate,
            loopBoundarySample,
            crossesLoopBoundary,
            windows,
          });
        }
      } finally {
        await audio.stop({ fade: false });
      }
      return endpoints;
    });

    expect(endpointReport).toHaveLength(2);
    expect(endpointReport.map(({ composedRate }) => composedRate)).toEqual([0.125, 8]);
    for (const endpoint of endpointReport) {
      expect(endpoint.windows).toHaveLength(2);
      expect(
        endpoint.crossesLoopBoundary,
        endpoint.name + " endpoint window must cross the 60-second source loop",
      ).toBe(true);
      for (const window of endpoint.windows) {
        const description = endpoint.name + " " + window.name + " buffer";
        expect(window.length, description + " must contain stereo samples").toBeGreaterThan(0);
        expect(window.finite, description + " must remain finite").toBe(true);
        expect(window.maxAbs, description + " must render signal").toBeGreaterThan(0.000_1);
        expect(window.rms, description + " must remain non-silent").toBeGreaterThan(0.000_01);
        expect(window.maxAbs, description + " must remain bounded").toBeLessThanOrEqual(0.880_001);
      }
    }

    await page.evaluate(async () => {
      const appVersion = new URL(
        document.querySelector('script[src^="srtuss-app.js"]')?.src ?? location.href,
      ).search;
      const { SrtussAudio } = await import("./src/srtuss.js" + appVersion);
      const originalSetVoices = SrtussAudio.prototype.setVoices;
      globalThis.__srtussEndpointVoiceCommits = [];
      SrtussAudio.prototype.setVoices = async function setVoicesWithEndpointProbe(
        voices,
        options,
      ) {
        globalThis.__srtussEndpointVoiceCommits.push({
          restart: options?.restart ?? null,
          voices: voices.map((voice) => ({
            projectId: voice.projectId,
            partId: voice.partId,
            stems: Object.values(voice.stems ?? {}),
            solo: voice.solo,
            timeRate: voice.timeRate,
            foldedLocalClock: voice.params?.clock,
          })),
        });
        return originalSetVoices.call(this, voices, options);
      };
    });
    const waitForEndpointCommit = async (expectedRate) => {
      await expect.poll(() => page.evaluate((rate) => (
        globalThis.__srtussEndpointVoiceCommits.some((commit) => (
          commit.restart === false
          && commit.voices.some((voice) => (
            voice.projectId === "ldlfRS"
            && voice.partId === "spectral-body"
            && voice.solo === true
            && voice.timeRate === rate
            && voice.foldedLocalClock === 1
            && voice.stems.length === 5
            && voice.stems.every((value) => value === 1)
          ))
        ))
      ), expectedRate), { timeout: 10_000 }).toBe(true);
    };

    const timelineSeconds = async () => {
      const [minutes, seconds] = (await page.locator("#timeline").textContent()).split(":");
      return Number(minutes) * 60 + Number(seconds);
    };
    const tapeRate = page.locator("#selectedVoiceRate");
    const localClock = page.locator(
      '#masterControls input[data-master-param="clock"][data-supported="true"]',
    );
    const rackClock = page.locator("#globalClock");
    const playButton = page.locator("#synthPlayButton");
    const audioButton = page.locator("#audioButton");
    await expect(page.locator("#selectedVoiceMode")).toHaveValue("master");
    const partSelect = page.locator("#selectedVoicePart");
    await partSelect.selectOption("mix");
    const compatibilityStems = page.locator("#stemControls input[data-master-stem]");
    await expect(compatibilityStems).toHaveCount(5);
    for (let index = 0; index < await compatibilityStems.count(); index += 1) {
      await compatibilityStems.nth(index).fill("0");
      await compatibilityStems.nth(index).dispatchEvent("change");
    }
    await partSelect.selectOption("spectral-body");
    await expect(page.locator("#stemControls input[data-master-stem]")).toHaveCount(0);
    await expect(tapeRate).toBeEnabled();
    await expect(localClock).toBeEnabled();
    await expect(rackClock).toBeEnabled();
    await page.locator("#selectedVoiceSolo").click();
    await expect(page.locator("#selectedVoiceSolo")).toHaveAttribute("aria-pressed", "true");

    const setRateFactors = async (value) => {
      await tapeRate.fill(value);
      await localClock.fill(value);
      await rackClock.fill(value);
      await rackClock.dispatchEvent("change");
      const formatted = Number(value).toFixed(2) + "x";
      await expect(page.locator("#selectedVoiceRateOut")).toHaveText(formatted);
      await expect(
        page.locator('#masterControls [data-master-param-output="clock"]'),
      ).toHaveText(formatted);
      await expect(page.locator("#globalClockOut")).toHaveText(formatted);
    };

    await setRateFactors("0.5");
    await playButton.click();
    await audioButton.click();
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
    await expect(audioButton).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await waitForAudioState(page, true, 30_000);
    await waitForEndpointCommit(0.125);
    const minimumEnvelope = await sampleAudioEnvelope(page, {
      durationMs: 500,
      intervalMs: 40,
    });
    expect(minimumEnvelope.summary.finite).toBe(true);
    expect(minimumEnvelope.summary.maxPeak).toBeGreaterThan(0.000_1);
    expect(minimumEnvelope.summary.clippedSamples).toBe(0);

    const beforeLiveEndpointChange = await timelineSeconds();
    await setRateFactors("2");
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
    await expect(audioButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-playing", "true");
    await waitForEndpointCommit(8);
    const maximumEnvelope = await sampleAudioEnvelope(page, {
      durationMs: 500,
      intervalMs: 40,
    });
    const afterLiveEndpointChange = await timelineSeconds();
    expect(afterLiveEndpointChange).toBeGreaterThan(beforeLiveEndpointChange + 0.08);
    expect(maximumEnvelope.summary.finite).toBe(true);
    expect(maximumEnvelope.summary.maxPeak).toBeGreaterThan(0.000_1);
    expect(maximumEnvelope.summary.clippedSamples).toBe(0);
    expect(pageErrors).toEqual([]);

    await testInfo.attach("srtuss-composed-rate-endpoints.json", {
      body: JSON.stringify({
        endpoints: endpointReport,
        beforeLiveEndpointChange,
        afterLiveEndpointChange,
        minimumEnvelope: minimumEnvelope.summary,
        maximumEnvelope: maximumEnvelope.summary,
      }, null, 2),
      contentType: "application/json",
    });

    await playButton.click();
    await waitForStableAudioState(page, false, { timeout: 10_000 });
    await audioButton.click();
    await waitForStableAudioState(page, false, { timeout: 10_000 });
  });

  test("master surface exposes decomposed song banks, rack globals, macros, and the default parts", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.name + ": " + error.message));
    await page.goto("srtuss.html", { waitUntil: "load" });

    await expect(page.locator("body")).toHaveAttribute("data-runtime-ready", "true");
    await expect(page.locator("canvas, video")).toHaveCount(0);

    const presets = page.locator("#presetButtons [data-master-preset]");
    await expect(presets).toHaveCount(28);
    const presetKinds = await presets.locator("span").allTextContents();
    expect(presetKinds.filter((text) => /independent parts/i.test(text))).toHaveLength(8);
    expect(presetKinds.filter((text) => /layered songs/i.test(text))).toHaveLength(12);
    expect(presetKinds.filter((text) => /exact source/i.test(text))).toHaveLength(8);
    const presetIds = await presets.evaluateAll((buttons) => (
      buttons.map((button) => button.dataset.masterPreset)
    ));
    expect(new Set(presetIds).size).toBe(28);
    await expect(
      page.locator('#presetButtons [data-master-preset="parts-ldlfrs"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#originalButtons [data-original-sound]")).toHaveCount(10);

    const knobs = page.locator("#masterControls .srtuss-knob");
    await expect(knobs).toHaveCount(10);
    await expect(knobs.locator(".srtuss-knob__dial input[type=range]")).toHaveCount(10);
    await expect(page.locator("#rackControls input[type=range]")).toHaveCount(5);
    const rackGlobalContracts = await page.evaluate((ids) => {
      const firstSelectedMacro = document.querySelector(
        "#masterControls input[data-master-param]",
      );
      return ids.map((id) => {
        const input = document.getElementById(id);
        const output = document.getElementById(id + "Out");
        return {
          id,
          exists: Boolean(input),
          labelled: Boolean(input?.labels?.length),
          output: output?.textContent?.trim(),
          minimum: Number(input?.min),
          maximum: Number(input?.max),
          current: Number(input?.value),
          enabled: input ? !input.disabled : false,
          beforeSelectedMacros: Boolean(
            input
              && firstSelectedMacro
              && (input.compareDocumentPosition(firstSelectedMacro)
                & Node.DOCUMENT_POSITION_FOLLOWING),
          ),
        };
      });
    }, SRTUSS_RACK_GLOBAL_IDS);
    expect(rackGlobalContracts).toHaveLength(5);
    for (const globalControl of rackGlobalContracts) {
      expect(globalControl.exists, globalControl.id + " must exist").toBe(true);
      expect(globalControl.labelled, globalControl.id + " must have a label").toBe(true);
      expect(globalControl.output, globalControl.id + " must expose its value").toBeTruthy();
      expect(globalControl.enabled, globalControl.id + " must be editable").toBe(true);
      expect(Number.isFinite(globalControl.minimum)).toBe(true);
      expect(Number.isFinite(globalControl.maximum)).toBe(true);
      expect(globalControl.maximum).toBeGreaterThan(globalControl.minimum);
      expect(globalControl.current).toBeGreaterThanOrEqual(globalControl.minimum);
      expect(globalControl.current).toBeLessThanOrEqual(globalControl.maximum);
      expect(
        globalControl.beforeSelectedMacros,
        globalControl.id + " must precede selected-voice macros",
      ).toBe(true);
    }
    const macroContracts = await knobs.evaluateAll((controls) => controls.map((control) => {
      const input = control.querySelector("input[type=range]");
      return {
        id: control.dataset.macroId,
        label: control.querySelector(".srtuss-knob__label")?.textContent?.trim(),
        value: control.querySelector(".srtuss-knob__value")?.textContent?.trim(),
        ariaLabel: input?.getAttribute("aria-label"),
        minimum: Number(input?.min),
        maximum: Number(input?.max),
        current: Number(input?.value),
      };
    }));
    for (const macro of macroContracts) {
      expect(macro.id).toBeTruthy();
      expect(macro.label).toBeTruthy();
      expect(macro.value).toBeTruthy();
      expect(macro.ariaLabel).toBeTruthy();
      expect(Number.isFinite(macro.minimum)).toBe(true);
      expect(Number.isFinite(macro.maximum)).toBe(true);
      expect(macro.maximum).toBeGreaterThan(macro.minimum);
      expect(macro.current).toBeGreaterThanOrEqual(macro.minimum);
      expect(macro.current).toBeLessThanOrEqual(macro.maximum);
    }

    const voices = page.locator("#voiceDeck .srtuss-voice-card");
    await expect(voices).toHaveCount(7);
    await expect(page.locator("body")).toHaveAttribute("data-voice-count", "7");
    await expect(voices.filter({ hasText: "Shift" })).toHaveCount(7);
    for (const label of ["Stochastic body", "Dorian PWM arp", "Pulse bass", "Pitch-drop kicks", "Snare noise", "Hats + ticks", "Stereo delays"]) {
      await expect(voices.filter({ hasText: label })).toHaveCount(1);
    }
    await expect(voices.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#selectedVoiceSource")).toHaveValue("ldlfRS");
    await expect(page.locator("#selectedVoiceMode")).toHaveValue("master");
    await expect(page.locator("#selectedVoicePart")).toHaveValue("spectral-body");

    for (const selector of [
      ".srtuss-selected-voice",
      ".srtuss-techniques",
      ".srtuss-stems",
    ]) {
      await expect(page.locator(selector)).toHaveJSProperty("open", true);
    }
    for (const selector of [
      ".srtuss-originals",
      ".srtuss-pending",
      ".srtuss-runtime",
    ]) {
      await expect(page.locator(selector)).toHaveJSProperty("open", false);
    }
    const mixedScene = page.locator(
      '#presetButtons [data-master-preset="monochrome-machinery"]',
    );
    await mixedScene.click();
    await expect(page.locator("#voiceDeck .srtuss-voice-card")).toHaveCount(3);
    await expect(page.locator("#selectedVoicePart")).toHaveValue("mix");
    const explode = page.locator("#explodeSelectedVoice");
    await expect(explode).toBeEnabled();
    await explode.click();
    const explodedCards = page.locator("#voiceDeck .srtuss-voice-card");
    await expect(explodedCards).toHaveCount(5);
    await expect(page.locator("body")).toHaveAttribute("data-voice-count", "5");
    for (const label of ["Detuned melody", "Pulse + sub bass", "Alternating taps"]) {
      await expect(explodedCards.filter({ hasText: label })).toHaveCount(1);
    }
    await expect(page.locator("#selectedVoicePart")).toHaveValue("melody");
    await expect(page.locator("#stemControls .control-note")).toContainText(
      "already an isolated source part",
    );
    expect(pageErrors).toEqual([]);
  });

  test("Audio and Play stay separate while presets preserve the running transport", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.name + ": " + error.message));
    await page.goto("srtuss.html", { waitUntil: "load" });
    await expect(page.locator("body")).toHaveAttribute("data-runtime-ready", "true");

    const timelineSeconds = async () => {
      const [minutes, seconds] = (await page.locator("#timeline").textContent()).split(":");
      return Number(minutes) * 60 + Number(seconds);
    };
    const audioButton = page.locator("#audioButton");
    const playButton = page.locator("#synthPlayButton");
    expect((await readAudioStatus(page)).active).toBe(false);

    const beforePlay = await timelineSeconds();
    await playButton.click();
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-playing", "true");
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#streamState")).toContainText("playing silently");
    await expect(page.locator("#liveStatus")).toContainText(
      "Audio is off — turn it on to hear playback",
    );
    await page.waitForTimeout(180);
    expect(await timelineSeconds()).toBeGreaterThan(beforePlay + 0.08);

    await audioButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await waitForAudioState(page, true, 30_000);
    const initial = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 40 });
    expect(initial.summary.finite).toBe(true);
    expect(initial.summary.maxPeak).toBeGreaterThan(0.001);
    expect(initial.summary.clippedSamples).toBe(0);

    const beforeGlobalEdit = await timelineSeconds();
    const globalClock = page.locator("#globalClock");
    await expect(globalClock).toBeEnabled();
    const globalClockTarget = (await globalClock.inputValue()) === "1.17" ? "0.93" : "1.17";
    await globalClock.fill(globalClockTarget);
    await globalClock.dispatchEvent("change");
    await expect(globalClock).toHaveValue(globalClockTarget);
    await expect(page.locator("#globalClockOut")).toHaveText(
      Number(globalClockTarget).toFixed(2) + "x",
    );
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
    await expect(audioButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-playing", "true");
    await page.waitForTimeout(180);
    const afterGlobalEdit = await timelineSeconds();
    expect(afterGlobalEdit).toBeGreaterThan(beforeGlobalEdit + 0.08);

    const beforePreset = await timelineSeconds();
    const nextPreset = page.locator(
      '#presetButtons [data-master-preset="rubble-weather"]',
    );
    await nextPreset.click();
    await expect(page).toHaveURL(/[?&]preset=rubble-weather/);
    await expect(nextPreset).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#liveStatus")).toContainText(
      "Loaded Rubble Weather without restarting transport",
      { timeout: 30_000 },
    );
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
    await expect(audioButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveAttribute("data-playing", "true");
    const afterPreset = await timelineSeconds();
    expect(afterPreset).toBeGreaterThan(beforePreset);

    const changed = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 40 });
    expect(changed.summary.finite).toBe(true);
    expect(changed.summary.maxPeak).toBeGreaterThan(0.001);
    expect(changed.summary.clippedSamples).toBe(0);
    await testInfo.attach("srtuss-master-preset-transition.json", {
      body: JSON.stringify({
        beforePlay,
        beforeGlobalEdit,
        afterGlobalEdit,
        beforePreset,
        afterPreset,
        initial: initial.summary,
        changed: changed.summary,
      }, null, 2),
      contentType: "application/json",
    });
    expect(pageErrors).toEqual([]);

    await playButton.click();
    await waitForStableAudioState(page, false, { timeout: 10_000 });
    await audioButton.click();
    await waitForStableAudioState(page, false, { timeout: 10_000 });
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
  });

  test("parts can be added, edited, soloed, muted, and removed while transport runs", async ({ page }) => {
    test.setTimeout(60_000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.name + ": " + error.message));
    await page.goto("srtuss.html?preset=monochrome-machinery", { waitUntil: "load" });
    await expect(page.locator("body")).toHaveAttribute("data-runtime-ready", "true");

    const timelineSeconds = async () => {
      const [minutes, seconds] = (await page.locator("#timeline").textContent()).split(":");
      return Number(minutes) * 60 + Number(seconds);
    };
    const playButton = page.locator("#synthPlayButton");
    await playButton.click();
    const beforeEdits = await timelineSeconds();

    const cards = page.locator("#voiceDeck .srtuss-voice-card");
    const addButton = page.locator("#addVoice");
    await expect(cards).toHaveCount(3);
    for (const expectedCount of [4, 5, 6]) {
      await addButton.click();
      await expect(cards).toHaveCount(expectedCount);
      await expect(page.locator("body")).toHaveAttribute(
        "data-voice-count",
        String(expectedCount),
      );
    }
    await expect(addButton).toBeEnabled();
    await expect(cards.last()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#selectedVoicePart")).toHaveValue("echo");
    await expect(page.locator("#selectedVoiceMode")).toHaveValue("master");

    await page.locator("#selectedVoiceLevel").fill("0.31");
    await page.locator("#selectedVoiceLevel").dispatchEvent("change");
    await expect(page.locator("#selectedVoiceLevelOut")).toHaveText("31%");
    await page.locator("#selectedVoicePan").fill("-0.55");
    await page.locator("#selectedVoicePan").dispatchEvent("change");
    await expect(page.locator("#selectedVoicePanOut")).toHaveText("L 55");
    await page.locator("#selectedVoiceRate").fill("1.37");
    await page.locator("#selectedVoiceRate").dispatchEvent("change");
    await expect(page.locator("#selectedVoiceRateOut")).toHaveText("1.37x");

    const macro = page.locator(
      '#masterControls input[data-master-param][data-supported="true"]',
    ).first();
    await expect(macro).toBeEnabled();
    const macroId = await macro.getAttribute("data-master-param");
    const macroTarget = await macro.evaluate((input) => {
      const minimum = Number(input.min);
      const maximum = Number(input.max);
      const target = minimum + (maximum - minimum) * 0.37;
      const step = Number(input.step) || 0.01;
      return String(Math.round(target / step) * step);
    });
    await macro.fill(macroTarget);
    await macro.dispatchEvent("change");
    await expect(
      page.locator('#nativeControls input[data-master-param="' + macroId + '"]'),
    ).toHaveValue(macroTarget);

    await expect(page.locator("#stemControls input[data-master-stem]")).toHaveCount(0);
    await cards.first().click();
    await expect(page.locator("#selectedVoicePart")).toHaveValue("mix");
    const stem = page.locator("#stemControls input[data-master-stem]").first();
    await expect(stem).toBeEnabled();
    await stem.fill("0.63");
    await stem.dispatchEvent("change");
    const stemId = await stem.getAttribute("data-master-stem");
    await expect(
      page.locator('[data-master-stem-output="' + stemId + '"]'),
    ).toHaveText("63%");

    const solo = page.locator("#selectedVoiceSolo");
    await solo.click();
    await expect(solo).toHaveAttribute("aria-pressed", "true");
    await expect(solo).toHaveText("Soloed");
    await expect(cards.first()).toHaveAttribute("data-solo", "true");
    await expect(cards.first().locator(".srtuss-voice-card__mode")).toContainText("SOLO");
    await solo.click();
    await expect(cards.first()).toHaveAttribute("data-solo", "false");
    await expect(solo).toHaveAttribute("aria-pressed", "false");

    const enabled = page.locator("#selectedVoiceEnabled");
    await enabled.click();
    await expect(enabled).toHaveAttribute("aria-pressed", "false");
    await expect(enabled).toHaveText("Muted");
    await expect(cards.first()).toHaveAttribute("data-enabled", "false");
    await expect(cards.first().locator(".srtuss-voice-card__mode")).toContainText("muted");
    await enabled.click();
    await expect(enabled).toHaveAttribute("aria-pressed", "true");

    await page.locator("#removeSelectedVoice").click();
    await expect(cards).toHaveCount(5);
    await expect(page.locator("body")).toHaveAttribute("data-voice-count", "5");
    await expect(addButton).toBeEnabled();
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(180);
    expect(await timelineSeconds()).toBeGreaterThan(beforeEdits + 0.08);
    expect(pageErrors).toEqual([]);

    await playButton.click();
    await expect(playButton).toHaveAttribute("aria-pressed", "false");
  });

  test("Chiptune and Acid Jam remain exact-original fallbacks", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.name + ": " + error.message));

    for (const [projectId, label] of [
      ["MljSRt", "Chiptune"],
      ["ldfSW2", "acid jam"],
    ]) {
      await page.goto("srtuss.html?sound=" + projectId, { waitUntil: "load" });
      await expect(page.locator("body")).toHaveAttribute("data-runtime-ready", "true");
      await expect(page).toHaveURL(new RegExp("[?&]sound=" + projectId));
      await expect(page.locator("#voiceDeck .srtuss-voice-card")).toHaveCount(1);
      await expect(page.locator("#selectedVoiceName")).toContainText(label);
      await expect(page.locator("#selectedVoiceSource")).toHaveValue(projectId);
      await expect(page.locator("#selectedVoiceMode")).toHaveValue("original");
      await expect(
        page.locator('#selectedVoiceMode option[value="master"]'),
      ).toHaveAttribute("disabled", "");
      await expect(page.locator("#randomizePatch")).toBeDisabled();
      await expect(page.locator("#mutatePatch")).toBeDisabled();
      await expect(
        page.locator('#originalButtons [data-original-sound="' + projectId + '"]'),
      ).toHaveAttribute("aria-pressed", "true");

      const macroInputs = page.locator("#masterControls input[type=range]");
      await expect(macroInputs).toHaveCount(10);
      expect(await macroInputs.evaluateAll((inputs) => inputs.every((input) => input.disabled))).toBe(true);
      const nativeInputs = page.locator("#nativeControls input[type=range]");
      await expect(nativeInputs).toHaveCount(10);
      expect(await nativeInputs.evaluateAll((inputs) => inputs.every((input) => input.disabled))).toBe(true);
      await expect(page.locator("#stemControls .control-note")).toContainText(
        "exact-only",
      );
      expect((await readAudioStatus(page)).active).toBe(false);
    }
    expect(pageErrors).toEqual([]);
  });

  test("master controls remain reachable at desktop and phone viewports", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push("page: " + error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push("console: " + message.text());
    });

    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "portrait", width: 390, height: 844 },
      { name: "landscape", width: 844, height: 390 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("srtuss.html", { waitUntil: "load" });
      await expect(page.locator("body")).toHaveAttribute("data-runtime-ready", "true");
      for (const expectedCount of [8, 9, 10]) {
        await page.locator("#addVoice").click();
        await expect(page.locator("#voiceDeck .srtuss-voice-card")).toHaveCount(expectedCount);
      }

      const originals = page.locator(".srtuss-originals");
      const runtime = page.locator(".srtuss-runtime");
      await originals.locator(":scope > summary").click();
      await runtime.locator(":scope > summary").click();
      await expect(originals).toHaveJSProperty("open", true);
      await expect(runtime).toHaveJSProperty("open", true);

      const reachable = [
        page.locator("#audioButton"),
        page.locator("#output"),
        page.locator("#synthPlayButton"),
        page.locator("#randomizePatch"),
        page.locator("#mutatePatch"),
        page.locator("#resetMaster"),
        ...SRTUSS_RACK_GLOBAL_IDS.map((id) => page.locator("#" + id)),
        page.locator("#masterControls .srtuss-knob").first(),
        page.locator("#masterControls .srtuss-knob").last(),
        page.locator("#presetButtons .srtuss-preset-button").first(),
        page.locator("#presetButtons .srtuss-preset-button").last(),
        page.locator("#addVoice"),
        page.locator("#voiceDeck .srtuss-voice-card").first(),
        page.locator("#voiceDeck .srtuss-voice-card").last(),
        page.locator("#selectedVoiceSource"),
        page.locator("#selectedVoiceMode"),
        page.locator("#selectedVoicePart"),
        page.locator("#explodeSelectedVoice"),
        page.locator("#selectedVoiceEnabled"),
        page.locator("#selectedVoiceSolo"),
        page.locator("#selectedVoiceLevel"),
        page.locator("#selectedVoicePan"),
        page.locator("#selectedVoiceRate"),
        page.locator("#nativeControls .srtuss-native-control").first(),
        page.locator("#nativeControls .srtuss-native-control").last(),
        page.locator("#removeSelectedVoice"),
        page.locator("#originalButtons .srtuss-original-button").first(),
        page.locator("#originalButtons .srtuss-original-button").last(),
        page.locator("#chunkDuration"),
        page.locator("#workgroupSize"),
        page.locator(".srtuss-pending > summary"),
      ];
      for (const control of reachable) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
        const box = await control.boundingBox();
        expect(box?.width, viewport.name + " control width").toBeGreaterThan(0);
        expect(box?.height, viewport.name + " control height").toBeGreaterThan(0);
      }

      const rackGlobalPlacement = await page.evaluate((ids) => {
        const firstSelectedMacro = document.querySelector(
          "#masterControls input[data-master-param]",
        );
        const macroTop = firstSelectedMacro?.getBoundingClientRect().top ?? Number.NaN;
        return ids.map((id) => {
          const input = document.getElementById(id);
          return {
            id,
            beforeInDocument: Boolean(
              input
                && firstSelectedMacro
                && (input.compareDocumentPosition(firstSelectedMacro)
                  & Node.DOCUMENT_POSITION_FOLLOWING),
            ),
            visuallyBefore: Boolean(
              input && Number.isFinite(macroTop)
                && input.getBoundingClientRect().top < macroTop,
            ),
          };
        });
      }, SRTUSS_RACK_GLOBAL_IDS);
      expect(rackGlobalPlacement).toHaveLength(5);
      for (const globalControl of rackGlobalPlacement) {
        expect(
          globalControl.beforeInDocument,
          viewport.name + " " + globalControl.id + " must precede selected macros in the DOM",
        ).toBe(true);
        expect(
          globalControl.visuallyBefore,
          viewport.name + " " + globalControl.id + " must render above selected macros",
        ).toBe(true);
      }

      const geometry = await page.evaluate(() => {
        const measure = (selector) => {
          const element = document.querySelector(selector);
          const style = getComputedStyle(element);
          return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
          };
        };
        return {
          viewportWidth: innerWidth,
          bodyWidth: document.body.scrollWidth,
          documentWidth: document.documentElement.scrollWidth,
          shell: measure(".srtuss-shell"),
          workbench: measure(".srtuss-workbench"),
          editor: measure(".srtuss-editor"),
          knobs: measure(".srtuss-knob-shelf"),
          voices: measure(".srtuss-voice-deck"),
        };
      });
      expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(["auto", "scroll"]).toContain(geometry.knobs.overflowX);
      expect(["auto", "scroll"]).toContain(geometry.voices.overflowX);
      expect(geometry.voices.scrollWidth).toBeGreaterThan(geometry.voices.clientWidth);
      if (viewport.name === "desktop") {
        expect(["auto", "scroll"]).toContain(geometry.editor.overflowY);
        expect(geometry.editor.scrollHeight).toBeGreaterThan(geometry.editor.clientHeight);
      } else if (viewport.name === "portrait") {
        expect(["auto", "scroll"]).toContain(geometry.shell.overflowY);
        expect(geometry.shell.scrollHeight).toBeGreaterThan(geometry.shell.clientHeight);
      } else {
        expect(["auto", "scroll"]).toContain(geometry.workbench.overflowY);
        expect(["auto", "scroll"]).toContain(geometry.editor.overflowY);
        expect(geometry.workbench.scrollHeight).toBeGreaterThan(geometry.workbench.clientHeight);
        expect(geometry.editor.scrollHeight).toBeGreaterThan(geometry.editor.clientHeight);
      }
    }
    expect(runtimeErrors).toEqual([]);

    const pageUrl = new URL("srtuss.html", page.url()).href;
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      const touchContext = await browser.newContext({
        viewport,
        hasTouch: true,
        isMobile: true,
      });
      try {
        const touchPage = await touchContext.newPage();
        await touchPage.goto(pageUrl, { waitUntil: "load" });
        for (const id of SRTUSS_RACK_GLOBAL_IDS) {
          const globalControl = touchPage.locator("#" + id);
          await expect(globalControl).toHaveCount(1);
          await globalControl.scrollIntoViewIfNeeded();
          await expect(globalControl).toBeVisible();
          const box = await globalControl.boundingBox();
          expect(box?.width, id + " touch width").toBeGreaterThan(0);
          expect(box?.height, id + " touch height").toBeGreaterThan(0);
        }
        const coarseGeometry = await touchPage.evaluate(() => ({
          coarse: matchMedia("(pointer: coarse)").matches,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          audioHeight: document.getElementById("audioButton").getBoundingClientRect().height,
          playHeight: document.getElementById("synthPlayButton").getBoundingClientRect().height,
          dialWidth: document.querySelector(".srtuss-knob__dial").getBoundingClientRect().width,
          partSelectHeight: document.getElementById("selectedVoicePart").getBoundingClientRect().height,
          explodeHeight: document.getElementById("explodeSelectedVoice").getBoundingClientRect().height,
          dialHeight: document.querySelector(".srtuss-knob__dial").getBoundingClientRect().height,
        }));
        expect(coarseGeometry.coarse).toBe(true);
        expect(coarseGeometry.documentWidth).toBeLessThanOrEqual(
          coarseGeometry.viewportWidth + 1,
        );
        expect(coarseGeometry.audioHeight).toBeGreaterThanOrEqual(48);
        expect(coarseGeometry.playHeight).toBeGreaterThanOrEqual(48);
        expect(coarseGeometry.dialWidth).toBeGreaterThanOrEqual(48);
        expect(coarseGeometry.partSelectHeight).toBeGreaterThanOrEqual(48);
        expect(coarseGeometry.explodeHeight).toBeGreaterThanOrEqual(48);
        expect(coarseGeometry.dialHeight).toBeGreaterThanOrEqual(48);
      } finally {
        await touchContext.close();
      }
    }
  });

});
