import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { enableFakeMidi, installFakeMidi, sendMidi } from "./helpers/fake-midi.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const diagnosticsByPage = new WeakMap();
test.beforeEach(async ({ page, baseURL }) => {
  diagnosticsByPage.set(page, watchPageDiagnostics(page, { baseURL }));
  if (process.env.E2E_AUDIO_SILENT_SINK === "1") await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    // Keep the real worklet and analysers; bypass only an unavailable host sink.
    window.AudioContext = class extends NativeAudioContext {
      constructor(options = {}) { super({ ...options, sinkId: { type: "none" } }); }
    };
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const messages = pageDiagnosticMessages(diagnosticsByPage.get(page));
  await testInfo.attach("spartial-granular-diagnostics.json", { body: JSON.stringify(messages, null, 2), contentType: "application/json" });
  expect(messages).toEqual([]);
});

async function open(page) {
  expect((await page.goto("spartial.html"))?.ok()).toBe(true);
  await settlePage(page);
  await expect(page.locator("#granularMix")).toBeAttached();
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function prepareCloud(page) {
  for (const [id, value] of Object.entries({ cascade: 0, cascadeStart: 0, attack: .01, release: .05, granularMix: 1, grainSize: 200, grainDensity: 30, grainPitch: 0, grainLookback: 0, grainScatter: 0, grainJitter: 0, grainReverse: 0 })) await setRange(page, id, value);
}
async function sounding(page, testInfo, name) {
  await waitForStableAudioState(page, true, { stableMs: 200, timeout: 6000 });
  const envelope = await sampleAudioEnvelope(page, { durationMs: 550, intervalMs: 40 });
  await testInfo.attach(`${name}.json`, { body: JSON.stringify(envelope, null, 2), contentType: "application/json" });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.001);
  expect(envelope.summary.maxPeak).toBeLessThan(1);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect(envelope.summary.activeSamples).toBeGreaterThanOrEqual(envelope.summary.sampleCount * .8);
  return envelope;
}
async function silent(page) {
  await waitForStableAudioState(page, false, { stableMs: 250, timeout: 6000 });
  const envelope = await sampleAudioEnvelope(page, { durationMs: 300, intervalMs: 40 });
  expect(envelope.summary.maxPeak).toBeLessThan(.001);
  return envelope;
}

// A known local source: 220 Hz for two seconds, then two seconds of silence.
// Its separated regions make file-position changes observable at the output.
function sourceWave() {
  const rate = 48000, frames = rate * 4, bytes = frames * 2;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + bytes, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(bytes, 40);
  for (let i = 0; i < rate * 2; i++) buffer.writeInt16LE(Math.round(.6 * 32767 * Math.sin(2 * Math.PI * 220 * i / rate)), 44 + i * 2);
  return { name: "tone-then-silence.wav", mimeType: "audio/wav", buffer };
}
async function loadFile(page) {
  await page.locator("#grainFile").setInputFiles(sourceWave());
  await expect(page.locator("#grainFileStatus")).toContainText("tone-then-silence.wav");
  await page.locator("#granularSource").selectOption("file");
  await expect(page.locator("#clearGrainFile")).toBeEnabled();
}
async function peakFrequency(page) {
  // The public recording tap observes the final stereo mix on its original
  // clock. No instrument state or processor test hooks participate.
  return page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import(new URL("src/audio-output-manager.js", location.origin));
    const manager = getSharedAudioOutputManager(globalThis), context = manager.recordingContext();
    if (!context) throw new Error("A running audio output is required");
    const analyser = context.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
    const release = manager.tapInto(context, analyser);
    try {
      await new Promise(resolve => setTimeout(resolve, 250));
      const bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(bins);
      let best = Math.ceil(80 / (context.sampleRate / analyser.fftSize));
      for (let i = best + 1; i < Math.floor(1200 / (context.sampleRate / analyser.fftSize)); i++) if (bins[i] > bins[best]) best = i;
      return best * context.sampleRate / analyser.fftSize;
    } finally { release(); analyser.disconnect(); }
  });
}

