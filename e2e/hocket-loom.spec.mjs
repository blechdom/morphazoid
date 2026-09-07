import { expect, test } from "@playwright/test";

import {
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";
import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3435";

async function openLoom(page) {
  const diagnostics = watchPageDiagnostics(page, { baseURL: BASE_URL });
  const response = await page.goto("/hocket-loom.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), "Hocket Luigi did not load").toBe(true);
  await settlePage(page);
  await expect(page.locator("#loomCanvas")).toBeVisible();
  return diagnostics;
}

function activeStepIndex(page) {
  return page.locator(".hocket-composite-step").evaluateAll((steps) =>
    steps.findIndex((step) => step.classList.contains("is-current"))
  );
}

async function characterizeHocketMarkers(page) {
  return page.evaluate(async () => {
    const {
      HOCKET_MARKER_NODE_LIMIT,
      createHocketNoiseBuffer,
      hocketMarkerPlan,
      scheduleHocketMarker,
    } = await import(new URL("/src/hocket-loom-audio.js", location.origin).href);
    const sampleRate = 48_000;
    const eventStartSeconds = 0.05;

    function energy(samples, begin, end) {
      let total = 0;
      for (let index = begin; index < end; index += 1) total += samples[index] ** 2;
      return total;
    }

    function spectralProfile(samples, start, length = 4_096) {
      const windowed = new Float64Array(length);
      let mean = 0;
      for (let index = 0; index < length; index += 1) mean += samples[start + index];
      mean /= length;
      for (let index = 0; index < length; index += 1) {
        const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (length - 1));
        windowed[index] = (samples[start + index] - mean) * hann;
      }

      const powers = [];
      let totalPower = 0;
      let weightedPower = 0;
      const firstBin = Math.ceil(80 * length / sampleRate);
      const lastBin = Math.floor(10_000 * length / sampleRate);
      for (let bin = firstBin; bin <= lastBin; bin += 1) {
        const coefficient = 2 * Math.cos(2 * Math.PI * bin / length);
        let previous = 0;
        let previousPrevious = 0;
        for (const sample of windowed) {
          const next = sample + coefficient * previous - previousPrevious;
          previousPrevious = previous;
          previous = next;
        }
        const power = Math.max(
          0,
          previous ** 2
            + previousPrevious ** 2
            - coefficient * previous * previousPrevious
        );
        const frequencyHz = bin * sampleRate / length;
        powers.push(power);
        totalPower += power;
        weightedPower += frequencyHz * power;
      }
      const normalized = powers.map((power) => power / Math.max(1e-30, totalPower));
      const top5Share = [...normalized]
        .sort((left, right) => right - left)
        .slice(0, 5)
        .reduce((sum, value) => sum + value, 0);
      const meanPower = powers.reduce((sum, value) => sum + value, 0) / powers.length;
      const logMean =
        powers.reduce((sum, value) => sum + Math.log(value + 1e-20), 0) / powers.length;
      return {
        centroidHz: weightedPower / Math.max(1e-30, totalPower),
        top5Share,
        flatness: Math.exp(logMean) / Math.max(1e-30, meanPower),
      };
    }

    const rows = [];
    for (const material of ["wood", "metal", "breath"]) {
      for (const seed of [17, 113, 901]) {
        const context = new OfflineAudioContext(2, Math.round(0.8 * sampleRate), sampleRate);
        const master = context.createGain();
        master.gain.value = 0.32;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 10;
        compressor.ratio.value = 5;
        compressor.attack.value = 0.002;
        compressor.release.value = 0.12;
        master.connect(compressor);
        compressor.connect(context.destination);

        const plan = hocketMarkerPlan({
          soundSet: material,
          pulseLengthMs: 92,
          voice: 1,
          tone: 1,
          voiceCount: 4,
          peak: 0.22,
        });
        const scheduled = scheduleHocketMarker(context, master, plan, {
          when: eventStartSeconds,
          noiseBuffer: createHocketNoiseBuffer(context, seed),
        });
        const buffer = await context.startRendering();
        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);
        const mono = new Float64Array(left.length);
        let finite = true;
        let peak = 0;
        for (let index = 0; index < mono.length; index += 1) {
          finite = finite && Number.isFinite(left[index]) && Number.isFinite(right[index]);
          peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
          mono[index] = (left[index] + right[index]) * 0.5;
        }

        const begin = Math.round(eventStartSeconds * sampleRate);
        const totalEnergy = energy(mono, begin, mono.length);
        let cumulative = 0;
        let t95Sample = begin;
        for (let index = begin; index < mono.length; index += 1) {
          cumulative += mono[index] ** 2;
          if (cumulative >= totalEnergy * 0.95) {
            t95Sample = index;
            break;
          }
        }
        rows.push({
          material,
          seed,
          finite,
          peak,
          rms: Math.sqrt(totalEnergy / (mono.length - begin)),
          t95Ms: (t95Sample - begin) * 1_000 / sampleRate,
          earlyShare:
            energy(mono, begin, begin + Math.round(0.035 * sampleRate))
              / Math.max(1e-30, totalEnergy),
          ...spectralProfile(mono, begin),
          sourceCount: plan.sourceCount,
          nodeEstimate: plan.nodeEstimate,
          scheduledSourceCount: scheduled.sources.length,
          scheduledNodeCount: scheduled.nodes.length,
          nodeLimit: HOCKET_MARKER_NODE_LIMIT,
        });
      }
    }
    return rows;
  });
}

