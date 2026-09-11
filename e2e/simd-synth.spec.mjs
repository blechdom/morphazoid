import { expect, test } from "@playwright/test";

async function installScopeProbe(page) {
  await page.addInitScript(() => {
    globalThis.__simdSynthScopeProbe = {
      reads: 0,
      peak: 0,
      maxRms: 0,
      finite: true,
    };
    const analyserPrototype = globalThis.AnalyserNode?.prototype;
    const getTimeDomainData = analyserPrototype?.getFloatTimeDomainData;
    if (!getTimeDomainData) return;
    analyserPrototype.getFloatTimeDomainData = function probeSimdSynthScope(target) {
      getTimeDomainData.call(this, target);
      if (this.fftSize !== 2048) return;
      const probe = globalThis.__simdSynthScopeProbe;
      probe.reads += 1;
      let sumOfSquares = 0;
      for (const sample of target) {
        probe.finite &&= Number.isFinite(sample);
        probe.peak = Math.max(probe.peak, Math.abs(sample));
        sumOfSquares += sample * sample;
      }
      probe.maxRms = Math.max(probe.maxRms, Math.sqrt(sumOfSquares / target.length));
    };
  });
}

async function expectAudibleScope(page) {
  await expect.poll(
    () => page.evaluate(() => globalThis.__simdSynthScopeProbe?.reads ?? 0),
    { timeout: 10_000 },
  ).toBeGreaterThan(0);
  await expect.poll(
    () => page.evaluate(() => globalThis.__simdSynthScopeProbe?.peak ?? 0),
    { timeout: 10_000 },
  ).toBeGreaterThan(0.0001);
  await expect.poll(
    () => page.evaluate(() => globalThis.__simdSynthScopeProbe?.maxRms ?? 0),
    { timeout: 10_000 },
  ).toBeGreaterThan(0.00001);
  expect(await page.evaluate(() => globalThis.__simdSynthScopeProbe?.finite)).toBe(true);
  await expect(page.locator("#scopeState")).toHaveText("live");
}

