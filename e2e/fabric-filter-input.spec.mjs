import { expect, test } from "@playwright/test";
import { sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const capture = page => page.evaluate(async () => (
  await import("/src/site/header-presets.js")
).captureHeaderPresetState());
const inputState = page => page.evaluate(() => ({
  requests: window.__fabricInput.requests,
  tracks: window.__fabricInput.streams.flatMap(stream => stream.getTracks().map(track => track.readyState)),
}));

// Real Web Audio streams exercise MediaStreamAudioSourceNode and the worklet,
// while permission timing/device enumeration remain deterministic and local.
async function installInput(page, { delayed = false } = {}) {
  await page.addInitScript(({ delayed }) => {
    const probe = window.__fabricInput = { requests: [], streams: [], release: [], delayed };
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        { kind: "audioinput", deviceId: "default", label: "Default microphone" },
        { kind: "audioinput", deviceId: "fabric-stereo", label: "QA stereo input" },
        { kind: "audioinput", deviceId: "fabric-other", label: "QA other input" },
      ],
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async constraints => {
        probe.requests.push(structuredClone(constraints));
        const context = new AudioContext({ sampleRate: 48_000 });
        const tone = context.createOscillator();
        tone.frequency.value = 880;
        const left = context.createGain(), right = context.createGain();
        left.gain.value = 0.2;
        right.gain.value = -0.2;
        const merger = context.createChannelMerger(2);
        const destination = context.createMediaStreamDestination();
        tone.connect(left).connect(merger, 0, 0);
        tone.connect(right).connect(merger, 0, 1);
        merger.connect(destination);
        tone.start();
        await context.resume();
        const stream = destination.stream;
        probe.streams.push(stream);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          let released = false;
          track.stop = () => {
            stop();
            if (!released) { released = true; void context.close(); }
          };
        }
        if (probe.delayed) await new Promise(resolve => probe.release.push(resolve));
        return stream;
      },
    });
  }, { delayed });
}

