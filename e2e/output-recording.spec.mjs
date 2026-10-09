import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const RECORD_BUTTON = ".output-recording-button";
const RECORD_DIALOG = ".output-recording-dialog";
const RECORD_NAME = ".output-recording-name";
const RECORD_MODE = ".output-recording-mode";

function readStereoWave(bytes) {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
  expect(bytes.readUInt32LE(4) + 8, "finalized RIFF size").toBe(bytes.length);
  let format;
  let payload;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    expect(offset + 8 + length, `${id} chunk fits its file`).toBeLessThanOrEqual(bytes.length);
    if (id === "fmt ") {
      format = {
        code: bytes.readUInt16LE(offset + 8),
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        byteRate: bytes.readUInt32LE(offset + 16),
        blockAlign: bytes.readUInt16LE(offset + 20),
        bits: bytes.readUInt16LE(offset + 22),
      };
    }
    if (id === "data") payload = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  expect(format).toBeDefined();
  expect(format.code).toBe(1);
  expect(format.channels).toBe(2);
  expect(format.bits).toBe(24);
  expect(format.blockAlign).toBe(6);
  expect(format.byteRate).toBe(format.sampleRate * 6);
  expect(payload).toBeDefined();
  expect(payload.length % 6).toBe(0);
  const frames = payload.length / 6;
  const channels = [new Float64Array(frames), new Float64Array(frames)];
  for (let frame = 0; frame < frames; frame += 1) {
    for (let side = 0; side < 2; side += 1) {
      channels[side][frame] = payload.readIntLE(frame * 6 + side * 3, 3) / 0x800000;
    }
  }
  return { ...format, frames, duration: frames / format.sampleRate, channels };
}

function signalRms(samples, from = 0, to = samples.length) {
  let squares = 0;
  for (let frame = from; frame < to; frame += 1) squares += samples[frame] ** 2;
  return Math.sqrt(squares / Math.max(1, to - from));
}

function toneAmplitude(samples, sampleRate, frequency, from, to) {
  let real = 0;
  let imaginary = 0;
  for (let frame = from; frame < to; frame += 1) {
    const phase = 2 * Math.PI * frequency * frame / sampleRate;
    real += samples[frame] * Math.cos(phase);
    imaginary += samples[frame] * Math.sin(phase);
  }
  return 2 * Math.hypot(real, imaginary) / (to - from);
}

function expectStereoTones(wave, {
  leftFrequency = 347, rightFrequency = 911, leftGain = 0.25, rightGain = 0.125,
  from = Math.floor(wave.frames * 0.2), to = Math.floor(wave.frames * 0.8),
} = {}) {
  const left = toneAmplitude(wave.channels[0], wave.sampleRate, leftFrequency, from, to);
  const right = toneAmplitude(wave.channels[1], wave.sampleRate, rightFrequency, from, to);
  expect(left, "left channel preserves its post-master level").toBeGreaterThan(leftGain * 0.85);
  expect(left).toBeLessThan(leftGain * 1.15);
  expect(right, "right channel preserves its distinct level").toBeGreaterThan(rightGain * 0.85);
  expect(right).toBeLessThan(rightGain * 1.15);
  expect(toneAmplitude(wave.channels[0], wave.sampleRate, rightFrequency, from, to), "no right-to-left fold-down")
    .toBeLessThan(rightGain * 0.08);
  expect(toneAmplitude(wave.channels[1], wave.sampleRate, leftFrequency, from, to), "no left-to-right fold-down")
    .toBeLessThan(leftGain * 0.08);
}

async function useDownloadFallback(page) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "showSaveFilePicker", { configurable: true, value: undefined });
  });
}

