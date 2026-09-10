import { expect, test } from "@playwright/test";

test.describe("SIMD 303", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "WebAssembly SIMD audio targets Chromium first");

  test("loads the 303 surface and streams through the automatic Wasm backend", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      globalThis.__simd303ScopeReads = 0;
      globalThis.__simd303ScopePeak = 0;
      const analyserPrototype = globalThis.AnalyserNode?.prototype;
      const getTimeDomainData = analyserPrototype?.getFloatTimeDomainData;
      if (!getTimeDomainData) return;
      analyserPrototype.getFloatTimeDomainData = function instrumentScope(target) {
        getTimeDomainData.call(this, target);
        if (this.fftSize !== 2048) return;
        globalThis.__simd303ScopeReads += 1;
        for (const sample of target) {
          globalThis.__simd303ScopePeak = Math.max(globalThis.__simd303ScopePeak, Math.abs(sample));
        }
      };
    });
    await page.goto("simd-303.html", { waitUntil: "networkidle" });

    expect(pageErrors).toEqual([]);

    await expect(page.locator("#audioState")).toHaveText("off");
    await expect(page.locator("#gpuState")).toHaveText("Wasm audio ready");
    await expect(page.locator(".webgpu-stage-knobs .webgpu-knob")).toHaveCount(22);
    await expect(page.locator("#transportKnobControls .webgpu-knob")).toHaveCount(3);
    await expect(page.locator("#knobControls .simd-knob-group")).toHaveCount(3);
    await expect(page.locator("#presetButtons button")).toHaveCount(37);
    await expect(page.locator("#stagePresetSelect option")).toHaveCount(await page.locator("#presetButtons button").count());
    await expect(page.locator("#stagePresetSelect optgroup")).toHaveCount(6);
    await expect(page.locator("#partials")).toHaveAttribute("max", "512");
    await expect(page.locator("[data-step-edit-mode]")).toHaveCount(10);
    await expect(page.locator(".simd-stage-toolbar [data-main-action]")).toHaveCount(7);
    await expect(page.locator("#stageSynthPlayButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#simdXlControls input[type=range]")).toHaveCount(7);
    await expect(page.locator("#morphTimeOut")).toHaveText("1.96 sec");
    await expect(page.locator("#startMorph")).toBeDisabled();

    await page.locator('.simd-stage-toolbar [data-step-edit-mode="accent"]').click();
    await expect(page.locator('.simd-stage-toolbar [data-step-edit-mode="accent"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('.simd-expression-section [data-step-edit-mode="accent"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#stepExpressionState")).toHaveText("accent lane");
    await page.locator('[data-main-action="acidize-expression"]').click();
    await page.locator('[data-main-action="randomize-expression"]').click();
    await expect(page.locator("#liveStatus")).toHaveText("Step accent, gate, slide, and chance randomized.");
    await page.locator('[data-main-action="source-noise"]').click();
    await expect(page.locator("#liveStatus")).toHaveText("Source noise sequence restored.");
    await page.locator("#spectrumMorph").fill("1.5");
    await expect(page.locator("#spectrumMorphOut")).toContainText("Square → Pulse");
    await page.locator("#stagePresetSelect").selectOption("filter-snap");
    await expect(page.locator("#liveStatus")).toHaveText("Lysergic Ribbon recalled. Expression and effects reset.");
    await expect(page.locator("#spectrumMorph")).toHaveValue("0");
    await expect(page.locator("#stepExpressionState")).toHaveText("pitch lane");
    await expect(page.locator('.simd-stage-toolbar [data-step-edit-mode="pitch"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("#stagePresetSelect").selectOption("cathedral-tail");
    await expect(page.locator("#liveStatus")).toHaveText("Cathedral Tail recalled with its effects and step expression.");
    await expect(page.locator("#spectrumMorph")).toHaveValue("2.86");
    await expect(page.locator("#delayMix")).toHaveValue("0.68");
    await page.locator("#stagePresetSelect").selectOption("filter-snap");
    await expect(page.locator("#liveStatus")).toHaveText("Lysergic Ribbon recalled. Expression and effects reset.");
    await expect(page.locator("#delayMix")).toHaveValue("0.2");
    await page.locator("#spectrumMorph").fill("1.5");
    const spectrumKnob = page.locator('#knobControls [data-param-key="spectrumMorph"]');
    await expect(spectrumKnob).toHaveAttribute("aria-valuenow", "1.5000");
    await spectrumKnob.focus();
    await page.keyboard.press("End");
    await expect(page.locator("#spectrumMorph")).toHaveValue("3");
    await expect(page.locator("#spectrumMorphOut")).toHaveText("Triangle");
    await page.locator("#captureMorphA").click();
    await expect(page.locator("#captureMorphA")).toContainText("✓");
    await page.locator("#stagePresetSelect").selectOption("cathedral-tail");
    await page.locator("#captureMorphB").click();
    await expect(page.locator("#captureMorphB")).toContainText("✓");
    await page.locator("#stagePresetSelect").selectOption("filter-snap");
    await page.locator("#morphTarget").selectOption("b");
    await page.locator("#morphScope").selectOption("effects");
    await page.locator("#morphTime").fill("0.25");
    await expect(page.locator("#morphTimeOut")).toHaveText("589 ms");

    await page.locator("#audioButton").click();
    await expect(page.locator("#audioState")).toHaveText("on", { timeout: 10_000 });
    await expect(page.locator("#backendMetric")).toHaveText("SIMD Wasm");
    await expect(page.locator("#laneMetric")).toHaveText("4");
    await expect(page.locator("#streamState")).toHaveText("128-frame AudioWorklet");
    await expect(page.locator("#kernelMetric")).not.toHaveText("—", { timeout: 10_000 });
    await expect(page.locator("#loadMetric")).toHaveText(/^[0-9]+%$/);

    await page.locator("#stageSynthPlayButton").click();
    await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#stageSynthPlayButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#stageSynthPlayButton .transport-pause")).toBeVisible();
    await expect(page.locator("#stageReadout")).toContainText("SYNTH PLAYING");
    await expect.poll(() => page.evaluate(() => globalThis.__simd303ScopeReads)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => globalThis.__simd303ScopePeak)).toBeGreaterThan(0.0001);

    await page.locator("#startMorph").click();
    await expect(page.locator("#startMorph")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#liveStatus")).toHaveText("Morph to B complete.");
    await expect(page.locator("#delayMix")).toHaveValue("0.68");
    await expect(page.locator("#spectrumMorph")).toHaveValue("0");
    await expect(page.locator("#timeScaleOut")).toHaveText("7.40x");
    await expect(page.locator("#gain")).toHaveValue("0.1");
    await page.locator("#morphTarget").selectOption("a");
    await page.locator("#morphScope").selectOption("all");
    await page.locator("#startMorph").click();
    await expect(page.locator("#liveStatus")).toHaveText("Morph to A complete.");
    await expect(page.locator("#spectrumMorph")).toHaveValue("3");
    await expect(page.locator("#delayMix")).toHaveValue("0.2");
    await expect(page.locator("#timeScaleOut")).toHaveText("7.40x");
    await expect(page.locator("#gain")).toHaveValue("0.1");
    await page.locator("#morphTarget").selectOption("b");
    await page.locator("#morphTime").fill("1");
    await page.locator("#startMorph").click();
    await expect(page.locator("#startMorph")).toHaveAttribute("aria-pressed", "true");
    await page.locator('#presetButtons [data-preset-id="filter-snap"]').click();
    await expect(page.locator("#startMorph")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#liveStatus")).toHaveText("Lysergic Ribbon recalled. Expression and effects reset.");
    await expect(page.locator("#spectrumMorph")).toHaveValue("0");

    await page.locator('[data-main-action="randomize-expression"]').click();
    await page.locator("#recallStagePreset").click();
    await expect(page.locator("#liveStatus")).toHaveText("Lysergic Ribbon recalled. Expression and effects reset.");
    await expect(page.locator("#spectrumMorph")).toHaveValue("0");
    await expect(page.locator("#stepExpressionState")).toHaveText("pitch lane");
    await expect(page.locator("#stageSynthPlayButton")).toHaveAttribute("aria-pressed", "true");

    await page.locator("#audioButton").click();
    await expect(page.locator("#audioState")).toHaveText("off");
    await expect(page.locator("#synthPlayButton")).toHaveAttribute("aria-pressed", "false");
  });

  test("honors the explicit scalar fallback", async ({ page }) => {
    await page.goto("simd-303.html?scalar=1", { waitUntil: "networkidle" });
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioState")).toHaveText("on", { timeout: 10_000 });
    await expect(page.locator("#backendMetric")).toHaveText("scalar Wasm");
    await expect(page.locator("#laneMetric")).toHaveText("1");
    await expect(page.locator("#kernelMetric")).not.toHaveText("—", { timeout: 10_000 });
  });

  test("saves, updates, reloads, recalls, and deletes browser-local presets", async ({ page }) => {
    await page.goto("simd-303.html", { waitUntil: "networkidle" });
    await page.locator("#stagePresetSelect").selectOption("cathedral-tail");
    await page.locator("#spectrumMorph").fill("1.37");
    await page.locator("#delayMix").fill("0.61");
    await page.locator('[data-main-action="acidize-expression"]').click();
    await page.locator("#userPresetName").fill("Browser Slime");
    await page.locator("#saveUserPreset").click();

    await expect(page.locator("#liveStatus")).toHaveText("Browser Slime saved in this browser.");
    await expect(page.locator("#userPresetState")).toHaveText("1 saved locally");
    await expect(page.locator('#stagePresetSelect optgroup[label="My presets"] option')).toHaveText("Browser Slime");
    await expect(page.locator("#presetButtons button")).toHaveCount(38);
    await expect(page.locator("#stagePresetSelect option")).toHaveCount(38);
    await expect(page.locator("#stagePresetSelect optgroup")).toHaveCount(7);
    await expect(page.locator("#deleteUserPreset")).toBeEnabled();
    const presetId = await page.locator("#stagePresetSelect").inputValue();
    expect(presetId).toMatch(/^user:/);
    const storedPatch = await page.evaluate(() => {
      const payload = JSON.parse(localStorage.getItem("morphazoid.simd-303.user-presets.v1"));
      return {
        version: payload.version,
        spectrumMorph: payload.presets[0].xlParams.spectrumMorph,
        delayMix: payload.presets[0].xlParams.delayMix,
        accent: payload.presets[0].stepExpression[0][0],
      };
    });
    expect(storedPatch.version).toBe(1);
    expect(storedPatch.spectrumMorph).toBe(1.37);
    expect(storedPatch.delayMix).toBe(0.61);
    expect(storedPatch.accent).toBeGreaterThanOrEqual(0.62);
    expect(storedPatch.accent).toBeLessThanOrEqual(1);

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#userPresetState")).toHaveText("1 saved locally");
    await page.locator("#stagePresetSelect").selectOption(presetId);
    await expect(page.locator("#liveStatus")).toHaveText("Browser Slime recalled from this browser.");
    await expect(page.locator("#spectrumMorph")).toHaveValue("1.37");
    await expect(page.locator("#delayMix")).toHaveValue("0.61");
    await expect(page.locator("#userPresetName")).toHaveValue("Browser Slime");

    await page.locator("#spectrumMorph").fill("2.2");
    await page.locator("#saveUserPreset").click();
    await expect(page.locator("#liveStatus")).toHaveText("Browser Slime updated in this browser.");
    await expect(page.locator("#presetButtons button")).toHaveCount(38);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#stagePresetSelect").selectOption(presetId);
    await expect(page.locator("#spectrumMorph")).toHaveValue("2.2");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#deleteUserPreset").click();
    await expect(page.locator("#liveStatus")).toHaveText(
      "Browser Slime deleted. The current sound remains loaded as a custom patch.",
    );
    await expect(page.locator("#userPresetState")).toHaveText("0 saved locally");
    await expect(page.locator("#presetButtons button")).toHaveCount(37);
    await expect(page.locator('#stagePresetSelect optgroup[label="My presets"]')).toHaveCount(0);
  });

  test("keeps the shared control surface reachable on desktop and mobile", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("simd-303.html", { waitUntil: "networkidle" });
      await page.locator("#resetPatch").scrollIntoViewIfNeeded();
      await expect(page.locator("#resetPatch")).toBeVisible();
      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        canvasWidth: document.querySelector("#stage").getBoundingClientRect().width,
        canvasHeight: document.querySelector("#stage").getBoundingClientRect().height,
        panelWidth: document.querySelector(".webgpu-303-panel").getBoundingClientRect().width,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
      expect(layout.canvasWidth).toBeGreaterThan(220);
      expect(layout.canvasHeight).toBeGreaterThan(80);
      expect(layout.panelWidth).toBeGreaterThan(220);
    }
  });
});
