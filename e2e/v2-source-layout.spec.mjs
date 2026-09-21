import { readFile, readdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
import { attachJson, canvasLayouts } from "./helpers/canvas-preservation.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";
import { relocatedSources } from "../tests/helpers/relocated-sources.mjs";

const root = new URL("../", import.meta.url);
const movedControllers = new Set(Object.values(relocatedSources));
const routes = [];
for (const file of (await readdir(root)).filter(name => name.endsWith(".html")).sort()) {
  const html = await readFile(new URL(file, root), "utf8");
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gu)]
    .map(match => match[1].split(/[?#]/u)[0].replace(/^\.\//u, ""));
  if (sources.some(source => movedControllers.has(source))) routes.push(file);
}

for (const route of routes) {
  test(`${route}: relocated source preserves the control surface across viewport changes`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${route}?layout-preservation=1#preserve-route`, { waitUntil: "load" });
    await settlePage(page);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    const surfaces = [];
    for (const layout of canvasLayouts) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await settlePage(page);
      await expect(page.locator(".midi-output-monitor-card.is-updated")).toHaveCount(0);
      surfaces.push(await page.evaluate(() => ({
        width: innerWidth, height: innerHeight,
        route: location.pathname + location.search + location.hash,
        bodyClass: document.body.className,
        controls: [...document.querySelectorAll(".masthead,.panel,button,input,select,summary,canvas")].flatMap(node => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          if (!box.width || !box.height || style.display === "none" || style.visibility === "hidden") return [];
          const values = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color", "backgroundColor",
            "borderRadius", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]
            .map(name => [name, style[name]]);
          return [{
            tag: node.tagName, id: node.id,
            box: [box.x, box.y, box.width, box.height].map(value => Math.round(value * 1000) / 1000),
            style: Object.fromEntries(values),
          }];
        }),
      })));
    }
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await attachJson(testInfo, "source-layout-surface.json", surfaces);
  });
}

test("Graph Delay loads its relocated-controller worklet URL with a synthetic input", async ({ page, baseURL }, testInfo) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.addInitScript(() => {
    window.__sourceLayoutFakeInputs = [];
    window.__sourceLayoutWorklets = [];
    const originalAddModule = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function (url, ...options) {
      // Worklet fetches are not reliably emitted as page "response" events.
      // Delegate to the real API and record only successfully loaded modules.
      await Reflect.apply(originalAddModule, this, [url, ...options]);
      const resolved = new URL(url, location.href);
      window.__sourceLayoutWorklets.push({ path: resolved.pathname + resolved.search, status: "loaded" });
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const source = audio.createOscillator();
      source.frequency.value = 147;
      const gain = audio.createGain();
      gain.gain.value = 0.02;
      const destination = audio.createMediaStreamDestination();
      source.connect(gain).connect(destination);
      source.start();
      await audio.resume();
      window.__sourceLayoutFakeInputs.push({ audio, source });
      return destination.stream;
    };
  });
  await page.goto("graph-delay.html", { waitUntil: "load" });
  await settlePage(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).peak).toBeGreaterThan(0.00001);
  const processors = await page.evaluate(() => window.__sourceLayoutWorklets);
  expect(processors).toEqual([{
    path: "/src/instruments/graph-delay/graph-turn-processor.js?v=20260726-edge-switches", status: "loaded",
  }]);
  await expect(page.locator("#liveStatus")).toContainText("Pitch processing active");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 500, intervalMs: 40 });
  expect(envelope.summary.activeSamples).toBeGreaterThan(0);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(await page.evaluate(() => window.__sourceLayoutFakeInputs.length)).toBe(1);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(async () => {
    for (const input of window.__sourceLayoutFakeInputs) {
      input.source.stop();
      await input.audio.close();
    }
  });
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  await attachJson(testInfo, "graph-delay-source-layout.json", { processors, envelope, input: "Synthetic oscillator; no hardware microphone." });
});