// Only the filesystem boundary is fake. Web Audio, the bridge, recording
// worklet, PCM encoding and final WAV header all run in the real browser.
async function installFilePicker(page) {
  await page.addInitScript(() => {
    const state = {
      calls: [], files: [], cancelNext: false, failNextWrite: false,
      writing: 0, maxConcurrentWrites: 0,
    };
    globalThis.__recordingFilePicker = state;
    Object.defineProperty(globalThis, "showSaveFilePicker", {
      configurable: true,
      value: async (options) => {
        state.calls.push(options);
        if (state.cancelNext) {
          state.cancelNext = false;
          throw new DOMException("Picker cancelled", "AbortError");
        }
        const file = { bytes: new Uint8Array(0), cursor: 0, closed: false, aborted: false, writes: [] };
        state.files.push(file);
        const writer = {
          async write(value) {
            state.writing += 1;
            state.maxConcurrentWrites = Math.max(state.maxConcurrentWrites, state.writing);
            try {
              await new Promise(resolve => setTimeout(resolve, 3));
              if (state.failNextWrite) {
                state.failNextWrite = false;
                throw new DOMException("Simulated disk write failure", "QuotaExceededError");
              }
              let data = value;
              if (value?.type === "seek") { file.cursor = value.position; return; }
              if (value?.type === "truncate") { await writer.truncate(value.size); return; }
              if (value?.type === "write") {
                if (value.position !== undefined) file.cursor = value.position;
                data = value.data;
              }
              const bytes = data instanceof Blob
                ? new Uint8Array(await data.arrayBuffer())
                : ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new TextEncoder().encode(String(data));
              const end = file.cursor + bytes.length;
              if (end > file.bytes.length) {
                const grown = new Uint8Array(end);
                grown.set(file.bytes);
                file.bytes = grown;
              }
              file.writes.push({ position: file.cursor, length: bytes.length });
              file.bytes.set(bytes, file.cursor);
              file.cursor = end;
            } finally {
              state.writing -= 1;
            }
          },
          async seek(position) { file.cursor = position; },
          async truncate(size) {
            const resized = new Uint8Array(size);
            resized.set(file.bytes.subarray(0, size));
            file.bytes = resized;
          },
          async close() {
            if (state.writing) throw new Error("File closed before pending PCM writes completed");
            file.closed = true;
          },
          async abort() { file.aborted = true; },
        };
        return { name: options?.suggestedName || "recording.wav", createWritable: async () => writer };
      },
    });
  });
}

async function readPickedFile(page, index = 0) {
  const result = await page.evaluate((fileIndex) => {
    const state = globalThis.__recordingFilePicker;
    const file = state.files[fileIndex];
    let binary = "";
    for (let offset = 0; offset < file.bytes.length; offset += 0x4000) {
      binary += String.fromCharCode(...file.bytes.subarray(offset, offset + 0x4000));
    }
    return { base64: btoa(binary), closed: file.closed, aborted: file.aborted,
      writes: file.writes, maxConcurrentWrites: state.maxConcurrentWrites, calls: state.calls };
  }, index);
  return { ...result, bytes: Buffer.from(result.base64, "base64") };
}

async function openInstrument(page) {
  await page.goto("karplus-strong.html");
  await expect(page.locator(RECORD_BUTTON)).toHaveCount(1);
  await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Record stereo output");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
}

