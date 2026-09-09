import { expect, test } from "@playwright/test";

import {
  readAudioStatus,
  sampleAudioEnvelope,
  waitForAudioState,
  waitForStableAudioState,
} from "./helpers/audio-probe.mjs";
import {
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

const CATALOG_URL = "https://www.webaudiomodules.com/community/plugins.json";
const SDK_URL = "https://www.webaudiomodules.com/sdk/2.0.0-alpha.6/src/initializeWamHost.js";
const MODULE_URL = "https://www.webaudiomodules.com/community/plugins/plugazoid-tests/gain/index.js";

const MOCK_CATALOG = [
  {
    identifier: "com.sequencerParty.simpleDistortion",
    name: "Test Gain WAM",
    vendor: "Morphazoid QA",
    description: "A deterministic gain effect for browser host verification.",
    category: ["Effect", "Utility"],
    path: "plugazoid-tests/gain/index.js",
  },
  {
    identifier: "org.morphazoid.testDelay",
    name: "Test Delay",
    vendor: "Morphazoid QA",
    description: "A second compatible effect.",
    category: ["Effect", "Delay"],
    path: "plugazoid-tests/delay/index.js",
  },
  {
    identifier: "org.morphazoid.testInstrument",
    name: "Test Instrument",
    vendor: "Morphazoid QA",
    category: ["Instrument"],
    path: "plugazoid-tests/instrument/index.js",
  },
];

const MOCK_SDK = `
  export default async function initializeWamHost(audioContext) {
    globalThis.__mockWamHostContext = audioContext;
    return ["plugazoid-test-host", "plugazoid-test-key"];
  }
`;

const MOCK_WAM = `
  export default class TestGainWam {
    static get isWebAudioModuleConstructor() { return true; }

    static async createInstance(groupId, audioContext) {
      if (groupId !== "plugazoid-test-host") throw new Error("Wrong WAM host group");
      const node = audioContext.createGain();
      node.gain.value = 0.2;
      Object.defineProperty(node, "destroy", {
        value() {
          globalThis.__mockWamDestroyCount = (globalThis.__mockWamDestroyCount || 0) + 1;
          node.disconnect();
        },
      });
      return {
        audioNode: node,
        descriptor: {
          name: "Test Gain WAM",
          vendor: "Morphazoid QA",
          apiVersion: "2.0.0-alpha.6",
        },
        async createGui() {
          const root = document.createElement("div");
          root.id = "mockWamGui";
          const label = document.createElement("label");
          label.textContent = "Test WAM gain";
          const input = document.createElement("input");
          input.id = "mockWamGain";
          input.type = "range";
          input.min = "0";
          input.max = "1";
          input.step = "0.01";
          input.value = "0.2";
          input.addEventListener("input", () => {
            node.gain.setTargetAtTime(Number(input.value), audioContext.currentTime, 0.006);
          });
          label.append(input);
          root.append(label);
          return root;
        },
        destroyGui(gui) {
          gui.remove();
        },
      };
    }
  }
`;

async function installMockWamNetwork(page) {
  await page.route(CATALOG_URL, (route) => route.fulfill({
    body: JSON.stringify(MOCK_CATALOG),
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
  }));
  await page.route(SDK_URL, (route) => route.fulfill({
    body: MOCK_SDK,
    contentType: "application/javascript",
    headers: { "Access-Control-Allow-Origin": "*" },
  }));
  await page.route(MODULE_URL, (route) => route.fulfill({
    body: MOCK_WAM,
    contentType: "application/javascript",
    headers: { "Access-Control-Allow-Origin": "*" },
  }));
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test.describe("Plugazoid WAM2 browser host MVP", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Realtime Web Audio coverage runs in Chromium");

  test("loads a remote WAM-shaped module and preserves separate Audio, input, bypass, and unload states", async ({ page }, testInfo) => {
    await installMockWamNetwork(page);
    const diagnostics = watchPageDiagnostics(page, {
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3435",
    });
    const response = await page.goto("plugazoid.html", { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);
    await settlePage(page);

    const audioButton = page.locator("#audioButton");
    const micButton = page.locator("#micButton");
    const testToneButton = page.locator("#testToneButton");
    const loadWamButton = page.locator("#loadWamButton");

    await expect(page.locator("#catalogSummary")).toHaveText("2 effects · 3 modules");
    await expect(page.locator("#wamSelect option")).toHaveCount(2);
    await expect(page.locator("#wamSelect")).toHaveValue("com.sequencerParty.simpleDistortion");
    expect((await readAudioStatus(page)).active).toBe(false);

    await micButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#audioError")).toContainText("Turn on Audio first");

    await audioButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "true");
    await expect(loadWamButton).toBeEnabled();
    await expect(page.locator("#runtimeState")).toContainText("WAM2 host ready");
    expect((await readAudioStatus(page)).active).toBe(false);

    await testToneButton.click();
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");
    await waitForAudioState(page, true);
    const dry = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
    expect(dry.summary.finite).toBe(true);
    expect(dry.summary.maxPeak).toBeGreaterThan(0.005);
    expect(dry.summary.clippedSamples).toBe(0);

    await loadWamButton.click();
    await expect(page.locator("#mockWamGui")).toBeVisible();
    await expect(page.locator("#processorName")).toHaveText("Test Gain WAM");
    await expect(page.locator("#processorVendor")).toHaveText("Morphazoid QA");
    await expect(page.locator("#wamApiVersion")).toHaveText("2.0.0-alpha.6");
    await expect(page.locator("#processorRuntime")).toHaveText("remote WAM2 module");
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");

    const wet = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
    expect(wet.summary.finite).toBe(true);
    expect(wet.summary.maxPeak).toBeGreaterThan(0.001);
    expect(wet.summary.clippedSamples).toBe(0);
    expect(dry.summary.meanRms).toBeGreaterThan(wet.summary.meanRms * 2);

    await setRange(page, "#mockWamGain", 0.8);
    const opened = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
    expect(opened.summary.meanRms).toBeGreaterThan(wet.summary.meanRms * 2);

    await page.locator("#bypassButton").click();
    await expect(page.locator("#bypassButton")).toHaveAttribute("aria-pressed", "true");
    const bypassed = await sampleAudioEnvelope(page, { durationMs: 450, intervalMs: 40 });
    expect(bypassed.summary.meanRms).toBeGreaterThan(opened.summary.meanRms);
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");

    await page.locator("#unloadWamButton").click();
    await expect(page.locator("#processorSummary")).toHaveText("empty slot");
    await expect(page.locator("#wamGuiEmpty")).toBeVisible();
    await expect.poll(() => page.evaluate(() => globalThis.__mockWamDestroyCount || 0)).toBe(1);
    await expect(testToneButton).toHaveAttribute("aria-pressed", "true");

    await setRange(page, "#outputLevel", 0);
    await waitForStableAudioState(page, false);
    await setRange(page, "#outputLevel", 0.52);
    await waitForAudioState(page, true);
    await testToneButton.click();
    await waitForStableAudioState(page, false);
    await audioButton.click();
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);

    await testInfo.attach("plugazoid-wam-audio-scenes.json", {
      body: JSON.stringify({
        dry: dry.summary,
        wet: wet.summary,
        opened: opened.summary,
        bypassed: bypassed.summary,
      }, null, 2),
      contentType: "application/json",
    });
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test("keeps the loaded WAM playable and every primary control reachable across required viewports", async ({ page }) => {
    await installMockWamNetwork(page);
    const diagnostics = watchPageDiagnostics(page, {
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3435",
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("plugazoid.html", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator("#audioButton").click();
    await expect(page.locator("#loadWamButton")).toBeEnabled();
    await page.locator("#loadWamButton").click();
    await expect(page.locator("#mockWamGui")).toBeVisible();
    await page.locator("#testToneButton").click();
    await waitForAudioState(page, true);

    for (const viewport of [
      { width: 1440, height: 900, name: "desktop" },
      { width: 390, height: 844, name: "phone portrait" },
      { width: 844, height: 390, name: "phone landscape" },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(120);
      const layout = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelOverflow: document.querySelector(".plugazoid-panel").scrollWidth
          - document.querySelector(".plugazoid-panel").clientWidth,
      }));
      expect(layout.documentOverflow, viewport.name + " document overflow").toBeLessThanOrEqual(1);
      expect(layout.panelOverflow, viewport.name + " panel overflow").toBeLessThanOrEqual(1);

      for (const selector of [
        "#audioButton",
        "#micButton",
        "#testToneButton",
        "#loadWamButton",
        "#mockWamGain",
        "#bypassButton",
        "#unloadWamButton",
      ]) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await expect(control, viewport.name + " " + selector).toBeVisible();
        const box = await control.boundingBox();
        expect(box, viewport.name + " " + selector + " box").not.toBeNull();
        expect(box.x, viewport.name + " " + selector + " left edge").toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, viewport.name + " " + selector + " right edge").toBeLessThanOrEqual(viewport.width + 1);
      }

      const envelope = await sampleAudioEnvelope(page, { durationMs: 280, intervalMs: 40 });
      expect(envelope.summary.finite, viewport.name + " finite audio").toBe(true);
      expect(envelope.summary.maxPeak, viewport.name + " signal").toBeGreaterThan(0.001);
      expect(envelope.summary.clippedSamples, viewport.name + " clipping").toBe(0);
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#testToneButton")).toHaveAttribute("aria-pressed", "true");
    }

    const coarseTargets = await page.evaluate(() => [
      "#audioButton",
      "#micButton",
      "#testToneButton",
      "#loadWamButton",
      "#bypassButton",
      "#unloadWamButton",
    ].map((selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { selector, width: rect.width, height: rect.height };
    }));
    for (const target of coarseTargets) {
      expect(target.width, target.selector + " is at least 48px wide").toBeGreaterThanOrEqual(48);
      expect(target.height, target.selector + " is at least 48px tall").toBeGreaterThanOrEqual(48);
    }

    await page.locator("#testToneButton").click();
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });

  test("routes a microphone-shaped MediaStream through a loaded WAM and releases both on teardown", async ({ page }) => {
    await installMockWamNetwork(page);
    const diagnostics = watchPageDiagnostics(page, {
      baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3435",
    });
    await page.goto("plugazoid.html", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator("#audioButton").click();
    await expect(page.locator("#loadWamButton")).toBeEnabled();
    await page.locator("#loadWamButton").click();
    await expect(page.locator("#mockWamGui")).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
          const context = new AudioContextConstructor();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const destination = context.createMediaStreamDestination();
          oscillator.type = "triangle";
          oscillator.frequency.value = 173;
          gain.gain.value = 0.035;
          oscillator.connect(gain);
          gain.connect(destination);
          oscillator.start();
          await context.resume();
          window.__plugazoidMockMic = {
            context,
            oscillator,
            track: destination.stream.getAudioTracks()[0],
          };
          return destination.stream;
        },
      });
    });

    await page.locator("#micButton").click();
    await expect(page.locator("#micButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#inputState")).toHaveText("microphone live");
    await waitForAudioState(page, true);

    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#micButton")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(
      () => window.__plugazoidMockMic.track.readyState,
    )).toBe("ended");
    await expect.poll(() => page.evaluate(() => globalThis.__mockWamDestroyCount || 0)).toBe(1);
    await page.evaluate(async () => {
      const mock = window.__plugazoidMockMic;
      try {
        mock.oscillator.stop();
      } catch {
        // The fixture may already have been released by the browser.
      }
      if (mock.context.state !== "closed") await mock.context.close();
    });

    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  });
});