async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((control, value) => {
    control.value = String(value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function arm(page) {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
}

async function connect(page) {
  await page.locator("#sourceMode").selectOption("input");
  await page.locator("#inputChannels").selectOption("2");
  await page.locator("#inputDevice").selectOption("fabric-stereo");
  await arm(page);
  await page.locator("#inputButton").click();
  await expect(page.locator("#inputButton")).toHaveText("Disconnect input");
}

async function choosePreset(page, id) {
  await page.locator(".header-preset-picker summary").click();
  await page.locator(`.header-preset-picker button[data-preset-id="${id}"]`).click();
}

test.beforeEach(async ({ page, baseURL }) => {
  page.fabricDiagnostics = watchPageDiagnostics(page, { baseURL });
});
test.afterEach(async ({ page }) => {
  expect(pageDiagnosticMessages(page.fabricDiagnostics)).toEqual([]);
});

test("the complete factory bank, Next and generative dice preserve explicit Audio and input settings", async ({ page }) => {
  await installInput(page);
  await page.goto("/moire-drone.html");
  const bank = await page.evaluate(async () => (await import("/src/instruments/moire-drone/full-presets.js")).MOIRE_DRONE_FULL_PRESETS);
  expect(bank).toHaveLength(62);
  await expect(page.locator(".header-preset-picker summary")).toContainText("Select Preset");
  await expect(page.locator(".header-preset-picker button[data-preset-id]")).toHaveCount(bank.length);
  expect(await page.locator(".header-preset-picker button[data-preset-id]").evaluateAll(nodes => nodes.map(node => node.dataset.presetId)))
    .toEqual(bank.map(preset => preset.id));

  await page.locator("#sourceMode").selectOption("input");
  await page.locator("#inputChannels").selectOption("2");
  await page.locator("#inputDevice").selectOption("fabric-stereo");
  await setRange(page, "inputGain", 1.37);
  await setRange(page, "outputLevel", 0.31);
  await expect(page.locator("#inputButton")).toBeDisabled();
  await expect(page.locator("#noiseControls")).toBeHidden();
  await page.locator("#stage").click({ position: { x: 100, y: 100 } });
  await page.locator("#stage").press("Enter");
  await page.locator(".header-preset-next").click();
  expect(await capture(page)).toMatchObject({ selectedId: bank[0].id, snapshot: bank[0].snapshot });
  await page.locator(".header-preset-random").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await inputState(page)).requests).toHaveLength(0);

  await arm(page);
  expect((await inputState(page)).requests).toHaveLength(0);
  await page.locator("#inputButton").click();
  await expect(page.locator("#inputButton")).toHaveText("Disconnect input");
  const stream = await inputState(page);
  expect(stream.requests).toEqual([{
    video: false,
    audio: {
      deviceId: { exact: "fabric-stereo" }, channelCount: { ideal: 2 },
      echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false },
    },
  }]);
  expect(stream.tracks).toEqual(["live"]);

  await choosePreset(page, bank.at(-1).id);
  expect(await capture(page)).toMatchObject({ selectedId: bank.at(-1).id, snapshot: bank.at(-1).snapshot });
  await page.locator(".header-preset-next").click();
  expect(await capture(page)).toMatchObject({ selectedId: bank[0].id, snapshot: bank[0].snapshot });
  await page.locator(".header-preset-random").click();
  const randomized = await capture(page);
  expect(randomized.selectedId).toBeNull();
  expect(bank.some(preset => JSON.stringify(preset.snapshot) === JSON.stringify(randomized.snapshot))).toBe(false);
  await expect(page.locator(".header-preset-picker summary")).toContainText("Custom");
  await expect(page.locator("#outputLevel")).toHaveValue("0.31");
  await expect(page.locator("#inputGain")).toHaveValue("1.37");
  await expect(page.locator("#inputGainOut")).toHaveText("1.37×");
  await expect(page.locator("#inputChannels")).toHaveValue("2");
  await expect(page.locator("#inputDevice")).toHaveValue("fabric-stereo");
  await expect(page.locator("#sourceMode")).toHaveValue("input");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#inputButton")).toHaveText("Disconnect input");
  expect(await inputState(page)).toEqual(stream);
});

test("stereo input reaches both worklet outputs, responds to filtering and stops on disconnect", async ({ page }, testInfo) => {
  await installInput(page);
  await page.goto("/moire-drone.html");
  await page.locator("#sourceMode").selectOption("input");
  await setRange(page, "filteredMix", 0);
  await setRange(page, "combDepth", 0);
  await setRange(page, "space", 0);
  await setRange(page, "feedback", 0);
  await setRange(page, "drive", 0);
  await setRange(page, "stereoWidth", 0);
  await page.locator("#inputChannels").selectOption("2");
  await arm(page);
  await waitForStableAudioState(page, false);
  await page.locator("#inputButton").click();
  await expect(page.locator("#inputButton")).toHaveText("Disconnect input");
  const open = await sampleAudioEnvelope(page, { durationMs: 750 });
  expect(open.summary.finite).toBe(true);
  expect(open.summary.maxRms).toBeGreaterThan(0.005);
  expect(open.summary.maxPeak).toBeLessThanOrEqual(1);
  expect(Math.max(...open.samples.map(sample => sample.leftPeak))).toBeGreaterThan(0.005);
  expect(Math.max(...open.samples.map(sample => sample.rightPeak))).toBeGreaterThan(0.005);

  await setRange(page, "combOffset", 0);
  await setRange(page, "combDepth", 1);
  await setRange(page, "spectralFilterBlend", 1);
  await setRange(page, "fftCutDepth", 1);
  await page.waitForTimeout(300);
  const filtered = await sampleAudioEnvelope(page, { durationMs: 600 });
  expect(filtered.summary.finite).toBe(true);
  expect(filtered.summary.meanRms).toBeLessThan(open.summary.meanRms * 0.5);
  await page.locator("#inputButton").click();
  await expect(page.locator("#inputButton")).toHaveText("Connect input");
  expect((await inputState(page)).tracks).toEqual(["ended"]);
  await waitForStableAudioState(page, false);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await testInfo.attach("fabric-input-filtering.json", {
    body: JSON.stringify({ open, filtered }, null, 2), contentType: "application/json",
  });
});

