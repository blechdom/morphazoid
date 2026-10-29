import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

function wave(bytes) {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
  let channels, rate, block, data;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(at + 4), id = bytes.toString("ascii", at, at + 4);
    if (id === "fmt ") { channels = bytes.readUInt16LE(at + 10); rate = bytes.readUInt32LE(at + 12); block = bytes.readUInt16LE(at + 20); expect(bytes.readUInt16LE(at + 22)).toBe(24); }
    if (id === "data") data = bytes.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  const frames = data.length / block;
  const peaks = Array(channels).fill(0);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    peaks[channel] = Math.max(peaks[channel], Math.abs(data.readIntLE(frame * block + channel * 3, 3) / 8388608));
  }
  return { channels, rate, frames, data, peaks };
}
function zipFiles(bytes) {
  const files = new Map();
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    expect(bytes.readUInt16LE(at + 8)).toBe(0);
    const size = bytes.readUInt32LE(at + 18), length = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const name = bytes.toString("utf8", at + 30, at + 30 + length);
    const start = at + 30 + length + extra;
    files.set(name, bytes.subarray(start, start + size)); at = start + size;
  }
  return files;
}
async function download(page, id) {
  const pending = page.waitForEvent("download"); await page.locator(id).click();
  const file = await pending; expect(await file.failure()).toBeNull();
  return readFile(await file.path());
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); }, String(value));
}

test.beforeEach(async ({ page }) => {
  if (process.env.E2E_AUDIO_SILENT_SINK === "1") await page.addInitScript(() => {
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(options = {}) { super({ ...options, sinkId: { type: "none" } }); } };
  });
});