async function addStereoSource(page, { leftGain = 0.25, rightGain = 0.125, leftFrequency = 347, rightFrequency = 911 } = {}) {
  return page.evaluate(async (configuration) => {
    const { connectAudioOutput, getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const context = new AudioContext({ sampleRate: 48_000 });
    await context.resume();
    const output = context.createChannelMerger(2);
    const oscillators = [];
    const gains = [];
    for (let channel = 0; channel < 2; channel += 1) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = channel ? configuration.rightFrequency : configuration.leftFrequency;
      gain.gain.value = channel ? configuration.rightGain : configuration.leftGain;
      oscillator.connect(gain).connect(output, 0, channel);
      oscillator.start();
      oscillators.push(oscillator);
      gains.push(gain);
    }
    const fixture = { context, output, oscillators, gains, audibleConnected: false, audibleDisconnects: 0 };
    // Track only this fixture's actual destination connection, preserving all
    // native AudioNode behavior. An analyser alone cannot prove that the
    // recorder left the speaker route connected.
    const connect = output.connect.bind(output);
    const disconnect = output.disconnect.bind(output);
    output.connect = (...args) => {
      const result = connect(...args);
      if (args[0] === context.destination) fixture.audibleConnected = true;
      return result;
    };
    output.disconnect = (...args) => {
      const result = disconnect(...args);
      if (!args.length || args[0] === context.destination) {
        fixture.audibleConnected = false;
        fixture.audibleDisconnects += 1;
      }
      return result;
    };
    fixture.release = connectAudioOutput(context, output);
    fixture.analyser = context.createAnalyser();
    output.connect(fixture.analyser);
    const fixtures = globalThis.__recordingTestSources ??= [];
    fixtures.push(fixture);
    return { index: fixtures.length - 1, connections: getSharedAudioOutputManager().connectionCount() };
  }, { leftGain, rightGain, leftFrequency, rightFrequency });
}

async function releaseStereoSource(page, index) {
  await page.evaluate(async (sourceIndex) => {
    const fixture = globalThis.__recordingTestSources[sourceIndex];
    fixture.release();
    for (const oscillator of fixture.oscillators) oscillator.stop();
    await fixture.context.close();
  }, index);
}

async function expectAudibleRoute(page, index) {
  const output = await page.evaluate((sourceIndex) => {
    const fixture = globalThis.__recordingTestSources[sourceIndex];
    const samples = new Float32Array(fixture.analyser.fftSize);
    fixture.analyser.getFloatTimeDomainData(samples);
    return { connected: fixture.audibleConnected, disconnects: fixture.audibleDisconnects,
      context: fixture.context.state, peak: Math.max(...samples.map(Math.abs)) };
  }, index);
  expect(output.connected, "recording must preserve the speaker route").toBe(true);
  expect(output.disconnects).toBe(0);
  expect(output.context).toBe("running");
  expect(output.peak).toBeGreaterThan(0.01);
}

async function startRecording(page) {
  await page.locator(RECORD_BUTTON).click();
  await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Stop recording");
  await expect(page.locator(".output-recording-clock")).toBeVisible();
}

async function stopRecording(page) {
  await page.locator(RECORD_BUTTON).click();
  await expect(page.locator(RECORD_DIALOG)).toBeVisible();
}