for (const action of ["cancel", "noise", "audio off", "hidden", "pagehide"]) {
  test(`a late input permission grant cannot reconnect after ${action}`, async ({ page }) => {
    await installInput(page, { delayed: true });
    await page.goto("/moire-drone.html");
    await page.locator("#sourceMode").selectOption("input");
    await arm(page);
    await page.locator("#inputButton").click();
    await expect(page.locator("#inputButton")).toHaveText("Cancel connection");
    await expect.poll(async () => (await inputState(page)).tracks).toEqual(["live"]);
    if (action === "cancel") await page.locator("#inputButton").click();
    else if (action === "noise") await page.locator("#sourceMode").selectOption("noise");
    else if (action === "audio off") await page.locator("#audioButton").click();
    else if (action === "hidden") await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    else await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
    await page.evaluate(() => window.__fabricInput.release.splice(0).forEach(resolve => resolve()));
    await expect.poll(async () => (await inputState(page)).tracks).toEqual(["ended"]);
    expect((await inputState(page)).requests).toHaveLength(1);
    await expect(page.locator("#inputButton")).toHaveAttribute("aria-pressed", "false");
  });
}

test("live input releases on device changes, Audio off, hiding and page teardown", async ({ page }) => {
  await installInput(page);
  await page.goto("/moire-drone.html");
  await connect(page);
  await page.locator("#inputDevice").selectOption("fabric-other");
  expect((await inputState(page)).tracks).toEqual(["ended"]);
  await expect(page.locator("#inputButton")).toHaveText("Connect input");
  await page.locator("#inputButton").click();
  await expect(page.locator("#inputButton")).toHaveText("Disconnect input");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await inputState(page)).tracks).toEqual(["ended", "ended"]);
  await arm(page);
  expect((await inputState(page)).requests).toHaveLength(2);
  await page.locator("#inputButton").click();
  await expect(page.locator("#inputButton")).toHaveText("Disconnect input");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await inputState(page)).tracks).toEqual(["ended", "ended", "ended"]);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect((await inputState(page)).requests).toHaveLength(3);
  await page.locator("#inputButton").click();
  await expect(page.locator("#inputButton")).toHaveText("Disconnect input");
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect.poll(async () => (await inputState(page)).tracks).toEqual(["ended", "ended", "ended", "ended"]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`presets and input remain reachable at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width !== 1440, baseURL });
    const page = await context.newPage();
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    try {
      await installInput(page);
      await page.goto("/moire-drone.html");
      await page.locator("#sourceMode").selectOption("input");
      const selectors = [".header-preset-picker summary", ".header-preset-next", ".header-preset-random", "#sourceMode", "#inputDevice", "#inputChannels", "#inputGain", "#inputButton", "#audioButton"];
      for (const selector of selectors) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        const geometry = await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return {
            width: rect.width, height: rect.height,
            inViewport: rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
            uncovered: hit === element || element.contains(hit),
          };
        });
        expect(geometry.inViewport, selector).toBe(true);
        expect(geometry.uncovered, selector).toBe(true);
        if (viewport.width !== 1440 && selector === "#audioButton") {
          expect(geometry.width).toBeGreaterThanOrEqual(48);
          expect(geometry.height).toBeGreaterThanOrEqual(48);
        }
      }
      await page.locator(".header-preset-picker summary").click();
      const lastPreset = page.locator(".header-preset-picker button[data-preset-id]").last();
      await lastPreset.click();
      await expect(page.locator(".header-preset-controls")).not.toHaveAttribute("data-preset-id", "unselected");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.locator("#sourceMode").scrollIntoViewIfNeeded();
      await testInfo.attach(`fabric-input-${viewport.width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await context.close(); }
  });
}
