import { expect, test } from "@playwright/test";
import { createShapesState, SHAPES_STORAGE_KEY } from "../src/instruments/shapes/shapes-state.js";
import { percussionEnvelopeEditorX } from "../src/audio.js";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

for (const dimension of ["3d", "4d"]) for (const rotating of [false, true]) for (const engine of ["pm", "shepard", "percussion", "triangle", "square"]) {
  test(`Shapes ${dimension} ${engine}: 16 subdivisions stay audible under CPU slowdown (${rotating ? "rotating" : "reader only"})`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const state = createShapesState({
      selection: { dimension, playingMode: "notes" },
      play: { running: true, continuousPhase: .1, rateCyclesPerSecond: .3, divisions: 4 },
      voice: { engine },
      synthesis: { percussionAttack: 12, percussionDecay: 900 },
      notes: {
        hitCap: 2, swell: false,
        envelopePoints: [0, 12, 70, 300, 900].map((ms, index) => ({
          x: percussionEnvelopeEditorX(ms), y: [0, 1, .55, .55, 0][index],
        })),
      },
      dimension: {
        [dimension]: {
          representation: dimension === "3d" ? "sphere" : "hypersphere",
          rotationMotion: {
            [dimension === "3d" ? "y" : "xw"]: { running: rotating, speed: .06 },
          },
        },
      },
    });
    await page.addInitScript(({ state, key }) => localStorage.setItem(key, JSON.stringify(state)), {
      state, key: SHAPES_STORAGE_KEY,
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goto("shapes.html");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
    await page.waitForTimeout(800);
    await page.locator("#divisions").fill("16");
    await expect(page.locator("#divisions")).toHaveValue("16");
    const signal = await sampleAudioEnvelope(page, { durationMs: 3000, intervalMs: 50 });
    expect(signal.summary.maxRms).toBeGreaterThan(.001);
    expect(signal.summary.clippedSamples).toBe(0);
    expect(signal.summary.finite).toBe(true);
    let quietSince = null, longestQuietMs = 0;
    for (const sample of signal.samples) {
      if (sample.rms < .00005) {
        quietSince ??= sample.elapsedMs;
        longestQuietMs = Math.max(longestQuietMs, sample.elapsedMs - quietSince);
      } else quietSince = null;
    }
    // These deliberately sustained test notes bridge the scan's edge gaps.
    // This is a dropout check, not a universal rule against musical rests.
    expect(longestQuietMs).toBeLessThan(250);
    await testInfo.attach("high-divisions.json", {
      body: JSON.stringify({ dimension, engine, rotating, longestQuietMs, signal }),
      contentType: "application/json",
    });
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#audioButton").click();
    await page.waitForTimeout(400);
    expect((await readAudioStatus(page)).rms).toBeLessThan(.0001);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
}
