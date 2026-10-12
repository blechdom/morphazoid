import { test, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

// Original, deterministic musical fixtures: independent transients and a quiet
// sustained chord, no filename/BPM tags or prefilled demo metadata.
function rhythmWave(bpm, offset, { duration = 24, quiet = false, pan = null } = {}) {
  const sampleRate = 16000, frames = Math.round(sampleRate * duration), channels = pan === null ? 1 : 2;
  const bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(frames * channels * 2, 40);
  let seed = 19017;
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    let sample = 0;
    if (!quiet) {
      const elapsed = time - offset, period = 60 / bpm;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      if (elapsed >= 0) {
        const beat = Math.floor(elapsed / period), phase = elapsed - beat * period;
        const eighth = elapsed % (period / 2);
        const kick = 0.5 * Math.exp(-phase / 0.045) * Math.sin(2 * Math.PI * 60 * phase);
        const snare = beat % 2 ? 0.14 * noise * Math.exp(-phase / 0.02) : 0;
        const hat = 0.035 * noise * Math.exp(-eighth / 0.008);
        sample = kick + snare + hat;
      }
      sample += 0.007 * [110, 137.5, 165].reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * time), 0);
      sample *= Math.min(1, time / 0.02, (duration - time) / 0.02);
    }
    const value = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
    for (let channel = 0; channel < channels; channel++) {
      bytes.writeInt16LE(pan === null || channel === pan ? value : 0, 44 + (i * channels + channel) * 2);
    }
  }
  return bytes;
}

const snapshot = (page) => page.evaluate(() => window.__trackazoid.snapshot());

async function ready(page) {
  await page.goto("/trackazoid.html");
  await expect(page.locator("#trackazoid")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#audioButton")).toBeEnabled();
}

async function upload(page, files) {
  await page.locator("#filePicker").setInputFiles(files);
  await expect.poll(async () => (await snapshot(page)).library.length).toBe(files.length);
}

async function load(page, name, deck) {
  await page.getByRole("button", { name: `Load ${name} into deck ${deck.toUpperCase()}`, exact: true }).click();
  await expect(page.locator(`#${deck}Title`)).toHaveText(name);
  await expect.poll(async () => (await snapshot(page)).decks[deck].loading).toBe(false);
}

async function analyzed(page, deck, expectedStatus = "ok") {
  await expect.poll(async () => {
    const state = (await snapshot(page)).decks[deck];
    return state.analyzing ? "analyzing" : state.metadata.analysis?.status;
  }, { timeout: 20_000 }).toBe(expectedStatus);
  return (await snapshot(page)).decks[deck];
}

async function audioOff(page) {
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  const state = await snapshot(page);
  expect(state.armed).toBe(false);
  expect(state.contextState).toBe("none");
}

async function slider(page, selector, value) {
  await page.locator(selector).evaluate((input, next) => {
    input.value = String(next); input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function corrections(page, deck) {
  const disclosure = page.locator(`#${deck}Adjust`);
  if (!(await disclosure.evaluate((element) => element.open))) await disclosure.locator("summary").click();
}

function beatDistance(position, offset, bpm) {
  const beat = (position - offset) * bpm / 60;
  return Math.abs(beat - Math.round(beat));
}

async function persistedTrack(page, name) {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const request = indexedDB.open("morphazoid-trackazoid-library", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, read = db.transaction("entries", "readonly").objectStore("entries").getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result.find((entry) => entry.name === name)?.metadata); };
    };
  }), name);
}

