import { expect, test } from "@playwright/test";

test.describe("SIMD Audio", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "WebAssembly SIMD POC targets Chromium first");

  test("keeps Audio explicit and selects its Wasm backend automatically", async ({ page }) => {
    await page.goto("simd-resonator.html", { waitUntil: "networkidle" });

    const readState = () => page.evaluate(() => (
      globalThis.__MORPHAZOID_SIMD_RESONATOR__.getState()
    ));
    const initial = await readState();
    expect(initial.audioOn).toBe(false);
    expect(initial.surface).toBe("resonator");
    expect(initial.availableEngines).toEqual(["resonator"]);
    await expect(page.locator(".simd-engine-choices")).toHaveCount(0);

    await page.locator("#pluckButton").click();
    expect((await readState()).audioOn).toBe(false);
    await expect(page.locator("#audioError")).toHaveText("Turn on Audio first.");

    await page.locator("#micButton").click();
    expect((await readState()).micOn).toBe(false);
    expect((await readState()).audioOn).toBe(false);
    await expect(page.locator("#audioError")).toHaveText("Turn on Audio first.");

    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readState()).audioOn).toBe(true);
    const started = await readState();
    expect(["simd", "scalar"]).toContain(started.backend);
    expect(started.kernelMicros).toBeGreaterThan(0);
    expect(started.backend).toBe(started.simdAvailable ? "simd" : "scalar");
    await expect(page.locator("#backendMetric")).toHaveText(started.simdAvailable ? "SIMD Wasm" : "scalar Wasm");
    await expect(page.locator("#laneMetric")).toHaveText(started.simdAvailable ? "4" : "1");
    await expect(page.locator("#simdBackendButton, #scalarBackendButton")).toHaveCount(0);

    await page.locator("#resonatorCanvas").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await readState()).peak, { timeout: 6_000 }).toBeGreaterThan(0.001);
    expect((await readState()).audioOn).toBe(true);

    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readState()).audioOn).toBe(false);
  });

  test("supports an explicit scalar fallback", async ({ page }) => {
    await page.goto("simd-resonator.html?scalar=1", { waitUntil: "networkidle" });
    await expect(page.locator("#simdBackendButton, #scalarBackendButton")).toHaveCount(0);
    await page.locator("#audioButton").click();
    await expect.poll(async () => page.evaluate(() => (
      globalThis.__MORPHAZOID_SIMD_RESONATOR__.getState().backend
    ))).toBe("scalar");
    await expect(page.locator("#backendMetric")).toHaveText("scalar Wasm");
  });

  test("plays the granular cloud and oscillator swarm without rearming Audio", async ({ page }) => {
    await page.goto("simd-audio-lab.html", { waitUntil: "networkidle" });
    const readState = () => page.evaluate(() => globalThis.__MORPHAZOID_SIMD_AUDIO__.getState());
    expect((await readState()).surface).toBe("lab");
    expect((await readState()).engine).toBe("granular");
    expect((await readState()).presetId).toBe("granular:thicket");
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readState()).audioOn).toBe(true);

    await expect(page.locator("#controlALabel")).toHaveText("Grains");
    const canvas = page.locator("#resonatorCanvas");
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.42);
    await page.mouse.down();
    await expect.poll(async () => (await readState()).peak, { timeout: 6_000 }).toBeGreaterThan(0.0001);
    await page.mouse.up();
    expect((await readState()).audioOn).toBe(true);

    await page.locator("#swarmEngineButton").click();
    await expect.poll(async () => (await readState()).engine).toBe("swarm");
    await expect(page.locator("#controlALabel")).toHaveText("Voices");
    await expect(page.locator("#micButton")).toBeDisabled();
    await page.mouse.move(bounds.x + bounds.width * 0.44, bounds.y + bounds.height * 0.34);
    await page.mouse.down();
    await expect.poll(async () => (await readState()).peak, { timeout: 6_000 }).toBeGreaterThan(0.0001);
    await page.mouse.up();
    expect((await readState()).audioOn).toBe(true);
  });

  test("loads dense presets and plays every added DSP engine", async ({ page }) => {
    await page.goto("simd-audio-lab.html", { waitUntil: "networkidle" });
    const readState = () => page.evaluate(() => globalThis.__MORPHAZOID_SIMD_AUDIO__.getState());
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readState()).audioOn).toBe(true);
    await expect.poll(async () => {
      const workerState = await readState();
      return workerState.workerMode === "unavailable"
        ? workerState.workerMode + ": " + workerState.workerError
        : workerState.workerMode;
    }).toBe("shared");

    await page.locator("#presetSelect").selectOption("granular:whiteout");
    expect((await readState()).settings.density).toBe(680);
    await expect(page.locator("#controlBOut")).toHaveText("680/s");

    for (const [engine, button, label] of [
      ["freeze", "#freezeEngineButton", "Bins"],
      ["ir", "#irEngineButton", "Taps"],
      ["mesh", "#meshEngineButton", "Modes"],
      ["waveguide", "#waveguideEngineButton", "Strings"],
      ["spatial", "#spatialEngineButton", "Sources"],
    ]) {
      await page.locator(button).click();
      await expect.poll(async () => (await readState()).engine).toBe(engine);
      await expect(page.locator("#controlALabel")).toHaveText(label);
      await page.locator("#pluckButton").click();
      await expect.poll(async () => (await readState()).peak, { timeout: 6_000 }).toBeGreaterThan(0.000001);
      if (engine === "ir") {
        await expect(page.locator("#demoInputNote")).toContainText("not the sound source");
        await expect.poll(async () => (await readState()).peak, { timeout: 6_000 }).toBeGreaterThan(0.001);
      }
      expect((await readState()).audioOn).toBe(true);
    }
  });

  test("keeps the Resonator and every lab example reachable at target viewport sizes", async ({ page }) => {
    for (const route of ["simd-resonator.html", "simd-audio-lab.html"]) {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(route, { waitUntil: "networkidle" });
        if (route.includes("lab")) await page.locator("#spatialEngineButton").click();
        await page.locator("#controlD").scrollIntoViewIfNeeded();
        await expect(page.locator("#controlD")).toBeVisible();
        await page.locator("#resetButton").scrollIntoViewIfNeeded();
        await expect(page.locator("#resetButton")).toBeVisible();
        const layout = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          panelClientWidth: document.querySelector(".simd-resonator-panel").clientWidth,
          panelScrollWidth: document.querySelector(".simd-resonator-panel").scrollWidth,
          engineButtonsInPanel: [...document.querySelectorAll(".simd-engine-choices button")].every((button) => {
            const panel = document.querySelector(".simd-resonator-panel").getBoundingClientRect();
            const bounds = button.getBoundingClientRect();
            return bounds.left >= panel.left - 1 && bounds.right <= panel.right + 1;
          }),
          canvasWidth: document.querySelector("#resonatorCanvas").getBoundingClientRect().width,
          canvasHeight: document.querySelector("#resonatorCanvas").getBoundingClientRect().height,
        }));
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
        expect(layout.panelScrollWidth).toBeLessThanOrEqual(layout.panelClientWidth + 1);
        expect(layout.engineButtonsInPanel).toBe(true);
        expect(layout.canvasWidth).toBeGreaterThan(180);
        expect(layout.canvasHeight).toBeGreaterThan(80);
      }
    }
  });

  test("cancels a microphone request when Audio is stopped", async ({ page }) => {
    await page.addInitScript(() => {
      const track = {
        stopped: false,
        stop() {
          this.stopped = true;
        },
      };
      let resolveRequest;
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia() {
            return new Promise((resolve) => {
              resolveRequest = () => resolve({ getTracks: () => [track] });
            });
          },
        },
      });
      globalThis.__SIMD_MIC_TEST__ = {
        resolve: () => resolveRequest?.(),
        track,
      };
    });

    await page.goto("simd-resonator.html", { waitUntil: "networkidle" });
    const readState = () => page.evaluate(() => (
      globalThis.__MORPHAZOID_SIMD_RESONATOR__.getState()
    ));
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readState()).audioOn).toBe(true);
    await page.locator("#micButton").click();
    await expect(page.locator("#micButton")).toBeDisabled();

    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readState()).audioOn).toBe(false);
    await page.evaluate(() => globalThis.__SIMD_MIC_TEST__.resolve());
    await expect.poll(async () => page.evaluate(() => (
      globalThis.__SIMD_MIC_TEST__.track.stopped
    ))).toBe(true);
    expect((await readState()).micOn).toBe(false);
    await expect(page.locator("#micButton")).toHaveAttribute("aria-label", /Enable microphone/);
  });
});
