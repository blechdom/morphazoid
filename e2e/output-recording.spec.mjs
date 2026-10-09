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
      denyNextCreateWritable: false,
      stallNextWrite: false, stallNextAbort: false,
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
        const file = { bytes: new Uint8Array(0), cursor: 0, closed: false, closeCalls: 0, aborted: false, writes: [] };
        state.files.push(file);
        const writer = {
          async write(value) {
            state.writing += 1;
            state.maxConcurrentWrites = Math.max(state.maxConcurrentWrites, state.writing);
            try {
              await new Promise(resolve => setTimeout(resolve, 3));
              if (state.stallNextWrite) {
                state.stallNextWrite = false;
                await new Promise((resolve, reject) => { file.rejectPendingWrite = reject; });
              }
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
            file.closeCalls += 1;
            if (state.writing) throw new Error("File closed before pending PCM writes completed");
            file.closed = true;
          },
          async abort() {
            file.aborted = true;
            file.rejectPendingWrite?.(new DOMException("Write aborted", "AbortError"));
            if (state.stallNextAbort) {
              state.stallNextAbort = false;
              await new Promise(() => {});
            }
          },
        };
        return {
          name: options?.suggestedName || "recording.wav",
          createWritable: async () => {
            if (state.denyNextCreateWritable) {
              state.denyNextCreateWritable = false;
              throw new DOMException("The browser denied write access", "NotAllowedError");
            }
            return writer;
          },
        };
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
    return { base64: btoa(binary), closed: file.closed, closeCalls: file.closeCalls, aborted: file.aborted,
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
    const existing = getSharedAudioOutputManager().recordingContext();
    const context = existing ?? new AudioContext({ sampleRate: 48_000 });
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
    const fixture = { context, ownsContext: !existing, output, oscillators, gains, audibleConnected: false, audibleDisconnects: 0 };
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
    if (fixture.ownsContext) await fixture.context.close();
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

async function downloadTake(page, name = "stereo-output-contract", { buttonName = "Save WAV" } = {}) {
  await page.locator(RECORD_NAME).fill(name);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${name}.wav`);
  expect(await download.failure()).toBeNull();
  return readFile(await download.path());
}

test("Record follows the Audio button when an engine mutes without suspending its context", async ({ page }) => {
  await useDownloadFallback(page);
  await openInstrument(page);
  await expect(page.locator(RECORD_BUTTON)).toBeEnabled();
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(RECORD_BUTTON)).toBeDisabled();
  const output = await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    return getSharedAudioOutputManager().getStatus();
  });
  expect(output.connectionCount, "Audio off preserves Karplus Strong's prepared graph").toBeGreaterThan(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(RECORD_BUTTON)).toBeEnabled();
  await expect(page.locator(RECORD_BUTTON)).toHaveCount(1);
});

for (const route of [
  "l-mic-rust.html", "l-system-parametric-lab.html", "l-system-experiments.html",
  "fractal-synthesis.html", "birdsong-lab.html", "crickets.html",
  "acoustic-manifold.html", "nightingale-manifold.html",
]) {
  test(`${route}: custom and dynamically created headers expose one output Record control`, async ({ page }) => {
    await useDownloadFallback(page);
    await page.goto(route);
    await expect(page.locator(RECORD_BUTTON)).toHaveCount(1);
    await expect(page.locator(RECORD_BUTTON)).toBeVisible();
    await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Record stereo output");
    await expect(page.locator(RECORD_BUTTON)).toBeDisabled();
    await expect(page.locator(RECORD_DIALOG)).toHaveCount(1);
  });
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
    let longestSilence = 0, run = 0;
    for (const sample of channel) {
      run = sample === 0 ? run + 1 : 0;
      longestSilence = Math.max(longestSilence, run);
    }
    expect(longestSilence, "continuous output has no inserted silence blocks").toBeLessThan(3);
    expect(signalRms(channel, Math.max(0, wave.frames - 128)), "stop does not pad the last chunk with silence")
      .toBeGreaterThan(0.025);
  }
  await testInfo.attach("stereo-output.wav", { body: bytes, contentType: "audio/wav" });
  await releaseStereoSource(page, source.index);
});

test("a take follows released and newly connected main-output sources without losing channel identity", async ({ page }) => {
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
  const wave = readStereoWave(await downloadTake(page, "source-replacement"));
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
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
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

test("a denied same-name Save WAV retry retains the exact take for Download WAV", async ({ page }) => {
  await installFilePicker(page);
  const downloads = [];
  page.on("download", download => downloads.push(download));
  await openInstrument(page);
  const source = await addStereoSource(page);
  await startRecording(page);
  await page.waitForTimeout(600);
  await stopRecording(page);
  await page.locator(RECORD_NAME).fill("same-name-take");
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__recordingFilePicker.files[0]?.closed)).toBe(true);
  const saved = await readPickedFile(page);

  await page.evaluate(() => { globalThis.__recordingFilePicker.denyNextCreateWritable = true; });
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  await expect(page.locator(".output-recording-message")).toContainText(/did not allow writing/i);
  await expect(page.locator(".output-recording-message")).toContainText("Download WAV");
  await expect(page.locator(RECORD_NAME)).toHaveValue("same-name-take.wav");
  await expect(page.locator(RECORD_NAME)).toBeEditable();
  for (const label of ["Save WAV", "Download WAV", "Cancel", "New recording"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeEnabled();
  }
  expect(downloads, "write denial must leave the download choice to the user").toHaveLength(0);
  const denied = await readPickedFile(page, 1);
  expect(denied.calls.map(call => call.suggestedName)).toEqual(["same-name-take.wav", "same-name-take.wav"]);
  expect(denied.writes).toEqual([]);
  expect(denied.closed).toBe(false);

  const downloaded = await downloadTake(page, "same-name-take", { buttonName: "Download WAV" });
  expect(downloaded.equals(saved.bytes), "fallback downloads the original take byte-for-byte").toBe(true);
  expectStereoTones(readStereoWave(downloaded));
  expect(await page.evaluate(() => globalThis.__recordingFilePicker.calls.length)).toBe(2);
  expect(downloads).toHaveLength(1);
  await expect(page.locator(RECORD_NAME)).toHaveValue("same-name-take.wav");
  await expectAudibleRoute(page, source.index);
  await releaseStereoSource(page, source.index);
});

test("Download WAV bypasses an advertised picker and retains the unsaved-take navigation guard", async ({ page }) => {
  await installFilePicker(page);
  await openInstrument(page);
  const source = await addStereoSource(page);
  await startRecording(page);
  await page.waitForTimeout(600);
  await stopRecording(page);
  await expect(page.getByRole("button", { name: "Save WAV", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download WAV", exact: true })).toBeVisible();
  const bytes = await downloadTake(page, "embedded-browser-take", { buttonName: "Download WAV" });
  expectStereoTones(readStereoWave(bytes));
  expect(await page.evaluate(() => globalThis.__recordingFilePicker.calls.length)).toBe(0);
  await expect(page.locator(`${RECORD_DIALOG} h2`)).not.toHaveText("Recording saved");

  const originalURL = page.url();
  const confirmationPromise = page.waitForEvent("dialog");
  const navigation = page.goto("settings.html").catch(() => {});
  const confirmation = await confirmationPromise;
  expect(confirmation.type()).toBe("beforeunload");
  await confirmation.dismiss();
  await navigation;
  await expect(page).toHaveURL(originalURL);
  await expect(page.locator(RECORD_NAME)).toHaveValue("embedded-browser-take.wav");
  await expect(page.locator(RECORD_DIALOG)).toBeVisible();
  await expectAudibleRoute(page, source.index);
  await releaseStereoSource(page, source.index);
});

test("repeated successful Save WAV with the same name uses fresh file handles and closes each once", async ({ page }) => {
  await installFilePicker(page);
  await openInstrument(page);
  const source = await addStereoSource(page);
  await startRecording(page);
  await page.waitForTimeout(600);
  await stopRecording(page);
  await page.locator(RECORD_NAME).fill("repeat-save");
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole("button", { name: "Save WAV", exact: true }).click();
    await expect.poll(() => page.evaluate(index => globalThis.__recordingFilePicker.files[index]?.closed, index)).toBe(true);
  }
  const first = await readPickedFile(page);
  const second = await readPickedFile(page, 1);
  expect(second.calls.map(call => call.suggestedName)).toEqual(["repeat-save.wav", "repeat-save.wav"]);
  expect(first.closeCalls).toBe(1);
  expect(second.closeCalls).toBe(1);
  expect(first.aborted || second.aborted).toBe(false);
  expect(second.bytes.equals(first.bytes)).toBe(true);
  expectStereoTones(readStereoWave(second.bytes));
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
      await installFilePicker(page);
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
      for (const label of ["Save WAV", "Download WAV", "New recording", "Cancel"]) {
        const action = page.getByRole("button", { name: label, exact: true });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeInViewport();
        await expect(action).toBeEnabled();
      }
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Save recording");
      await releaseStereoSource(page, source.index);
    });
  });
}

async function addClockedTones(page) {
  await page.evaluate(async () => {
    const { connectAudioOutput, getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const context = getSharedAudioOutputManager().recordingContext();
    const output = context.createChannelMerger(2);
    const oscillators = [];
    for (const [channel, frequency, level] of [[0, 347, 0.25], [1, 911, 0.125]]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.value = level;
      oscillator.connect(gain).connect(output, 0, channel);
      oscillator.start();
      oscillators.push(oscillator);
    }
    globalThis.__recordingClockFixture = {
      context, output, oscillators, release: connectAudioOutput(context, output),
    };
  });
}

async function releaseClockedTones(page) {
  await page.evaluate(() => {
    const fixture = globalThis.__recordingClockFixture;
    fixture.release();
    for (const oscillator of fixture.oscillators) oscillator.stop();
    fixture.output.disconnect();
  });
}

test("stereo WAV remains continuous through a 500 ms main-thread stall", async ({ page }, testInfo) => {
  await useDownloadFallback(page);
  await openInstrument(page);
  await addClockedTones(page);
  await startRecording(page);
  await page.waitForTimeout(350);
  const stall = await page.evaluate(() => {
    const context = globalThis.__recordingClockFixture.context;
    const startedAt = performance.now();
    const startedAudio = context.currentTime;
    // Intentionally block JavaScript, timers and message delivery while the
    // real AudioWorklet and native oscillator graph continue rendering.
    while (performance.now() - startedAt < 500) { /* Deliberate UI stall. */ }
    return { milliseconds: performance.now() - startedAt, audioSeconds: context.currentTime - startedAudio };
  });
  expect(stall.milliseconds).toBeGreaterThanOrEqual(500);
  expect(stall.audioSeconds, "the audio clock advances while JavaScript is blocked").toBeGreaterThan(0.35);
  await expect(page.locator(RECORD_BUTTON)).toHaveAccessibleName("Stop recording");
  await page.waitForTimeout(400);
  await stopRecording(page);
  const bytes = await downloadTake(page, "main-thread-stall");
  const wave = readStereoWave(bytes);
  expect(wave.duration, "the stalled half-second is present in the saved take").toBeGreaterThan(1.0);
  expectStereoTones(wave);
  const continuity = wave.channels.map((samples, channel) => {
    const frequency = channel ? 911 : 347;
    const level = channel ? 0.125 : 0.25;
    const from = 128;
    const to = samples.length - 128;
    let cc = 0, ss = 0, cs = 0, xc = 0, xs = 0, maxStep = 0;
    for (let frame = from; frame < to; frame += 1) {
      const phase = 2 * Math.PI * frequency * frame / wave.sampleRate;
      const c = Math.cos(phase), s = Math.sin(phase);
      cc += c * c; ss += s * s; cs += c * s;
      xc += samples[frame] * c; xs += samples[frame] * s;
      maxStep = Math.max(maxStep, Math.abs(samples[frame] - samples[frame - 1]));
    }
    // Fit one phase across the complete recording. Dropped/repeated render
    // blocks or a silent hole cannot pass by merely containing the right tone.
    const determinant = cc * ss - cs * cs;
    const a = (xc * ss - xs * cs) / determinant;
    const b = (xs * cc - xc * cs) / determinant;
    let residual = 0;
    for (let frame = from; frame < to; frame += 1) {
      const phase = 2 * Math.PI * frequency * frame / wave.sampleRate;
      residual += (samples[frame] - a * Math.cos(phase) - b * Math.sin(phase)) ** 2;
    }
    const residualRms = Math.sqrt(residual / (to - from));
    const largestSineStep = 2 * level * Math.sin(Math.PI * frequency / wave.sampleRate);
    expect(residualRms, `channel ${channel + 1} has one continuous oscillator phase`).toBeLessThan(0.0001);
    expect(maxStep, `channel ${channel + 1} contains no sample discontinuity`).toBeLessThan(largestSineStep * 1.02 + 0.000001);
    return { channel: channel + 1, residualRms, maxStep, largestSineStep };
  });
  await testInfo.attach("main-thread-stall-continuity.json", {
    body: JSON.stringify({ stall, duration: wave.duration, sampleRate: wave.sampleRate, continuity }, null, 2),
    contentType: "application/json",
  });
  await releaseClockedTones(page);
});

test("a stalled Save WAV write restores controls and preserves the take even when abort also stalls", async ({ page }) => {
  await installFilePicker(page);
  await page.addInitScript(() => {
    const schedule = globalThis.setTimeout.bind(globalThis);
    globalThis.setTimeout = (callback, delay, ...args) => schedule(callback, delay === 15_000 ? 50 : delay, ...args);
  });
  await openInstrument(page);
  await addClockedTones(page);
  await startRecording(page);
  await page.waitForTimeout(650);
  await stopRecording(page);
  await page.locator(RECORD_NAME).fill("retry-this-take");
  await page.evaluate(() => {
    globalThis.__recordingFilePicker.stallNextWrite = true;
    globalThis.__recordingFilePicker.stallNextAbort = true;
  });
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  await expect(page.locator(".output-recording-message")).toContainText(/timed out/i);
  await expect(page.locator(RECORD_DIALOG)).toBeVisible();
  for (const label of ["Save WAV", "Cancel", "New recording"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeEnabled();
  }
  await expect(page.locator(RECORD_NAME)).toBeEditable();
  expect(await page.evaluate(() => globalThis.__recordingFilePicker.files[0].aborted)).toBe(true);
  await page.getByRole("button", { name: "Save WAV", exact: true }).click();
  await expect.poll(() => page.evaluate(() => globalThis.__recordingFilePicker.files[1]?.closed)).toBe(true);
  const file = await readPickedFile(page, 1);
  expect(file.calls).toHaveLength(2);
  expect(file.aborted).toBe(false);
  expect(file.calls[1].suggestedName).toBe("retry-this-take.wav");
  expectStereoTones(readStereoWave(file.bytes));
  await releaseClockedTones(page);
});