// Measure actual stereo output on its audio clock. A is panned left in its
// source file and B right, so transient alignment can be checked independently
// of the transport's phase model. The parallel probe contributes only silence.
async function installBeatProbe(page) {
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager(globalThis), context = manager.recordingContext();
    if (!context) throw new Error("Arm Audio before installing its beat probe");
    const source = `class BeatProbe extends AudioWorkletProcessor {
      constructor() { super(); this.capture = null; this.port.onmessage = ({data}) => { this.capture = {frames: data.frames, at: 0, blocks: []}; }; }
      process(inputs, outputs) {
        for (const channel of outputs[0] || []) channel.fill(0);
        const capture = this.capture, input = inputs[0];
        if (!capture || !input?.[0] || !input?.[1]) return true;
        let left = 0, right = 0, peak = 0, invalid = 0;
        for (let i = 0; i < input[0].length; i++) {
          const l = input[0][i], r = input[1][i];
          if (!Number.isFinite(l) || !Number.isFinite(r)) invalid++;
          left += l*l; right += r*r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
        }
        capture.blocks.push({time: capture.at / sampleRate, left: left / input[0].length, right: right / input[0].length, peak, invalid});
        capture.at += input[0].length;
        if (capture.at >= capture.frames) { this.port.postMessage(capture.blocks); this.capture = null; }
        return true;
      }
    }; registerProcessor("trackazoid-beat-probe", BeatProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const node = new AudioWorkletNode(context, "trackazoid-beat-probe", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit",
    });
    const release = manager.tapInto(context, node); node.connect(context.destination);
    window.__beatProbe = {
      capture: (seconds) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Beat probe did not finish")), seconds * 1000 + 5000);
        node.port.onmessage = ({data}) => { clearTimeout(timeout); resolve(data); };
        node.port.postMessage({frames: Math.ceil(seconds * context.sampleRate)});
      }),
      dispose: () => { release(); node.disconnect(); node.port.close(); },
    };
  });
}

async function alignedOutput(page) {
  const blocks = await page.evaluate(() => window.__beatProbe.capture(2.7));
  expect(blocks.every((block) => !block.invalid && Number.isFinite(block.left) && Number.isFinite(block.right))).toBe(true);
  expect(Math.max(...blocks.map(({peak}) => peak))).toBeLessThan(1);
  for (const channel of ["left", "right"]) {
    expect(Math.sqrt(blocks.reduce((sum, block) => sum + block[channel], 0) / blocks.length)).toBeGreaterThan(0.005);
  }
  const bpm = (await snapshot(page)).decks.a.effectiveBpm, period = 60 / bpm;
  const attacks = (channel) => {
    const threshold = Math.max(...blocks.map((block) => block[channel])) * 0.22;
    const found = [];
    for (let index = 1; index < blocks.length; index++) {
      const block = blocks[index];
      if (block.time < 0.25 || block.time > 2.45 || block[channel] < threshold || blocks[index - 1][channel] >= threshold) continue;
      if (!found.length || block.time - found.at(-1) > period * 0.5) found.push(block.time);
    }
    return found;
  };
  const left = attacks("left"), right = attacks("right");
  expect(left.length).toBeGreaterThanOrEqual(3); expect(right.length).toBeGreaterThanOrEqual(3);
  const errors = left.map((time) => Math.min(...right.map((other) => Math.abs(time - other))));
  // Ignore one boundary attack whose partner may lie outside the capture window.
  errors.sort((a, b) => a - b);
  expect(errors[Math.max(0, errors.length - 2)], `Audible onset gaps: ${errors.join(", ")}`).toBeLessThan(0.04);
  const { decks } = await snapshot(page);
  expect(decks.b.pending).toBe(false); expect(decks.b.sync).toBe(true);
  expect(Math.abs(decks.b.phaseError)).toBeLessThan(0.05);
  expect(Math.abs(decks.a.effectiveBpm - decks.b.effectiveBpm)).toBeLessThan(0.05);
}

async function holdAnalysisResults(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__analysisDelivery = { hold: true, messages: [], created: 0, terminated: 0,
      release(index = 0) { const message = this.messages.splice(index, 1)[0]; message?.deliver(); },
    };
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.isBeatAnalysis = String(url).includes("beat-analysis-worker.js");
        if (this.isBeatAnalysis) window.__analysisDelivery.created++;
      }
      deliverOrHold(callback, event) {
        const gate = window.__analysisDelivery;
        if (this.isBeatAnalysis && gate.hold) gate.messages.push({ result: event.data.result, deliver: () => callback.call(this, event) });
        else callback.call(this, event);
      }
      set onmessage(callback) {
        super.onmessage = typeof callback === "function" ? (event) => this.deliverOrHold(callback, event) : callback;
      }
      addEventListener(type, callback, options) {
        if (type === "message" && typeof callback === "function") {
          super.addEventListener(type, (event) => this.deliverOrHold(callback, event), options);
        } else super.addEventListener(type, callback, options);
      }
      terminate() {
        if (this.isBeatAnalysis) window.__analysisDelivery.terminated++;
        super.terminate();
      }
    };
  });
}

test("unknown uploads find their own beat grids and Sync before Play follows the master without arming Audio", async ({ page }) => {
  test.setTimeout(60_000);
  await ready(page);
  await upload(page, [
    { name: "Origin.wav", mimeType: "audio/wav", buffer: rhythmWave(114, 0.137) },
    { name: "Companion.wav", mimeType: "audio/wav", buffer: rhythmWave(126, 0.283) },
  ]);
  await load(page, "Origin.wav", "a");
  const first = await analyzed(page, "a");
  expect(first.metadata.gridSource).toBe("auto");
  expect(Math.abs(first.metadata.bpm - 114)).toBeLessThan(0.5);
  expect(beatDistance(first.metadata.beatOffset, 0.137, 114)).toBeLessThan(0.12);
  await load(page, "Companion.wav", "b");
  const second = await analyzed(page, "b");
  expect(second.metadata.gridSource).toBe("auto");
  expect(Math.abs(second.metadata.bpm - 126)).toBeLessThan(0.5);
  expect(beatDistance(second.metadata.beatOffset, 0.283, 126)).toBeLessThan(0.12);
  expect(first.keyLock).toBe(true); expect(second.keyLock).toBe(true);
  await expect(page.locator("#aKeyLock")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#bKeyLock")).toHaveAttribute("aria-pressed", "true");
  await audioOff(page);

  await page.locator("#bSync").click();
  expect((await snapshot(page)).decks.b.sync).toBe(true);
  await page.locator("#aPlay").click(); await page.locator("#bPlay").click();
  await expect.poll(async () => {
    const { master, decks } = await snapshot(page);
    return master === "a" && decks.a.playing && decks.b.playing && !decks.b.pending
      && Math.abs(decks.b.phaseError) < 0.05;
  }).toBe(true);
  await slider(page, "#aTempo", 3);
  await expect.poll(async () => {
    const { decks } = await snapshot(page);
    return !decks.b.pending && decks.b.sync && Math.abs(decks.a.effectiveBpm - decks.b.effectiveBpm) < 0.05
      && Math.abs(decks.b.phaseError) < 0.05;
  }).toBe(true);
  const matching = await snapshot(page);
  expect(matching.decks.a.effectiveBpm).toBeCloseTo(matching.decks.a.metadata.bpm * 1.03, 2);
  await page.locator("#bPlay").click();
  expect((await snapshot(page)).decks.b.sync).toBe(true);
  await page.locator("#bPlay").click();
  await expect.poll(async () => {
    const { decks } = await snapshot(page);
    return !decks.b.pending && decks.b.sync && Math.abs(decks.b.phaseError) < 0.05;
  }).toBe(true);
  await slider(page, "#bTempo", -1);
  expect((await snapshot(page)).decks.b.sync).toBe(false);
  await page.locator("#bSync").click();
  expect((await snapshot(page)).decks.b.sync).toBe(true);
  await corrections(page, "b"); await page.locator("#bNudgeForward").click();
  expect((await snapshot(page)).decks.b.sync).toBe(false);
  await audioOff(page);
  await expect(page.locator("#errorMessage")).toBeHidden();
});

test("armed output stays beat aligned with default and mixed Key Lock through tempo changes and Audio off/on", async ({ page }) => {
  test.setTimeout(75_000);
  await ready(page);
  await upload(page, [
    { name: "Left groove.wav", mimeType: "audio/wav", buffer: rhythmWave(114, 0.137, {pan: 0, duration: 40}) },
    { name: "Right groove.wav", mimeType: "audio/wav", buffer: rhythmWave(126, 0.283, {pan: 1, duration: 40}) },
  ]);
  await load(page, "Left groove.wav", "a"); await analyzed(page, "a");
  await load(page, "Right groove.wav", "b"); await analyzed(page, "b");
  await page.locator("#bSync").click(); await page.locator("#aPlay").click(); await page.locator("#bPlay").click();
  await audioOff(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  await expect.poll(async () => !(await snapshot(page)).decks.b.pending).toBe(true);
  await installBeatProbe(page);
  try {
    const armed = await snapshot(page);
    expect(armed.decks.a.keyLock).toBe(true); expect(armed.decks.b.keyLock).toBe(true);
    await alignedOutput(page);
    await slider(page, "#aTempo", 3);
    await expect.poll(async () => !(await snapshot(page)).decks.b.pending).toBe(true);
    await alignedOutput(page);
    await page.locator("#bKeyLock").click();
    await expect(page.locator("#bKeyLock")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#bKeyLock")).toBeEnabled();
    await alignedOutput(page);
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
    const muted = await sampleAudioEnvelope(page, {durationMs: 200});
    expect(muted.summary.maxRms).toBeLessThan(0.0001);
    const silent = await snapshot(page);
    expect(silent.decks.a.playing).toBe(true); expect(silent.decks.b.playing).toBe(true); expect(silent.decks.b.sync).toBe(true);
    await page.locator("#audioButton").click();
    await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
    await expect.poll(async () => !(await snapshot(page)).decks.b.pending).toBe(true);
    await alignedOutput(page);
    await expect(page.locator("#errorMessage")).toBeHidden();
  } finally { await page.evaluate(() => window.__beatProbe.dispose()); }
  await page.evaluate(() => window.__trackazoid.dispose());
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
});

test("manual half/double BPM and grid corrections survive reanalysis and reload until Use Auto is explicit", async ({ page }) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "trackazoid-beat-grid-"));
  const file = join(directory, "Unlabelled.wav");
  try {
    await writeFile(file, rhythmWave(114, 0.137));
    await ready(page); await upload(page, [file]); await load(page, "Unlabelled.wav", "a");
    await analyzed(page, "a"); await corrections(page, "a");
    await page.locator("#aBpm").fill("132");
    await page.locator("#aHalfBpm").click(); await expect(page.locator("#aBpm")).toHaveValue("66");
    await page.locator("#aDoubleBpm").click(); await expect(page.locator("#aBpm")).toHaveValue("132");
    await page.locator("#aWaveform").focus(); await page.keyboard.press("ArrowRight");
    const position = (await snapshot(page)).decks.a.position;
    await page.locator("#aGrid").click(); await page.locator("#aGridForward").click();
    expect((await snapshot(page)).decks.a.metadata.beatOffset).toBeCloseTo(position + 0.01, 6);
    await page.locator("#aGridBack").click();
    expect((await snapshot(page)).decks.a.metadata.beatOffset).toBeCloseTo(position, 6);
    await page.locator("#aGridForward").click();
    const manual = (await snapshot(page)).decks.a.metadata;
    expect(manual.gridSource).toBe("manual");
    await page.locator("#aAnalyze").click(); await analyzed(page, "a");
    const afterAnalysis = (await snapshot(page)).decks.a.metadata;
    expect(afterAnalysis.gridSource).toBe("manual");
    expect(afterAnalysis.bpm).toBe(132);
    expect(afterAnalysis.beatOffset).toBe(manual.beatOffset);
    await expect.poll(async () => {
      const saved = await persistedTrack(page, "Unlabelled.wav");
      return saved && { bpm: saved.bpm, beatOffset: saved.beatOffset, gridSource: saved.gridSource };
    }).toEqual({ bpm: 132, beatOffset: manual.beatOffset, gridSource: "manual" });

    await ready(page);
    await expect(page.locator("#trackRows tr.tz-unavailable")).toHaveCount(1);
    await upload(page, [file]); await load(page, "Unlabelled.wav", "a");
    expect((await snapshot(page)).decks.a.metadata.bpm).toBe(132);
    expect((await snapshot(page)).decks.a.metadata.beatOffset).toBe(manual.beatOffset);
    expect((await snapshot(page)).decks.a.metadata.gridSource).toBe("manual");
    await corrections(page, "a");
    await page.locator("#aUseAuto").click();
    await expect.poll(async () => (await snapshot(page)).decks.a.metadata.gridSource).toBe("auto");
    expect(Math.abs((await snapshot(page)).decks.a.metadata.bpm - 114)).toBeLessThan(0.5);
    await audioOff(page);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ambiguous audio exposes missing beat confidence and needs a manual grid before Sync", async ({ page }) => {
  await ready(page);
  await upload(page, [
    { name: "No pulses.wav", mimeType: "audio/wav", buffer: rhythmWave(114, 0.137, { quiet: true }) },
    { name: "Reference.wav", mimeType: "audio/wav", buffer: rhythmWave(126, 0.283) },
  ]);
  await load(page, "No pulses.wav", "a");
  const ambiguous = await analyzed(page, "a", "unreliable");
  expect(ambiguous.metadata.gridSource).toBe("unknown");
  await expect(page.locator("#aAnalysisStatus")).toContainText("No steady beat found");
  await expect(page.locator("#aPlay")).toBeEnabled();
  await load(page, "Reference.wav", "b"); await analyzed(page, "b");
  await expect(page.locator("#aSync")).toBeDisabled();
  await expect(page.locator("#bSync")).toBeDisabled();
  await corrections(page, "a"); await page.locator("#aBpm").fill("120");
  await page.locator("#aGrid").click();
  expect((await snapshot(page)).decks.a.metadata.gridSource).toBe("manual");
  await expect(page.locator("#aSync")).toBeEnabled();
  await audioOff(page);
});

test("analysis worker failure leaves playable audio and a visible manual/retry route", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes("beat-analysis-worker.js")) throw new DOMException("Test analyzer startup denied", "SecurityError");
        super(url, options);
      }
    };
  });
  await ready(page);
  await upload(page, [{ name: "Still playable.wav", mimeType: "audio/wav", buffer: rhythmWave(114, 0.137) }]);
  await load(page, "Still playable.wav", "a");
  await expect(page.locator("#aAnalysisStatus")).toContainText("Analysis unavailable");
  await expect(page.locator("#aPlay")).toBeEnabled();
  await expect(page.locator("#aSync")).toBeDisabled();
  await corrections(page, "a"); await expect(page.locator("#aAnalyze")).toBeEnabled();
  await page.locator("#aBpm").fill("114"); await page.locator("#aGrid").click();
  expect((await snapshot(page)).decks.a.metadata.gridSource).toBe("manual");
  await page.locator("#aPlay").click();
  await expect(page.locator("#aPlay")).toHaveAttribute("aria-pressed", "true");
  await audioOff(page);
});

test("manual edits win over in-flight analysis on both decks holding the same file", async ({ page }) => {
  await holdAnalysisResults(page); await ready(page);
  await upload(page, [{ name: "Shared groove.wav", mimeType: "audio/wav", buffer: rhythmWave(114, 0.137) }]);
  await load(page, "Shared groove.wav", "a"); await load(page, "Shared groove.wav", "b");
  await expect.poll(() => page.evaluate(() => window.__analysisDelivery.messages.length), { timeout: 20_000 }).toBe(2);
  await page.locator("#aPlay").click();
  await expect.poll(async () => (await snapshot(page)).decks.a.position).toBeGreaterThan(0.1);
  expect((await snapshot(page)).decks.a.analyzing).toBe(true);
  await audioOff(page); await page.locator("#aPlay").click();
  await corrections(page, "a"); await page.locator("#aBpm").fill("132");
  await page.locator("#aGrid").click();
  const manual = (await snapshot(page)).decks.a.metadata;
  await page.evaluate(() => {
    window.__analysisDelivery.hold = false;
    window.__analysisDelivery.release(0); window.__analysisDelivery.release(0);
  });
  await analyzed(page, "a"); await analyzed(page, "b");
  const { decks } = await snapshot(page);
  expect(decks.a.entry).toBe(decks.b.entry);
  for (const deck of [decks.a, decks.b]) {
    expect(deck.metadata.gridSource).toBe("manual");
    expect(deck.metadata.bpm).toBe(132); expect(deck.metadata.beatOffset).toBe(manual.beatOffset);
    expect(Math.abs(deck.metadata.analysis.bpm - 114)).toBeLessThan(0.5);
  }
  await audioOff(page);
});

test("late analysis cannot apply an old track's grid to its replacement", async ({ page }) => {
  test.setTimeout(60_000);
  await holdAnalysisResults(page); await ready(page);
  await upload(page, [
    { name: "Earlier.wav", mimeType: "audio/wav", buffer: rhythmWave(114, 0.137) },
    { name: "Latest.wav", mimeType: "audio/wav", buffer: rhythmWave(126, 0.283) },
  ]);
  await load(page, "Earlier.wav", "a");
  await expect.poll(() => page.evaluate(() => window.__analysisDelivery.messages.length), { timeout: 20_000 }).toBe(1);
  await expect(page.locator("#aSync")).toBeDisabled();
  await expect(page.locator("#aPlay")).toBeEnabled();
  const oldEntry = (await snapshot(page)).decks.a.entry;
  await load(page, "Latest.wav", "a");
  const newEntry = (await snapshot(page)).decks.a.entry;
  expect(newEntry).not.toBe(oldEntry);
  await expect.poll(() => page.evaluate(() => window.__analysisDelivery.messages.length), { timeout: 20_000 }).toBe(2);
  await page.evaluate(() => window.__analysisDelivery.release(0));
  const pending = (await snapshot(page)).decks.a;
  expect(pending.entry).toBe(newEntry);
  expect(pending.analyzing).toBe(true);
  expect(pending.metadata.gridSource).toBe("unknown");
  await page.evaluate(() => { window.__analysisDelivery.hold = false; window.__analysisDelivery.release(0); });
  const final = await analyzed(page, "a");
  expect(final.entry).toBe(newEntry);
  expect(Math.abs(final.metadata.bpm - 126)).toBeLessThan(0.5);
  await audioOff(page);
});

test("disposing during analysis terminates its worker and ignores the delayed result", async ({ page }) => {
  await holdAnalysisResults(page); await ready(page);
  await upload(page, [{ name: "Leaving.wav", mimeType: "audio/wav", buffer: rhythmWave(114, 0.137) }]);
  await load(page, "Leaving.wav", "a");
  await expect.poll(() => page.evaluate(() => window.__analysisDelivery.messages.length), { timeout: 20_000 }).toBe(1);
  const before = (await snapshot(page)).decks.a.metadata;
  await page.evaluate(() => window.__trackazoid.dispose());
  expect((await snapshot(page)).disposed).toBe(true);
  expect(await page.evaluate(() => window.__analysisDelivery.terminated)).toBeGreaterThan(0);
  await page.evaluate(() => { window.__analysisDelivery.hold = false; window.__analysisDelivery.release(0); });
  const after = await snapshot(page);
  expect(after.disposed).toBe(true);
  expect(after.decks.a.metadata).toEqual(before);
  expect(after.contextState).toBe("none");
});