test("headphone monitoring exports matching isolated tracks and multichannel WAV for both layers", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("spartial.html");
  await expect(page.locator("#multitrackRecord")).toBeDisabled();
  await page.locator("#layout").evaluate(select => { select.value = "7-4-1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.locator("#routingMode").selectOption("focus");
  await page.locator("#target").selectOption({ label: "Rrs · channel 8" });
  await range(page, "cascade", 0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#holdButton").click();
  for (const mix of [0, 1]) {
    await range(page, "granularMix", mix);
    await page.waitForTimeout(500);
    await page.locator("#multitrackRecord").click();
    await expect(page.locator("#multitrackRecord")).toHaveText("Stop multitrack");
    await expect(page.locator("#layout")).toBeDisabled();
    await expect(page.locator("#omitLfe")).toBeDisabled();
    await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#multitrackTime")).not.toHaveText("00:00");
    await page.locator("#multitrackRecord").click();
    await expect(page.locator("#multitrackDialog")).toBeVisible();
    const multi = wave(await download(page, "#multitrackWav"));
    expect(multi.channels).toBe(12); expect(multi.frames).toBeGreaterThan(multi.rate / 2);
    expect(multi.peaks[7], `layer mix ${mix} reaches physical channel 8`).toBeGreaterThan(.001);
    expect(multi.peaks.filter((_, i) => i !== 7).every(peak => peak === 0)).toBe(true);
    const files = zipFiles(await download(page, "#multitrackZip"));
    const stems = [...files].filter(([name]) => name.endsWith(".wav"));
    expect(stems).toHaveLength(12);
    expect([...files.keys()].some(name => name.endsWith("/channel-map.txt"))).toBe(true);
    for (const [index, [name, bytes]] of stems.entries()) {
      expect(name.split("/").at(-1)).toMatch(new RegExp(`^${String(index + 1).padStart(2, "0")}-`));
      const mono = wave(bytes); expect(mono.channels).toBe(1); expect(mono.frames).toBe(multi.frames); expect(mono.rate).toBe(multi.rate);
      const expected = Buffer.alloc(mono.data.length);
      for (let frame = 0; frame < mono.frames; frame++) multi.data.copy(expected, frame * 3, (frame * 12 + index) * 3, (frame * 12 + index) * 3 + 3);
      expect(mono.data.equals(expected), `${name} matches the multichannel take byte-for-byte`).toBe(true);
    }
    await page.locator("#multitrackClose").click();
    await expect(page.locator("#multitrackRecord")).toHaveText("Export multitrack");
    await page.locator("#multitrackRecord").click(); await page.locator("#multitrackDiscard").click();
    await expect(page.locator("#multitrackRecord")).toHaveText("Record multitrack");
    await expect(page.locator("#layout")).toBeEnabled();
  }
  expect(errors).toEqual([]);
});

test("7.1 multitrack preserves silent LFE and can include it without shifting side channels", async ({ page }) => {
  await page.goto("spartial.html");
  await page.locator('[data-section="sound"] > summary').click();
  await page.locator("#layout").selectOption("7-1");
  await page.locator("#routingMode").selectOption("focus");
  await page.locator("#target").selectOption({ label: "Ls · channel 5" });
  await range(page, "cascade", 0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#holdButton").click();
  for (const { omit, channel } of [{ omit: true, channel: 5 }, { omit: false, channel: 4 }]) {
    await page.locator("#omitLfe").setChecked(omit);
    if (!omit) {
      await page.locator("#target").selectOption({ label: "LFE · channel 4" });
      // Let the held note's previous speaker fade before capturing its new patch.
      await page.waitForTimeout(500);
    }
    await page.locator("#multitrackRecord").click();
    await expect(page.locator("#layout")).toBeDisabled();
    await expect(page.locator("#omitLfe")).toBeDisabled();
    await page.waitForTimeout(650);
    await page.locator("#multitrackRecord").click();
    await expect(page.locator("#multitrackDialog")).toBeVisible();
    const take = wave(await download(page, "#multitrackWav"));
    expect(take.channels).toBe(8);
    expect(take.peaks[channel - 1]).toBeGreaterThan(.001);
    expect(take.peaks.filter((_, index) => index !== channel - 1)).toEqual(Array(7).fill(0));
    await page.locator("#multitrackDiscard").click();
  }
  await expect(page.locator("#holdButton")).toHaveAttribute("aria-pressed", "true");
});

test("multitrack capture retains its physical map through monitor rebuilds", async ({ page }) => {
  await page.goto("/");
  const count = await page.evaluate(async () => {
    const { SpartialAudio, spartialLayout, spartialSpeakers } = await import("/src/instruments/spartial/spartial-audio.js");
    let runs = 0;
    for (const layoutId of ["4-ring", "4-1", "7-1", "8-circle", "8-cube", "7-4-1", "16-ring"]) for (const omitLfe of [true, false]) {
      const context = new OfflineAudioContext(32, 4096, 48000);
      Object.defineProperty(context, "state", { get: () => "running" });
      const audio = new SpartialAudio();
      Object.assign(audio, { context, enabled: true, layoutId, omitLfe, forcePreview: true, master: context.createGain() });
      audio.master.channelInterpretation = "discrete"; audio.master.gain.value = .5;
      audio.rebuildRoutes();
      const output = context.createChannelMerger(32), split = context.createChannelSplitter(16);
      for (let i = 0; i < 16; i++) split.connect(output, i, 16 + i);
      output.connect(context.destination);
      const release = audio.tapInto(context, split);
      audio.rebuildRoutes(); // Previously master.disconnect() would detach this tap.
      context.destination.channelCount = 32; context.destination.channelInterpretation = "discrete";
      const speakers = spartialSpeakers(spartialLayout(layoutId), omitLfe);
      const source = context.createBufferSource(); source.buffer = context.createBuffer(16, 4096, 48000); source.channelInterpretation = "discrete";
      speakers.forEach((_, index) => source.buffer.getChannelData(index).fill(.125, index * 128, index * 128 + 128));
      source.connect(audio.master); source.start();
      const rendered = await context.startRendering();
      speakers.forEach((speaker, index) => {
        for (let lane = 0; lane < 16; lane++) {
          const actual = rendered.getChannelData(16 + lane)[index * 128 + 64], expected = lane === speaker.channel - 1 ? .0625 : 0;
          if (Math.abs(actual - expected) > 1e-7) throw new Error(`${layoutId} omit ${omitLfe}: channel ${lane + 1} for ${speaker.label}: ${actual}`);
        }
      });
      release(); release();
      if (audio.captureTaps.size) throw new Error("Capture tap leaked");
      audio.releaseOutput(); audio.master.disconnect(); for (const node of audio.routes) node.disconnect(); output.disconnect(); split.disconnect();
      runs++;
    }
    return runs;
  });
  expect(count).toBe(14);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`record control is above presets and reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await page.goto("spartial.html");
    await expect(page.locator(".spartial-panel .header-preset-controls")).toBeVisible();
    await page.locator("#multitrackRecord").scrollIntoViewIfNeeded();
    const result = await page.evaluate(() => {
      const button = document.querySelector("#multitrackRecord").getBoundingClientRect();
      const preset = document.querySelector(".spartial-panel .header-preset-controls").getBoundingClientRect();
      return { height: button.height, above: button.bottom <= preset.top, right: button.right, left: button.left, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(result.height).toBeGreaterThanOrEqual(48); expect(result.above).toBe(true); expect(result.overflow).toBe(false);
    expect(result.right).toBeLessThanOrEqual(viewport.width); expect(result.left).toBeGreaterThanOrEqual(0);
  });
}

test("Audio off finishes the take; cancelling folder export preserves both download choices", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.showDirectoryPicker = () => Promise.reject(new DOMException("Cancelled", "AbortError"));
  });
  await page.goto("spartial.html");
  await page.locator("#audioButton").click(); await page.locator("#holdButton").click();
  await page.locator("#multitrackRecord").click();
  await expect(page.locator("#multitrackTime")).not.toHaveText("00:00");
  await page.locator("#audioButton").click();
  await expect(page.locator("#multitrackDialog")).toBeVisible();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  const bounds = await page.locator("#multitrackDialog").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.height).toBeLessThanOrEqual(844);
  await page.locator("#multitrackFolder").click();
  await expect(page.locator("#multitrackMessage")).toContainText("Save cancelled");
  await expect(page.locator("#multitrackWav")).toBeEnabled(); await expect(page.locator("#multitrackZip")).toBeEnabled();
  expect(wave(await download(page, "#multitrackWav")).frames).toBeGreaterThan(0);
  await page.locator("#multitrackDiscard").click();
  await expect(page.locator("#multitrackRecord")).toBeDisabled();
});

test("cancelling module startup releases speaker setup without arming Audio", async ({ page }) => {
  await page.addInitScript(() => {
    const load = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = function(url, ...options) {
      const loaded = load.call(this, url, ...options);
      return String(url).includes("output-recorder-processor.js")
        ? Promise.all([loaded, new Promise(resolve => { window.releaseRecordingModule = resolve; })]) : loaded;
    };
  });
  await page.goto("spartial.html"); await page.locator("#audioButton").click();
  await page.locator("#multitrackRecord").click();
  await expect(page.locator("#multitrackRecord")).toHaveText("Cancel recording");
  await expect(page.locator("#layout")).toBeDisabled();
  await page.locator("#multitrackRecord").click();
  await page.evaluate(() => window.releaseRecordingModule());
  await expect(page.locator("#layout")).toBeEnabled();
  // A cancelled startup can have an empty take, which is safe to discard.
  if (await page.locator("#multitrackDialog").isVisible()) await page.locator("#multitrackDiscard").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#multitrackRecord")).toHaveText("Record multitrack");
});