test("SPARTIAL granular defaults preserve additive sound and explicit Audio and rotation", async ({ page }) => {
  await open(page);
  await expect(page.locator("#granularMix")).toHaveValue("0");
  await expect(page.locator("#granularSource")).toHaveValue("additive");
  await expect(page.locator("#grainFreeze")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#grainFreeze")).toBeDisabled();
  await expect(page.locator("#motion")).toHaveValue("off");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await setRange(page, "granularMix", 1);
  await page.locator("#holdButton").click();
  await page.locator("#nextGrainPreset").click();
  await page.locator("#randomGrainPreset").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await silent(page);
});

test("SPARTIAL full-wet live grains sound, obey master mute, and preserve level through presets and dice", async ({ page }, testInfo) => {
  await open(page); await prepareCloud(page);
  await setRange(page, "level", .43);
  await page.locator("#audioButton").click(); await page.locator("#holdButton").click();
  await sounding(page, testInfo, "live-full-wet");
  await setRange(page, "level", 0); await silent(page);
  await setRange(page, "level", .43); await sounding(page, testInfo, "live-volume-restored");
  for (const selector of ["#nextGrainPreset", "#randomGrainPreset", "#nextPreset", "#randomPreset"]) {
    await page.locator(selector).click();
    await expect(page.locator("#level")).toHaveValue("0.43");
    await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  }
  await page.locator("#preset").selectOption("still");
  await prepareCloud(page); await sounding(page, testInfo, "live-after-preset-changes");
  await page.locator("#panicButton").click(); await silent(page);
});

test("SPARTIAL stereo grains play a short live note after idle and its look-back delay", async ({ page }, testInfo) => {
  await open(page);
  for (const [id, value] of Object.entries({ granularMix: 1, cascade: 0, attack: .01, release: .05, grainSize: 100, grainDensity: 40, grainLookback: 700, grainScatter: 0 })) await setRange(page, id, value);
  await page.locator('details[data-section="sound"] > summary').click();
  await page.locator("#forcePreview").check();
  await page.locator("#audioButton").click();
  await expect(page.locator("#routeBadge")).toHaveText("Stereo preview");
  await page.waitForTimeout(4200); // Fill the running capture buffer with old silence.
  await page.locator("#stage").focus();
  await page.keyboard.down("a");
  await page.waitForTimeout(100);
  await page.keyboard.up("a");
  const envelope = await sampleAudioEnvelope(page, { durationMs: 1500, intervalMs: 30 });
  await testInfo.attach("delayed-live-stereo-tap.json", { body: JSON.stringify(envelope, null, 2), contentType: "application/json" });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.001);
  expect(Math.max(...envelope.samples.map(sample => sample.leftPeak))).toBeGreaterThan(.001);
  expect(Math.max(...envelope.samples.map(sample => sample.rightPeak))).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await silent(page);
  // A second delayed note must still obey Silence before it reaches the grains.
  await page.locator("#stage").focus();
  await page.keyboard.down("a"); await page.waitForTimeout(100); await page.keyboard.up("a");
  await page.locator("#panicButton").click();
  const stopped = await sampleAudioEnvelope(page, { durationMs: 1200, intervalMs: 40 });
  expect(stopped.summary.maxPeak).toBeLessThan(.001);
});