async function downloadTake(page, name = "stereo-output-contract") {
  await page.locator(RECORD_NAME).fill(name);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${name}.wav`);
  expect(await download.failure()).toBeNull();
  return readFile(await download.path());
}

test("records independent stereo channels as 24-bit WAV and flushes the final partial chunk", async ({ page }, testInfo) => {
  await useDownloadFallback(page);
  await openInstrument(page);
  const source = await addStereoSource(page);
  await startRecording(page);
  await expectAudibleRoute(page, source.index);
  await page.waitForTimeout(1173);
  await stopRecording(page);
  await expectAudibleRoute(page, source.index);
  const bytes = await downloadTake(page);
  const wave = readStereoWave(bytes);
  expect(wave.duration).toBeGreaterThan(0.9);
  expect(wave.duration).toBeLessThan(4);
  expectStereoTones(wave);
  for (const channel of wave.channels) {
    expect(signalRms(channel, Math.max(0, wave.frames - 128)), "stop does not pad the last chunk with silence")
      .toBeGreaterThan(0.025);
  }
  await testInfo.attach("stereo-output.wav", { body: bytes, contentType: "audio/wav" });
  await releaseStereoSource(page, source.index);
});

test("a take follows released and newly created output contexts without losing channel identity", async ({ page }) => {
  await useDownloadFallback(page);
  await openInstrument(page);
  const first = await addStereoSource(page);
  await startRecording(page);
  await page.waitForTimeout(650);
  await releaseStereoSource(page, first.index);
  const secondTones = { leftGain: 0.075, rightGain: 0.225, leftFrequency: 503, rightFrequency: 1103 };
  const second = await addStereoSource(page, secondTones);
  await page.waitForTimeout(750);
  await stopRecording(page);
  const wave = readStereoWave(await downloadTake(page, "context-replacement"));
  expectStereoTones(wave, { from: Math.floor(wave.frames * 0.12), to: Math.floor(wave.frames * 0.32) });
  expectStereoTones(wave, { ...secondTones, from: Math.floor(wave.frames * 0.72), to: Math.floor(wave.frames * 0.92) });
  await expectAudibleRoute(page, second.index);
  await releaseStereoSource(page, second.index);
});

test("direct-file capture writes PCM incrementally, survives repeated controls and finalizes one valid file", async ({ page }) => {
  await installFilePicker(page);
  await openInstrument(page);
  const source = await addStereoSource(page);
  await page.locator(".header-settings-trigger").click();
  await page.locator(RECORD_MODE).selectOption("file");
  await page.locator(".header-settings-trigger").click();
  await page.locator(RECORD_BUTTON).evaluate(button => { button.click(); button.click(); });
  await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Stop recording");
  await expect.poll(() => page.evaluate(() => {
    const file = globalThis.__recordingFilePicker.files[0];
    return file?.writes.filter(write => write.position > 0).length ?? 0;
  })).toBeGreaterThan(1);
  const active = await page.evaluate(() => ({
    calls: globalThis.__recordingFilePicker.calls.length,
    files: globalThis.__recordingFilePicker.files.length,
    closed: globalThis.__recordingFilePicker.files[0].closed,
  }));
  expect(active).toEqual({ calls: 1, files: 1, closed: false });
  await page.waitForTimeout(450);
  await page.locator(RECORD_BUTTON).evaluate(button => { button.click(); button.click(); });
  await expect(page.locator(RECORD_DIALOG)).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.__recordingFilePicker.files[0].closed)).toBe(true);
  const file = await readPickedFile(page);
  expect(file.calls).toHaveLength(1);
  expect(file.aborted).toBe(false);
  expect(file.maxConcurrentWrites).toBe(1);
  expect(file.writes.filter(write => write.position === 0).length, "placeholder then final WAV header").toBeGreaterThanOrEqual(2);
  expectStereoTones(readStereoWave(file.bytes));
  await expectAudibleRoute(page, source.index);
  await page.getByRole("button", { name: "New recording", exact: true }).click();
  await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Record stereo output");
  await releaseStereoSource(page, source.index);
});

test("cancelling a direct-file picker leaves Audio running and starts no recording", async ({ page }) => {
  await installFilePicker(page);
  await openInstrument(page);
  const source = await addStereoSource(page);
  await page.locator(".header-settings-trigger").click();
  await page.locator(RECORD_MODE).selectOption("file");
  await page.locator(".header-settings-trigger").click();
  await page.evaluate(() => { globalThis.__recordingFilePicker.cancelNext = true; });
  await page.locator(RECORD_BUTTON).click();
  await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Record stereo output");
  await expect(page.locator(RECORD_BUTTON)).toBeEnabled();
  expect(await page.evaluate(() => globalThis.__recordingFilePicker.files.length)).toBe(0);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expectAudibleRoute(page, source.index);
  await startRecording(page);
  await page.waitForTimeout(350);
  await stopRecording(page);
  expect((await readPickedFile(page)).closed).toBe(true);
  await releaseStereoSource(page, source.index);
});

test("cancelling Save WAV and keeping a take for later preserves its name and recorded audio", async ({ page }) => {
  await installFilePicker(page);
  await openInstrument(page);
  const source = await addStereoSource(page);
  await startRecording(page);
  await page.waitForTimeout(600);
  await stopRecording(page);
  await page.locator(RECORD_NAME).fill("keep-this-performance");
  await page.evaluate(() => { globalThis.__recordingFilePicker.cancelNext = true; });
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  await expect(page.locator(RECORD_DIALOG)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save WAV", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => globalThis.__recordingFilePicker.files.length)).toBe(0);
  await page.getByRole("button", { name: "Keep for later", exact: true }).click();
  await expect(page.locator(RECORD_DIALOG)).not.toBeVisible();
  await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Save recording");
  await page.locator(RECORD_BUTTON).click();
  await expect(page.locator(RECORD_NAME)).toHaveValue("keep-this-performance.wav");
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__recordingFilePicker.files[0]?.closed)).toBe(true);
  const file = await readPickedFile(page);
  expect(file.calls).toHaveLength(2);
  for (const call of file.calls) expect(call.suggestedName).toBe("keep-this-performance.wav");
  expectStereoTones(readStereoWave(file.bytes));
  await expectAudibleRoute(page, source.index);
  await releaseStereoSource(page, source.index);
});

test("a direct-file write failure stops capture without claiming the take was saved", async ({ page }) => {
  await installFilePicker(page);
  await openInstrument(page);
  const source = await addStereoSource(page);
  await page.locator(".header-settings-trigger").click();
  await page.locator(RECORD_MODE).selectOption("file");
  await page.locator(".header-settings-trigger").click();
  await startRecording(page);
  await expect.poll(() => page.evaluate(() => globalThis.__recordingFilePicker.files[0]?.writes.length ?? 0))
    .toBeGreaterThan(1);
  await page.evaluate(() => { globalThis.__recordingFilePicker.failNextWrite = true; });
  await expect(page.locator(RECORD_DIALOG)).toBeVisible();
  await expect(page.locator(".output-recording-message")).toContainText(/write|written|disk|storage|quota/i);
  await expect(page.locator(`${RECORD_DIALOG} h2`)).not.toHaveText("Recording saved");
  await expect(page.locator(RECORD_BUTTON)).not.toHaveAccessibleName("Stop recording");
  await expectAudibleRoute(page, source.index);
  await releaseStereoSource(page, source.index);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test.describe(`output recording ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 900 });
    test("keeps Record, Audio, Settings and the save dialog reachable without duplicate controls", async ({ page }) => {
      await useDownloadFallback(page);
      await page.goto("karplus-strong.html");
      await expect(page.locator(RECORD_BUTTON)).toBeVisible();
      await expect(page.locator(RECORD_BUTTON)).toHaveCount(1);
      await expect(page.locator(RECORD_BUTTON)).toBeDisabled();
      await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
      await page.evaluate(async () => {
        const { initializeMidiToolbars } = await import("/nav.js");
        initializeMidiToolbars(document, globalThis);
      });
      await expect(page.locator(RECORD_BUTTON)).toHaveCount(1);
      for (const selector of [RECORD_BUTTON, "#audioButton", ".header-settings-trigger"]) {
        const box = await page.locator(selector).boundingBox();
        expect(box).not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        if (viewport.width < 900) {
          expect(box.width).toBeGreaterThanOrEqual(48);
          expect(box.height).toBeGreaterThanOrEqual(48);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width + 1);
      await page.locator("#audioButton").click();
      const source = await addStereoSource(page);
      await startRecording(page);
      await page.waitForTimeout(350);
      await stopRecording(page);
      const dialog = await page.locator(RECORD_DIALOG).boundingBox();
      expect(dialog.x).toBeGreaterThanOrEqual(0);
      expect(dialog.y).toBeGreaterThanOrEqual(0);
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(viewport.height + 1);
      await expect(page.locator(RECORD_NAME)).toBeEditable();
      await expect(page.getByRole("button", { name: "Save WAV", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Keep for later", exact: true }).click();
      await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Save recording");
      await releaseStereoSource(page, source.index);
    });
  });
}