test("wood, metal, and breath remain characteristically distinct beyond level", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Offline Web Audio characterization runs in Chromium");
  const diagnostics = await openLoom(page);
  const rows = await characterizeHocketMarkers(page);
  const material = (name) => rows.filter((row) => row.material === name);
  const wood = material("wood");
  const metal = material("metal");
  const breath = material("breath");
  const minimum = (items, key) => Math.min(...items.map((item) => item[key]));
  const maximum = (items, key) => Math.max(...items.map((item) => item[key]));

  expect(rows).toHaveLength(9);
  for (const row of rows) {
    expect(row.finite, JSON.stringify(row)).toBe(true);
    expect(row.rms, JSON.stringify(row)).toBeGreaterThan(0.0005);
    expect(row.peak, JSON.stringify(row)).toBeGreaterThan(0.015);
    expect(row.peak, JSON.stringify(row)).toBeLessThan(0.12);
    expect(row.scheduledSourceCount).toBe(row.sourceCount);
    expect(row.scheduledNodeCount).toBe(row.nodeEstimate);
    expect(row.nodeEstimate).toBeLessThanOrEqual(row.nodeLimit);
  }
  expect(maximum(rows, "peak") / minimum(rows, "peak")).toBeLessThan(2.25);

  for (const row of wood) {
    expect(row.t95Ms).toBeLessThan(30);
    expect(row.earlyShare).toBeGreaterThan(0.9);
    expect(row.centroidHz).toBeLessThan(500);
    expect(row.top5Share).toBeGreaterThan(0.7);
  }
  for (const row of metal) {
    expect(row.t95Ms).toBeGreaterThan(60);
    expect(row.earlyShare).toBeGreaterThan(0.5);
    expect(row.earlyShare).toBeLessThan(0.8);
    expect(row.centroidHz).toBeLessThan(700);
    expect(row.top5Share).toBeGreaterThan(0.85);
    expect(row.flatness).toBeLessThan(0.001);
  }
  for (const row of breath) {
    expect(row.t95Ms).toBeGreaterThan(60);
    expect(row.earlyShare).toBeLessThan(0.45);
    expect(row.centroidHz).toBeGreaterThan(1_800);
    expect(row.top5Share).toBeLessThan(0.15);
    expect(row.flatness).toBeGreaterThan(0.12);
  }
  expect(minimum(metal, "t95Ms")).toBeGreaterThan(maximum(wood, "t95Ms") * 2);
  expect(minimum(breath, "t95Ms")).toBeGreaterThan(maximum(wood, "t95Ms") * 2);
  expect(minimum(metal, "top5Share")).toBeGreaterThan(maximum(wood, "top5Share") + 0.04);
  expect(minimum(breath, "centroidHz")).toBeGreaterThan(maximum(metal, "centroidHz") * 3);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("preserve and free-weave edits expose ownership, collisions, and gaps", async ({ page }) => {
  const diagnostics = await openLoom(page);
  const audioButton = page.locator("#audioButton");
  const playButton = page.locator("#playButton");

  await expect(page.locator(".hocket-step")).toHaveCount(32);
  await expect(page.locator("#coverageOut")).toHaveText("100%");
  await expect(page.locator("#gapOut")).toHaveText("0");
  await expect(page.locator("#collisionOut")).toHaveText("0");
  await expect(audioButton).toHaveAttribute("aria-pressed", "false");

  await playButton.click();
  await expect(playButton).toHaveAttribute("aria-pressed", "true");
  await expect(audioButton).toHaveAttribute("aria-pressed", "false");
  const firstStep = await activeStepIndex(page);
  await expect.poll(() => activeStepIndex(page)).not.toBe(firstStep);

  await page.locator('.hocket-step[data-voice="1"][data-step="0"]').click();
  await expect(page.locator("#collisionOut")).toHaveText("0");
  await expect(page.locator("#gapOut")).toHaveText("0");
  await expect(page.locator("#presetStatus")).toContainText("your variation");
  await expect(playButton).toHaveAttribute("aria-pressed", "true");

  await page.locator("#preserveComposite").uncheck();
  await page.locator('.hocket-step[data-voice="0"][data-step="0"]').click();
  await expect(page.locator("#collisionOut")).toHaveText("1");
  await expect(page.locator("#gapOut")).toHaveText("0");

  await page.locator("#restTool").click();
  await page.locator('.hocket-step[data-voice="0"][data-step="2"]').click();
  await expect(page.locator("#gapOut")).toHaveText("1");

  await playButton.click();
  await expect(playButton).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("edit auditions follow resulting ownership while a free rest stays silent", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Web Audio edit audition runs in Chromium");
  const diagnostics = await openLoom(page);
  const audioButton = page.locator("#audioButton");

  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "true");
  await page.locator("#pulseLength").fill("260");
  await page.locator("#restTool").click();
  await page.locator('.hocket-step[data-voice="0"][data-step="0"]').click();
  await expect(page.locator('.hocket-step[data-voice="1"][data-step="0"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect.poll(async () => {
    return (await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState())).groupVoices;
  }).toContain(1);
  await expect.poll(async () => {
    return (await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState())).activeGroups;
  }).toBe(0);

  await page.locator("#presetSelect").selectOption("olutalo");
  await page.locator("#presetSelect").selectOption("nyog-cag");
  await page.locator("#preserveComposite").uncheck();
  await page.locator("#restTool").click();
  await page.locator('.hocket-step[data-voice="0"][data-step="0"]').click();
  await page.waitForTimeout(80);
  const freeRest = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
  expect(freeRest.activeGroups, JSON.stringify(freeRest)).toBe(0);
  await expect(page.locator("#gapOut")).toHaveText("1");

  await audioButton.click();
  await waitForStableAudioState(page, false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Space respects control ownership and dynamic editors retain keyboard focus", async ({ page }) => {
  const diagnostics = await openLoom(page);
  const playButton = page.locator("#playButton");
  const grid = page.locator("#voiceGrid");

  await expect(grid.locator(":scope > [role='group']")).toHaveCount(2);
  await expect(grid.locator(":scope > [role='group']").first().locator(":scope > button")).toHaveCount(16);

  await page.locator("#clearButton").focus();
  await page.keyboard.press("Space");
  await expect(playButton).toHaveAttribute("aria-pressed", "false");

  await playButton.focus();
  await page.keyboard.press("Space");
  await expect(playButton).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Space");
  await expect(playButton).toHaveAttribute("aria-pressed", "false");

  const canvas = page.locator("#loomCanvas");
  await canvas.focus();
  await page.keyboard.press("Space");
  await expect(playButton).toHaveAttribute("aria-pressed", "false");

  await page.locator("#restTool").click();
  const step = page.locator(".hocket-step").first();
  await step.focus();
  await page.keyboard.press("Space");
  await expect(playButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("hocket-step"))).toBe(true);

  const pad = page.locator(".hocket-voice-pad").first();
  await pad.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#liveStatus")).toContainText("Audio is off");

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.press("Space");
  await expect(playButton).toHaveAttribute("aria-pressed", "true");
  await playButton.click();
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("preset, phase, voice-count, cycle, and tightening controls reshape one live score", async ({ page }) => {
  const diagnostics = await openLoom(page);
  await page.locator("#presetSelect").selectOption("open-weave");
  await expect(page.locator("#gapOut")).toHaveText("1");
  await expect(page.locator("#collisionOut")).toHaveText("1");
  await expect(page.locator(".hocket-step")).toHaveCount(36);

  await page.locator("#tightenButton").click();
  await expect(page.locator("#gapOut")).toHaveText("0");
  await expect(page.locator("#collisionOut")).toHaveText("0");

  const phase = page.locator('[data-phase-voice="1"]');
  await phase.fill("3");
  await expect(phase).toHaveValue("3");
  await expect(page.locator("#presetStatus")).toContainText("your variation");

  await page.locator("#voiceCount").selectOption("4");
  await page.locator("#cycleLength").selectOption("8");
  await expect(page.locator(".hocket-step")).toHaveCount(32);
  await expect(page.locator("#structureSummary")).toHaveText("4 voices · 8 pulses");
  await expect(page.locator(".hocket-voice-pad")).toHaveCount(4);

  const shiftVoice = page.locator("#shiftVoice");
  await shiftVoice.selectOption("2");
  const phaseVoice = page.locator('[data-phase-voice="2"]');
  const phaseZero = page.locator('[data-phase-voice="0"]');
  const phaseBefore = Number(await phaseVoice.inputValue());
  const phaseZeroBefore = await phaseZero.inputValue();
  await page.locator("#shiftForward").click();
  await expect(shiftVoice).toHaveValue("2");
  await expect(phaseVoice).toHaveValue(String((phaseBefore + 1) % 8));
  await page.locator("#shiftForward").click();
  await expect(shiftVoice).toHaveValue("2");
  const phaseAfterShift = (phaseBefore + 2) % 8;
  await expect(phaseVoice).toHaveValue(String(phaseAfterShift));
  await expect(phaseZero).toHaveValue(phaseZeroBefore);

  await phaseVoice.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(phaseVoice).toHaveValue(String(Math.min(7, phaseAfterShift + 2)));
  await expect.poll(() => page.evaluate(() => document.activeElement?.dataset.phaseVoice)).toBe("2");

  const canvas = page.locator("#loomCanvas");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#liveStatus")).toContainText("pulse 2");

  await page.locator("#resetButton").click();
  await expect(page.locator("#voiceCount")).toHaveValue("3");
  await expect(page.locator("#cycleLength")).toHaveValue("12");
  await expect(page.locator("#gapOut")).toHaveText("1");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("explicit Audio joins and leaves a running visual rhythm without owning transport", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Web Audio probe runs in Chromium");
  const diagnostics = await openLoom(page);
  const audioButton = page.locator("#audioButton");
  const playButton = page.locator("#playButton");

  await playButton.click();
  await expect(playButton).toHaveAttribute("aria-pressed", "true");
  expect((await readAudioStatus(page)).active).toBe(false);

  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  await page.locator("#pulseLength").fill("260");
  const soundSet = page.locator("#soundSet");
  const markerPanel = page.locator("details").filter({ has: soundSet });
  await markerPanel.locator("summary").click();
  await expect(soundSet).toBeVisible();
  for (const marker of [
    { value: "wood", label: "Dry wood clack", sourceCount: 3 },
    { value: "metal", label: "Inharmonic metal ring", sourceCount: 4 },
    { value: "breath", label: "Air breath", sourceCount: 1 },
  ]) {
    await soundSet.selectOption(marker.value);
    await expect(page.locator("#soundSummary")).toContainText(marker.label);
    await page.locator(".hocket-voice-pad").first().click();
    await expect.poll(async () => {
      const debug = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
      return debug.strikeHistory.at(-1)?.material;
    }).toBe(marker.value);
    const markerDebug = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
    const latest = markerDebug.strikeHistory.at(-1);
    expect(latest.sourceKinds.every((kind) => kind.startsWith(marker.value))).toBe(true);
    expect(latest.sourceCount).toBe(marker.sourceCount);
    expect(markerDebug.activeSourceCount).toBeLessThanOrEqual(320);
    await expect(playButton).toHaveAttribute("aria-pressed", "true");
  }
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  const audioDebug = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
  expect(audioDebug.audioContextState, JSON.stringify(audioDebug)).toBe("running");
  expect(audioDebug.activeGroups, JSON.stringify(audioDebug)).toBeGreaterThan(0);
  await page.waitForTimeout(60);
  const signalDebug = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
  expect(
    Math.max(0, ...signalDebug.groupEnvelopeGains.filter(Number.isFinite)),
    JSON.stringify(signalDebug)
  ).toBeGreaterThan(0.001);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 850, intervalMs: 50 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.activeSamples, JSON.stringify(envelope)).toBeGreaterThan(0);
  expect(envelope.summary.maxPeak).toBeGreaterThan(0.001);
  expect(envelope.summary.clippedSamples).toBe(0);

  await page.locator("#presetSelect").selectOption("olutalo");
  await expect(playButton).toHaveAttribute("aria-pressed", "true");
  await expect(audioButton).toHaveAttribute("aria-pressed", "true");

  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "false");
  await expect(playButton).toHaveAttribute("aria-pressed", "true");
  await waitForStableAudioState(page, false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("an armed start schedules pulse zero, releases cleanly, and survives BFCache", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Web Audio probe runs in Chromium");
  const diagnostics = await openLoom(page);
  const audioButton = page.locator("#audioButton");
  const playButton = page.locator("#playButton");

  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "true");
  await playButton.click();
  await expect.poll(async () => {
    const debug = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
    return debug.scheduledSteps[0];
  }).toBe(0);

  await page.evaluate(() => globalThis.__HOCKET_LOOM__.suspendAudio());
  await expect.poll(async () => {
    return (await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState())).audioContextState;
  }).toBe("suspended");
  await page.waitForTimeout(80);
  const suspendedA = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
  await page.waitForTimeout(120);
  const suspendedB = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
  expect(suspendedA.activeGroups, JSON.stringify(suspendedA)).toBe(0);
  expect(suspendedB.activeGroups, JSON.stringify(suspendedB)).toBe(0);
  expect(suspendedB.scheduledSteps).toEqual(suspendedA.scheduledSteps);

  await page.evaluate(() => globalThis.__HOCKET_LOOM__.resumeAudio());
  await expect.poll(async () => {
    return (await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState())).audioContextState;
  }).toBe("running");
  await expect.poll(async () => {
    return (await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState())).scheduledSteps.length;
  }).toBeGreaterThan(suspendedB.scheduledSteps.length);

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(playButton).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState())).audioArmed).toBe(true);

  await playButton.click();
  await expect.poll(async () => (await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState())).activeGroups).toBe(0);
  await audioButton.click();
  await waitForStableAudioState(page, false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a failed Audio start closes partial state and the next press retries", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Web Audio recovery runs in Chromium");
  const diagnostics = await openLoom(page);
  await page.evaluate(() => {
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
    const NativeWebkitAudioContext = window.webkitAudioContext;
    window.__restoreHocketAudioContext = () => {
      window.AudioContext = NativeAudioContext;
      window.webkitAudioContext = NativeWebkitAudioContext;
    };
    window.AudioContext = class FailingAudioContext extends NativeAudioContext {
      get state() {
        return "suspended";
      }

      resume() {
        return Promise.reject(new Error("Synthetic resume failure."));
      }
    };
  });

  const audioButton = page.locator("#audioButton");
  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioState")).toHaveText("error");
  await expect(page.locator("#audioError")).toContainText("Synthetic resume failure");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  const failed = await page.evaluate(() => globalThis.__HOCKET_LOOM__.getDebugState());
  expect(failed.audioArmed).toBe(false);
  expect(failed.audioContextState).toBe("closed");

  await page.evaluate(() => window.__restoreHocketAudioContext());
  await audioButton.click();
  await expect(audioButton).toHaveAttribute("aria-pressed", "true");
  await audioButton.click();
  await waitForStableAudioState(page, false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

for (const viewport of [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
]) {
  test(`${viewport.name} keeps the instrument reachable without document-width overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const diagnostics = await openLoom(page);
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      audio: document.querySelector("#audioButton")?.getBoundingClientRect(),
      transport: document.querySelector("#playButton")?.getBoundingClientRect(),
      canvas: document.querySelector("#loomCanvas")?.getBoundingClientRect(),
    }));
    const scoreReach = await page.locator(".hocket-grid-scroll").evaluate((scroller) => {
      const composite = scroller.querySelector(".hocket-composite");
      const finalCell = composite?.querySelector(".hocket-composite-step:last-child");
      scroller.scrollLeft = scroller.scrollWidth;
      const scrollerRect = scroller.getBoundingClientRect();
      const finalRect = finalCell?.getBoundingClientRect();
      return {
        compositeInsideScroller: Boolean(composite),
        finalCellReachable: Boolean(finalRect && finalRect.right <= scrollerRect.right + 1),
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.audio.width).toBeGreaterThanOrEqual(48);
    expect(layout.audio.height).toBeGreaterThanOrEqual(48);
    expect(layout.transport.width).toBeGreaterThanOrEqual(48);
    expect(layout.transport.height).toBeGreaterThanOrEqual(48);
    expect(layout.canvas.width).toBeGreaterThan(300);
    expect(scoreReach.compositeInsideScroller).toBe(true);
    expect(scoreReach.finalCellReachable).toBe(true);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