test.describe("SIMD SYNTH", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "WebAssembly SIMD audio targets Chromium first");

  test("keeps Audio explicit while exposing and editing the complete rack", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("simd-synth.html", { waitUntil: "networkidle" });

    expect(pageErrors).toEqual([]);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#audioState")).toHaveText("off");
    await expect(page.locator("#scopeState")).toHaveText("audio off");

    await expect(page.locator(".instrument-page-info")).toHaveCount(0);
    await expect(page.locator("#voiceLamps .simd-voice-lamp")).toHaveCount(8);
    await expect(page.locator("#sequencer .simd-step")).toHaveCount(16);
    await expect(page.locator("#sequencer .simd-step-control")).toHaveCount(16);
    await expect(page.locator("#sequencer .simd-step-bar")).toHaveCount(16);
    await expect(page.locator("#sequencer .simd-step-foot")).toHaveCount(0);
    await expect(page.locator("[data-sequence-lane]")).toHaveCount(4);
    await expect(page.locator("#modMatrix .simd-mod-row")).toHaveCount(4);
    await expect(page.locator("#modMatrix .simd-mod-row select")).toHaveCount(8);
    await expect(page.locator("#sourceA option")).toHaveCount(8);
    await expect(page.locator("#combine option")).toHaveCount(6);
    await expect(page.locator("#filterRoute option")).toHaveCount(6);
    await expect(page.locator("#fx1 option")).toHaveCount(6);
    await expect(page.locator(".simd-panel-transport #playButton")).toBeVisible();
    await expect(page.locator(".simd-panel-transport #presetSelect")).toBeVisible();
    await expect(page.locator(".simd-panel-transport #bpm")).toBeVisible();
    expect(await page.evaluate(() => {
      const transport = document.querySelector(".simd-panel-transport");
      const firstSection = document.querySelector(".simd-synth-panel > details.control-section");
      return Boolean(transport.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);

    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playState")).toHaveText("running · Audio off");
    await expect(page.locator("#liveStatus")).toHaveText("Sequence running silently. Turn Audio on when ready.");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#sequencer .simd-step.is-current")).toHaveCount(1);

    await page.locator("#sourceA").selectOption("3");
    await page.locator("#sourceB").selectOption("7");
    await page.locator('details[data-section="combine"] > summary').click();
    await page.locator("#combine").selectOption("2");
    await page.locator('details[data-section="filters"] > summary').click();
    await page.locator("#filterRoute").selectOption("2");
    await page.locator('details[data-section="effects"] > summary').click();
    await page.locator("#fx1").selectOption("4");
    await page.locator("#fx2").selectOption("5");
    await page.locator('details[data-section="tone"] > summary').click();
    await page.locator("#toneOrderButton").click();
    await page.locator('details[data-section="effects"] > summary').click();
    await page.locator("#fxOrderButton").click();

    await expect(page.locator(".simd-synth-panel details[open]")).toHaveCount(1);

    await expect(page.locator("#presetSelect")).toHaveValue("custom");
    await expect(page.locator("#sourceSummary")).toHaveText("Modal metal + Vector bytebeat");
    await expect(page.locator("#combineSummary")).toHaveText("Ring");
    await expect(page.locator("#toneSummary")).toHaveText("filters → shape");
    await expect(page.locator("#filterSummary")).toHaveText("Parallel");
    await expect(page.locator("#effectsSummary")).toHaveText("2 → 1");
    await expect(page.locator(".simd-panel-transport #playButton")).toBeVisible();
    await expect(page.locator(".simd-panel-transport #presetSelect")).toBeVisible();
    await expect(page.locator(".simd-panel-transport #bpm")).toBeVisible();

    await page.locator('details[data-section="modulation"] > summary').click();
    const firstRoute = page.locator("#modMatrix .simd-mod-row").first();
    await firstRoute.locator("select").nth(0).selectOption("9");
    await firstRoute.locator("select").nth(1).selectOption("14");
    await firstRoute.locator("input[type='range']").fill("0.57");
    await expect(firstRoute.locator("select").nth(0)).toHaveValue("9");
    await expect(firstRoute.locator("select").nth(1)).toHaveValue("14");
    await expect(firstRoute.locator("output")).toHaveText("+57");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioState")).toHaveText("off");

    await page.locator("#presetSelect").selectOption("feedback-reef");
    await expect(page.locator("#sourceA")).toHaveValue("6");
    await expect(page.locator("#sourceB")).toHaveValue("3");
    await expect(page.locator("#filterRoute")).toHaveValue("5");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");

    await page.locator("#randomPatch").click();
    await expect(page.locator("#presetSelect")).toHaveValue("custom");
    await expect(page.locator("#liveStatus")).toHaveText("A bounded random rack was built. Init is always one tap away.");
    await page.locator("#initPatch").click();
    await expect(page.locator("#liveStatus")).toHaveText("Clean Init restored.");
    await expect(page.locator("#presetSelect")).toHaveValue("mono-init");
    await expect(page.locator("#sourceA")).toHaveValue("0");
    await expect(page.locator("#sourceB")).toHaveValue("0");
    await expect(page.locator("#combine")).toHaveValue("0");
    await expect(page.locator("#shaper")).toHaveValue("0");
    await expect(page.locator("#filter1")).toHaveValue("1");
    await expect(page.locator("#filter2")).toHaveValue("0");
    await expect(page.locator("#fx1")).toHaveValue("0");
    await expect(page.locator("#fx2")).toHaveValue("0");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioState")).toHaveText("off");

    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  });

  test("edits pitch, gate, accent, and slide through one compact bar lane", async ({ page }) => {
    await page.goto("simd-synth.html", { waitUntil: "networkidle" });

    await expect(page.locator("#sequenceLaneState")).toHaveText("pitch lane");
    await expect(page.locator('[data-sequence-lane="pitch"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Step 1 scale degree")).toBeVisible();

    await page.locator('[data-sequence-lane="gate"]').click();
    await expect(page.locator("#sequenceLaneState")).toHaveText("gate lane");
    const gate = page.getByLabel("Step 1 gate");
    await gate.fill("0");
    await expect(gate).toHaveAttribute("aria-valuetext", "off");
    await expect(page.locator("#sequencer .simd-step").first()).toHaveCSS("--step-level", "5%");

    await page.locator('[data-sequence-lane="accent"]').click();
    const accent = page.getByLabel("Step 1 accent");
    await accent.fill("0.93");
    await expect(accent).toHaveAttribute("aria-valuetext", "93%");

    await page.locator('[data-sequence-lane="slide"]').click();
    const slide = page.getByLabel("Step 1 slide");
    await slide.fill("0.66");
    await expect(slide).toHaveAttribute("aria-valuetext", "66%");

    await page.locator('[data-sequence-lane="gate"]').click();
    await expect(page.getByLabel("Step 1 gate")).toHaveValue("0");
  });

  test("paints the whole expression lane in one undoable gesture", async ({ page }) => {
    await page.goto("simd-synth.html", { waitUntil: "networkidle" });

    const controls = page.locator("#sequencer .simd-step-control");
    const before = await controls.evaluateAll((inputs) => inputs.map(({ value }) => Number(value)));
    const firstTrack = await page.locator("#sequencer .simd-step-track").first().boundingBox();
    const lastTrack = await page.locator("#sequencer .simd-step-track").last().boundingBox();
    expect(firstTrack).not.toBeNull();
    expect(lastTrack).not.toBeNull();

    await page.mouse.move(firstTrack.x + firstTrack.width / 2, firstTrack.y + firstTrack.height * 0.88);
    await page.mouse.down();
    await page.mouse.move(lastTrack.x + lastTrack.width / 2, lastTrack.y + lastTrack.height * 0.12, { steps: 2 });
    await page.mouse.up();

    const painted = await controls.evaluateAll((inputs) => inputs.map(({ value }) => Number(value)));
    expect(painted.filter((value, index) => value !== before[index]).length).toBeGreaterThan(8);
    expect(painted.every((value, index) => index === 0 || value >= painted[index - 1])).toBe(true);
    await expect(page.locator("#presetSelect")).toHaveValue("custom");
    await expect(page.locator("#undoPatch")).toBeEnabled();

    await page.locator("#undoPatch").click();
    expect(await controls.evaluateAll((inputs) => inputs.map(({ value }) => Number(value)))).toEqual(before);
  });

  test("compact knobs track vertical drag, keyboard input, and undo history", async ({ page }) => {
    await page.goto("simd-synth.html", { waitUntil: "networkidle" });

    const control = page.locator("#tuneA");
    const dial = control.locator("xpath=..");
    const before = await dial.evaluate((element) => ({
      angle: element.style.getPropertyValue("--knob-angle"),
      fill: element.style.getPropertyValue("--knob-fill"),
    }));
    const bounds = await dial.boundingBox();
    expect(bounds).not.toBeNull();

    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 - 28, { steps: 4 });
    await page.mouse.up();

    expect(Number(await control.inputValue())).toBeGreaterThan(0);
    await expect(page.locator("#tuneAOut")).not.toHaveText("0 st");
    await expect(page.locator("#undoPatch")).toBeEnabled();
    const dragged = await dial.evaluate((element) => ({
      angle: element.style.getPropertyValue("--knob-angle"),
      fill: element.style.getPropertyValue("--knob-fill"),
    }));
    expect(dragged.angle).not.toBe(before.angle);
    expect(dragged.fill).not.toBe(before.fill);

    await control.focus();
    const valueBeforeKey = Number(await control.inputValue());
    await page.keyboard.press("ArrowRight");
    expect(Number(await control.inputValue())).toBeGreaterThan(valueBeforeKey);
  });

  test("shows and plays the two-octave computer-key layout", async ({ page }) => {
    await page.goto("simd-synth.html", { waitUntil: "networkidle" });

    await expect(page.locator("#keyboard .simd-key")).toHaveCount(24);
    expect(await page.locator("#keyboard kbd").allTextContents()).toEqual([
      "Q", "2", "W", "3", "E", "R", "5", "T", "6", "Y", "7", "U",
      "Z", "S", "X", "D", "C", "V", "G", "B", "H", "N", "J", "M",
    ]);
    const lowC = page.locator('#keyboard .simd-key[data-key-code="KeyZ"]');
    const highC = page.locator('#keyboard .simd-key[data-key-code="KeyQ"]');
    await expect(lowC).toHaveAttribute("data-note", "48");
    await expect(highC).toHaveAttribute("data-note", "60");
    await expect(page.locator('#keyboard .simd-key[data-key-code="KeyU"]')).toHaveAttribute("data-note", "71");

    await page.keyboard.down("z");
    await page.keyboard.down("q");
    await expect(lowC).toHaveClass(/is-active/);
    await expect(highC).toHaveClass(/is-active/);
    await page.keyboard.up("z");
    await expect(lowC).not.toHaveClass(/is-active/);
    await expect(highC).toHaveClass(/is-active/);
    await page.keyboard.up("q");
    await expect(highC).not.toHaveClass(/is-active/);

    await page.locator(".simd-local-preset-disclosure > summary").click();
    await page.locator("#presetName").focus();
    await page.keyboard.type("z");
    await expect(page.locator("#presetName")).toHaveValue("z");
    await expect(lowC).not.toHaveClass(/is-active/);

    await page.locator(".simd-synth-titlebar").click();
    await page.keyboard.down("u");
    const highB = page.locator('#keyboard .simd-key[data-key-code="KeyU"]');
    await expect(highB).toHaveClass(/is-active/);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(highB).not.toHaveClass(/is-active/);
    await page.keyboard.up("u");
  });

  test("saves and recalls the complete patch from browser-local storage", async ({ page }) => {
    await page.goto("simd-synth.html", { waitUntil: "networkidle" });

    await page.locator("#sourceA").selectOption("7");
    await page.locator("#colorA").fill("0.91");
    await page.getByLabel("Step 1 scale degree").fill("12");
    await page.locator('details[data-section="modulation"] > summary').click();
    const firstRoute = page.locator("#modMatrix .simd-mod-row").first();
    await firstRoute.locator("select").nth(0).selectOption("9");
    await firstRoute.locator("select").nth(1).selectOption("14");
    await firstRoute.locator("input[type='range']").fill("0.57");
    await page.locator(".simd-local-preset-disclosure > summary").click();
    await page.locator("#presetName").fill("Browser Reef");
    await page.locator("#savePreset").click();

    await expect(page.locator("#liveStatus")).toHaveText("Browser Reef saved in this browser.");
    await expect(page.locator("#deletePreset")).toBeEnabled();
    const presetId = await page.locator("#presetSelect").inputValue();
    expect(presetId).toMatch(/^user:/);
    await expect(page.locator('#presetSelect optgroup[label="My presets"] option')).toHaveText("Browser Reef");

    const stored = await page.evaluate(() => {
      const payload = JSON.parse(localStorage.getItem("morphazoid.simd-synth.user-presets.v1"));
      return {
        version: payload.version,
        label: payload.presets[0].label,
        sourceA: payload.presets[0].params.sourceA,
        colorA: payload.presets[0].params.colorA,
        firstStepPitch: payload.presets[0].sequence[0][0],
        firstRoute: payload.presets[0].modRoutes[0],
      };
    });
    expect(stored).toEqual({
      version: 1,
      label: "Browser Reef",
      sourceA: 7,
      colorA: 0.91,
      firstStepPitch: 12,
      firstRoute: [9, 14, 0.57, 0],
    });

    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#presetSelect").selectOption(presetId);
    await expect(page.locator("#liveStatus")).toHaveText("Browser Reef loaded. Saved in this browser.");
    await expect(page.locator("#sourceA")).toHaveValue("7");
    await expect(page.locator("#colorA")).toHaveValue("0.91");
    await expect(page.getByLabel("Step 1 scale degree")).toHaveValue("12");
    const recalledRoute = page.locator("#modMatrix .simd-mod-row").first();
    await expect(recalledRoute.locator("select").nth(0)).toHaveValue("9");
    await expect(recalledRoute.locator("select").nth(1)).toHaveValue("14");
    await expect(recalledRoute.locator("input[type='range']")).toHaveValue("0.57");
  });

  test("streams nonzero sequence output through the automatic SIMD AudioWorklet", async ({ page }) => {
    await installScopeProbe(page);
    await page.goto("simd-synth.html", { waitUntil: "networkidle" });

    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await expect(page.locator("#audioState")).toHaveText("simd");

    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await expectAudibleScope(page);

    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#audioState")).toHaveText("off");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#playButton").click();
  });

  test("streams nonzero keyed output through the explicit scalar fallback", async ({ page }) => {
    await installScopeProbe(page);
    await page.goto("simd-synth.html?scalar=1", { waitUntil: "networkidle" });

    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await expect(page.locator("#audioState")).toHaveText("scalar");

    await expect(page.locator("#keyboard .simd-key")).toHaveCount(24);
    const middleC = page.locator('#keyboard .simd-key[data-note="60"]');
    await middleC.focus();
    await page.keyboard.down("Enter");
    await expect(middleC).toHaveClass(/is-active/);
    await expectAudibleScope(page);
    await page.keyboard.up("Enter");
    await expect(middleC).not.toHaveClass(/is-active/);

    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  });

  test("keeps its compact rack reachable without document or panel overflow", async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("simd-synth.html", { waitUntil: "networkidle" });

      const compactGeometry = await page.evaluate(() => {
        const select = document.querySelector("#sourceA").getBoundingClientRect();
        const dial = document.querySelector(".simd-dial").getBoundingClientRect();
        const knob = document.querySelector(".simd-knob").getBoundingClientRect();
        return {
          selectHeight: select.height,
          dialLeftInset: dial.left - knob.left,
          dialRightInset: knob.right - dial.right,
        };
      });
      expect(compactGeometry.selectHeight).toBeLessThanOrEqual(29);
      expect(compactGeometry.dialLeftInset).toBeGreaterThanOrEqual(0);
      expect(compactGeometry.dialRightInset).toBeGreaterThanOrEqual(0);

      await page.locator("#sequencer .simd-step").last().scrollIntoViewIfNeeded();
      await expect(page.locator("#sequencer .simd-step").last()).toBeVisible();
      await page.locator('details[data-section="modulation"] > summary').click();
      await page.locator("#modMatrix .simd-mod-clear").last().scrollIntoViewIfNeeded();
      await expect(page.locator("#modMatrix .simd-mod-clear").last()).toBeVisible();

      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const panel = document.querySelector(".simd-synth-panel");
        const shell = document.querySelector(".simd-synth-shell").getBoundingClientRect();
        const scope = document.querySelector("#scopeCanvas").getBoundingClientRect();
        return {
          documentOverflow: Math.max(0, root.scrollWidth - root.clientWidth),
          panelOverflow: Math.max(0, panel.scrollWidth - panel.clientWidth),
          shellLeft: shell.left,
          shellRight: shell.right,
          scopeWidth: scope.width,
          viewportWidth: innerWidth,
        };
      });
      expect(layout.documentOverflow).toBeLessThanOrEqual(2);
      expect(layout.panelOverflow).toBeLessThanOrEqual(2);
      expect(layout.shellLeft).toBeGreaterThanOrEqual(-2);
      expect(layout.shellRight).toBeLessThanOrEqual(layout.viewportWidth + 2);
      expect(layout.scopeWidth).toBeGreaterThan(220);
    }
  });
});