test("SPARTIAL Freeze sustains the captured cloud after note release and Silence stops it", async ({ page }, testInfo) => {
  await open(page); await prepareCloud(page);
  await page.locator("#audioButton").click(); await page.locator("#holdButton").click();
  await sounding(page, testInfo, "before-freeze");
  await expect(page.locator("#grainFreeze")).toBeEnabled();
  await page.locator("#grainFreeze").click();
  await expect(page.locator("#grainFreeze")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#holdButton").click();
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(1000); // Exceeds both the note release and grain duration.
  await sounding(page, testInfo, "frozen-after-release");
  await page.locator("#panicButton").click(); await silent(page);
  await setRange(page, "grainSpread", .6); await silent(page);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});

test("SPARTIAL loads a local grain file silently and its position, pitch and source change audible output", async ({ page }, testInfo) => {
  test.setTimeout(45000);
  await open(page); await prepareCloud(page); await loadFile(page);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await silent(page);
  await page.locator(".grain-detail > summary").click();
  await expect(page.locator("#grainFilePosition")).toBeVisible();
  await expect(page.locator("#grainLivePosition")).toBeHidden();
  await setRange(page, "grainPosition", .25);
  await page.locator("#root").selectOption("60");
  await page.locator("#audioButton").click(); await page.locator("#holdButton").click();
  await sounding(page, testInfo, "file-tone");
  const normalPitch = await peakFrequency(page);
  expect(normalPitch).toBeGreaterThan(200); expect(normalPitch).toBeLessThan(240);
  await setRange(page, "grainPitch", 12);
  await page.waitForTimeout(250);
  const octavePitch = await peakFrequency(page);
  expect(octavePitch / normalPitch).toBeGreaterThan(1.85); expect(octavePitch / normalPitch).toBeLessThan(2.15);
  await setRange(page, "grainPosition", .75); await silent(page);
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
  await setRange(page, "grainPosition", .25); await sounding(page, testInfo, "file-position-restored");
  await page.locator("#granularSource").selectOption("additive");
  await expect(page.locator("#grainLivePosition")).toBeVisible();
  await expect(page.locator("#grainFilePosition")).toBeHidden();
  await sounding(page, testInfo, "live-source-restored");
  await page.locator("#granularSource").selectOption("file");
  await page.locator("#clearGrainFile").click();
  await expect(page.locator("#granularSource")).toHaveValue("additive");
  await expect(page.locator("#clearGrainFile")).toBeDisabled();
  await expect(page.locator("#level")).toHaveValue("0.65");
  await page.locator("#panicButton").click(); await silent(page);
});

async function hitVisible(page, selector) {
  return page.locator(selector).evaluate(node => {
    const box = node.getBoundingClientRect(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return box.width > 0 && box.height > 0 && box.left >= -1 && box.right <= innerWidth + 1 && (hit === node || node.contains(hit));
  });
}
test.describe("SPARTIAL granular mobile", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) test(`${viewport.width}x${viewport.height} granular controls remain reachable while the graphic stays pinned`, async ({ page }, testInfo) => {
    test.setTimeout(45000);
    await page.setViewportSize(viewport); await open(page);
    const scroller = page.locator("#spartialControls"), graphic = page.locator("#stageWrap");
    const initial = await graphic.boundingBox();
    const pinned = async () => {
      const box = await graphic.boundingBox();
      for (const key of ["x", "y", "width", "height"]) expect(Math.abs(box[key] - initial[key]), `graphic ${key}`).toBeLessThan(1);
      expect(await page.evaluate(() => scrollY)).toBe(0);
    };
    const scrollTop = () => scroller.evaluate(node => node.scrollTop);
    const pane = await scroller.boundingBox();
    await page.mouse.move(pane.x + 8, pane.y + pane.height / 2);
    await page.mouse.wheel(0, 180);
    await expect.poll(scrollTop).toBeGreaterThan(50); await pinned();
    const session = await page.context().newCDPSession(page);
    try {
      const before = await scrollTop(), x = pane.x + 8, y = pane.y + pane.height - 20;
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - Math.min(160, pane.height * .5) * step / 6 }] });
        await page.waitForTimeout(20);
      }
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(scrollTop).toBeGreaterThan(before); await pinned();
    } finally { await session.detach(); }
    await page.locator(".grain-detail > summary").click();
    for (const id of ["granularMix", "grainPreset", "nextGrainPreset", "randomGrainPreset", "granularSource", "loadGrainFile", "grainFreeze", "grainSize", "grainDensity", "grainPitch", "grainPattern", "grainSpread", "grainLookback", "grainScatter", "grainJitter", "grainReverse"]) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      expect(await hitVisible(page, `#${id}`), `${id} can be reached`).toBe(true);
      await pinned();
    }
    await loadFile(page);
    await page.locator("#grainPosition").scrollIntoViewIfNeeded();
    expect(await hitVisible(page, "#grainPosition")).toBe(true); await pinned();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.locator("#grainPreset").scrollIntoViewIfNeeded();
    await testInfo.attach(`granular-mobile-${viewport.width}.png`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
  });
});


test("SPARTIAL a late file decode preserves a newer instrument preset and never arms Audio", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeOfflineAudioContext = window.OfflineAudioContext;
    window.OfflineAudioContext = class extends NativeOfflineAudioContext {
      async decodeAudioData(bytes) {
        const decoded = await super.decodeAudioData(bytes);
        await new Promise(resolve => { window.finishGrainDecode = resolve; });
        return decoded;
      }
    };
  });
  await open(page);
  await page.locator("#grainFile").setInputFiles(sourceWave());
  await expect.poll(() => page.evaluate(() => typeof window.finishGrainDecode)).toBe("function");
  await page.locator("#preset").selectOption("grain-cloud");
  await page.evaluate(() => window.finishGrainDecode());
  await expect(page.locator("#grainFileStatus")).toContainText("tone-then-silence.wav");
  await expect(page.locator("#granularSource")).toHaveValue("additive");
  await expect(page.locator("#preset")).toHaveValue("grain-cloud");
  await expect(page.locator("#granularMix")).toHaveValue("0.65");
  await expect(page.locator("#clearGrainFile")).toBeEnabled();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#granularSource").selectOption("file");
  await expect(page.locator("#granularSource")).toHaveValue("file");
});


test("SPARTIAL MIDI program changes select the complete instrument rather than a texture bank", async ({ page }) => {
  await installFakeMidi(page); await open(page);
  await setRange(page, "level", .43);
  await page.locator(".header-settings-menu > summary").click();
  await enableFakeMidi(page);
  await page.locator(".header-settings-menu > summary").click();
  await sendMidi(page, [0xc0, 12]);
  await expect(page.locator("#preset")).toHaveValue("grain-cloud");
  await expect(page.locator("#spectrumPreset")).toHaveValue("soft");
  await expect(page.locator("#granularMix")).toHaveValue("0.65");
  await expect(page.locator("#grainSize")).toHaveValue("220");
  await expect(page.locator("#level")).toHaveValue("0.43");
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
});
